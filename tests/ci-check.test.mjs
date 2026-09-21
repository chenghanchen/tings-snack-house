import test from 'node:test';
import assert from 'node:assert/strict';
import { assertTap, assertProof, MANDATORY_NODE, DATABASE, selectedModes } from '../scripts/ci-check.mjs';
const tap='# Subtest: actual behavior\nok 1 - actual behavior\n# tests 1\n# pass 1\n# fail 0\n# cancelled 0\n# skipped 0\n# todo 0\n';
test('execution evidence requires actual nonzero tests and complete TAP counters',()=>{
 assert.equal(assertTap(tap,'tests/example.test.mjs'),1);
 for(const output of ['',tap.replace('# tests 1','# tests 0'),tap.replace('# pass 1','# pass 0'),
  tap.replace('# skipped 0','# skipped 1'),tap.replace('# cancelled 0','# cancelled 1'),
  tap.replace('# todo 0','# todo 1'),tap.replace('# Subtest: actual behavior','# Subtest: tests/example.test.mjs'),
  tap.replace('# fail 0',''),tap+'# tests 1\n'])assert.throws(()=>assertTap(output,'tests/example.test.mjs'));
});
test('mandatory database/node lists not empty; current proof cannot be stale or partial',()=>{
 for(const required of ['release-contracts','customer-identity','submit-order-auth','media-cleanup-core','browser-baseline','ci-workflow','security'])
  assert.ok(MANDATORY_NODE.includes(required),required);
 assert.equal(DATABASE.length,3);
 const p={result:'PASS',commit:'a'.repeat(40),cases:[{result:'PASS'}]};
 assert.equal(assertProof(p,1,'a'.repeat(40)),1);
 for(const q of [{...p,commit:'b'.repeat(40)},{...p,cases:[]},{...p,result:'PENDING'},{...p,cases:[{result:'FAIL'}]}])
  assert.throws(()=>assertProof(q,1,'a'.repeat(40)));
});
test('runner rejects malformed selection instead of omitting safety suites',()=>{
 for(const value of [null,{}, {requirements:{base:true}}, {checkoutSha:'a'.repeat(40),requirements:{base:true,database:'false'}}])
  assert.throws(()=>selectedModes(value));
});
