// Direct checks, no Release Report, classifier, production request or credentials.
import { existsSync, readFileSync, readdirSync, appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { spawnSync, execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkGitVersions } from './cache-version-guard.mjs';
import { createRequire } from 'node:module';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const require=createRequire(import.meta.url);
export const MANDATORY_NODE = ['activity-promotions','browser-baseline','catalog-layout','customer-identity',
 'customer-order-tools','customer-otp-template','edge-bundle-proof','edge-dependencies','footer-layout','image-optimizer',
 'media-cleanup-core','order-refresh-level','release-ci-gate','release-contracts','release-level','release-live',
 'release-override','release-report','request-body','submit-order-auth','supabase-evidence',
 'ci-select','ci-shadow-gate','ci-check','cache-version-guard'];
export const DATABASE = ['customer-accounts-db','customer-wallet-db','media-deletion-guard-db'];
export function assertTap(output, file) {
  const metric=k=>{const m=[...output.matchAll(new RegExp('^# '+k+' (\\d+)\\r?$','gm'))];if(m.length!==1)throw Error('Missing/ambiguous TAP '+k);return Number(m[0][1]);};
  const tests=metric('tests');
  if(tests<1 || metric('pass')!==tests || ['fail','cancelled','skipped','todo'].some(k=>metric(k)!==0))
    throw Error('Zero/skipped/incomplete/failed mandatory suite: '+file);
  const subtests=[...output.matchAll(/^# Subtest: (.+)\r?$/gm)].map(m=>m[1].trim().replaceAll('\\','/'));
  if(!subtests.some(n=>n!==file.replaceAll('\\','/')&&!n.endsWith('/'+file.replaceAll('\\','/'))&&!n.endsWith('/'+path.basename(file))))
    throw Error('Empty test file is not an executed suite: '+file);
  return tests;
}
function run(args, timeout=240000, env=process.env) {
  const r=spawnSync(process.execPath,args,{cwd:root,env,encoding:'utf8',timeout,maxBuffer:24*1024*1024});
  const out=(r.stdout||'')+(r.stderr||'');process.stdout.write(out);
  if(r.error||r.status!==0)throw Error('Check failed: '+args.join(' ')+' '+(r.error?.message||''));
  return out;
}
function nodeSuites(names) {
  let cases=0;
  for(const name of names) {
    const file='tests/'+name+'.test.mjs';
    if(!existsSync(path.join(root,file)))throw Error('Mandatory suite missing: '+file);
    cases+=assertTap(run(['--test','--test-reporter=tap',file]),file);
  }
  if(!cases)throw Error('Zero tests');return cases;
}
const walk=dir=>readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(path.join(dir,e.name)):[path.join(dir,e.name)]);
export function localChecks() {
  let assets=0;
  function reference(raw,source) {
    if(/^(?:https?:|data:|#|mailto:|tel:)/i.test(raw))return;
    const clean=decodeURIComponent(raw.split(/[?#]/)[0]).replace(/^\//,'');
    if(clean&&!existsSync(path.join(root,clean)))throw Error(source+': missing local resource '+clean);
    if(clean)assets++;
  }
  for(const file of ['index.html','admin.html'])
    for(const m of readFileSync(path.join(root,file),'utf8').matchAll(/(?:src|href)=["']([^"']+)["']/gi))reference(m[1],file);
  for(const m of readFileSync(path.join(root,'admin-auth.js'),'utf8').matchAll(/["']([^"']+\.(?:js|css)(?:\?[^"']*)?)["']/gi))reference(m[1],'admin-auth.js');
  const files=[...readdirSync(root).filter(f=>f.endsWith('.js')).map(f=>path.join(root,f)),
    ...walk(path.join(root,'scripts')),...walk(path.join(root,'tests'))].filter(f=>/\.(?:mjs|cjs|js)$/.test(f));
  for(const file of files) {
    for(const m of readFileSync(file,'utf8').matchAll(/\bfrom\s+["'](\.\.?\/[^"']+)["']/g))
      if(!existsSync(path.resolve(path.dirname(file),m[1])))throw Error('Missing local import: '+file+' '+m[1]);
    run(['--check',file]);
  }
  execFileSync('git',['diff','HEAD','--check'],{cwd:root,stdio:'pipe'});
  if(!assets||!files.length)throw Error('Empty resource/syntax coverage');
  return {assets,scripts:files.length};
}
export function assertProof(proof,count,sha) {
  if(proof?.result!=='PASS'||proof.commit!==sha||proof.cases?.length!==count||
      proof.cases.some(c=>c.result!=='PASS'))throw Error('Missing/zero/failed high-risk execution proof');
  return count;
}
export async function check(mode,base) {
  const checkoutSha=execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim();
  if(process.env.GITHUB_SHA && process.env.GITHUB_SHA!==checkoutSha)throw Error('Wrong checkout SHA');
  let cases=0,details={};
  if(mode==='base') {
    details.local=localChecks();
    details.cache=checkGitVersions(root,base,checkoutSha);
    if(!['PASS','NOT_REQUIRED'].includes(details.cache.status))throw Error('Cache Version Guard: '+JSON.stringify(details.cache));
    run(['scripts/release-security.mjs']);
    const discovered=readdirSync(path.join(root,'tests')).filter(f=>f.endsWith('.test.mjs')&&!f.endsWith('-db.test.mjs')).map(f=>f.slice(0,-9));
    for(const name of MANDATORY_NODE)if(!discovered.includes(name))throw Error('Missing mandatory Node suite '+name);
    cases=nodeSuites(discovered.sort());
    const log=run(['scripts/check-browser-baseline.cjs']);
    const lines=log.split(/\r?\n/).filter(l=>l.startsWith('BROWSER_BASELINE '));
    if(lines.length!==1)throw Error('Missing current browser execution summary');
    const browser=JSON.parse(lines[0].slice('BROWSER_BASELINE '.length));
    require('./browser/policy.cjs').assertComplete(browser.results);
    if(browser.retries!==0)throw Error('Unexpected browser retry');
    details.browser=browser;cases+=browser.results.reduce((n,r)=>n+r.cases,0);
  } else if(mode==='database') {
    const names=readdirSync(path.join(root,'tests')).filter(f=>f.endsWith('-db.test.mjs')).map(f=>f.slice(0,-9));
    for(const name of DATABASE)if(!names.includes(name))throw Error('Missing database suite '+name);
    cases=nodeSuites(names.sort());
  } else if(mode==='edge') {
    cases=nodeSuites(['customer-identity','request-body','submit-order-auth','media-cleanup-core','edge-dependencies','edge-bundle-proof']);
    run(['scripts/check-edge-dependencies.mjs'],260000);
    // Existing proof semantics (including fresh Docker fixtures) remain unchanged.
    const p='.build/edge-bundle-proof/evidence/report.json';
    if(existsSync(path.join(root,p)))throw Error('Stale Edge proof; use fresh isolated checkout');
    run(['scripts/edge-bundle-proof.mjs'],1200000,{...process.env,GITHUB_SHA:checkoutSha});
    cases+=assertProof(JSON.parse(readFileSync(path.join(root,p),'utf8')),6,checkoutSha);
  } else if(mode==='media-concurrency') {
    const p='.build/media-concurrency/report.json';
    if(existsSync(path.join(root,p)))throw Error('Stale media proof; use fresh isolated checkout');
    run(['scripts/check-media-concurrency.mjs'],540000,{...process.env,GITHUB_SHA:checkoutSha});
    cases=assertProof(JSON.parse(readFileSync(path.join(root,p),'utf8')),4,checkoutSha);
  } else throw Error('Unknown suite');
  if(!Number.isSafeInteger(cases)||cases<=0)throw Error('Zero execution');
  const result={mode,checkoutSha,cases,details};
  mkdirSync(path.join(root,'.build/ci-shadow'),{recursive:true});
  writeFileSync(path.join(root,'.build/ci-shadow',mode+'.json'),JSON.stringify(result,null,2));
  // Emitted only after ALL required operations succeeded in this invocation.
  if(process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT,
    'cases='+cases+'\ncheckout_sha='+checkoutSha+'\ncheckout_run_id='+process.env.GITHUB_RUN_ID+
    '\ncheckout_run_attempt='+process.env.GITHUB_RUN_ATTEMPT+'\n');
  console.log('CI_CHECK '+JSON.stringify({mode,checkoutSha,cases}));return result;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  try {await check(process.argv[2],process.env.CI_BASE_SHA);}catch(e){console.error(e.stack);process.exitCode=1;}
}
