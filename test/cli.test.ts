import assert from 'node:assert/strict';
import test from 'node:test';
import {
  parseCliOptions,
  runCli,
  execute,
  UsageError,
} from '../bin/cli.js';
import type { CliDeps } from '../bin/cli.js';
import { GitError } from '../src/gitlog.js';

type Commit = { hash: string; message: string };

function commit(seed: string, message: string): Commit {
  return { hash: seed.repeat(40), message };
}

const FEAT = (): Commit => commit('a', 'feat: add rate limiting');
const FIX = (): Commit => commit('b', 'fix: fix socket leak');
const NONCONFORMING = (): Commit => commit('c', 'Merge branch main');

type DepOverrides = {
  commits?: Commit[];
  latestTag?: string | null;
  repoUrl?: string | null;
  getCommits?: (from: string | null, to: string) => Commit[];
  writeFile?: (path: string, content: string) => void;
};

/** Build a CliDeps mock. Records getCommits args so tests can assert the range. */
function deps(over: DepOverrides = {}): CliDeps & { calls: Array<[string | null, string]> } {
  const calls: Array<[string | null, string]> = [];
  const commits = over.commits ?? [];
  return {
    getCommits: over.getCommits ?? ((from, to) => {
      calls.push([from, to]);
      void to;
      return commits;
    }),
    getLatestTag: () => (over.latestTag === undefined ? null : over.latestTag),
    getRepoUrl: () => (over.repoUrl === undefined ? null : over.repoUrl),
    writeFile: over.writeFile ?? (() => {}),
    calls,
  };
}

// ---------------------------------------------------------------------------
// parseCliOptions
// ---------------------------------------------------------------------------

test('parseCliOptions returns defaults when no flags are given', () => {
  const o = parseCliOptions([]);
  assert.equal(o.from, null);
  assert.equal(o.to, 'HEAD');
  assert.equal(o.out, null);
  assert.equal(o.bumpOnly, false);
  assert.equal(o.noVersion, false);
  assert.equal(o.tag, null);
});

test('parseCliOptions parses every flag and strips a leading v from --tag', () => {
  const o = parseCliOptions([
    '--from', 'v2.0.0',
    '--to', 'dev',
    '--out', 'CHANGELOG.md',
    '--bump-only',
    '--no-version',
    '--tag', 'v1.2.3',
  ]);
  assert.equal(o.from, 'v2.0.0');
  assert.equal(o.to, 'dev');
  assert.equal(o.out, 'CHANGELOG.md');
  assert.equal(o.bumpOnly, true);
  assert.equal(o.noVersion, true);
  assert.equal(o.tag, '1.2.3');
});

test('parseCliOptions keeps an un-prefixed --tag as-is', () => {
  assert.equal(parseCliOptions(['--tag', '1.2.3']).tag, '1.2.3');
});

test('parseCliOptions accepts the --from none escape hatch', () => {
  assert.equal(parseCliOptions(['--from', 'none']).from, 'none');
});

test('parseCliOptions throws UsageError on an unknown flag', () => {
  assert.throws(() => parseCliOptions(['--wat']), UsageError);
});

test('parseCliOptions throws UsageError when a flag value is missing', () => {
  assert.throws(() => parseCliOptions(['--tag']), UsageError);
});

// ---------------------------------------------------------------------------
// runCli orchestration (real parser/semver/render, mocked gitlog seams)
// ---------------------------------------------------------------------------

test('runCli uses latest tag as range start when --from is omitted', () => {
  const d = deps({ commits: [FIX()], latestTag: 'v1.0.0' });
  runCli(parseCliOptions([]), d);
  assert.deepEqual(d.calls[0], ['v1.0.0', 'HEAD']);
});

test('runCli uses full history (null from) when there is no tag and --from omitted', () => {
  const d = deps({ commits: [FIX()], latestTag: null });
  runCli(parseCliOptions([]), d);
  assert.deepEqual(d.calls[0], [null, 'HEAD']);
});

test('runCli treats --from none as full history', () => {
  const d = deps({ commits: [FIX()] });
  runCli(parseCliOptions(['--from', 'none']), d);
  assert.deepEqual(d.calls[0], [null, 'HEAD']);
});

test('runCli passes an explicit --from and --to through to getCommits', () => {
  const d = deps({ commits: [FIX()] });
  runCli(parseCliOptions(['--from', 'feature/x', '--to', 'rel/1.1']), d);
  assert.deepEqual(d.calls[0], ['feature/x', 'rel/1.1']);
});

test('runCli renders the next-version heading computed from the latest tag', () => {
  const d = deps({ commits: [FEAT()], latestTag: 'v1.2.3' });
  const out = runCli(parseCliOptions([]), d);
  assert.match(out, /^## v1\.3\.0 \(\d{4}-\d{2}-\d{2}\)\n/);
  assert.match(out, /### Features\n\n- add rate limiting \(a{7}\)/);
});

test('runCli renders an Unreleased heading with --no-version', () => {
  const d = deps({ commits: [FIX()], latestTag: 'v1.0.0' });
  const out = runCli(parseCliOptions(['--no-version']), d);
  assert.match(out, /^## Unreleased\n/);
});

test('runCli --tag overrides the heading version, with leading v stripped', () => {
  const d = deps({ commits: [FEAT()], latestTag: 'v1.2.3' });
  const out = runCli(parseCliOptions(['--tag', 'v9.9.9']), d);
  assert.match(out, /^## v9\.9\.9 \(\d{4}-\d{2}-\d{2}\)\n/);
});

test('runCli throws UsageError for an invalid --tag version', () => {
  const d = deps({ commits: [FEAT()], latestTag: 'v1.0.0' });
  assert.throws(() => runCli(parseCliOptions(['--tag', 'not-a-version']), d), UsageError);
});

test('runCli --bump-only returns just the computed next version', () => {
  const d = deps({ commits: [FEAT()], latestTag: 'v1.2.3' });
  const out = runCli(parseCliOptions(['--bump-only']), d);
  assert.equal(out, '1.3.0\n');
});

test('runCli bumps from 0.0.0 when there is no tag (first release)', () => {
  const d = deps({ commits: [FEAT(), FIX()], latestTag: null });
  const out = runCli(parseCliOptions(['--bump-only']), d);
  assert.equal(out, '0.1.0\n');
});

test('runCli downgrades a 0.x breaking change to a minor bump', () => {
  const d = deps({ commits: [commit('d', 'feat(api)!: drop v1')], latestTag: 'v0.4.0' });
  const out = runCli(parseCliOptions(['--bump-only']), d);
  assert.equal(out, '0.5.0\n');
});

test('runCli skips non-conforming commits and reports a none bump', () => {
  const d = deps({ commits: [NONCONFORMING()] });
  const out = runCli(parseCliOptions(['--bump-only']), d);
  assert.equal(out, '0.0.0\n');
});

test('runCli propagates a git failure as a runtime error', () => {
  const bad = (): Commit[] => {
    throw new GitError('git log failed', 'fatal: bad revision', 128);
  };
  const d = deps({ getCommits: bad, latestTag: 'v1.0.0' });
  assert.throws(() => runCli(parseCliOptions([]), d), GitError);
});

// ---------------------------------------------------------------------------
// execute: exit codes, single-line stderr, atomic no-write-on-failure
// ---------------------------------------------------------------------------

test('execute returns exit 0 and stdout for a successful stdout run', () => {
  const d = deps({ commits: [FEAT()], latestTag: 'v1.2.3' });
  const r = execute(['--bump-only'], d);
  assert.equal(r.exitCode, 0);
  assert.equal(r.stdout, '1.3.0\n');
  assert.equal(r.stderr, null);
});

test('execute returns exit 2 for an unknown flag', () => {
  const r = execute(['--wat'], deps());
  assert.equal(r.exitCode, 2);
  assert.equal(r.stdout, null);
  assert.match(r.stderr ?? '', /--wat/);
});

test('execute returns exit 2 for an invalid --tag', () => {
  const r = execute(['--tag', 'garbage'], deps());
  assert.equal(r.exitCode, 2);
});

test('execute returns exit 1 and a single-line stderr on a runtime git failure', () => {
  const bad = (): Commit[] => {
    throw new GitError('git log failed', 'line one\nline two\n', 128);
  };
  const d = deps({ getCommits: bad, latestTag: 'v1.0.0' });
  const r = execute([], d);
  assert.equal(r.exitCode, 1);
  assert.equal(r.stdout, null);
  assert.ok(r.stderr !== null);
  assert.equal(r.stderr.includes('\n'), false, `stderr should be single-line, got: ${r.stderr}`);
  assert.match(r.stderr, /git log failed/);
});

test('execute writes --out file content atomically and writes nothing to stdout', () => {
  const writes: Array<[string, string]> = [];
  const d = deps({
    commits: [FIX()],
    latestTag: 'v1.0.0',
    writeFile: (p, c) => writes.push([p, c]),
  });
  const r = execute(['--out', 'CHANGELOG.md'], d);
  assert.equal(r.exitCode, 0);
  assert.equal(r.stdout, null);
  assert.equal(writes.length, 1);
  const [path, content] = writes[0] as [string, string];
  assert.equal(path, 'CHANGELOG.md');
  assert.match(content, /^## v1\.0\.1 \(\d{4}-\d{2}-\d{2}\)\n/);
});

test('execute does not write the --out file when the run fails', () => {
  const writes: Array<[string, string]> = [];
  const bad = (): Commit[] => {
    throw new GitError('boom', 'baz', 1);
  };
  const d = deps({ getCommits: bad, latestTag: 'v1.0.0', writeFile: (p, c) => writes.push([p, c]) });
  const r = execute(['--out', 'CHANGELOG.md'], d);
  assert.equal(r.exitCode, 1);
  assert.equal(writes.length, 0);
});

test('execute returns exit 1 when writing the output file fails', () => {
  const d = deps({
    commits: [FIX()],
    latestTag: 'v1.0.0',
    writeFile: () => {
      throw new Error('permission denied');
    },
  });
  const r = execute(['--out', '/proc/no-write'], d);
  assert.equal(r.exitCode, 1);
  assert.equal(r.stdout, null);
  assert.match(r.stderr ?? '', /permission denied/);
});