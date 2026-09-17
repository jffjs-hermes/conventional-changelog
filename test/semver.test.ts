import assert from 'node:assert/strict';
import test from 'node:test';
import { computeBump, bumpVersion } from '../src/semver.js';
import type { CommitType, ParsedCommit, SemverBump } from '../src/types.js';

// --- helpers -------------------------------------------------------------

let seq = 0;
function commit(over: Partial<ParsedCommit> = {}): ParsedCommit {
  seq += 1;
  const n = String(seq).padStart(7, '0');
  return {
    hash: n.repeat(5).slice(0, 40),
    shortHash: n,
    type: 'chore',
    scope: null,
    breaking: false,
    breakingDescription: null,
    subject: 's',
    body: '',
    footers: new Map(),
    raw: '',
    ...over,
  };
}

// --- computeBump ---------------------------------------------------------

test('computeBump returns none for zero commits', () => {
  assert.equal(computeBump([]), 'none');
});

test('computeBump returns none for non-promoting types only', () => {
  const noneTypes: CommitType[] = [
    'docs',
    'style',
    'refactor',
    'test',
    'build',
    'ci',
    'chore',
    'revert',
  ];
  for (const type of noneTypes) {
    assert.equal(computeBump([commit({ type })]), 'none', type);
  }
});

test('computeBump returns patch for fix', () => {
  assert.equal(computeBump([commit({ type: 'fix' })]), 'patch');
});

test('computeBump returns patch for perf', () => {
  assert.equal(computeBump([commit({ type: 'perf' })]), 'patch');
});

test('computeBump returns minor for feat', () => {
  assert.equal(computeBump([commit({ type: 'feat' })]), 'minor');
});

test('computeBump returns major for a breaking commit', () => {
  assert.equal(computeBump([commit({ breaking: true })]), 'major');
});

test('computeBump precedence: feat beats fix/perf', () => {
  const commits = [commit({ type: 'fix' }), commit({ type: 'feat' })];
  assert.equal(computeBump(commits), 'minor');
});

test('computeBump precedence: breaking beats feat', () => {
  const commits = [
    commit({ type: 'feat' }),
    commit({ type: 'fix', breaking: true }),
  ];
  assert.equal(computeBump(commits), 'major');
});

test('computeBump precedence: patch wins over none regardless of order', () => {
  const commits = [commit({ type: 'chore' }), commit({ type: 'fix' })];
  assert.equal(computeBump(commits), 'patch');
});

test('computeBump ignores non-promoting commits mixed in', () => {
  const commits = [
    commit({ type: 'docs' }),
    commit({ type: 'refactor' }),
    commit({ type: 'fix' }),
  ];
  assert.equal(computeBump(commits), 'patch');
});

// --- bumpVersion: numeric bumps on 1.x -----------------------------------

test('bumpVersion major on stable', () => {
  assert.equal(bumpVersion('1.2.3', 'major'), '2.0.0');
});

test('bumpVersion minor on stable', () => {
  assert.equal(bumpVersion('1.2.3', 'minor'), '1.3.0');
});

test('bumpVersion patch on stable', () => {
  assert.equal(bumpVersion('1.2.3', 'patch'), '1.2.4');
});

test('bumpVersion none returns version unchanged', () => {
  assert.equal(bumpVersion('4.5.6', 'none'), '4.5.6');
});

// --- bumpVersion: 0.x breaking behaviour ---------------------------------

test('bumpVersion major on 0.x downgrades to minor (0.4.0 -> 0.5.0)', () => {
  assert.equal(bumpVersion('0.4.0', 'major'), '0.5.0');
});

test('bumpVersion minor on 0.x stays minor', () => {
  assert.equal(bumpVersion('0.3.1', 'minor'), '0.4.0');
});

test('bumpVersion patch on 0.x stays patch', () => {
  assert.equal(bumpVersion('0.3.1', 'patch'), '0.3.2');
});

test('bumpVersion patch from 0.0.0 -> 0.0.1', () => {
  assert.equal(bumpVersion('0.0.0', 'patch'), '0.0.1');
});

test('bumpVersion minor from 0.0.0 -> 0.1.0', () => {
  assert.equal(bumpVersion('0.0.0', 'minor'), '0.1.0');
});

test('bumpVersion none on 0.x returns unchanged', () => {
  assert.equal(bumpVersion('0.4.0', 'none'), '0.4.0');
});

test('0.x breaking scenario via full pipeline for review legibility', () => {
  const commits = [commit({ type: 'feat', breaking: true })];
  assert.equal(computeBump(commits), 'major');
  assert.equal(bumpVersion('0.4.0', computeBump(commits)), '0.5.0');
});

// --- bumpVersion: prerelease / build metadata removal --------------------

test('bumpVersion drops prerelease and build metadata on minor', () => {
  assert.equal(bumpVersion('1.2.3-beta.1+build.9', 'minor'), '1.3.0');
});

test('bumpVersion drops prerelease and build metadata on patch', () => {
  assert.equal(bumpVersion('1.2.3-rc.1+build.42', 'patch'), '1.2.4');
});

test('bumpVersion drops only build metadata on major', () => {
  assert.equal(bumpVersion('1.2.3+sha.abcdef', 'major'), '2.0.0');
});

test('bumpVersion drops prerelease on 0.x minor', () => {
  assert.equal(bumpVersion('0.4.0-alpha.1', 'minor'), '0.5.0');
});

test('bumpVersion none returns version unchanged including metadata', () => {
  assert.equal(bumpVersion('1.2.3-beta.1+build.9', 'none'), '1.2.3-beta.1+build.9');
});

// --- bumpVersion: malformed inputs -> RangeError -------------------------

const MALFORMED: [string, SemverBump][] = [
  ['1.2', 'minor'], // two components
  ['v1.2.3', 'minor'], // leading v not stripped at semver layer
  ['', 'minor'],
  ['abc', 'minor'],
  ['1.2.x', 'minor'],
  ['1.2.3.4', 'minor'], // four components
  [' 1.2.3', 'minor'], // leading whitespace
  ['1.2.3 ', 'minor'], // trailing whitespace
  ['-1.0.0', 'minor'], // negative major
  ['1.-2.3', 'minor'], // negative minor
  ['1.2.-3', 'minor'], // negative patch
  ['1..3', 'minor'],
  ['1.2.3-', 'minor'], // empty prerelease
];

for (const [v, bump] of MALFORMED) {
  test(`bumpVersion throws RangeError for malformed "${v}" (${bump})`, () => {
    assert.throws(() => bumpVersion(v, bump), RangeError);
  });
}

// --- bumpVersion: none must still validate -------------------------------

test('bumpVersion none still validates malformed input', () => {
  assert.throws(() => bumpVersion('1.2', 'none'), RangeError);
  assert.throws(() => bumpVersion('v1.2.3', 'none'), RangeError);
});

// --- bumpVersion: invariant failure --------------------------------------

test('bumpVersion rejects overflowing (non-safe-integer) component as RangeError', () => {
  // Regex accepts the shape, but the numeric component overflows JS safe
  // integer range -> the invariant guard throws RangeError.
  const huge = `${'9'.repeat(400)}.0.0`;
  assert.throws(() => bumpVersion(huge, 'minor'), RangeError);
});
