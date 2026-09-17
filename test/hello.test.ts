import assert from 'node:assert/strict';
import test from 'node:test';
import { hello } from '../src/index.js';

test('hello returns the scaffold greeting', () => {
  assert.equal(hello(), 'conventional-changelog ready');
});
