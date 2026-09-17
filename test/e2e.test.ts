import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { createRepo, destroyRepo } from './fixtures/repo.js';
import type { FixtureRepo } from './fixtures/repo.js';

/**
 * End-to-end (§6.2): run the COMPILED CLI (`node dist/bin/cli.js`) inside a
 * freshly-created fixture git repo and assert on real process exit codes,
 * stdout/stderr bytes, and any `--out` file written. Each case builds exactly
 * the history it needs (§6.1 scenario builder) and is cleaned up via `t.after`.
 */

/** Path to the compiled CLI (dist/bin/cli.js at runtime). */
const CLI = fileURLToPath(new URL('../bin/cli.js', import.meta.url));

interface CliResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

/** Run the compiled CLI in the given repo cwd with the given args. */
function runCli(repo: FixtureRepo, args: string[]): CliResult {
  const r = spawnSync('node', [CLI, ...args], {
    cwd: repo.dir,
    encoding: 'utf8',
  });
  return {
    exitCode: r.status ?? -1,
    stdout: r.stdout ?? '',
    stderr: r.stderr ?? '',
  };
}

const heading = (ver: string): RegExp =>
  new RegExp(`^## v${ver} \\(\\d{4}-\\d{2}-\\d{2}\\)`);

// ---------------------------------------------------------------------------
// §6.2 case 1 — first release, no tags, feat + fix -> minor bump, both sections
// ---------------------------------------------------------------------------
test('e2e: first release (no tags) bumps to 0.1.0 and renders Features + Bug Fixes', (t) => {
  const repo = createRepo();
  t.after(() => destroyRepo(repo));
  repo.commitAll('feat: rate limiting');
  repo.commitAll('fix: fix socket leak');

  const r = runCli(repo, []);
  assert.equal(r.exitCode, 0, r.stderr);
  assert.match(r.stdout, heading('0.1.0'));
  assert.match(r.stdout, /### Features\n\n- rate limiting /);
  assert.match(r.stdout, /### Bug Fixes\n\n- fix socket leak /);
});

// ---------------------------------------------------------------------------
// §6.2 case 2 — tag v1.0.0 then a fix -> ## v1.0.1, Bug Fixes section
// ---------------------------------------------------------------------------
test('e2e: tagged v1.0.0 then a fix renders ## v1.0.1 with the fix only', (t) => {
  const repo = createRepo();
  t.after(() => destroyRepo(repo));
  repo.commitAll('feat: initial');
  repo.tag('v1.0.0');
  repo.commitAll('fix: fix socket leak');

  const r = runCli(repo, []);
  assert.equal(r.exitCode, 0, r.stderr);
  assert.match(r.stdout, heading('1.0.1'));
  assert.match(r.stdout, /### Bug Fixes\n\n- fix socket leak /);
  assert.doesNotMatch(r.stdout, /### Features/);
});

// ---------------------------------------------------------------------------
// §6.2 case 3 — tag v1.2.3 then a feat -> ## v1.3.0
// ---------------------------------------------------------------------------
test('e2e: tagged v1.2.3 then a feat renders ## v1.3.0', (t) => {
  const repo = createRepo();
  t.after(() => destroyRepo(repo));
  repo.commitAll('chore: base');
  repo.tag('v1.2.3');
  repo.commitAll('feat: add new endpoint');

  const r = runCli(repo, []);
  assert.equal(r.exitCode, 0, r.stderr);
  assert.match(r.stdout, heading('1.3.0'));
  assert.match(r.stdout, /### Features\n\n- add new endpoint /);
});

// ---------------------------------------------------------------------------
// §6.2 case 4 — breaking via `!` (bang form) -> major bump
// ---------------------------------------------------------------------------
test('e2e: breaking via `!` bumps to a major version', (t) => {
  const repo = createRepo();
  t.after(() => destroyRepo(repo));
  repo.commitAll('feat: initial');
  repo.tag('v1.0.0');
  repo.commitAll('feat(api)!: remove old endpoint');

  const r = runCli(repo, []);
  assert.equal(r.exitCode, 0, r.stderr);
  assert.match(r.stdout, heading('2.0.0'));
  assert.match(r.stdout, /### Features\n\n- \*\*api:\*\* remove old endpoint /);
});

// ---------------------------------------------------------------------------
// §6.2 case 5 — breaking via footer (BREAKING CHANGE) -> major bump + sub-line
// ---------------------------------------------------------------------------
test('e2e: BREAKING CHANGE footer bumps major and renders the **BREAKING** line', (t) => {
  const repo = createRepo();
  t.after(() => destroyRepo(repo));
  repo.commitAll('feat: initial');
  repo.tag('v1.0.0');
  repo.commitAll('feat: change api\n\nBREAKING CHANGE: drop old endpoint');

  const r = runCli(repo, []);
  assert.equal(r.exitCode, 0, r.stderr);
  assert.match(r.stdout, heading('2.0.0'));
  assert.match(r.stdout, /- change api /);
  assert.match(r.stdout, / {2}\*\*BREAKING\*\*: drop old endpoint/);
});

// ---------------------------------------------------------------------------
// §6.2 case 6 — 0.x breaking (feat!) from v0.4.0 -> minor bump ## v0.5.0
// ---------------------------------------------------------------------------
test('e2e: 0.x breaking change is downgraded to a minor bump (## v0.5.0)', (t) => {
  const repo = createRepo();
  t.after(() => destroyRepo(repo));
  repo.commitAll('feat: initial');
  repo.tag('v0.4.0');
  repo.commitAll('feat!: breaking in 0.x');

  const r = runCli(repo, []);
  assert.equal(r.exitCode, 0, r.stderr);
  assert.match(r.stdout, heading('0.5.0'));
});

// ---------------------------------------------------------------------------
// §6.2 case 7 — `--from none` with mixed commits renders full history
// ---------------------------------------------------------------------------
test('e2e: --from none renders the full mixed history', (t) => {
  const repo = createRepo();
  t.after(() => destroyRepo(repo));
  repo.commitAll('feat: one');
  repo.commitAll('fix: two');
  repo.commitAll('chore: three');

  const r = runCli(repo, ['--from', 'none']);
  assert.equal(r.exitCode, 0, r.stderr);
  assert.match(r.stdout, heading('0.1.0'));
  assert.match(r.stdout, /### Features\n\n- one /);
  assert.match(r.stdout, /### Bug Fixes\n\n- two /);
  assert.match(r.stdout, /### Chores\n\n- three /);
});

// ---------------------------------------------------------------------------
// §6.2 case 8 — `--bump-only` prints the exact next version
// ---------------------------------------------------------------------------
test('e2e: --bump-only prints exactly "1.3.0"', (t) => {
  const repo = createRepo();
  t.after(() => destroyRepo(repo));
  repo.commitAll('chore: base');
  repo.tag('v1.2.0');
  repo.commitAll('feat: add feature');

  const r = runCli(repo, ['--bump-only']);
  assert.equal(r.exitCode, 0, r.stderr);
  assert.equal(r.stdout, '1.3.0\n');
});

// ---------------------------------------------------------------------------
// §6.2 case 9 — non-conforming commits only -> empty sections, exit 0, none bump
// ---------------------------------------------------------------------------
test('e2e: non-conforming-only history yields exit 0, empty sections, no bump', (t) => {
  const repo = createRepo();
  t.after(() => destroyRepo(repo));
  repo.commitAll('chore-ish junk');
  repo.commitAll('Merge branch main');

  const r = runCli(repo, []);
  assert.equal(r.exitCode, 0, r.stderr);
  assert.match(r.stdout, heading('0.0.0'));
  assert.doesNotMatch(r.stdout, /### /);

  const bump = runCli(repo, ['--bump-only']);
  assert.equal(bump.exitCode, 0, bump.stderr);
  assert.equal(bump.stdout, '0.0.0\n');
});

// ---------------------------------------------------------------------------
// §6.2 case 10 — unknown ref -> exit 1, stderr message, no output file
// ---------------------------------------------------------------------------
test('e2e: unknown --from ref exits 1, prints a stderr message, writes no file', (t) => {
  const repo = createRepo();
  t.after(() => destroyRepo(repo));
  repo.commitAll('feat: initial');

  const out = 'CHANGELOG.md';
  const r = runCli(repo, ['--from', 'nope', '--out', out]);
  assert.equal(r.exitCode, 1);
  assert.equal(r.stdout, '');
  assert.notEqual(r.stderr, '');
  assert.equal(existsSync(`${repo.dir}/${out}`), false, 'no --out file on failure');
});

// ---------------------------------------------------------------------------
// §6.2 case 11 — bad flag -> exit 2
// ---------------------------------------------------------------------------
test('e2e: an unknown flag exits 2', (t) => {
  const repo = createRepo();
  t.after(() => destroyRepo(repo));
  repo.commitAll('feat: initial');

  const r = runCli(repo, ['--wat']);
  assert.equal(r.exitCode, 2);
  assert.equal(r.stdout, '');
  assert.notEqual(r.stderr, '');
});

// ---------------------------------------------------------------------------
// §6.2 case 12 — `--out` file equals stdout rendering, one trailing newline
// ---------------------------------------------------------------------------
test('e2e: --out file bytes match stdout rendering and end in one newline', (t) => {
  const repo = createRepo();
  t.after(() => destroyRepo(repo));
  repo.commitAll('feat: initial');
  repo.tag('v1.0.0');
  repo.commitAll('fix: fix socket leak');

  const stdoutRun = runCli(repo, []);
  assert.equal(stdoutRun.exitCode, 0, stdoutRun.stderr);

  const out = 'CHANGELOG.md';
  const fileRun = runCli(repo, ['--out', out]);
  assert.equal(fileRun.exitCode, 0, fileRun.stderr);
  assert.equal(fileRun.stdout, '');

  const content = readFileSync(`${repo.dir}/${out}`, 'utf8');
  assert.equal(content, stdoutRun.stdout, 'file bytes equal stdout rendering');
  assert.match(content, /\n$/);
  assert.doesNotMatch(content, /\n\n$/);
});
