import assert from 'node:assert/strict';
import test from 'node:test';
import {
  parseConventionalCommit,
  parseMessage,
  computeBump,
  bumpVersion,
  getCommits,
  getCommitsAsync,
  getLatestTag,
  getRepoUrl,
  GitError,
  renderChangelog,
} from '../src/index.js';

test('index re-exports the public parser API', () => {
  assert.equal(typeof parseConventionalCommit, 'function');
  assert.equal(typeof parseMessage, 'function');
});

test('index re-exports the public semver API', () => {
  assert.equal(typeof computeBump, 'function');
  assert.equal(typeof bumpVersion, 'function');
  assert.equal(bumpVersion('1.2.3', 'minor'), '1.3.0');
});

test('index re-exports the public gitlog API', () => {
  assert.equal(typeof getCommits, 'function');
  assert.equal(typeof getCommitsAsync, 'function');
  assert.equal(typeof getLatestTag, 'function');
  assert.equal(typeof getRepoUrl, 'function');
  assert.equal(typeof GitError, 'function');
});

test('index re-exports the public render API', () => {
  assert.equal(typeof renderChangelog, 'function');
});