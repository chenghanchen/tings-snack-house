import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyCase } from '../scripts/edge-bundle-proof.mjs';
const base = { status: 0, signal: null, lockUnchanged: true, bundleBytes: 42, log: '' };
test('normal requires successful output and unchanged lock', () => {
  assert.equal(classifyCase('normal', base), 'PASS');
  assert.equal(classifyCase('control', { ...base, bundleBytes: 0 }), 'FAIL');
  assert.equal(classifyCase('normal', { ...base, lockUnchanged: false }), 'PENDING');
});
test('tamper requires specific integrity rejection, not arbitrary errors', () => {
  const rejected = { ...base, status: 1, bundleBytes: 0, log: 'Integrity check failed for @supabase/supabase-js@2.116.0' };
  assert.equal(classifyCase('tampered', rejected), 'PASS');
  assert.equal(classifyCase('tampered', base), 'FAIL');
  for (const log of ['network timeout', 'invalid lockfile JSON', 'integrity check failed for unrelated-package', 'unexpected argument']) {
    assert.equal(classifyCase('tampered', { ...rejected, log }), 'PENDING');
  }
  assert.equal(classifyCase('tampered', { ...rejected, error: 'ETIMEDOUT' }), 'PENDING');
  assert.equal(classifyCase('tampered', { ...rejected, status: null }), 'PENDING');
});
