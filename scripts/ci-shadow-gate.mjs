// Shadow only: never publishes the existing required "release-gate" context.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateContext, readAttemptJobs } from './release-ci-gate.mjs';
import { validateSelection } from './ci-select.mjs';
import { computeRequirements } from './ci-requirements.mjs';
export const JOBS={select:'shadow-select',test:'shadow-test',database:'shadow-database',edge:'shadow-edge','media-concurrency':'shadow-media-concurrency'};
export const TRUSTED_CI_VERSION=1;
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
// Only the launcher may load this and its imports from an event base/approved anchor.
export async function verifyRequirements(root,context,needs,binding,options={}) {
  const calculation = computeRequirements(root,binding,options.trustedSha ?? binding?.baseSha);
  try {
    validateContext(context);
    if (!calculation.valid || binding.checkoutSha !== context.checkoutSha || binding.headSha !== context.apiSha ||
        String(binding.runId) !== String(context.runId) || String(binding.attempt) !== String(context.attempt))
      throw Error('Invalid trusted union/binding: '+calculation.errors.join('; '));
    const selection = {schemaVersion:1,checkoutSha:binding.checkoutSha,baseSha:binding.baseSha,diffComplete:true,
      requirements:calculation.requirements,reasons:['trusted base UNION candidate; CI_CONTROL_CHANGE='+calculation.CI_CONTROL_CHANGE]};
    validateSelection(selection,context.checkoutSha);
    const effective = structuredClone(needs);
    // Candidate's requirements or candidate verdict cannot replace this calculation.
    effective.select.outputs.selection = JSON.stringify(selection);
    return {...await verifyShadow(context,effective,options),calculation};
  } catch (e) { return {pass:false,errors:[e.message],lines:[],calculation}; }
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  console.error('Direct candidate gate execution forbidden; use ci-trusted-launcher.mjs gate');
  process.exitCode=1;
}
