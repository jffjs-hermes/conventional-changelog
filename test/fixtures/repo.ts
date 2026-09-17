import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * Throwaway git fixture repo (spec §6.1). Each repo is an isolated temp dir.
 * Clean up with destroyRepo() (call from a test `after` hook).
 */
export interface FixtureRepo {
  dir: string;
  /** Write a file, stage it, and commit with the given message. Returns full SHA. */
  commitAll: (message: string) => string;
  /** Create a (lightweight) tag at HEAD. Returns the tag name. */
  tag: (name: string) => string;
  /** Run an arbitrary `git` command in the fixture and return stdout. */
  git: (...args: string[]) => string;
}

export function createRepo(): FixtureRepo {
  const dir = mkdtempSync(join(tmpdir(), 'cc-gitlog-test-'));
  git(dir, 'init', '-q');
  git(dir, 'config', 'user.name', 'Fixture User');
  git(dir, 'config', 'user.email', 'fixture@example.com');

  let n = 0;
  const commitAll = (message: string): string => {
    n += 1;
    writeFileSync(join(dir, `f-${n}.txt`), `content ${n}\n`);
    git(dir, 'add', '.');
    // Deterministic, monotonically increasing author/committer dates.
    const stamp = new Date(Date.UTC(2026, 0, 1, 0, 0, n)).toISOString();
    gitWithEnv(
      dir,
      { GIT_AUTHOR_DATE: stamp, GIT_COMMITTER_DATE: stamp },
      'commit', '-q', '-m', message,
    );
    return git(dir, 'rev-parse', 'HEAD').trim();
  };

  return {
    dir,
    commitAll,
    tag: (name: string): string => {
      git(dir, 'tag', name);
      return name;
    },
    git: (...args: string[]) => git(dir, ...args),
  };
}

export function destroyRepo(repo: FixtureRepo): void {
  rmSync(repo.dir, { recursive: true, force: true });
}

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' });
}

function gitWithEnv(
  cwd: string,
  env: Record<string, string>,
  ...args: string[]
): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8', env: { ...process.env, ...env } });
}