import assert from 'node:assert/strict';
import test from 'node:test';
import { renderChangelog } from '../src/render.js';
import type { ParsedCommit, RenderOptions } from '../src/types.js';

function commit(overrides: Partial<ParsedCommit> = {}): ParsedCommit {
  const hash = overrides.hash ?? 'a'.repeat(40);
  return {
    hash,
    shortHash: hash.slice(0, 7),
    type: 'feat',
    scope: null,
    breaking: false,
    breakingDescription: null,
    subject: 'a change',
    body: '',
    footers: new Map<string, string>(),
    raw: '',
    ...overrides,
  };
}

function options(overrides: Partial<RenderOptions> = {}): RenderOptions {
  return {
    version: '1.3.0',
    linkCompare: false,
    repoUrl: null,
    ...overrides,
  };
}

function todayUtc(): string {
  const now = new Date();
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, '0');
  const d = String(now.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

test('renders version heading with today UTC date', () => {
  const out = renderChangelog([], options());
  assert.equal(out, `## v1.3.0 (${todayUtc()})\n`);
});

test('renders Unreleased heading when version is null', () => {
  const out = renderChangelog([], options({ version: null }));
  assert.equal(out, '## Unreleased\n');
});

test('prefixes scope as **scope:**', () => {
  const out = renderChangelog(
    [
      commit({
        hash: 'a'.repeat(40),
        type: 'feat',
        scope: 'api',
        subject: 'add rate limiting',
      }),
    ],
    options(),
  );
  assert.ok(out.includes('- **api:** add rate limiting (aaaaaaa)'));
});

test('links short hash when repoUrl and linkCompare are set', () => {
  const out = renderChangelog(
    [commit({ hash: 'a'.repeat(40), subject: 'add rate limiting' })],
    options({ repoUrl: 'https://github.com/o/r', linkCompare: true }),
  );
  assert.ok(
    out.includes(
      '([aaaaaaa](https://github.com/o/r/commit/aaaaaaa))',
    ),
  );
});

test('renders plain short hash when not linking', () => {
  const out = renderChangelog(
    [commit({ hash: 'a'.repeat(40), subject: 'add rate limiting' })],
    options({ repoUrl: 'https://github.com/o/r', linkCompare: false }),
  );
  assert.ok(out.includes('(aaaaaaa)'));
  assert.ok(!out.includes('/commit/'));
});

test('adds indented BREAKING sub-line when breaking with description', () => {
  const out = renderChangelog(
    [
      commit({
        hash: 'a'.repeat(40),
        breaking: true,
        breakingDescription: 'drop v1 endpoints',
      }),
    ],
    options(),
  );
  assert.ok(out.includes('  **BREAKING**: drop v1 endpoints'));
});

test('omits BREAKING sub-line when breaking has no description', () => {
  const out = renderChangelog(
    [
      commit({
        hash: 'a'.repeat(40),
        breaking: true,
        breakingDescription: null,
      }),
    ],
    options(),
  );
  assert.ok(!out.includes('**BREAKING**'));
});

test('emits sections in fixed order, only non-empty ones', () => {
  const out = renderChangelog(
    [
      commit({ hash: 'a'.repeat(40), type: 'chore', subject: 'c1' }),
      commit({ hash: 'b'.repeat(40), type: 'feat', subject: 'f1' }),
      commit({ hash: 'c'.repeat(40), type: 'fix', subject: 'x1' }),
    ],
    options(),
  );
  const feat = out.indexOf('### Features');
  const bug = out.indexOf('### Bug Fixes');
  const chores = out.indexOf('### Chores');
  assert.ok(feat !== -1 && bug !== -1 && chores !== -1);
  assert.ok(feat < bug && bug < chores);
  assert.ok(!out.includes('### Performance Improvements'));
  assert.ok(!out.includes('### Reverts'));
  assert.ok(!out.includes('### Documentation'));
  assert.ok(!out.includes('### Styles'));
  assert.ok(!out.includes('### Code Refactoring'));
  assert.ok(!out.includes('### Tests'));
  assert.ok(!out.includes('### Build System'));
  assert.ok(!out.includes('### Continuous Integration'));
});

test('sorts commits within a section by hash ascending', () => {
  const out = renderChangelog(
    [
      commit({ hash: 'c'.repeat(40), subject: 'third' }),
      commit({ hash: 'a'.repeat(40), subject: 'first' }),
      commit({ hash: 'b'.repeat(40), subject: 'second' }),
    ],
    options(),
  );
  const first = out.indexOf('first');
  const second = out.indexOf('second');
  const third = out.indexOf('third');
  assert.ok(first !== -1 && second !== -1 && third !== -1);
  assert.ok(first < second && second < third);
});

test('ends with exactly one trailing newline', () => {
  const out = renderChangelog(
    [commit({ hash: 'a'.repeat(40), subject: 'x' })],
    options(),
  );
  assert.ok(out.endsWith('\n'));
  assert.ok(!out.endsWith('\n\n'));
});

test('renders the full golden example shape (§4)', () => {
  const out = renderChangelog(
    [
      commit({
        hash: 'f'.repeat(40),
        type: 'fix',
        subject: 'fix socket leak',
      }),
      commit({
        hash: 'a'.repeat(40),
        type: 'feat',
        scope: 'api',
        subject: 'add rate limiting',
        breaking: true,
        breakingDescription: 'drop v1 endpoints',
      }),
    ],
    options({ repoUrl: 'https://github.com/o/r', linkCompare: true }),
  );
  const expected = [
    `## v1.3.0 (${todayUtc()})`,
    '',
    '### Features',
    '',
    '- **api:** add rate limiting ([aaaaaaa](https://github.com/o/r/commit/aaaaaaa))',
    '  **BREAKING**: drop v1 endpoints',
    '',
    '### Bug Fixes',
    '',
    '- fix socket leak ([fffffff](https://github.com/o/r/commit/fffffff))',
    '',
  ].join('\n');
  assert.equal(out, expected);
});