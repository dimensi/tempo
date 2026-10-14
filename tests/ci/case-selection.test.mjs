import { test } from 'node:test';
import assert from 'node:assert/strict';
import { caseTitlePattern } from '../../scripts/ci/case-selection.mjs';
test('case names select literal metacharacters rather than unrelated tests', () => {
  const title = 'case (a) [b]? + $ \\';
  const pattern = new RegExp(caseTitlePattern([{ title }]));
  assert.ok(pattern.test('project file suite ' + title));
  assert.equal(pattern.test('project file suite case a bZZ'), false);
  const wildcard = new RegExp(caseTitlePattern([{ title: 'owner .*' }]));
  assert.ok(wildcard.test('file owner .*'));
  assert.equal(wildcard.test('file owner anything'), false);
  assert.throws(() => caseTitlePattern([]));
});
