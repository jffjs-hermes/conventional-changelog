import { execFile, execFileSync } from 'node:child_process';

export interface RawCommit {
  hash: string;
  message: string;
}

export class GitError extends Error {
  readonly stderr: string;
  readonly exitCode: number;

  constructor(message: string, stderr: string, exitCode: number) {
    super(message);
    this.name = 'GitError';
    this.stderr = stderr;
    this.exitCode = exitCode;
  }
}

/**
 * Record layout is `%H` (full hash) NUL `%B` (raw message) RS (0x1e).
 * git appends a trailing newline after each record's RS.
 */
const LOG_FORMAT = '%H%x00%B%x1e';
const RS = 0x1e;
const LF = 0x0a;

/**
 * Run git synchronously, translating a nonzero exit / spawn failure into a
 * typed `GitError` carrying the captured stderr and exit code.
 */
function runGit(args: string[]): string {
  try {
    return execFileSync('git', args, { encoding: 'utf8' });
  } catch (err) {
    const e = err as Error & { stderr?: unknown; status?: number };
    const stderr = typeof e.stderr === 'string' ? e.stderr : '';
    const exitCode = typeof e.status === 'number' ? e.status : 1;
    throw new GitError(
      `git ${args[0] ?? ''} failed: ${stderr.trim() || 'unknown error'}`,
      stderr,
      exitCode,
    );
  }
}

/** Run git asynchronously, rejecting with a typed `GitError` on failure. */
function runGitAsync(args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile('git', args, { encoding: 'utf8' }, (err, stdout) => {
      if (err) {
        const e = err as Error & { stderr?: unknown; code?: number | string };
        const stderr = typeof e.stderr === 'string' ? e.stderr : '';
        const exitCode = typeof e.code === 'number' ? e.code : 1;
        reject(
          new GitError(
            `git ${args[0] ?? ''} failed: ${stderr.trim() || 'unknown error'}`,
            stderr,
            exitCode,
          ),
        );
      } else {
        resolve(stdout);
      }
    });
  });
}

/**
 * Byte-exact parse of `git log --format=%H%x00%B%x1e` output.
 * Each record is: hash NUL message RS + optional LF. Parsing is driven by the
 * separator bytes, so arbitrary message content (including literal `%H`,
 * newlines, unicode) is preserved verbatim and never re-interpreted.
 */
function parseGitLogOutput(stdout: string): RawCommit[] {
  const buf = Buffer.from(stdout, 'utf8');
  const commits: RawCommit[] = [];
  let i = 0;
  while (i < buf.length) {
    const nul = buf.indexOf(0, i);
    if (nul === -1) break;
    const rs = buf.indexOf(RS, nul);
    if (rs === -1) break;
    const hash = buf.subarray(i, nul).toString('utf8');
    // git terminates the raw body (`%B`) with a trailing newline; strip it so
    // `message` is the clean message text.
    const message = buf
      .subarray(nul + 1, rs)
      .toString('utf8')
      .replace(/\n+$/, '');
    commits.push({ hash, message });
    i = rs + 1;
    if (buf[i] === LF) i += 1; // git terminates each record with a newline
  }
  return commits;
}

function logArgs(fromRef: string | null, toRef: string): string[] {
  const range = fromRef === null ? toRef : `${fromRef}..${toRef}`;
  return ['log', range, `--format=${LOG_FORMAT}`];
}

export function getCommits(fromRef: string | null, toRef = 'HEAD'): RawCommit[] {
  return parseGitLogOutput(runGit(logArgs(fromRef, toRef)));
}

export async function getCommitsAsync(
  fromRef: string | null,
  toRef = 'HEAD',
): Promise<RawCommit[]> {
  return parseGitLogOutput(await runGitAsync(logArgs(fromRef, toRef)));
}

/**
 * Latest tag reachable from HEAD (`git describe --tags --abbrev=0` semantics),
 * or null when the history has no describable tag.
 */
export function getLatestTag(): string | null {
  try {
    const out = execFileSync(
      'git',
      ['describe', '--tags', '--abbrev=0'],
      { encoding: 'utf8' },
    ).trim();
    return out === '' ? null : out;
  } catch {
    return null;
  }
}

/** The configured `remote.origin.url`, or null when no origin remote is set. */
export function getRepoUrl(): string | null {
  try {
    const out = execFileSync(
      'git',
      ['config', '--get', 'remote.origin.url'],
      { encoding: 'utf8' },
    ).trim();
    return out === '' ? null : out;
  } catch {
    return null;
  }
}