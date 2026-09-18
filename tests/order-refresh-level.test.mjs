import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {classifyChanges, detectRelease, FULL_GATES} from '../scripts/release-level.mjs';

const baseline='2be07ac33c3a3758d548ae200bf21713da3fb678';
const files=['customer-account.css','customer-account.js','index.html','scripts/check-customer-account.cjs','scripts/check-order-refresh.cjs'];
const assets=['styles.css','mobile-header.js','customer-account.css','customer-account.js'];
const digest=s=>createHash('sha256').update(s.replace(/\r\n/g,'\n')).digest('hex');
let saved;
function fixture() {
  if(saved)return saved;
  const root=mkdtempSync(path.join(tmpdir(),'order-refresh-policy-'));
  const git=(...args)=>execFileSync('git',args,{cwd:root,encoding:'utf8',stdio:['pipe','pipe','pipe']}).trim();
  const old=file=>execFileSync('git',['show',`${baseline}:${file}`],{cwd:new URL('..',import.meta.url),encoding:'utf8'}).replace(/\r\n/g,'\n');
  git('init','-b','main');
  for(const file of new Set([...assets,...files.filter(f=>f!=='scripts/check-order-refresh.cjs')])){
    mkdirSync(path.dirname(path.join(root,file)),{recursive:true});writeFileSync(path.join(root,file),old(file));
  }
  const commit=()=>{git('add','.');git('-c','user.name=Fixture','-c','user.email=fixture@example.test','-c','commit.gpgsign=false','commit','--allow-empty','-m','Offline fixture');return git('rev-parse','HEAD')};
  const base=commit();
  execFileSync('git',['apply','--'],{cwd:root,input:readFileSync(new URL('./fixtures/release-level/order-refresh.patch.txt',import.meta.url),'utf8').replace(/\r\n/g,'\n'),stdio:['pipe','pipe','pipe']});
  const head=commit();
  const changes=files.map(file=>({path:file,status:file==='scripts/check-order-refresh.cjs'?'A':'M',mode:'100644',oldMode:'100644',before:file==='scripts/check-order-refresh.cjs'?'':old(file),after:readFileSync(path.join(root,file),'utf8').replace(/\r\n/g,'\n')}));
  return saved={root,base,head,changes,git,commit};
}
const classify=changes=>classifyChanges(changes,{base:fixture().base,head:fixture().head});

test('exact preserved five-file refresh UI is L1 with all four content versions verified',()=>{
  const f=fixture(),p=detectRelease(f.root,{base:f.base,head:f.head});
  assert.equal(p.level,'L1');assert.equal(p.resourceVersions.status,'PASS');
  assert.equal(p.backendChanged,false);assert.equal(p.resourceVersions.checked.length,4);
  assert.deepEqual(p.files.map(f=>f.level),files.map(()=>'L1'));
  for(const c of f.changes)assert.equal(classify([{...c,before:c.before.replace(/\r?\n/g,'\r\n'),after:c.after.replace(/\r?\n/g,'\r\n')}]).level,'L1');
  for(const asset of assets){const row=p.resourceVersions.checked.find(r=>r.asset===asset);assert.equal(row.version,row.sha256)}
  assert.deepEqual(classifyChanges(f.changes,{base:f.base,head:f.head,minimumLevel:'L3'}).requiredGates,FULL_GATES);
  const corrected=f.changes.map(c=>c.path!=='scripts/check-customer-account.cjs'?c:{...c,
    after:c.after.replace("codeSize:'15px'","codeSize:'16px'").replace('labelWidth:90,addressWidth:320','labelWidth:80,addressWidth:330').replace('close:[50,50],labelWidth:90,orderNumberSize','close:[50,50],labelWidth:80,orderNumberSize')});
  assert.equal(classify(corrected).level,'L1');
});

test('account approval is only the one-way reviewed UI diff, never arbitrary account code',()=>{
  const ui=fixture().changes.find(c=>c.path==='customer-account.js');
  assert.match(ui.after,/setOrderRefreshBusy/);assert.doesNotMatch(ui.after,/customerOrderUpdated/);
  // Existing security-sensitive functions must be byte-identical in this audited pair.
  for(const [start,end] of [['  async function accountRpc(', '  const detailsDirty']]){
    assert.ok(ui.before.includes(start) && ui.before.includes(end) && ui.after.includes(start) && ui.after.includes(end));
    assert.equal(ui.before.slice(ui.before.indexOf(start),ui.before.indexOf(end)),ui.after.slice(ui.after.indexOf(start),ui.after.indexOf(end)));
  }
  for(const suffix of ['\nsupabase.from("orders").insert({});','\nclient.rpc("charge_wallet");',
    '\nclient.auth.updateUser({});','\nclient.storage.from("media").remove(["x"]);',
    '\ndb["from"]("orders")["delete"]();','\nfetch("/admin",{method:"POST"});','\n// unknown edit']){
    assert.equal(classify([{...ui,after:ui.after+suffix}]).level,'L3');
    assert.equal(classify([{...ui,before:ui.before+suffix}]).level,'L3');
  }
  for(const mutation of [{status:'A'},{status:'D'},{mode:'100755'},{oldMode:'100755'},
    {mode:'120000'},{path:'customer-account-copy.js'},{before:ui.after,after:ui.before}])
    assert.equal(classify([{...ui,...mutation}]).level,'L3');
});

test('offline support fingerprints are exact and cannot disable tests or broaden paths',()=>{
  for(const ui of fixture().changes.filter(c=>c.path.startsWith('scripts/'))){
    for(const extra of [{after:ui.after+'\nprocess.exit(0);'},{before:'unreviewed',status:'M'},
      {status:'D'},{mode:'100755'},{path:'scripts/unknown.cjs'},{path:'scripts/deploy.cjs'}])
      assert.equal(classify([{...ui,...extra}]).level,'L3');
  }
  const ui=fixture().changes;
  for(const file of ['migration.sql','auth/rls.sql','storage-delete.js','supabase/functions/submit-order/index.ts',
    'scripts/release-security.mjs','scripts/release-level.mjs','scripts/deploy.cjs','.github/workflows/release-production.yml',
    'tests/order-refresh-level.test.mjs','unknown.js']){
    const risk={path:file,status:'A',after:'changed'};
    for(const mixed of [[risk,...ui],[...ui,risk]])assert.deepEqual(classify(mixed).requiredGates,FULL_GATES);
  }
});

test('account resource HTML keys cannot disguise execution/path changes',()=>{
  const html=fixture().changes.find(c=>c.path==='index.html');
  for(const after of [html.after.replace('customer-account.js?v=','other.js?v='),
    html.after.replace('defer src="customer-account.js','async src="customer-account.js'),
    html.after.replace('defer src="customer-account.js','defer onload="pay()" src="customer-account.js'),
    html.after+'<script>pay()</script>'])assert.equal(classify([{...html,after}]).level,'L3');
});

test('account CSS/JS stale versions or extra HTML consumers block complete Git-tree release',()=>{
  const f=fixture();
  for(const asset of ['customer-account.css','customer-account.js']){
    const full=path.join(f.root,asset),original=readFileSync(full,'utf8');
    writeFileSync(full,original+'\n/* unversioned */');
    let p=detectRelease(f.root,{base:f.base,head:f.commit()});
    assert.equal(p.resourceVersions.status,'FAIL');assert.equal(p.level,'L3');
    writeFileSync(full,original);
  }
  const htmlPath=path.join(f.root,'index.html'),html=readFileSync(htmlPath,'utf8');
  writeFileSync(htmlPath,html.replace(/customer-account\.js\?v=[a-f0-9]{64}/,'customer-account.js?v='+ '0'.repeat(64)));
  assert.equal(detectRelease(f.root,{base:f.base,head:f.commit()}).resourceVersions.status,'FAIL');
  writeFileSync(htmlPath,html);
  writeFileSync(path.join(f.root,'extra.html'),`<script src="customer-account.js?v=${digest(readFileSync(path.join(f.root,'customer-account.js'),'utf8'))}"></script>`);
  assert.equal(detectRelease(f.root,{base:f.base,head:f.commit()}).resourceVersions.status,'FAIL');
});
