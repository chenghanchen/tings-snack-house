import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

export const POLICY_VERSION = 1;
export const BASE_GATES = Object.freeze(['workingTree', 'tests', 'security', 'github', 'cloudflare', 'desktop', 'mobile', 'production', 'releaseReport', 'releaseHistory']);
export const FULL_GATES = Object.freeze([...BASE_GATES, 'database', 'supabase', 'guestCheckout', 'frozenVersion', 'edgeBundler', 'productionApproval', 'productionMatch']);
export const normalizeGateFloor = value => value === undefined ? 'L1' : ['L1', 'L2', 'L3'].includes(value) ? value : 'L3';
// Exact paths AND reviewed normalized contents, never a scripts/*.cjs glob.
// Modifications require both sides to be known: removing unknown code is not L1.
const reviewedUiSupport = new Map([
  ['scripts/check-success-hero.cjs', new Set([
    '8f354a89bd8232d847dad8c8a574cdf5b7bce56095a8d967359c926766d25bd9', // historical 350.01px fixture
    'e9371f11481ba6c3297a40ecd3e64d47c07506a5f50e3a6f6b0e21f5e604ba30', // reviewed 300px fixture
  ])],
  ['scripts/check-success-dialog.cjs', new Set([
    '62001c564682372689e6f86ad457d00b19d495ba74995a7ffa4f1e6d7ac2576d', // offline layout/close-hit-area fixture
  ])],
]);
const ordinary = new Set(['mobile-header.js', 'admin-mobile-nav.js', 'footer-contact-overlay.js', 'activity-announcement.js', 'site-appearance.js']);
const sha = value => /^[a-f0-9]{40}$/.test(value || '');
const hash = value => createHash('sha256').update(value).digest('hex');
const riskPath = /(?:^supabase\/|\.sql$|(?:^|\/)(?:AGENTS\.md|RELEASE[^/]*|EDGE[^/]*|MEDIA[^/]*|P1[^/]*|release[^/]*|package(?:-lock)?\.json|deno\.(?:json|lock)|wrangler[^/]*|_headers|_redirects)$|^\.github\/|(?:auth|identity|wallet|checkout|payment|pricing|order|media-cleanup|storage|rls|permission|edge-depend|edge-bundle|request-body))/i;
const riskyCode = /(?:supabase|\.rpc\s*\(|\.from\s*\(|\.storage\b|auth|jwt|token|role|permission|price|amount|total|discount|tax|payment|checkout|delete|removeItem)/i;

export function classifyFile(change) {
  const { path: file, status, before = '', after = '', mode = '100644', oldMode = '100644' } = change;
  const answer = (level, reason, backend = false) => ({ path: file, status, level, reason, backend });
  if (!file || file.includes('\\') || file.split('/').includes('..') || !['A', 'M', 'D'].includes(status) || !['100644', '100755'].includes(mode) || !['100644', '100755'].includes(oldMode))
    return answer('L3', 'Unknown path/status, symlink, submodule or file mode');
  // Deletions may remove controls. Renames are decoded as deletion + addition.
  if (status === 'D') return answer('L3', 'Deletion requires full review');
  // Reviewed, non-executable archive documents cannot hide production changes.
  if (/^release-reports\/[^/]+\/(?:report\.(?:md|json)|VERIFICATION\.md|RELEASE-HISTORY\.md)$/.test(file) || file === 'RELEASE-HISTORY.md')
    return answer('L1', 'Release archive only; does not certify this release');
  // CSS filenames such as checkout-layout.css do not execute checkout logic.
  if (/^[^/]+\.css$/.test(file)) {
    if (/@import|javascript\s*:|expression\s*\(/i.test(before + after)) return answer('L3', 'CSS active/external import requires review');
    return answer('L1', 'Stylesheet only');
  }
  if (reviewedUiSupport.has(file)) {
    const expected = reviewedUiSupport.get(file);
    const matches = source => expected.has(hash(source.replace(/\r\n/g, '\n')));
    return mode === oldMode && matches(after) && (status === 'A' || matches(before))
      ? answer('L1', 'Exact reviewed UI regression fixture; before/after fingerprints matched where applicable')
      : answer('L3', 'Unreviewed UI test content or file-mode change');
  }
  if (riskPath.test(file) || ['app.js', 'admin.js', 'supabase-config.js', 'store-settings.js', 'marketing.js', 'category-product-manager.js', 'appearance-settings.js', 'activity-promotions.js'].includes(file))
    return answer('L3', 'High-risk business/security/release control', /^supabase\//.test(file) || /\.sql$/.test(file) || /supabase/.test(file));
  if (/^(?:assets|images|fonts)\/[a-zA-Z0-9_./-]+\.(?:png|jpe?g|webp|gif|ico|woff2?|ttf)$/i.test(file)) return answer('L1', 'Passive static asset');
  if (/\.html$/.test(file)) {
    // Only text/presentation-attribute edits with identical remaining markup are L1.
    const structure = s => s.replace(/<!--[\s\S]*?-->/g, '').replace(/\s(?:class|style|title|aria-label)=(?:"[^"]*"|'[^']*')/g, '').replace(/>[^<]*</g, '><').trim();
    if (status === 'M' && !/<script|\son\w+\s*=|javascript:/i.test(before + after) && structure(before) === structure(after)) return answer('L1', 'HTML text/presentation only');
    return answer('L3', 'Executable or structurally ambiguous HTML');
  }
  if (ordinary.has(file)) {
    if (riskyCode.test(before + after)) return answer('L3', 'Ordinary module contains security/financial/backend operations');
    return answer('L2', 'Allowlisted ordinary client logic');
  }
  if (/^docs\/[a-zA-Z0-9_/-]+\.md$/.test(file) || file === 'README.md') return answer('L1', 'Documentation only');
  return answer('L3', 'Unclassified file: full gates required');
}

export function classifyChanges(changes, { base, head, uncertainty = null, minimumLevel } = {}) {
  const files = changes.map(classifyFile);
  const uncertain = uncertainty || (!sha(base) || !sha(head) || base === head ? 'Missing/invalid distinct base and head' : null) || (!files.length ? 'Empty diff does not prove release scope' : null);
  const floor = normalizeGateFloor(minimumLevel);
  const level = uncertain ? 'L3' : files.reduce((max, file) => file.level > max ? file.level : max, floor);
  const backend = files.some(file => file.backend);
  // L2 currently maps no database mutation paths: every SQL/RLS/Edge path is L3.
  // Unknown dependency mappings are L3, not an empty list of related tests.
  const requiredGates = level === 'L3' ? FULL_GATES : level === 'L2' ? [...BASE_GATES, 'guestCheckout', ...(backend ? ['database', 'supabase'] : [])] : BASE_GATES;
  return { policyVersion: POLICY_VERSION, base: base || null, head: head || null, level, minimumLevel: floor, uncertainty: uncertain,
    files, diffFingerprint: hash(JSON.stringify(changes)), backendChanged: backend,
    databaseScope: level === 'L3' || backend ? 'all' : 'none',
    testScope: level === 'L1' ? 'frontend' : 'full', requiredGates };
}

export function detectRelease(root, { base, head = 'HEAD', minimumLevel } = {}) {
  const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
  let target;
  try {
    if (!/^[a-zA-Z0-9_./~^-]+$/.test(head) || head.startsWith('-')) throw Error('Invalid head');
    target = git('rev-parse', '--verify', `${head}^{commit}`).trim();
    // Never silently use HEAD^: a release may contain several unpublished commits.
    if (!sha(base)) throw Error('Explicit full base SHA required; CI must use push.before or PR merge base');
    git('merge-base', '--is-ancestor', base, target);
    const names = git('diff', '--name-status', '-z', '--no-renames', base, target, '--').split('\0');
    const changes = [];
    const blob = (ref, file) => git('show', `${ref}:${file}`);
    const mode = (ref, file) => git('ls-tree', ref, '--', file).split(' ')[0];
    while (names[0]) {
      const status = names.shift(), file = names.shift();
      if (!file || !['A', 'M', 'D'].includes(status)) throw Error('Unknown diff status');
      const binary = /\.(?:png|jpe?g|webp|gif|ico|woff2?|ttf)$/i.test(file);
      changes.push({ path: file, status,
        mode: status === 'D' ? '100644' : mode(target, file), oldMode: status === 'A' ? '100644' : mode(base, file),
        before: status === 'A' ? '' : binary ? git('rev-parse', `${base}:${file}`).trim() : blob(base, file),
        after: status === 'D' ? '' : binary ? git('rev-parse', `${target}:${file}`).trim() : blob(target, file) });
    }
    return classifyChanges(changes, { base, head: target, minimumLevel });
  } catch {
    return classifyChanges([], { base: sha(base) ? base : null, head: target || null, minimumLevel, uncertainty: 'Cannot establish complete ancestor diff (missing/invalid base, shallow history, binary/oversized/unknown diff)' });
  }
}

export function validateClassification(value) {
  if (value?.policyVersion !== POLICY_VERSION || !['L1', 'L2', 'L3'].includes(value.level) || !['L1', 'L2', 'L3'].includes(value.minimumLevel) || !Array.isArray(value.files) || !Array.isArray(value.requiredGates)) throw Error('Invalid release classification');
  const expected = value.level === 'L3' ? FULL_GATES : value.level === 'L2' ? [...BASE_GATES, 'guestCheckout', ...(value.backendChanged ? ['database', 'supabase'] : [])] : BASE_GATES;
  if (JSON.stringify(value.requiredGates) !== JSON.stringify(expected) || (value.uncertainty && value.level !== 'L3') || (!value.uncertainty && (!sha(value.base) || !sha(value.head) || !/^[a-f0-9]{64}$/.test(value.diffFingerprint || '')))) throw Error('Classification/gate policy mismatch');
  const derived = value.uncertainty ? 'L3' : value.files.reduce((max, file) => {
    if (!['L1', 'L2', 'L3'].includes(file.level) || !file.path || !file.reason) throw Error('Invalid classified file');
    return file.level > max ? file.level : max;
  }, value.minimumLevel);
  if ((!value.uncertainty && !value.files.length) || derived !== value.level || value.backendChanged !== value.files.some(file => file.backend) || value.testScope !== (value.level === 'L1' ? 'frontend' : 'full') || value.databaseScope !== (value.level === 'L3' || value.backendChanged ? 'all' : 'none')) throw Error('Classification scope mismatch');
  return value;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2), allowed = new Set(['--base', '--head', '--format', '--root']);
  const options = {};
  while (args.length) { const key = args.shift(); if (!allowed.has(key) || !args.length || Object.hasOwn(options, key.slice(2))) throw Error('Use --base FULL_SHA --head REF [--format level]'); options[key.slice(2)] = args.shift(); }
  const result = detectRelease(options.root ? path.resolve(options.root) : path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'), options);
  console.log(options.format === 'level' ? result.level : JSON.stringify(result, null, 2));
}
