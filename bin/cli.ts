#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { getCommits, getLatestTag, getRepoUrl } from '../src/gitlog.js';
import { parseConventionalCommit } from '../src/parser.js';
import { computeBump, bumpVersion } from '../src/semver.js';
import { renderChangelog } from '../src/render.js';
import type { ParsedCommit, RawCommit } from '../src/types.js';

export interface CliOptions {
  /** Range start; null when `--from` was not given (resolved at run time from the latest tag). */
  from: string | null;
  /** Range end, default `'HEAD'`. */
  to: string;
  /** Output file path, or null to write to stdout. */
  out: string | null;
  /** Print only the computed next version. */
  bumpOnly: boolean;
  /** Render the `Unreleased` heading instead of a version. */
  noVersion: boolean;
  /** Normalized `--tag` (leading `v` stripped), or null when absent. */
  tag: string | null;
}

/** I/O seams for orchestration; injected by tests, provided by the runtime. */
export interface CliDeps {
  getCommits(fromRef: string | null, toRef: string): RawCommit[];
  getLatestTag(): string | null;
  getRepoUrl(): string | null;
  /** Atomic write-into-place. Throws on failure so callers can exit 1. */
  writeFile(path: string, content: string): void;
}

export interface ExecuteResult {
  exitCode: number;
  stdout: string | null;
  stderr: string | null;
}

/** A usage error (bad flag, missing value, invalid `--tag`) — maps to exit code 2. */
export class UsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UsageError';
  }
}

function stripLeadingV(version: string): string {
  return version.startsWith('v') ? version.slice(1) : version;
}

function singleLine(message: string): string {
  return message.replace(/\s+/gu, ' ').trim();
}

/** Pure argument parsing. Throws UsageError on usage errors (exit 2). */
export function parseCliOptions(argv: string[]): CliOptions {
  let values: {
    from?: string;
    to?: string;
    out?: string;
    'bump-only'?: boolean;
    'no-version'?: boolean;
    tag?: string;
  };
  try {
    values = parseArgs({
      options: {
        from: { type: 'string' },
        to: { type: 'string' },
        out: { type: 'string' },
        'bump-only': { type: 'boolean' },
        'no-version': { type: 'boolean' },
        tag: { type: 'string' },
      },
      args: argv,
    }).values;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new UsageError(message);
  }

  const nonEmptyString = (v: string | undefined): string | null =>
    typeof v === 'string' && v.length > 0 ? v : null;

  const rawTag = nonEmptyString(values.tag);
  return {
    from: nonEmptyString(values.from),
    to: nonEmptyString(values.to) ?? 'HEAD',
    out: nonEmptyString(values.out),
    bumpOnly: values['bump-only'] === true,
    noVersion: values['no-version'] === true,
    tag: rawTag === null ? null : stripLeadingV(rawTag),
  };
}

/**
 * Orchestration: resolve range -> get commits -> parse -> bump -> render.
 * Returns the output content (next version for --bump-only, else the
 * rendered markdown). Throws UsageError (exit 2) for bad `--tag`, and any
 * error from `deps.getCommits` (e.g. GitError) propagates as a runtime
 * error (exit 1). No output is written here — the caller writes atomically.
 */
export function runCli(options: CliOptions, deps: CliDeps): string {
  // Validate --tag up front: an invalid override is a usage error (exit 2),
  // independent of the repository or git state.
  if (options.tag !== null) {
    try {
      bumpVersion(options.tag, 'none');
    } catch {
      throw new UsageError(`invalid --tag version: '${options.tag}'`);
    }
  }

  const latestTag = deps.getLatestTag();
  // `--from none` is the escape hatch for "no previous tag" (full history);
  // an omitted --from falls back to the latest tag (or full history when
  // there are no tags, since getLatestTag returns null).
  const fromRef =
    options.from === null
      ? latestTag
      : options.from === 'none'
        ? null
        : options.from;

  const rawCommits = deps.getCommits(fromRef, options.to);

  const parsed: ParsedCommit[] = [];
  for (const raw of rawCommits) {
    const commit = parseConventionalCommit(raw);
    if (commit !== null) parsed.push(commit);
  }

  const bump = computeBump(parsed);
  const baseVersion = latestTag === null ? '0.0.0' : stripLeadingV(latestTag);
  const next = bumpVersion(baseVersion, bump);

  if (options.bumpOnly) {
    const version = options.tag !== null ? options.tag : next;
    return `${version}\n`;
  }

  const version: string | null = options.noVersion
    ? null
    : options.tag !== null
      ? options.tag
      : next;
  const repoUrl = deps.getRepoUrl();

  return renderChangelog(parsed, { version, linkCompare: true, repoUrl });
}

/** Wire parse + orchestrate + exit. Pure and dependency-injected for tests. */
export function execute(argv: string[], deps: CliDeps): ExecuteResult {
  let options: CliOptions;
  try {
    options = parseCliOptions(argv);
  } catch (err) {
    if (err instanceof UsageError) {
      return { exitCode: 2, stdout: null, stderr: err.message };
    }
    throw err;
  }

  let content: string;
  try {
    content = runCli(options, deps);
  } catch (err) {
    if (err instanceof UsageError) {
      return { exitCode: 2, stdout: null, stderr: err.message };
    }
    const message = err instanceof Error ? err.message : String(err);
    return { exitCode: 1, stdout: null, stderr: singleLine(message) };
  }

  if (options.out !== null) {
    try {
      // Only reached after the full run succeeded, so a failed or aborted
      // write never leaves partial output (atomic no-write-on-failure).
      deps.writeFile(options.out, content);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { exitCode: 1, stdout: null, stderr: singleLine(message) };
    }
    return { exitCode: 0, stdout: null, stderr: null };
  }

  return { exitCode: 0, stdout: content, stderr: null };
}

/** Write to a sibling temp file, then atomically rename into place. */
function atomicWriteFile(path: string, content: string): void {
  const tmp = join(
    dirname(path),
    `.${basename(path)}.tmp-${process.pid}-${Math.random().toString(36).slice(2)}`,
  );
  writeFileSync(tmp, content, 'utf8');
  try {
    renameSync(tmp, path);
  } catch (err) {
    try {
      unlinkSync(tmp);
    } catch {
      // best-effort cleanup of the temp file
    }
    throw err;
  }
}

const DEFAULT_DEPS: CliDeps = {
  getCommits: (fromRef, toRef) => getCommits(fromRef, toRef),
  getLatestTag,
  getRepoUrl,
  writeFile: atomicWriteFile,
};

function main(): void {
  // process.argv[0] = node, argv[1] = this script; real args start at [2].
  const result = execute(process.argv.slice(2), DEFAULT_DEPS);
  if (result.stdout !== null) {
    process.stdout.write(result.stdout);
  }
  if (result.stderr !== null) {
    process.stderr.write(`${result.stderr}\n`);
  }
  process.exitCode = result.exitCode;
}

// Portably detect whether this module is the direct CLI entry point. The
// `import.meta.main` property is only available on newer Node (>=22); the
// path comparison works on every supported Node version including 20.
if (
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main();
}