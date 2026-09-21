// Shadow only: never publishes the existing required "release-gate" context.
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateContext, contextFromEnvironment, readAttemptJobs } from './release-ci-gate.mjs';
import { validateSelection, selectGit } from './ci-select.mjs';
export const JOBS={select:'shadow-select',test:'shadow-test',database:'shadow-database',edge:'shadow-edge','media-concurrency':'shadow-media-concurrency'};
export function evaluateShadow(context,needs,jobs) {
  const errors=[],lines=[];
  try {validateContext(context);}catch(e){return {pass:false,errors:[e.message],lines};}
  let plan;
  try {
    if(!needs||Object.keys(needs).sort().join()!==Object.keys(JOBS).sort().join())throw Error('Missing/unknown dependencies');
    plan=validateSelection(JSON.parse(needs.select?.outputs?.selection),context.checkoutSha);
    if(!plan.diffComplete)throw Error('Diff incomplete; full checks do not repair missing selection evidence');
  }catch(e){errors.push(e.message);}
  lines.push('requirements='+JSON.stringify(plan?.requirements||'INVALID'));
  for(const [key,name] of Object.entries(JOBS)) {
    const rows=Array.isArray(jobs)?jobs.filter(j=>j?.name===name):[];
    if(rows.length!==1){errors.push(name+': missing/duplicate current-attempt evidence; Re-run all jobs');continue;}
    const j=rows[0],n=needs?.[key];
    if(!Number.isSafeInteger(j.id)||j.id<=0||String(j.run_id)!==String(context.runId)||
        String(j.run_attempt)!==String(context.attempt)||j.head_sha!==context.apiSha||j.status!=='completed')
      errors.push(name+': stale/wrong run, attempt, SHA or unfinished record');
    const flag=key==='media-concurrency'?'mediaConcurrency':key;
    const required=['select','test'].includes(key)||!plan||plan.requirements[flag];
    if(!(j.conclusion==='success'||(!required&&j.conclusion==='skipped')))
      errors.push(name+': '+j.conclusion+'; '+(required?'success required':'only success/skipped permitted'));
    if(n?.result!==j.conclusion)errors.push(name+': needs/API mismatch');
    if(j.conclusion==='success') {
      if(n?.outputs?.checkout_sha!==context.checkoutSha||n.outputs.checkout_run_id!==String(context.runId)||
          n.outputs.checkout_run_attempt!==String(context.attempt))errors.push(name+': checkout proof missing/wrong');
      if(key!=='select'&&(!/^[1-9]\d*$/.test(n?.outputs?.cases||'')||!Number.isSafeInteger(Number(n.outputs.cases))))
        errors.push(name+': missing/zero execution count');
    } else if(j.conclusion==='skipped'&&Object.keys(n?.outputs||{}).length) errors.push(name+': stale skipped outputs');
    lines.push(name+'='+j.conclusion+'; required='+required);
  }
  return {pass:errors.length===0,errors,lines};
}
export async function verifyShadow(context,needs,options={}) {
  try {return evaluateShadow(context,needs,await readAttemptJobs(context,options));}
  catch(e){return {pass:false,errors:[e.message],lines:[]};}
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  let result;
  try {
    const actual=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();
    const context=contextFromEnvironment(process.env,JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH,'utf8')),actual);
    const needs=JSON.parse(process.env.CI_SHADOW_NEEDS||'null');
    // Independent local diff reconstruction; no old report/artifact can fill evidence.
    const received=validateSelection(JSON.parse(needs?.select?.outputs?.selection),actual);
    const expected=selectGit(process.cwd(),process.env.CI_BASE_SHA);
    if(JSON.stringify(received)!==JSON.stringify(expected))throw Error('Selector output differs from complete current-checkout diff');
    result=await verifyShadow(context,needs,{token:process.env.GITHUB_TOKEN});
  }catch(e){result={pass:false,errors:[e.message],lines:[]};}
  console.log([...result.lines,...result.errors.map(s=>'ERROR: '+s),'release-gate-shadow='+(result.pass?'PASS':'FAIL')].join('\n').replaceAll('::',': :'));
  if(!result.pass)process.exitCode=1;
}
