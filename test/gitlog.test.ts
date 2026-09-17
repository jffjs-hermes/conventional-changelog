import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRepo, destroyRepo, type FixtureRepo } from './fixtures/repo.js';
import {
  getCommits,
  getCommitsAsync,
  getLatestTag,
  getRepoUrl,
  GitError,
} from '../src/gitlog.js';

const HASH_RE = /^[0-9a-f]{40}$/;

/**
 * Run a test body with a fresh fixture repo as the process cwd.
 * The body may be async; cleanup + cwd restore happen in `finally`.
 */
async function inRepo(body: (repo: FixtureRepo) => void | Promise<void>): Promise<void> {
  const repo = createRepo();
  const saved = process.cwd();
  process.chdir(repo.dir);
  try {
    await body(repo);
  } finally {
    process.chdir(saved);
    destroyRepo(repo);
  }
}

test('getCommits(null) returns the entire history, newest first', async () => {
  await inRepo((repo) => {
    const first = repo.commitAll('feat: alpha');
    repo.commitAll('fix: beta');

    const commits = getCommits(null);
    assert.equal(commits.length, 2);
    assert.deepEqual(
      commits.map((c) => c.message),
      ['fix: beta', 'feat: alpha'],
    );
    assert.equal(commits[1]!.hash, first);
    for (const c of commits) assert.match(c.hash, HASH_RE);
  });
});

test('getCommits with a fromRef excludes the fromRef commit from the range', async () => {
  await inRepo((repo) => {
    repo.commitAll('feat: alpha');
    repo.tag('v1.0.0');
    repo.commitAll('fix: after tag');

    const sinceTag = getCommits('v1.0.0');
    assert.equal(sinceTag.length, 1);
    assert.deepEqual(sinceTag[0]!.message, 'fix: after tag');

    const full = getCommits(null);
    assert.equal(full.length, 2);
  });
});

test('getCommits defaults toRef to HEAD', async () => {
  await inRepo((repo) => {
    repo.commitAll('feat: alpha');
    repo.tag('v1.0.0');
    repo.commitAll('fix: one');
    repo.commitAll('feat: two');

    const afterTag = getCommits('v1.0.0');
    assert.deepEqual(
      afterTag.map((c) => c.message),
      ['feat: two', 'fix: one'],
    );
  });
});

test('getCommits honours an explicit toRef (exclusive from, inclusive to)', async () => {
  await inRepo((repo) => {
    repo.commitAll('feat: alpha');
    const middle = repo.commitAll('fix: middle');
    const last = repo.commitAll('feat: last');

    const upToMiddle = getCommits(null, middle);
    assert.deepEqual(upToMiddle.map((c) => c.message), ['fix: middle', 'feat: alpha']);

    const slice = getCommits(middle, last);
    assert.deepEqual(slice.map((c) => c.message), ['feat: last']);
  });
});

test('parsing is immune to literal format tokens in the message (%H %x00 %B %x1e)', async () => {
  await inRepo((repo) => {
    const msg = 'fix: literal %H %x00 %B %x1e inside a message';
    const hash = repo.commitAll(msg);

    const commits = getCommits(null);
    assert.equal(commits.length, 1);
    assert.equal(commits[0]!.hash, hash);
    assert.equal(commits[0]!.message, msg);
  });
});

test('multi-line bodies (message) are preserved verbatim', async () => {
  await inRepo((repo) => {
    const msg = 'feat: multi line\n\nBody paragraph one.\n\n- bullet\nfoot: value';
    repo.commitAll(msg);

    const commits = getCommits(null);
    assert.equal(commits.length, 1);
    assert.equal(commits[0]!.message, msg);
  });
});

test('getCommitsAsync matches getCommits', async () => {
  await inRepo(async (repo) => {
    repo.commitAll('feat: alpha');
    repo.commitAll('fix: beta');

    const sync = getCommits(null);
    const asyncResult = await getCommitsAsync(null);
    assert.deepEqual(asyncResult, sync);
  });
});

test('getRepoUrl returns the configured remote origin URL or null', async () => {
  await inRepo((repo) => {
    assert.equal(getRepoUrl(), null);
    repo.git('remote', 'add', 'origin', 'https://github.com/example/proj.git');
    assert.equal(getRepoUrl(), 'https://github.com/example/proj.git');
  });
});

test('getLatestTag returns the most recent reachable tag, null when tagless', async () => {
  await inRepo((repo) => {
    assert.equal(getLatestTag(), null);
    repo.commitAll('feat: alpha');
    repo.tag('v0.1.0');
    repo.commitAll('fix: beta');
    repo.tag('v0.2.0');
    assert.equal(getLatestTag(), 'v0.2.0');
  });
});

test('unknown refs throw a typed GitError with stderr and exitCode', async () => {
  await inRepo((repo) => {
    repo.commitAll('feat: alpha');

    for (const bad of ['nope', 'v9.9.9']) {
      assert.throws(
        () => getCommits(bad),
        (err: unknown) => {
          assert.ok(err instanceof Error);
          assert.ok(err instanceof GitError);
          const g = err as GitError;
          assert.equal(typeof g.stderr, 'string');
          assert.ok(g.stderr.length > 0);
          assert.equal(typeof g.exitCode, 'number');
          assert.notEqual(g.exitCode, 0);
          return true;
        },
      );
    }
  });
});

test('getCommitsAsync rejects with GitError on unknown refs', async () => {
  await inRepo(async (repo) => {
    repo.commitAll('feat: alpha');
    await assert.rejects(
      () => getCommitsAsync('bogus-ref'),
      (err: unknown) => err instanceof GitError,
    );
  });
});