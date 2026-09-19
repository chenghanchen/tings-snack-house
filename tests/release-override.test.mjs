import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { detectRelease, validateClassification, FULL_GATES } from '../scripts/release-level.mjs';
import { createReport, validateReport, renderReport } from '../scripts/release-report-core.mjs';

const root = new URL('..', import.meta.url), baseline = 'b3ed83601945c0cc679f79d9ab7910522029457e';
const approvalPath = 'release-ui-overrides.json';
const sourceFiles = ['customer-account.css','customer-account.js','index.html','scripts/check-customer-account.cjs','styles.css','mobile-header.js'];
const patch = readFileSync(new URL('./fixtures/release-level/account-details-ui.patch.txt', import.meta.url), 'utf8').replace(/\r\n/g,'\n');
const hash = s => createHash('sha256').update(s.replace(/\r\n/g,'\n')).digest('hex');
const sources = Object.fromEntries(sourceFiles.map(f => [f,execFileSync('git',['show',`${baseline}:${f}`],{cwd:root,encoding:'utf8'})]));
function fixture(manifest) {
  const folder = mkdtempSync(path.join(tmpdir(),'release-override-'));
  const git = (...args) => execFileSync('git',args,{cwd:folder,encoding:'utf8',stdio:['pipe','pipe','pipe']}).trim();
  git('init','-q');git('config','user.name','Override fixture');git('config','user.email','override@example.test');git('config','core.autocrlf','false');
  const put = (file,content) => { mkdirSync(path.dirname(path.join(folder,file)),{recursive:true});writeFileSync(path.join(folder,file),content); };
  for(const [file,source] of Object.entries(sources))put(file,source);
  if(manifest !== undefined)put(approvalPath,typeof manifest==='string'?manifest:JSON.stringify(manifest));
  const commit = () => {git('add','.');git('commit','-qm','fixture');return git('rev-parse','HEAD')};
  const base = commit();
  execFileSync('git',['apply','--'],{cwd:folder,input:patch,stdio:['pipe','pipe','pipe']});
  return {folder,base,put,git,commit,plan: options => detectRelease(folder,{base,head:commit(),...options})};
}
const unapproved = fixture(), automatic = unapproved.plan();
const rows = ['customer-account.js','scripts/check-customer-account.cjs'].map(file => ({path:file,beforeSha256:hash(sources[file]),afterSha256:hash(readFileSync(path.join(unapproved.folder,file),'utf8'))}));
const approval = () => ({schemaVersion:1,approvals:[{id:'account-details-back-ui',review:'User-authorized exact presentation diff; independent L3 scope review',
  issuedAt:new Date(Date.now()-60000).toISOString(),expiresAt:new Date(Date.now()+86400000).toISOString(),diffFingerprint:automatic.diffFingerprint,files:structuredClone(rows)}]});
function full(plan) {
  assert.equal(plan.level,'L3');assert.deepEqual(plan.requiredGates,FULL_GATES);
  if(plan.resourceVersions?.status==='FAIL')assert.throws(()=>validateClassification(plan),/Cache\/version release blocked/);
  else validateClassification(plan);
}

test('missing approval stays L3; exact trusted approval enables L1 without hiding automatic classification',()=>{
  full(automatic);
  const f=fixture(approval()),p=f.plan();
  assert.equal(p.level,'L1');assert.equal(p.override.status,'APPLIED');assert.equal(p.resourceVersions.status,'PASS');
  assert.equal(p.files.filter(f=>f.automaticLevel==='L3').length,2);
  validateClassification(p);
  const report=createReport(p.head,'main','fixture',undefined,p);
  for(const gate of ['database','supabase','productionMatch','productionApproval','frozenVersion','edgeBundler'])assert.equal(report.checks[gate].status,'NOT_REQUIRED');
  validateReport(report);
  assert.match(renderReport(report),/Manual override: \*\*APPLIED\*\*/);
});
test('initial approval binds the complete pending UI fixture, not the infrastructure branch',()=>{
  const manifest=JSON.parse(readFileSync(new URL('../release-ui-overrides.json',import.meta.url),'utf8'));
  assert.equal(manifest.approvals[0].diffFingerprint,automatic.diffFingerprint);
  assert.deepEqual(manifest.approvals[0].files,rows);
  // Time-dependent validity is covered separately; this structural test must not
  // grant the real approval a renewal or make CI time-bomb after its expiration.
  manifest.approvals[0].issuedAt=approval().approvals[0].issuedAt;
  manifest.approvals[0].expiresAt=approval().approvals[0].expiresAt;
  assert.equal(fixture(manifest).plan().level,'L1');
});
test('candidate cannot approve itself or replace a trusted approval',()=>{
  const a=approval(),f=fixture();f.put(approvalPath,JSON.stringify(a));full(f.plan());
  const g=fixture(a);a.approvals[0].review='candidate edit';g.put(approvalPath,JSON.stringify(a));full(g.plan());
});
test('malformed, stale, future-dated, oversized TTL, duplicate and ambiguous approvals fail closed',()=>{
  const variants=['{broken',{}, {schemaVersion:1,approvals:[]}];
  for(const mutate of [
    a=>{a.approvals[0].expiresAt=new Date(Date.now()-1000).toISOString()},
    a=>{a.approvals[0].issuedAt=new Date(Date.now()+10000).toISOString()},
    a=>{a.approvals[0].expiresAt=new Date(Date.now()+8*86400000).toISOString()},
    a=>{a.approvals[0].expiresAt='not a date'},
    a=>{a.approvals[0].files[0].afterSha256='0'.repeat(64)},
    a=>{a.approvals[0].files.push(a.approvals[0].files[0])},
    a=>{a.approvals[0].files.pop()},
    a=>{a.approvals[0].diffFingerprint='0'.repeat(64)},
    a=>{a.approvals[0].extra='unknown'},
    a=>{a.approvals.push({...a.approvals[0]})},
    a=>{a.approvals.push({...a.approvals[0],id:'ambiguous'})},
  ]){const a=approval();mutate(a);variants.push(a)}
  for(const a of variants)full(fixture(a).plan());
});
test('any file drift, unrelated L1 change, mode change and missing cache update invalidate approval',()=>{
  for(const file of ['customer-account.js','scripts/check-customer-account.cjs','customer-account.css','index.html']){
    const f=fixture(approval());f.put(file,readFileSync(path.join(f.folder,file),'utf8')+'\n');full(f.plan());
  }
  const a=fixture(approval());a.put('README.md','additional L1 scope');full(a.plan());
  const b=fixture(approval());b.put('index.html',sources['index.html']);const p=b.plan();full(p);assert.equal(p.resourceVersions.status,'FAIL');
  const c=fixture(approval());c.git('add','.');c.git('update-index','--chmod=+x','customer-account.js');c.git('commit','-qm','mode change');
  full(detectRelease(c.folder,{base:c.base,head:'HEAD'}));
});
test('hard L3 files cannot be included even in a matching trusted manifest',()=>{
  for(const file of ['supabase/migrations/001.sql','supabase/functions/submit-order/index.ts','auth.js','rls.sql','storage-delete.js','payment.js','order-pricing.js','admin.js','scripts/deploy.cjs','scripts/release-security.mjs','.github/workflows/deploy.yml','unknown.cjs']){
    const f=fixture();f.put(file,'sensitiveOperation();');const raw=f.plan();
    const a=approval();a.approvals[0].diffFingerprint=raw.diffFingerprint;
    const g=fixture(a);g.put(file,'sensitiveOperation();');full(g.plan());
    a.approvals[0].files.push({path:file,beforeSha256:hash(''),afterSha256:hash('sensitiveOperation();')});
    const h=fixture(a);h.put(file,'sensitiveOperation();');full(h.plan());
  }
});
test('hard operations hidden in an eligible filename cannot be approved with forged hashes',()=>{
  for(const operation of ['db.from("orders").insert({});','db.rpc("save");','db.auth.updateUser({});','db.storage.from("media").remove(["x"]);','total += 1;','fetch("/pay",{method:"POST"});','db["from"]("orders")["delete"]();']){
    for(const file of ['customer-account.js','scripts/check-customer-account.cjs']){
      const f=fixture();const mutated=readFileSync(path.join(f.folder,file),'utf8')+'\n'+operation;f.put(file,mutated);
      const syncCache = g => {if(file==='customer-account.js')g.put('index.html',readFileSync(path.join(g.folder,'index.html'),'utf8').replace(/customer-account\.js\?v=[a-f0-9]{64}/,`customer-account.js?v=${hash(mutated)}`))};
      syncCache(f);const raw=f.plan();assert.equal(raw.resourceVersions.status,'PASS');
      const a=approval();a.approvals[0].diffFingerprint=raw.diffFingerprint;a.approvals[0].files.find(r=>r.path===file).afterSha256=hash(mutated);
      const g=fixture(a);g.put(file,mutated);syncCache(g);const p=g.plan();assert.equal(p.resourceVersions.status,'PASS');full(p);
    }
  }
});
test('trusted L3 floor, uncertain ancestry and report tampering are never bypassed',()=>{
  full(fixture(approval()).plan({minimumLevel:'L3'}));
  full(fixture(approval()).plan({base:'0'.repeat(40)}));
  const p=fixture(approval()).plan();
  for(const mutate of [
    r=>{r.override.approval.expiresAt=new Date(Date.now()-1000).toISOString()},
    r=>{r.override.approval.files[0].afterSha256='0'.repeat(64)},
    r=>{r.override.sourceBase='0'.repeat(40)},
    r=>{delete r.override},
  ]){const r=structuredClone(p);mutate(r);assert.throws(()=>validateClassification(r))}
  const report=createReport(p.head,'main','fixture',undefined,p);
  report.classification.override.approval.expiresAt=new Date(Date.now()-1000).toISOString();
  assert.throws(()=>renderReport(report));
});
