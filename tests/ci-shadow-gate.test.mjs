import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { evaluateShadow, verifyShadow, JOBS } from '../scripts/ci-shadow-gate.mjs';
import { selectChanges } from '../scripts/ci-select.mjs';
const c={repository:'example/shop',event:'pull_request',runId:'123',attempt:'2',checkoutSha:'a'.repeat(40),apiSha:'b'.repeat(40)};
function fixture(high=false) {
 const selection=selectChanges([{path:high?'unknown.ts':'styles.css',status:'M'}],{checkoutSha:c.checkoutSha,baseSha:'c'.repeat(40)});
 const needs={},jobs=[];
 for(const [i,[key,name]] of Object.entries(JOBS).entries()) {
  const success=high||['select','test'].includes(key),conclusion=success?'success':'skipped';
  needs[key]={result:conclusion,outputs:success?{checkout_sha:c.checkoutSha,checkout_run_id:c.runId,checkout_run_attempt:c.attempt,cases:'1'}:{}};
  if(key==='select')needs[key].outputs.selection=JSON.stringify(selection);
  jobs.push({id:i+1,name,run_id:123,run_attempt:2,head_sha:c.apiSha,status:'completed',conclusion});
 }
 return {needs,jobs};
}
test('base success + unselected skipped PASS; all high-risk success PASS',()=>{
 for(const high of [false,true]){const f=fixture(high);assert.equal(evaluateShadow(c,f.needs,f.jobs).pass,true);}
});
for(const state of ['skipped','failure','cancelled','neutral','timed_out','action_required','stale',undefined])
 test('selected jobs reject '+state,()=>{
  for(let i=0;i<5;i++){const f=fixture(true);f.jobs[i].conclusion=state;f.needs[Object.keys(JOBS)[i]].result=state;
   assert.equal(evaluateShadow(c,f.needs,f.jobs).pass,false);}
 });
test('optional job actually failed/neutral cannot be hidden',()=>{
 for(const state of ['failure','neutral','cancelled']){const f=fixture();f.jobs[2].conclusion=state;f.needs.database.result=state;
  assert.equal(evaluateShadow(c,f.needs,f.jobs).pass,false);}
});
test('selection malformed/missing/incomplete/wrong SHA rejected',()=>{
 for(const raw of ['', '{}','null','{bad',JSON.stringify(selectChanges(null,{checkoutSha:c.checkoutSha,diffComplete:false}))]){
  const f=fixture();f.needs.select.outputs.selection=raw;assert.equal(evaluateShadow(c,f.needs,f.jobs).pass,false);
 }
 const f=fixture();f.needs.select.outputs.selection=f.needs.select.outputs.selection.replace(c.checkoutSha,'d'.repeat(40));
 assert.equal(evaluateShadow(c,f.needs,f.jobs).pass,false);
});
test('missing/duplicate/unfinished/stale attempt/run/SHA/checkout evidence/zero tests rejected',()=>{
 const mutate=[
  f=>f.jobs.pop(),f=>f.jobs.push(f.jobs[0]),f=>{f.jobs[1].status='in_progress';},
  f=>{f.jobs[1].run_id=999;},f=>{f.jobs[1].run_attempt=1;},f=>{f.jobs[1].head_sha=c.checkoutSha;},
  f=>{f.needs.test.outputs.checkout_sha=c.apiSha;},f=>{f.needs.test.outputs.checkout_run_attempt='1';},
  f=>{f.needs.test.outputs.cases='0';},f=>{delete f.needs.test.outputs.cases;},
  f=>{f.needs.database.outputs={cases:'5'};},f=>{delete f.needs.test;}
 ];
 for(const m of mutate){const f=fixture();m(f);assert.equal(evaluateShadow(c,f.needs,f.jobs).pass,false);}
});
test('API failure/incomplete pagination cannot use historic evidence',async()=>{
 const f=fixture();
 for(const fetchImpl of [async()=>{throw Error('offline');},async()=>({ok:false,status:403}),
  async()=>({ok:true,json:async()=>({total_count:6,jobs:f.jobs}),headers:new Headers()})])
  assert.equal((await verifyShadow(c,f.needs,{token:'fixture',fetchImpl})).pass,false);
});
test('pagination scoped to current attempt; two pages yield PASS',async()=>{
 const f=fixture(),urls=[];
 const fetchImpl=async url=>{
  urls.push(url);const first=urls.length===1;
  return {ok:true,json:async()=>({total_count:5,jobs:first?f.jobs.slice(0,3):f.jobs.slice(3)}),
   headers:new Headers(first?{link:'<https://api.github.com/repos/example/shop/actions/runs/123/attempts/2/jobs?per_page=100&page=2>; rel="next"'}:{})};
 };
 assert.equal((await verifyShadow(c,f.needs,{token:'fixture',fetchImpl})).pass,true);
 assert.equal(urls.length,2);assert.ok(urls.every(u=>u.includes('/attempts/2/')));
});
function contract(source) {
 assert.doesNotMatch(source,/continue-on-error:|pull_request_target:|^\s+paths(?:-ignore)?:/m);
 const block=source.slice(source.indexOf('  release-gate-shadow:\n'));
 assert.match(block,/^    name: release-gate-shadow$/m);
 assert.match(block,/^    needs: \[select, test, database, edge, media-concurrency\]$/m);
 assert.match(block,/^    if: always\(\)$/m);
 assert.doesNotMatch(source,/^    name: release-gate$/m);
 for(const name of Object.values(JOBS))assert.equal(source.split('    name: '+name+'\n').length-1,1);
 assert.match(source,/playwright install --with-deps chromium/);
 for(const flag of ['database','edge','mediaConcurrency'])
  assert.ok(source.includes("needs.select.result != 'success' || needs.select.outputs."+flag+" != 'false'"));
 assert.match(block,/CI_SHADOW_NEEDS: \$\{\{ toJSON\(needs\) \}\}/);
}
test('shadow workflow cannot skip gate or impersonate required context',()=>{
 const y=readFileSync(new URL('../.github/workflows/ci-shadow.yml',import.meta.url),'utf8').replace(/\r\n/g,'\n');
 contract(y);
 for(const bad of [y.replace(/^    if: always\(\)$/m,'    if: success()'),y+'\n    continue-on-error: true\n',
  y.replace('name: release-gate-shadow','name: release-gate'),y.replace('needs: [select, test, database, edge, media-concurrency]','needs: [test]')])
  assert.throws(()=>contract(bad));
 const legacy=readFileSync(new URL('../.github/workflows/release-check.yml',import.meta.url),'utf8');
 assert.match(legacy,/name: release-gate\r?\n\s+needs: \[classify, test, edge-bundler, media-concurrency\]/);
});
