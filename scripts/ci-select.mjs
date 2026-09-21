import { execFileSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const REQUIREMENTS = ['base', 'database', 'edge', 'mediaConcurrency', 'unknown'];
const sha = s => typeof s === 'string' && /^[0-9a-f]{40}$/.test(s);
const cleanPath = s => typeof s === 'string' && !!s && !s.startsWith('/') && !s.includes('\\') &&
  !s.split('/').some(p => p === '..' || p === '.' || p === '') && !/[\0-\x1f]/.test(s);
// Reviewed file responsibilities, NOT source-code safety claims. Shared callers
// are deliberately NOT in the presentation set. New/renamed/deleted paths fail closed.
const presentation = new Set(['index.html', 'admin.html', 'mobile-header.js', 'footer-contact-overlay.js', 'admin-mobile-nav.js']);
const databaseCallers = new Set(['customer-account.js','customer-wallet.js','customer-order-tools.js',
  'admin-auth.js','admin-order-controls.js','order-cards.js','store-order-rules.js','store-settings.js',
  'supabase-config.js','activity-promotions.js','marketing.js']);
const mediaCallers = new Set(['app.js','admin.js','media-cleanup.js','image-optimizer.js',
  'category-product-manager.js','legacy-product-editor-bridge.js','appearance-settings.js','site-appearance.js']);
export function requirementsForPath(file) {
  if (!cleanPath(file)) return ['unknown'];
  if (/^\.github\/|^scripts\/(?:ci-|cache-version-guard)|(?:^|\/)(?:package(?:-lock)?\.json|deno\.(?:jsonc?|lock)|[^/]*lock[^/]*|[^/]*config[^/]*|_headers|_redirects|AGENTS\.md)$/.test(file)) return ['unknown'];
  if (mediaCallers.has(file) || /(?:media[-/]?(?:delet|cleanup)|storage|media-reference|reference-lock|deletion-guard)/i.test(file)) return ['database','edge','mediaConcurrency'];
  if (/\.sql$/i.test(file) || /(?:^|\/)(?:migrations?|rls|schema|rpc|database-contracts?)(?:[/._-]|$)/i.test(file)) return ['database'];
  if (/^supabase\/functions\/_shared\//.test(file)) return ['unknown'];
  if (/^supabase\/functions\//.test(file)) return ['edge','database']; // current functions cross RPC/order/DB boundaries
  if (/^supabase\//.test(file)) return ['unknown'];
  if (databaseCallers.has(file)) return ['database','edge'];
  if (presentation.has(file) || /\.css$/i.test(file) || /^(?:images|assets)\/[^?#]+\.(?:png|jpe?g|webp|gif|svg|ico|woff2?)$/i.test(file)) return [];
  if (/^tests\/(?:customer-identity|request-body|submit-order-auth|edge-dependencies|edge-bundle-proof)\.test\.mjs$/.test(file)) return ['edge'];
  // Other test/tool changes can affect the validation boundary; do not whitelist directories.
  return ['unknown'];
}
export function selectChanges(changes, { checkoutSha, baseSha, diffComplete = true } = {}) {
  const requirements = { base:true, database:false, edge:false, mediaConcurrency:false, unknown:false };
  const reasons = [];
  if (!sha(checkoutSha)) throw Error('Explicit checkout SHA required');
  const uncertain = reason => { requirements.unknown = true; reasons.push(reason); };
  if (!sha(baseSha) || !diffComplete || !Array.isArray(changes)) { diffComplete = false; uncertain('Incomplete/unavailable diff'); }
  for (const c of Array.isArray(changes) ? changes : []) {
    if (!c || !cleanPath(c.path) || !['A','M','D','R','C','T'].includes(c.status)) { uncertain('Malformed change'); continue; }
    if (!['A','M'].includes(c.status) || (c.mode && c.mode !== '100644') || (c.oldMode && c.oldMode !== '100644'))
      uncertain('Rename/delete/copy/type or non-regular change: '+c.path);
    for (const file of [c.path, c.oldPath].filter(Boolean)) {
      const selected = requirementsForPath(file);
      selected.forEach(k => { requirements[k] = true; });
      reasons.push(file+': '+(selected.join('+') || 'base'));
    }
  }
  if (requirements.unknown) requirements.database = requirements.edge = requirements.mediaConcurrency = true;
  return { schemaVersion:1, checkoutSha, baseSha:sha(baseSha)?baseSha:null, diffComplete, requirements, reasons };
}
export function validateSelection(value, checkoutSha) {
  const keys = ['schemaVersion','checkoutSha','baseSha','diffComplete','requirements','reasons'];
  if (!value || JSON.stringify(Object.keys(value).sort()) !== JSON.stringify(keys.sort()) || value.schemaVersion !== 1 ||
      !sha(value.checkoutSha) || value.checkoutSha !== checkoutSha || !(sha(value.baseSha) || value.baseSha === null) ||
      typeof value.diffComplete !== 'boolean' || !Array.isArray(value.reasons) || !value.reasons.every(s=>typeof s==='string') ||
      !value.requirements || Object.keys(value.requirements).sort().join() !== [...REQUIREMENTS].sort().join() ||
      !REQUIREMENTS.every(k=>typeof value.requirements[k] === 'boolean') || value.requirements.base !== true ||
      ((!value.diffComplete || !value.baseSha) && !value.requirements.unknown) ||
      (value.requirements.unknown && !['database','edge','mediaConcurrency'].every(k=>value.requirements[k])))
    throw Error('Malformed/stale selection; run full high-risk and reject gate');
  return value;
}
export function parseNameStatus(raw) {
  const fields = raw.split('\0'), changes = [];
  if (fields.pop() !== '') throw Error('Incomplete NUL diff');
  while (fields.length) {
    const token=fields.shift(), status=token?.[0];
    if (/^[AMDT]$/.test(token)) {
      const file=fields.shift(); if(!cleanPath(file))throw Error('Invalid diff path');
      changes.push({status,path:file});
    } else if (/^[RC]\d{1,3}$/.test(token)) {
      const oldPath=fields.shift(), file=fields.shift();
      if(!cleanPath(file)||!cleanPath(oldPath))throw Error('Incomplete rename');
      changes.push({status,path:file,oldPath});
    } else throw Error('Unknown diff status');
  }
  return changes;
}
export function selectGit(root, baseSha) {
  const git=(...args)=>execFileSync('git',args,{cwd:root,encoding:'utf8',maxBuffer:32*1024*1024});
  const checkoutSha=git('rev-parse','HEAD').trim();
  try {
    if(!sha(baseSha))throw Error('Full base SHA required');
    git('merge-base','--is-ancestor',baseSha,checkoutSha);
    const changes=parseNameStatus(git('diff','--name-status','-z','--find-renames',baseSha,checkoutSha,'--'));
    for(const c of changes) {
      if(c.status!=='D') c.mode=git('ls-tree',checkoutSha,'--',c.path).split(' ')[0];
      if(c.status!=='A') c.oldMode=git('ls-tree',baseSha,'--',c.oldPath||c.path).split(' ')[0];
    }
    return selectChanges(changes,{checkoutSha,baseSha});
  } catch {
    return selectChanges(null,{checkoutSha,baseSha,diffComplete:false});
  }
}
if(process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const plan=selectGit(process.cwd(),process.env.CI_BASE_SHA);
  validateSelection(plan,process.env.GITHUB_SHA || plan.checkoutSha);
  console.log(JSON.stringify(plan));
  if(process.env.GITHUB_OUTPUT) {
    appendFileSync(process.env.GITHUB_OUTPUT,'selection='+JSON.stringify(plan)+'\n');
    for(const k of REQUIREMENTS)appendFileSync(process.env.GITHUB_OUTPUT,k+'='+plan.requirements[k]+'\n');
  }
  if(!plan.diffComplete)process.exitCode=1;
}
