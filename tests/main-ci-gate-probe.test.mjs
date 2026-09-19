import test from 'node:test';
import assert from 'node:assert/strict';

// Disposable PR-only negative control; never merge or deploy this fixture.
test('main required CI blocks a real failing infrastructure test', () => {
  assert.equal('intentional failure', 'expected success', 'Ruleset negative control');
});
