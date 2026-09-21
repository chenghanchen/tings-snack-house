import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {computeRequirements,unionRequirements,bindingFromEvent,isControlPath} from '../scripts/ci-requirements.mjs';
import {verifyRequirements,JOBS} from '../scripts/ci-shadow-gate.mjs';
const source=readFileSync(new URL('../scripts/ci-select.mjs',import.meta.url),'utf8');
const req=(database=false)=>({base:true,database,edge:false,mediaConcurrency:false,unknown:false});
const full=r=>assert.deepEqual(r,{base:true,database:true,edge:true,mediaConcurrency:true,unknown:true});
function fixture(t,{base=source,candidate=base,files={'schema.sql':'select 2;'}}={}) {
  const root=mkdtempSync(path.join(tmpdir(),'ci-union-test-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
  const git=(...a)=>execFileSync('git',a,{cwd:root,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
  const put=(f,s)=>{mkdirSync(path.dirname(path.join(root,f)),{recursive:true});writeFileSync(path.join(root,f),s);};
  git('init','-q');git('config','user.name','Fixture');git('config','user.email','fixture@example.test');git('config','core.autocrlf','false');
  put('schema.sql','select 1;');if(base!==null)put('scripts/ci-select.mjs',base);
  git('add','.');git('commit','-qm','base');const baseSha=git('rev-parse','HEAD');
  if(candidate===null)rmSync(path.join(root,'scripts/ci-select.mjs'),{force:true});else put('scripts/ci-select.mjs',candidate);
  for(const [f,s] of Object.entries(files))put(f,s);
  git('add','-A');git('commit','-qm','candidate');const headSha=git('rev-parse','HEAD');
  return {root,git,put,binding:{baseSha,headSha,checkoutSha:headSha,runId:'123',attempt:'1'}};
}
test('union preserves trusted SQL requirement; candidate may only enhance',()=>{
  assert.equal(unionRequirements(req(true),req()).database,true);
  assert.equal(unionRequirements(req(),req(true)).database,true);
  full(unionRequirements(req(),null));full(unionRequirements(req(),req(),true));
});
test('real Git: base SQL vs downgraded candidate; control change forces full',t=>{
  const weak=source.replace("return ['database'];","return [];");assert.notEqual(weak,source);
  const f=fixture(t,{candidate:weak}),r=computeRequirements(f.root,f.binding);
  assert.equal(r.valid,true);assert.equal(r.trustedRequirements.database,true);
  // Candidate still marks its selector file unknown: independently test union above.
  assert.equal(r.CI_CONTROL_CHANGE,true);full(r.requirements);
});
test('malicious selector says base-only for EVERYTHING; cannot lower trusted requirements',t=>{
  const candidate=`export function selectGit(root,baseSha){return {schemaVersion:1,checkoutSha:'PLACEHOLDER',baseSha,diffComplete:true,requirements:${JSON.stringify(req())},reasons:[]}}`;
  // Resolve checkout at runtime so the attack is well-formed, not rejected by stale SHA.
  const code="import {execFileSync} from 'node:child_process';\n"+candidate.replace("'PLACEHOLDER'","execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim()");
  const f=fixture(t,{candidate:code}),r=computeRequirements(f.root,f.binding);
  assert.equal(r.valid,true);assert.equal(r.candidateRequirements.database,false);
  assert.equal(r.trustedRequirements.database,true);full(r.requirements);
});
for(const [name,candidate] of [['deleted',null],['malformed','export const selectGit=()=>({bad:true});'],
 ['throws','throw Error("selector failed");'],['wrong SHA',"export const selectGit=()=>({checkoutSha:'"+'f'.repeat(40)+"'});"]])
 test('candidate '+name+' fails closed',t=>{const f=fixture(t,{candidate}),r=computeRequirements(f.root,f.binding);assert.equal(r.valid,false);full(r.requirements);});
test('bootstrap missing base selector never substitutes HEAD or chooses anchor',t=>{
  const f=fixture(t,{base:null,candidate:source}),r=computeRequirements(f.root,f.binding);
  assert.equal(r.valid,false);assert.equal(r.trustedRequirements,null);full(r.requirements);
});
for(const [name,tail] of [['incomplete diff','diffComplete:false'],['wrong output base',"baseSha:'"+'e'.repeat(40)+"'"],
  ['wrong output checkout',"checkoutSha:'"+'e'.repeat(40)+"'"]])
 test(name+' with otherwise valid output is rejected',t=>{
  const code="import {execFileSync} from 'node:child_process'; export function selectGit(root,baseSha){return {schemaVersion:1,baseSha,checkoutSha:execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),diffComplete:true,requirements:"+JSON.stringify(req())+",reasons:[],"+tail+"}}";
  const f=fixture(t,{candidate:code}),r=computeRequirements(f.root,f.binding);assert.equal(r.valid,false);full(r.requirements);
 });
test('PR merge checkout binds exact event base/head parents',t=>{
  const f=fixture(t);f.git('checkout','-qb','fixture-merge',f.binding.baseSha);f.put('unrelated.txt','base advanced');
  f.git('add','.');f.git('commit','-qm','event base');const baseSha=f.git('rev-parse','HEAD');
  f.git('merge','--no-ff','-qm','temporary PR merge',f.binding.headSha);
  const binding={...f.binding,baseSha,checkoutSha:f.git('rev-parse','HEAD')};
  assert.equal(computeRequirements(f.root,binding).valid,true);
  const wrong=computeRequirements(f.root,{...binding,baseSha:f.binding.baseSha});
  assert.equal(wrong.valid,false);full(wrong.requirements);
});
test('wrong revision/checkout and event binding rejected; worktree not selector source',t=>{
  const f=fixture(t);f.put('scripts/ci-select.mjs','throw Error("worktree must not execute");');
  assert.equal(computeRequirements(f.root,f.binding).valid,true);
  for(const k of ['baseSha','headSha','checkoutSha']){const r=computeRequirements(f.root,{...f.binding,[k]:'f'.repeat(40)});assert.equal(r.valid,false);full(r.requirements);}
  const e={GITHUB_EVENT_NAME:'pull_request',GITHUB_SHA:f.binding.checkoutSha,GITHUB_RUN_ID:'123',GITHUB_RUN_ATTEMPT:'1'};
  assert.deepEqual(bindingFromEvent(e,{pull_request:{base:{sha:f.binding.baseSha},head:{sha:f.binding.headSha}}},f.binding.checkoutSha),f.binding);
  assert.throws(()=>bindingFromEvent({...e,GITHUB_SHA:'bad'},{},f.binding.checkoutSha));
});
test('CI control paths force full independently of selectors',()=>{
  for(const p of ['scripts/ci-select.mjs','scripts/ci-requirements.mjs','scripts/ci-shadow-gate.mjs','scripts/ci-check.mjs',
    'scripts/cache-version-guard.mjs','.github/workflows/ci-shadow.yml','package.json','package-lock.json','deno.json'])assert.equal(isControlPath(p),true,p);
  assert.equal(isControlPath('styles.css'),false);
});
test('candidate gate attack succeeds locally; independent verdict rejects skipped required DB',async t=>{
  const f=fixture(t,{files:{'schema.sql':'select 2;','scripts/ci-shadow-gate.mjs':'console.log("CANDIDATE PASS");'}});
  assert.match(execFileSync(process.execPath,['scripts/ci-shadow-gate.mjs'],{cwd:f.root,encoding:'utf8'}),/CANDIDATE PASS/);
  const c={repository:'example/shop',event:'pull_request',runId:'123',attempt:'1',checkoutSha:f.binding.checkoutSha,apiSha:f.binding.headSha};
  const needs={},jobs=[];
  for(const [i,[key,name]] of Object.entries(JOBS).entries()){
    const conclusion=key==='database'?'skipped':'success';
    needs[key]={result:conclusion,outputs:conclusion==='success'?{checkout_sha:c.checkoutSha,checkout_run_id:'123',checkout_run_attempt:'1',cases:'1'}:{}};
    jobs.push({id:i+1,name,run_id:123,run_attempt:1,head_sha:c.apiSha,status:'completed',conclusion});
  }
  const options={token:'fixture',fetchImpl:async()=>({ok:true,json:async()=>({total_count:jobs.length,jobs}),headers:new Headers()})};
  const r=await verifyRequirements(f.root,c,needs,f.binding,options);
  assert.equal(r.pass,false);assert.ok(r.errors.some(e=>e.includes('shadow-database')));assert.equal(r.calculation.requirements.database,true);
  console.log('TRUST_BOUNDARY: candidate gate exited 0; separately loaded verdict rejected it. Candidate launcher remains untrusted until reviewed anchor is fixed.');
  jobs[2].conclusion='success';needs.database={result:'success',outputs:{checkout_sha:c.checkoutSha,checkout_run_id:'123',checkout_run_attempt:'1',cases:'1'}};
  assert.equal((await verifyRequirements(f.root,c,needs,f.binding,options)).pass,true);
});
