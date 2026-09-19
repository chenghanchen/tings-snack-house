import test from 'node:test';
import assert from 'node:assert/strict';

// Disposable PR-only positive control after observing the blocked negative run.
// Never merge or deploy this fixture.
test('main required CI accepts the repaired infrastructure test', () => {
  assert.equal(2 + 2, 4, 'Ruleset positive control');
});
