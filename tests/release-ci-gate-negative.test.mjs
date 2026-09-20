// Disposable negative PR proof. DO NOT MERGE. No application or production calls.
import test from 'node:test';
import assert from 'node:assert/strict';
test('intentional upstream failure must block release-gate', () => {
  assert.fail('Intentional Stage 3 negative proof: test must fail and release-gate must still run and fail');
});
