import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {execFileSync,spawnSync} from 'node:child_process';
import {CLOSURE,runTrusted} from '../scripts/ci-trusted-launcher.mjs';
const launcher=fileURLToPath(new URL('../scripts/ci-trusted-launcher.mjs',import.meta.url));
const sources=Object.fromEntries(CLOSURE.map(f=>[f,readFileSync(new URL('../scripts/'+f,import.meta.url),'utf8')]));
const weak="import {execFileSync} from 'node:child_process';export function selectGit(root,baseSha){return {schemaVersion:1,baseSha,checkoutSha:execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),diffComplete:true,requirements:{base:true,database:false,edge:false,mediaConcurrency:false,unknown:false},reasons:[]}}";
function fixture(t,{bootstrap=false,baseWeak=false,change={},omitAnchor=[],sql=true}={}) {
 const root=mkdtempSync(path.join(tmpdir(),'ci-launcher-test-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
 const git=(...a)=>execFileSync('git',a,{cwd:root,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
 const put=(f,s)=>{mkdirSync(path.dirname(path.join(root,f)),{recursive:true});writeFileSync(path.join(root,f),s);};
 const closure=omit=>{for(const [f,s] of Object.entries(sources))if(!omit.includes(f))put('scripts/'+f,baseWeak&&f==='ci-select.mjs'?
   s.replace('diffComplete, requirements, reasons','diffComplete, requirements:{base:true,database:false,edge:false,mediaConcurrency:false,unknown:false}, reasons'):s);};
 git('init','-q');git('config','user.name','Fixture');git('config','user.email','fixture@example.test');git('config','core.autocrlf','false');
 put('schema.sql','select 1;');if(!bootstrap)closure([]);git('add','.');git('commit','-qm','event base');const base=git('rev-parse','HEAD');
 let anchor=base;
 if(bootstrap){git('checkout','-qb','anchor');closure(omitAnchor);git('add','.');git('commit','-qm','reviewed anchor');anchor=git('rev-parse','HEAD');git('checkout','-qb','candidate',base);closure([]);}
 if(sql)put('schema.sql','select 2;');
 for(const [f,s] of Object.entries(change)){if(s===null)rmSync(path.join(root,'scripts',f),{force:true});else put('scripts/'+f,s);}
 git('add','-A');git('commit','-qm','candidate');const head=git('rev-parse','HEAD');
 const env={...process.env,GITHUB_EVENT_NAME:'pull_request',GITHUB_REPOSITORY:'example/shop',GITHUB_SHA:head,GITHUB_RUN_ID:'123',GITHUB_RUN_ATTEMPT:'1',BOOTSTRAP_TRUST_ANCHOR_SHA:anchor};
 const event={pull_request:{base:{sha:base},head:{sha:head}}},needs={},jobs=[];
 for(const [i,key] of ['select','test','database','edge','media-concurrency'].entries()){
  needs[key]={result:'success',outputs:{checkout_sha:head,checkout_run_id:'123',checkout_run_attempt:'1',cases:'1'}};
  jobs.push({id:i+1,name:'shadow-'+key,run_id:123,run_attempt:1,head_sha:head,status:'completed',conclusion:'success'});
 }
 const options={token:'fixture',fetchImpl:async()=>({ok:true,json:async()=>({total_count:5,jobs}),headers:new Headers()})};
 return {root,env,event,needs,jobs,options,anchor,git,put};
}
const run=f=>runTrusted(f,f.options);
const skipped=f=>{f.jobs[2].conclusion='skipped';f.needs.database={result:'skipped',outputs:{}};};
const full=r=>assert.deepEqual(r.calculation.requirements,{base:true,database:true,edge:true,mediaConcurrency:true,unknown:true});
test('normal base and explicit bootstrap each load the exact closure and pass actual evidence',async t=>{
 for(const bootstrap of [false,true]){const f=fixture(t,{bootstrap}),r=await run(f);assert.equal(r.pass,true,JSON.stringify(r));assert.equal(r.trustedSha,f.anchor);assert.equal(r.calculation.trustedSha,f.anchor);}
});
for(const [name,change] of [
 ['candidate gate exits 0',{'ci-shadow-gate.mjs':'process.exit(0)'}],
 ['candidate union lies',{'ci-requirements.mjs':'export const computeRequirements=()=>({valid:true,requirements:{base:false,database:false,edge:false,mediaConcurrency:false,unknown:false}});'}],
 ['candidate selector downgrades SQL',{'ci-select.mjs':weak}],
 ['same-name API helper forges success',{'release-ci-gate.mjs':'export const readAttemptJobs=()=>[]; throw Error("CANDIDATE HELPER EXECUTED");'}],
 ['deleted candidate gate',{'ci-shadow-gate.mjs':null}]
])test(name+' cannot replace trusted verdict',async t=>{
 const f=fixture(t,{change});skipped(f);const r=await run(f);
 assert.equal(r.pass,false);assert.equal(r.calculation.CI_CONTROL_CHANGE,true);full(r);
 assert.ok(r.errors.some(e=>e.includes('shadow-database')),JSON.stringify(r));
 f.jobs[2].conclusion='success';f.needs.database={result:'success',outputs:{checkout_sha:f.env.GITHUB_SHA,checkout_run_id:'123',checkout_run_attempt:'1',cases:'1'}};
 assert.equal((await run(f)).pass,true); // control edits require review/full checks, not automatic denial
});
test('candidate worktree/helper/package scripts never become trusted executable source',async t=>{
 const f=fixture(t);for(const file of CLOSURE)f.put('scripts/'+file,'process.exit(0);');
 f.put('package.json',JSON.stringify({scripts:{preinstall:'exit 0'},type:'commonjs'}));skipped(f);
 const r=await run(f);assert.equal(r.pass,false);assert.ok(r.errors.some(e=>e.includes('shadow-database')));
});
for(const [name,source] of [['deleted',null],['malformed','export const selectGit=()=>({bad:true});'],['throws','throw Error("candidate broken");']])
 test('candidate selector '+name+' fails full/invalid',async t=>{const f=fixture(t,{change:{'ci-select.mjs':source}}),r=await run(f);assert.equal(r.pass,false);assert.equal(r.calculation.valid,false);full(r);});
for(const [name,value] of [['missing',''],['malformed','main'],['nonexistent','f'.repeat(40)]])
 test('bootstrap '+name+' SHA has no fallback',async t=>{const f=fixture(t,{bootstrap:true});f.env.BOOTSTRAP_TRUST_ANCHOR_SHA=value;const r=await run(f);assert.equal(r.pass,false);full(r);});
test('readable wrong bootstrap commit with incomplete closure fails',async t=>{
 const f=fixture(t,{bootstrap:true});f.env.BOOTSTRAP_TRUST_ANCHOR_SHA=f.event.pull_request.base.sha;
 const r=await run(f);assert.equal(r.pass,false);full(r);
});
test('missing trusted file cannot be filled from candidate or mixed per-file SHA options',async t=>{
 const f=fixture(t,{bootstrap:true,omitAnchor:['release-ci-gate.mjs']});
 f.options.trustedSha=f.env.GITHUB_SHA;f.options.fileRefs={'release-ci-gate.mjs':f.env.GITHUB_SHA};
 const r=await run(f);assert.equal(r.pass,false);assert.match(r.errors.join(),/Incomplete trusted closure/);full(r);
});
test('candidate enhancement survives union even if base selector returns base only',async t=>{
 const f=fixture(t,{baseWeak:true,change:{'ci-select.mjs':sources['ci-select.mjs']}}),r=await run(f);
 assert.equal(r.pass,true);assert.equal(r.calculation.trustedRequirements.database,false);
 assert.equal(r.calculation.candidateRequirements.database,true);assert.equal(r.calculation.requirements.database,true);
});
test('real CLI uses the same trusted verdict for candidate gate attack',t=>{
 const f=fixture(t,{bootstrap:true,change:{'ci-shadow-gate.mjs':'process.exit(0)'}});skipped(f);
 const eventFile=path.join(f.root,'event.json');writeFileSync(eventFile,JSON.stringify(f.event));
 const code=`globalThis.fetch=async()=>({ok:true,json:async()=>(${JSON.stringify({total_count:5,jobs:f.jobs})}),headers:new Headers()});process.argv=[process.execPath,${JSON.stringify(launcher)},'gate'];await import(${JSON.stringify(pathToFileURL(launcher).href)});`;
 const env={...f.env,GITHUB_EVENT_PATH:eventFile,GITHUB_TOKEN:'fixture',CI_SHADOW_NEEDS:JSON.stringify(f.needs)};
 delete env.GITHUB_OUTPUT;delete env.GITHUB_STEP_SUMMARY;delete env.NODE_OPTIONS;
 const r=spawnSync(process.execPath,['--input-type=module','-e',code],{cwd:f.root,env,encoding:'utf8'});
 assert.equal(r.status,1,r.stderr);const verdict=JSON.parse(r.stdout.trim());assert.equal(verdict.trustedSha,f.anchor);
 assert.ok(verdict.errors.some(e=>e.includes('shadow-database')));full(verdict);
});
test('workflow select and gate invoke the launcher, not candidate verdict',()=>{
 const y=readFileSync(new URL('../.github/workflows/ci-shadow.yml',import.meta.url),'utf8');
 for(const mode of ['select','gate'])assert.match(y,new RegExp('run: node scripts/ci-trusted-launcher.mjs '+mode));
 assert.doesNotMatch(y,/run: node scripts\/ci-shadow-gate\.mjs/);
 assert.match(y,/BOOTSTRAP_TRUST_ANCHOR_SHA: ''/);
});
