// Human-reviewed launcher boundary; NOT protection against a rewritten workflow.
import {execFileSync} from 'node:child_process';
import {mkdtempSync,writeFileSync,readFileSync,rmSync,appendFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {pathToFileURL,fileURLToPath} from 'node:url';
export const CLOSURE=['ci-select.mjs','ci-requirements.mjs','ci-shadow-gate.mjs','release-ci-gate.mjs'];
const full=()=>({base:true,database:true,edge:true,mediaConcurrency:true,unknown:true});
const sha=s=>typeof s==='string'&&/^[0-9a-f]{40}$/.test(s);
export async function runTrusted({root,env,event,needs,mode='gate'},options={}) {
  let dir, trustedSha; const git=(...a)=>execFileSync('git',a,{cwd:root,encoding:'utf8',maxBuffer:4*1024*1024,stdio:['ignore','pipe','pipe']}).trim();
  try {
    if(!['gate','select'].includes(mode)||env.GITHUB_EVENT_NAME!=='pull_request')throw Error('Explicit PR gate/select invocation required');
    const base=event?.pull_request?.base?.sha,head=event?.pull_request?.head?.sha;
    if(![base,head,env.GITHUB_SHA].every(sha)||git('rev-parse','HEAD')!==env.GITHUB_SHA)throw Error('Invalid event/checkout SHA');
    if(git('cat-file','-t',base)!=='commit')throw Error('Base must be an exact commit object');
    const entries=CLOSURE.map(f=>git('ls-tree',base,'--','scripts/'+f));
    if(entries.some(e=>e&&!e.startsWith('100644 blob ')))throw Error('Nonregular trusted base module');
    trustedSha=entries.every(Boolean)?base:env.BOOTSTRAP_TRUST_ANCHOR_SHA;
    if(!sha(trustedSha)||git('cat-file','-t',trustedSha)!=='commit'||git('rev-parse',trustedSha+'^{commit}')!==trustedSha)
      throw Error('Missing/invalid explicit bootstrap commit; no fallback');
    // One immutable source for EVERY module; there is no per-file ref override.
    const sources=CLOSURE.map(f=>{
      if(!git('ls-tree',trustedSha,'--','scripts/'+f).startsWith('100644 blob '))throw Error('Incomplete trusted closure: '+f);
      return git('show',trustedSha+':scripts/'+f);
    });
    dir=mkdtempSync(path.join(tmpdir(),'ci-trusted-'));
    for(let i=0;i<CLOSURE.length;i++)writeFileSync(path.join(dir,CLOSURE[i]),sources[i]);
    const gate=await import(pathToFileURL(path.join(dir,'ci-shadow-gate.mjs')).href);
    const policy=await import(pathToFileURL(path.join(dir,'ci-requirements.mjs')).href);
    const api=await import(pathToFileURL(path.join(dir,'release-ci-gate.mjs')).href);
    if(gate.TRUSTED_CI_VERSION!==1||typeof gate.verifyRequirements!=='function')throw Error('Unsupported trusted implementation; no fallback');
    const binding=policy.bindingFromEvent(env,event,git('rev-parse','HEAD'));
    const context=api.contextFromEnvironment(env,event,binding.checkoutSha);
    if(mode==='select') {
      const calculation=policy.computeRequirements(root,binding,trustedSha);
      return {pass:calculation.valid,calculation,trustedSha,errors:calculation.errors,lines:[]};
    }
    return {...await gate.verifyRequirements(root,context,needs,binding,{...options,trustedSha}),trustedSha};
  } catch(e) { return {pass:false,trustedSha,errors:[e.message],lines:[],calculation:{valid:false,CI_CONTROL_CHANGE:true,requirements:full()}}; }
  finally {if(dir)rmSync(dir,{recursive:true,force:true});} // exclusively this fresh temporary directory
}
export async function main(env=process.env) {
  let result;
  try {result=await runTrusted({root:process.cwd(),env,event:JSON.parse(readFileSync(env.GITHUB_EVENT_PATH,'utf8')),
    needs:JSON.parse(env.CI_SHADOW_NEEDS||'null'),mode:process.argv[2]},{token:env.GITHUB_TOKEN});}
  catch(e){result={pass:false,errors:[e.message],calculation:{valid:false,CI_CONTROL_CHANGE:true,requirements:full()}};}
  const safe=s=>s.replaceAll(env.GITHUB_TOKEN||'\0','[redacted]').replaceAll('::',': :');
  console.log(safe(JSON.stringify(result)));
  if(env.GITHUB_STEP_SUMMARY){
    const c=result.calculation,b=c.binding||{},r=c.requirements;
    const summary={bootstrapAnchorSha:env.BOOTSTRAP_TRUST_ANCHOR_SHA,baseSha:b.baseSha,headSha:b.headSha,
      checkoutSha:b.checkoutSha,runId:b.runId,attempt:b.attempt,trustedSha:result.trustedSha,
      trustedSource:result.trustedSha?(result.trustedSha===b.baseSha?'base-tree':'bootstrap-anchor'):'unavailable',
      trustedRequirements:c.trustedRequirements,candidateRequirements:c.candidateRequirements,unionRequirements:r,
      CI_CONTROL_CHANGE:c.CI_CONTROL_CHANGE,
      requiredJobs:['shadow-select','shadow-test',...['database','edge','mediaConcurrency'].filter(k=>r[k])
        .map(k=>'shadow-'+(k==='mediaConcurrency'?'media-concurrency':k))],
      trustedVerdict:result.pass?'PASS':'FAIL',errors:result.errors};
    appendFileSync(env.GITHUB_STEP_SUMMARY,'\n### Trusted shadow '+process.argv[2]+'\n\n```json\n'+safe(JSON.stringify(summary,null,2))+
      '\n```\n'+(c.CI_CONTROL_CHANGE?'CI_CONTROL_CHANGE=true — HUMAN DIFF REVIEW REQUIRED; workflow/routing/launcher invocation is not automatically trusted.\n':''));
  }
  if(process.argv[2]==='select'&&env.GITHUB_OUTPUT){
    appendFileSync(env.GITHUB_OUTPUT,'selection='+JSON.stringify(result.calculation)+'\n');
    for(const [k,v] of Object.entries(result.calculation.requirements))appendFileSync(env.GITHUB_OUTPUT,k+'='+v+'\n');
  }
  if(!result.pass)process.exitCode=1;
  return result;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))await main();
