// Phase 2.5 candidate, NOT a trust anchor. Step 2 must load this and the verdict
// from an explicitly reviewed Git revision; a candidate launcher is not trusted.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { REQUIREMENTS, validateSelection } from './ci-select.mjs';
const sha = s => typeof s === 'string' && /^[0-9a-f]{40}$/.test(s);
const full = () => Object.fromEntries(REQUIREMENTS.map(k => [k, true]));
export const isControlPath = p => /^(?:\.github\/|scripts\/(?:ci-|cache-version-guard|release-ci-gate))|(?:^|\/)(?:package(?:-lock)?\.json|[^/]*lock[^/]*|[^/]*config[^/]*|deno\.jsonc?|AGENTS\.md)$/.test(p);
export function unionRequirements(trusted, candidate, control = false) {
  const good = r => r && Object.keys(r).sort().join() === [...REQUIREMENTS].sort().join() &&
    REQUIREMENTS.every(k => typeof r[k] === 'boolean') && r.base === true &&
    (!r.unknown || (r.database && r.edge && r.mediaConcurrency));
  if (!good(trusted) || !good(candidate) || control) return full();
  const out = Object.fromEntries(REQUIREMENTS.map(k => [k, trusted[k] || candidate[k]]));
  return out.unknown ? full() : out;
}
export function bindingFromEvent(env, event, checkoutSha) {
  if (env.GITHUB_EVENT_NAME !== 'pull_request' || env.GITHUB_SHA !== checkoutSha)
    throw Error('PR event and actual checkout SHA required');
  return { baseSha:event.pull_request?.base?.sha, headSha:event.pull_request?.head?.sha,
    checkoutSha, runId:env.GITHUB_RUN_ID, attempt:env.GITHUB_RUN_ATTEMPT };
}
export function computeRequirements(root, binding, trustedSha = binding?.baseSha) {
  const git = (...args) => execFileSync('git', args, { cwd:root, encoding:'utf8', maxBuffer:32*1024*1024, stdio:['ignore','pipe','pipe'] });
  const errors = []; let trusted = null, candidate = null, control = false;
  const result = () => ({ binding, trustedSha, valid:errors.length === 0, CI_CONTROL_CHANGE:control,
    trustedRequirements:trusted?.requirements ?? null, candidateRequirements:candidate?.requirements ?? null,
    requirements:errors.length ? full() : unionRequirements(trusted.requirements, candidate.requirements, control), errors });
  let sources;
  try {
    if (!sha(trustedSha) || !binding || !['baseSha','headSha','checkoutSha'].every(k => sha(binding[k])) ||
        !['runId','attempt'].every(k => /^[1-9]\d*$/.test(String(binding[k])) && Number.isSafeInteger(Number(binding[k]))))
      throw Error('Malformed SHA/run/attempt binding');
    if (git('rev-parse','HEAD').trim() !== binding.checkoutSha) throw Error('Wrong checkout SHA');
    for (const ref of [binding.baseSha,binding.headSha]) git('merge-base','--is-ancestor',ref,binding.checkoutSha);
    if (binding.checkoutSha !== binding.headSha && git('show','-s','--format=%P',binding.checkoutSha).trim() !== binding.baseSha+' '+binding.headSha)
      throw Error('Checkout is not the event-bound PR merge');
    const paths = git('diff','--name-only','--no-renames','-z',binding.baseSha,binding.checkoutSha,'--').split('\0');
    if (paths.pop() !== '') throw Error('Incomplete diff');
    control = paths.some(isControlPath);
    // Snapshot BOTH exact Git blobs before executing either side. No branch-name,
    // worktree-source, HEAD fallback, prior run or bootstrap-anchor auto-selection.
    sources = [trustedSha,binding.headSha].map(ref => {
      const entry = git('ls-tree',ref,'--','scripts/ci-select.mjs');
      if (!entry.startsWith('100644 blob ')) return null;
      return git('show',ref+':scripts/ci-select.mjs');
    });
  } catch (e) { errors.push('Binding/diff/source: '+e.message); return result(); }
  const execute = (source, label) => {
    if (source === null) { errors.push(label+': selector absent (full high-risk; no anchor chosen)'); return null; }
    const dir = mkdtempSync(path.join(tmpdir(),'ci-selector-'));
    try {
      const file = path.join(dir,'selector.mjs'); writeFileSync(file,source);
      const code = 'const m=await import(process.argv[1]); console.log(JSON.stringify(m.selectGit(process.cwd(),process.argv[2])));';
      const env = { ...process.env }; delete env.NODE_OPTIONS; delete env.NODE_PATH; delete env.GITHUB_TOKEN;
      const value = JSON.parse(execFileSync(process.execPath,['--input-type=module','-e',code,pathToFileURL(file).href,binding.baseSha],
        { cwd:root, env, encoding:'utf8', timeout:15000, maxBuffer:1024*1024, stdio:['ignore','pipe','pipe'] }));
      validateSelection(value,binding.checkoutSha);
      if (value.baseSha !== binding.baseSha || !value.diffComplete) throw Error('Wrong base SHA/incomplete diff');
      return value;
    } catch (e) { errors.push(label+': '+e.message); return null; }
    finally { rmSync(dir,{recursive:true,force:true}); } // only this newly created temp directory
  };
  trusted = execute(sources[0],'trusted base'); candidate = execute(sources[1],'candidate head');
  return result();
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const actual = execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();
    const result = computeRequirements(process.cwd(),bindingFromEvent(process.env,JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH,'utf8')),actual));
    console.log(JSON.stringify(result)); if (!result.valid) process.exitCode = 1;
  } catch (e) { console.error(JSON.stringify({valid:false,requirements:full(),error:e.message})); process.exitCode = 1; }
}
