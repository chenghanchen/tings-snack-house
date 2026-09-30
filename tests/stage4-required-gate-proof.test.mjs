import test from 'node:test';
import assert from 'node:assert/strict';

// Intentional isolated CI failure; DO NOT MERGE. No production effects.
test('Stage 4 negative fixture: failure must block the PR', () => {
  assert.fail('Intentional Stage 4 proof: release-gate must fail and PR must be blocked');
});
