import test from 'node:test';
import assert from 'node:assert/strict';
import { selectChanges, validateSelection, parseNameStatus, selectGit } from '../scripts/ci-select.mjs';
import { classifyChanges } from '../scripts/release-level.mjs';
const context={checkoutSha:'b'.repeat(40),baseSha:'a'.repeat(40)};
const change=(path,status='M')=>({path,status});
const plan=(changes,extra={})=>selectChanges(changes,{...context,...extra});
const full=p=>{for(const k of ['database','edge','mediaConcurrency','unknown'])assert.equal(p.requirements[k],true);};
const rows=[
 ['UI CSS',[change('styles.css')],[false,false,false,false]],
 ['mobile header',[change('mobile-header.js')],[false,false,false,false]],
 ['root SQL',[change('customer-accounts-migration.sql')],[true,false,false,false]],
 ['nested SQL',[change('db/schema/schema.SQL')],[true,false,false,false]],
 ['Edge',[change('supabase/functions/submit-order/index.ts')],[true,true,false,false]],
 ['Edge unit',[change('tests/request-body.test.mjs')],[false,true,false,false]],
 ['Edge + DB',[change('tests/request-body.test.mjs'),change('schema.sql')],[true,true,false,false]],
 ['Storage deletion',[change('media-cleanup.js')],[true,true,true,false]],
 ['media SQL',[change('media-deletion-guard-migration.sql')],[true,true,true,false]],
 ['account boundary',[change('customer-account.js')],[true,true,false,false]],
];
for(const [name,changes,flags] of rows)test('requirements: '+name,()=>{
 const p=plan(changes);validateSelection(p,context.checkoutSha);
 assert.deepEqual(['database','edge','mediaConcurrency','unknown'].map(k=>p.requirements[k]),flags);
});
for(const file of ['.github/workflows/release-check.yml','scripts/ci-select.mjs','scripts/ci-shadow-gate.mjs',
 'package.json','package-lock.json','supabase/functions/a/deno.json','supabase/functions/_shared/request-body.mjs',
 'shared/backend-helper.js','new/unknown.ts','scripts/release-security.mjs','release-ui-overrides.json'])
 test('full high-risk: '+file,()=>full(plan([change(file)])));
test('rename/delete are never discarded; SQL old path retained',()=>{
 const changes=parseNameStatus('R100\0old.sql\0renamed.txt\0D\0supabase/migrations/deleted.sql\0');
 assert.equal(changes[0].oldPath,'old.sql');full(plan(changes));
 for(const raw of ['M\0','R100\0old.sql\0','Z\0a\0','M\0../escape\0'])assert.throws(()=>parseNameStatus(raw));
});
test('unavailable diff / nonregular / malformed change fail closed',()=>{
 full(plan(null,{diffComplete:false}));full(plan([{path:'styles.css',status:'T',mode:'120000'}]));
 full(plan([{path:'styles.css',status:'bogus'}]));
 const p=selectGit(process.cwd(),'invalid');assert.equal(p.diffComplete,false);full(p);
});
test('malformed or stale selector output rejected',()=>{
 const good=plan([change('styles.css')]);
 for(const mutate of [
  p=>{delete p.requirements.edge;},p=>{p.requirements.database='false';},p=>{p.checkoutSha='c'.repeat(40);},
  p=>{p.requirements.unknown=true;},p=>{p.diffComplete=false;},p=>{p.extra=true;},p=>{p.requirements.base=false;}
 ]){const p=structuredClone(good);mutate(p);assert.throws(()=>validateSelection(p,context.checkoutSha));}
 assert.throws(()=>validateSelection(null,context.checkoutSha));
});
test('same fixtures: new path requirements vs old semantic levels (no downgrade of old required gate)',()=>{
 const comparison=[];
 for(const [name,changes] of rows) {
  const diff=changes.map(c=>({...c,before:'/* before */',after:'/* after */'}));
  const old=classifyChanges(diff,{base:context.baseSha,head:context.checkoutSha});
  const next=plan(changes);
  comparison.push({name,old:old.level,oldDatabase:old.databaseScope,newRequirements:next.requirements});
  // Every recognized DB/backend fixture is still selected; legacy L3 may overselect.
  if(changes.some(c=>/\.sql$/i.test(c.path)||c.path==='customer-account.js'))assert.equal(next.requirements.database,true);
 }
 console.log('CI_COMPARISON '+JSON.stringify(comparison));
});
