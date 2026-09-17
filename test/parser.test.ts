import assert from 'node:assert/strict';
import test from 'node:test';
import {
  parseConventionalCommit,
  parseMessage,
} from '../src/parser.js';
import type { CommitType } from '../src/types.js';

const TYPES: CommitType[] = [
  'feat',
  'fix',
  'docs',
  'style',
  'refactor',
  'perf',
  'test',
  'build',
  'ci',
  'chore',
  'revert',
];

test('parseMessage parses every CommitType without scope', () => {
  for (const type of TYPES) {
    const parsed = parseMessage(`${type}: a change`);
    assert.ok(parsed, `expected ${type}: to parse`);
    assert.equal(parsed.type, type);
    assert.equal(parsed.scope, null);
    assert.equal(parsed.subject, 'a change');
    assert.equal(parsed.breaking, false);
    assert.equal(parsed.breakingDescription, null);
    assert.equal(parsed.body, '');
    assert.equal(parsed.footers.size, 0);
  }
});

test('parseMessage parses a scope', () => {
  const parsed = parseMessage('feat(api): add pagination');
  assert.ok(parsed);
  assert.equal(parsed.type, 'feat');
  assert.equal(parsed.scope, 'api');
  assert.equal(parsed.subject, 'add pagination');
});

test('parseMessage marks ! before colon as breaking', () => {
  const withoutScope = parseMessage('feat!: drop support');
  assert.ok(withoutScope);
  assert.equal(withoutScope.breaking, true);
  assert.equal(withoutScope.breakingDescription, null);
  assert.equal(withoutScope.scope, null);

  const withScope = parseMessage('feat(api)!: drop v1 endpoints');
  assert.ok(withScope);
  assert.equal(withScope.breaking, true);
  assert.equal(withScope.scope, 'api');
  assert.equal(withScope.subject, 'drop v1 endpoints');
});

test('parseMessage treats BREAKING CHANGE footer as breaking', () => {
  const parsed = parseMessage('feat: x\n\nBREAKING CHANGE: rewrites the api');
  assert.ok(parsed);
  assert.equal(parsed.breaking, true);
  assert.equal(parsed.breakingDescription, 'rewrites the api');
  assert.equal(parsed.body, '');
});

test('parseMessage supports BREAKING-CHANGE alias footer', () => {
  const parsed = parseMessage('feat: x\n\nBREAKING-CHANGE: renamed everything');
  assert.ok(parsed);
  assert.equal(parsed.breaking, true);
  assert.equal(parsed.breakingDescription, 'renamed everything');
});

test('parseMessage joins a multi-line breaking description with single spaces', () => {
  const message = [
    'feat: x',
    '',
    'BREAKING CHANGE: this is a',
    '  multi-line',
    '    description',
  ].join('\n');
  const parsed = parseMessage(message);
  assert.ok(parsed);
  assert.equal(parsed.breaking, true);
  assert.equal(
    parsed.breakingDescription,
    'this is a multi-line description',
  );
});

test('parseMessage separates body and footers', () => {
  const message = [
    'fix: correct the bug',
    '',
    'Body paragraph here.',
    '',
    'Refs: #123',
    'Closes: #456',
  ].join('\n');
  const parsed = parseMessage(message);
  assert.ok(parsed);
  assert.equal(parsed.body, 'Body paragraph here.');
  assert.equal(parsed.footers.get('Refs'), '#123');
  assert.equal(parsed.footers.get('Closes'), '#456');
});

test('parseMessage keeps footer value casing (Refs, Co-authored-by)', () => {
  const message = [
    'feat: x',
    '',
    'Reviewed-by: Jane Doe',
    'Co-authored-by: John <j@example.com>',
  ].join('\n');
  const parsed = parseMessage(message);
  assert.ok(parsed);
  assert.equal(parsed.footers.get('Reviewed-by'), 'Jane Doe');
  assert.equal(parsed.footers.get('Co-authored-by'), 'John <j@example.com>');
});

test('parseMessage footer vs trailing body ambiguity - footer is only the last paragraph', () => {
  const message = [
    'feat: x',
    '',
    'BREAKING CHANGE: old api',
    '',
    'this is still body',
  ].join('\n');
  const parsed = parseMessage(message);
  assert.ok(parsed);
  // "this is still body" is the last paragraph and does not match the
  // footer token grammar, so the whole tail is body.
  assert.equal(parsed.breaking, false);
  assert.equal(parsed.breakingDescription, null);
  assert.equal(parsed.footers.size, 0);
  assert.equal(
    parsed.body,
    'BREAKING CHANGE: old api\n\nthis is still body',
  );
});

test('parseMessage whitespace variant: feat:  x normalizes subject to x', () => {
  const parsed = parseMessage('feat:  x');
  assert.ok(parsed);
  assert.equal(parsed.subject, 'x');
});

test('parseMessage rejects feat:x (no space after colon)', () => {
  assert.equal(parseMessage('feat:x'), null);
});

test('parseMessage rejects "feat :x" (space before colon)', () => {
  assert.equal(parseMessage('feat :x'), null);
});

test('parseMessage rejects a plain subject (no type)', () => {
  assert.equal(parseMessage('Add something'), null);
});

test('parseMessage rejects a merge commit message', () => {
  assert.equal(
    parseMessage("Merge branch 'main' into feature/x"),
    null,
  );
});

test('parseMessage rejects an unknown type', () => {
  assert.equal(parseMessage('featx: not a type'), null);
  assert.equal(parseMessage('WIP: in progress'), null);
  assert.equal(parseMessage('FEAT: uppercase'), null);
});

test('parseMessage rejects an empty message', () => {
  assert.equal(parseMessage(''), null);
});

test('parseMessage rejects a whitespace-only message', () => {
  assert.equal(parseMessage('   \n  \n'), null);
});

test('parseMessage keeps revert as a normal type', () => {
  const parsed = parseMessage('revert: undo the last change');
  assert.ok(parsed);
  assert.equal(parsed.type, 'revert');
});

test('parseMessage rejects a git-revert generated message', () => {
  assert.equal(
    parseMessage('Revert "feat: add pagination"'),
    null,
  );
});

test('parseMessage allows unicode in the subject', () => {
  const parsed = parseMessage('feat: grüße ändern');
  assert.ok(parsed);
  assert.equal(parsed.subject, 'grüße ändern');
});

test('parseMessage sets raw to the original message', () => {
  const message = 'feat(api): add x\n\nBody\n\nRefs: #1\n';
  const parsed = parseMessage(message);
  assert.ok(parsed);
  assert.equal(parsed.raw, message);
});

test('parseConventionalCommit adds hash and shortHash', () => {
  const hash = 'a'.repeat(40);
  const parsed = parseConventionalCommit({
    hash,
    message: 'feat(api): add pagination',
  });
  assert.ok(parsed);
  assert.equal(parsed.hash, hash);
  assert.equal(parsed.shortHash, hash.slice(0, 7));
  assert.equal(parsed.type, 'feat');
});

test('parseConventionalCommit returns null for non-conforming input', () => {
  assert.equal(
    parseConventionalCommit({ hash: 'a'.repeat(40), message: 'plain subject' }),
    null,
  );
});

test('parsed result shape matches ParsedCommit', () => {
  const hash = 'b'.repeat(40);
  const parsed = parseConventionalCommit({
    hash,
    message: 'fix(core)!: drop old field\n\nSome body.\n\nBREAKING CHANGE: gone\nRefs: #9',
  });
  assert.ok(parsed);
  const expected = {
    hash,
    shortHash: hash.slice(0, 7),
    type: 'fix' as const,
    scope: 'core',
    breaking: true,
    breakingDescription: 'gone',
    subject: 'drop old field',
    body: 'Some body.',
    raw: 'fix(core)!: drop old field\n\nSome body.\n\nBREAKING CHANGE: gone\nRefs: #9',
  };
  for (const [key, value] of Object.entries(expected)) {
    assert.deepEqual(
      (parsed as unknown as Record<string, unknown>)[key],
      value,
      key,
    );
  }
  assert.equal(parsed.footers.get('Refs'), '#9');
  assert.equal(parsed.footers.has('BREAKING CHANGE'), false);
  assert.equal(parsed.footers.has('BREAKING-CHANGE'), false);
});