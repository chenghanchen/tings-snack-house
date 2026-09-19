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
  ['scripts/check-customer-account.cjs', new Set([
    'ec444723969214a45d5f37ec27e6ad2ca673d66ebf4c53a8d9ef4a5609946ce5', // original offline account suite
    'd004960d204b7e583ff17ff2df9c23de1a6b302149122c03ebb81f89757eedd4', // corrected released success-dialog dimensions
    '71de69a1f8d9af0e646fac914eae5c53ad9f949490f93585e8eb6c2d055f97ae', // pending refresh UI assertions; old dimensions still fail
    '357b8507d6232726a1502fa71b60c1ac84035d1639c15809593e42d688657359', // same UI assertions plus corrected released dimensions
  ])],
  ['scripts/check-order-refresh.cjs', new Set([
    '437daffbaa35590870ff78332a1a642d6a9454cf4643984e031f60a3e31218b9', // offline refresh UI checks only
  ])],
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
// Reviewed DOM-only navigation/search/category presentation, not a JS-directory allowlist.
// Audit: forwards existing navigation events; no network, credentials, prices or storage writes.
const reviewedUiModules = new Map([
  ['mobile-header.js', new Set([
    'b108952a2a59c4580027182ec8234e7f83afb5e78ff8135f91e62091f1c935aa', // existing navigation
    '902f8028e24f807bc808063aa320158619aa2ace602e40a8577427a9cd1b976a', // mobile placeholder/category scroll
  ])],
]);
const riskPath = /(?:^supabase\/|\.sql$|(?:^|\/)(?:AGENTS\.md|RELEASE[^/]*|EDGE[^/]*|MEDIA[^/]*|P1[^/]*|release[^/]*|package(?:-lock)?\.json|deno\.(?:json|lock)|wrangler[^/]*|_headers|_redirects)$|^\.github\/|(?:auth|identity|wallet|checkout|payment|pricing|order|media-cleanup|storage|rls|permission|edge-depend|edge-bundle|request-body))/i;
const riskyCode = /(?:supabase|\.rpc\s*\(|\.from\s*\(|\.storage\b|auth|jwt|token|role|permission|price|amount|total|discount|tax|payment|checkout|delete|removeItem)/i;

// Release policy, not an application manifest. Expanding this map is L3 review.
// Keep this module self-contained: CI executes a copy from the trusted base tree.
const managedResources = Object.freeze({
  'styles.css': { html: 'index.html', tag: 'link', attribute: 'href' },
  'mobile-header.js': { html: 'index.html', tag: 'script', attribute: 'src' },
  'customer-account.css': { html: 'index.html', tag: 'link', attribute: 'href' },
  'customer-account.js': { html: 'index.html', tag: 'script', attribute: 'src' },
});
const normalizedHash = source => hash(source.replace(/\r\n/g, '\n'));
// This is an audited one-way transition, NOT approval of the account module's
// business logic or a permanent account-file exemption. Every other byte fails closed.
const accountRefreshTransition = Object.freeze({
  before: '2a1b49e338c28710261381c5ba566201918d7dfcbe8ac3c3f998904ec11bbd51',
  after: '940c11a79a01bd0979d68fa855a18d5da5b2bfb9feb277f3da9d1c9f6b802093',
});

// Independent L3-reviewed eligibility, NOT authorization. Only these exact source
// transitions were audited as presentation/test-only. No keyword-based API detector
// can safely prove arbitrary account JS harmless. Unknown bytes stay hard L3.
const overrideEligibility = new Map([
  ['customer-account.js', ['940c11a79a01bd0979d68fa855a18d5da5b2bfb9feb277f3da9d1c9f6b802093', 'd9bf368da56ecb72d6ad4fbf5d5a80543ceb48f40d4a96a931de955e17b542c6']],
  ['scripts/check-customer-account.cjs', ['357b8507d6232726a1502fa71b60c1ac84035d1639c15809593e42d688657359', 'a3ea9844dccac416c6f14544afa4f72c1fde493c2d2615940f6a588c64205dd6']],
]);
const overridePath = 'release-ui-overrides.json';
const exactKeys = (v, keys) => v && typeof v === 'object' && !Array.isArray(v) &&
  JSON.stringify(Object.keys(v).sort()) === JSON.stringify([...keys].sort());
const digest = v => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);
const isoDate = v => typeof v === 'string' && Number.isFinite(Date.parse(v)) && new Date(v).toISOString() === v;
const overrideRowKeys = ['path', 'beforeSha256', 'afterSha256'];
function validApproval(a, now = Date.now()) {
  if (!exactKeys(a, ['id','review','issuedAt','expiresAt','diffFingerprint','files']) ||
      typeof a.id !== 'string' || !/^[a-z0-9-]{1,80}$/.test(a.id) || typeof a.review !== 'string' || !a.review.trim() || a.review.length > 2000 ||
      !isoDate(a.issuedAt) || !isoDate(a.expiresAt) || Date.parse(a.issuedAt) > now || Date.parse(a.expiresAt) <= now ||
      Date.parse(a.expiresAt) <= Date.parse(a.issuedAt) || Date.parse(a.expiresAt) - Date.parse(a.issuedAt) > 7 * 86400000 ||
      !digest(a.diffFingerprint) || !Array.isArray(a.files) || !a.files.length || a.files.length > overrideEligibility.size) return false;
  const seen = new Set();
  return a.files.every(row => {
    if (!exactKeys(row, overrideRowKeys) || seen.has(row.path)) return false;
    seen.add(row.path);
    const pair = overrideEligibility.get(row.path);
    return pair && row.beforeSha256 === pair[0] && row.afterSha256 === pair[1];
  });
}
function applyTrustedOverride(plan, changes, git, base, target) {
  // Read only a regular file in the immutable trusted base, never from the worktree,
  // an environment JSON/path, CLI override, or the candidate's approval file.
  const entry = git('ls-tree', base, '--', overridePath);
  if (!entry) return plan;
  const reject = reason => ({ ...plan, override: { status: 'REJECTED', reason, sourceBase: base } });
  try {
    if (!entry.startsWith('100644 blob ')) return reject('Approval source is not a regular trusted-base file');
    const raw = git('show', `${base}:${overridePath}`);
    if (raw.length > 32768) return reject('Oversized approval source');
    const manifest = JSON.parse(raw);
    if (!exactKeys(manifest, ['schemaVersion','approvals']) || manifest.schemaVersion !== 1 ||
        !Array.isArray(manifest.approvals) || !manifest.approvals.length || manifest.approvals.length > 20 ||
        !manifest.approvals.every(a => validApproval(a)) || new Set(manifest.approvals.map(a => a.id)).size !== manifest.approvals.length)
      return reject('Malformed, expired, future-dated or ineligible approval');
    if (plan.uncertainty || plan.level !== 'L3' || plan.minimumLevel === 'L3' || plan.backendChanged ||
        changes.some(c => c.path === overridePath) || git('show', `${target}:${overridePath}`) !== raw)
      return reject('Uncertain range, trusted L3 floor, hard backend change or modified approval source');
    const matches = manifest.approvals.filter(a => a.diffFingerprint === plan.diffFingerprint);
    if (matches.length !== 1) return reject('Complete diff fingerprint must match exactly one approval');
    const approval = matches[0], high = plan.files.filter(f => f.level === 'L3');
    if (high.length !== approval.files.length) return reject('Unapproved or hard L3 file in complete diff');
    for (const f of high) {
      const c = changes.find(c => c.path === f.path), row = approval.files.find(r => r.path === f.path);
      if (!row || !overrideEligibility.has(f.path) || c.status !== 'M' || c.mode !== '100644' || c.oldMode !== '100644' ||
          normalizedHash(c.before) !== row.beforeSha256 || normalizedHash(c.after) !== row.afterSha256)
        return reject('Hard L3, unknown bytes, file mode or source fingerprint mismatch');
    }
    const files = plan.files.map(f => f.level === 'L3' ? { ...f, level: 'L1', automaticLevel: 'L3',
      reason: `Exact manually approved presentation transition (${approval.id}); automatic L3 retained in audit` } : f);
    const level = files.reduce((max, f) => f.level > max ? f.level : max, plan.minimumLevel);
    return { ...plan, files, level, databaseScope: 'none', testScope: level === 'L1' ? 'frontend' : 'full',
      requiredGates: level === 'L1' ? BASE_GATES : [...BASE_GATES, 'guestCheckout'],
      override: { status: 'APPLIED', sourceBase: base, sourceSha256: normalizedHash(raw), approval } };
  } catch { return reject('Unreadable or malformed trusted approval'); }
}

// Recognize actual HTML tags, never matching resource-like strings inside scripts,
// comments, styles, templates, or foreign/raw-text content. Unknown syntax fails closed.
function resourceParts(source) {
  let offset = 0, shape = '';
  const references = [];
  while (offset < source.length) {
    const next = source.indexOf('<', offset);
    if (next < 0) { shape += source.slice(offset); break; }
    shape += source.slice(offset, next);
    const token = /^(?:<!--[\s\S]*?-->|<!doctype[^>]*>|<\/?([a-z][a-z0-9:-]*)\b(?:[^"'<>]|"[^"]*"|'[^']*')*>)/i.exec(source.slice(next));
    if (!token) throw Error('Unrecognized HTML syntax');
    let rendered = token[0];
    offset = next + rendered.length;
    const name = token[1]?.toLowerCase();
    if (name && !rendered.startsWith('</')) {
      if (name === 'base') throw Error('HTML base URL requires reference review');
      const start = /^<[a-z][a-z0-9:-]*/i.exec(rendered)[0].length;
      const attrs = new Map(); let pos = start;
      while (!/^\s*\/?\s*>$/.test(rendered.slice(pos))) {
        const a = /\s+([a-z_:][a-z0-9_.:-]*)(?:\s*=\s*("[^"]*"|'[^']*'|[^\s"'=<>`]+))?/iy;
        a.lastIndex = pos; const m = a.exec(rendered);
        if (!m || attrs.has(m[1].toLowerCase())) throw Error('Ambiguous HTML attributes');
        attrs.set(m[1].toLowerCase(), { value: m[2], start: m.index + m[0].lastIndexOf(m[2] || '') });
        pos = a.lastIndex;
      }
      // Both canonical references and suspicious aliases count, including extra consumers.
      for (const attribute of ['src', 'href']) {
        const a = attrs.get(attribute); if (!a?.value) continue;
        const quoted = /^["']/.test(a.value);
        const raw = quoted ? a.value.slice(1, -1) : a.value;
        let decoded;
        try {
          const entities = raw.replace(/&#(?:x([a-f0-9]+)|(\d+));?/gi, (_, x, d) => String.fromCodePoint(parseInt(x || d, x ? 16 : 10)));
          if (/&(?!amp;)[a-z][a-z0-9]*;/i.test(entities)) throw Error('Unknown entity');
          decoded = decodeURIComponent(entities.replace(/&amp;/gi, '&')).replace(/[\t\r\n]/g, '');
        }
        catch { throw Error('Unrecognized resource URL encoding'); }
        for (const [asset, expected] of Object.entries(managedResources)) {
          if (!decoded.includes(asset)) continue;
          const prefix = `${asset}?v=`;
          const version = raw.startsWith(prefix) ? raw.slice(prefix.length) : '';
          const canonical = quoted && /^[a-zA-Z0-9._-]+$/.test(version) && name === expected.tag && attribute === expected.attribute &&
            (name !== 'link' || /^(["'])stylesheet\1$/i.test(attrs.get('rel')?.value || ''));
          references.push({ asset, version, canonical });
          if (canonical) {
            const at = a.start + 1 + prefix.length;
            // Only version bytes may be masked. All paths, attributes and code stay exact.
            rendered = rendered.slice(0, at) + '__RESOURCE_VERSION__' + rendered.slice(at + version.length);
          }
        }
      }
      shape += rendered;
      if (['script', 'style', 'title', 'textarea', 'svg', 'math', 'template', 'noscript', 'xmp', 'iframe', 'noembed', 'noframes'].includes(name)) {
        if (/\/\s*>$/.test(token[0])) throw Error('Ambiguous raw-text tag');
        const close = new RegExp(`</${name}\\s*>`, 'i').exec(source.slice(offset));
        if (!close) throw Error('Unterminated HTML element');
        const body = source.slice(offset, offset + close.index);
        if (!['script', 'style', 'title', 'textarea'].includes(name) && new RegExp(`<${name}\\b`, 'i').test(body)) throw Error('Nested opaque HTML');
        // Dynamic imports/hidden consumers are not covered by the static reference map.
        if (Object.keys(managedResources).some(asset => body.includes(asset))) throw Error('Opaque resource consumer requires review');
        shape += body + close[0]; offset += close.index + close[0].length;
      }
    } else shape += rendered;
  }
  return { shape, references };
}

function onlyManagedVersionsChanged(file, before, after) {
  try {
    const a = resourceParts(before), b = resourceParts(after);
    if (before === after || (a.shape !== b.shape && !onlyPresentationStylesChanged(a.shape, b.shape)) ||
      !b.references.length || a.references.length !== b.references.length) return false;
    return b.references.every((r, i) => r.canonical && a.references[i].canonical && r.asset === a.references[i].asset &&
      managedResources[r.asset].html === file && /^[a-f0-9]{64}$/.test(r.version));
  } catch { return false; }
}

function checkResourceVersions(git, base, target, changes) {
  const files = git('ls-tree', '-r', '--name-only', '-z', target).split('\0').filter(f => /\.html$/i.test(f));
  const relevant = changes.some(c => Object.hasOwn(managedResources, c.path) || /\.html$/i.test(c.path));
  if (!relevant) return { status: 'NOT_REQUIRED', reason: 'No managed resource or HTML changes' };
  const checked = [], problems = [];
  try {
    const expected = new Map(Object.keys(managedResources).map(asset => {
      if (!git('ls-tree', target, '--', asset).startsWith('100644 blob ')) throw Error(`Missing/non-regular managed resource: ${asset}`);
      return [asset, normalizedHash(git('show', `${target}:${asset}`))];
    }));
    for (const html of files) {
      if (!git('ls-tree', target, '--', html).startsWith('100644 blob ')) throw Error(`Non-regular HTML: ${html}`);
      const parsed = resourceParts(git('show', `${target}:${html}`));
      for (const ref of parsed.references) {
        if (!ref.canonical || managedResources[ref.asset].html !== html) problems.push(`Unknown reference: ${html} -> ${ref.asset}`);
        if (ref.version !== expected.get(ref.asset)) problems.push(`Stale content version: ${html} -> ${ref.asset}`);
        checked.push({ html, asset: ref.asset, version: ref.version, sha256: expected.get(ref.asset) });
      }
    }
    for (const asset of Object.keys(managedResources)) {
      if (checked.filter(r => r.asset === asset).length !== 1) problems.push(`Missing/duplicate consumer: ${asset}`);
      const changed = changes.find(c => c.path === asset);
      if (changed && changed.before !== changed.after) {
        // Require a changed cache key as well as a matching target content hash.
        const old = resourceParts(git('show', `${base}:${managedResources[asset].html}`));
        const prior = old.references.filter(r => r.asset === asset);
        const next = checked.filter(r => r.asset === asset);
        if (prior.length !== 1 || next.length !== 1 || prior[0].version === next[0].version) problems.push(`Unchanged/unknown cache key: ${asset}`);
      }
    }
  } catch (error) { problems.push(error.message); }
  return { status: problems.length ? 'FAIL' : 'PASS', checked, problems };
}

// Small, intentionally conservative recognizer, not a general HTML/CSS parser.
// Preserve every byte outside real style bodies, including all executable content.
function htmlStyleParts(source) {
  const styles = [];
  let skeleton = '', offset = 0;
  while (offset < source.length) {
    const next = source.indexOf('<', offset);
    if (next < 0) { skeleton += source.slice(offset); break; }
    skeleton += source.slice(offset, next);
    const rest = source.slice(next);
    const token = /^(?:<!--[\s\S]*?-->|<!doctype[^>]*>|<\/?([a-z][a-z0-9:-]*)\b(?:[^"'<>]|"[^"]*"|'[^']*')*>)/i.exec(rest);
    if (!token) return null;
    skeleton += token[0];
    offset = next + token[0].length;
    const name = token[1]?.toLowerCase();
    if (['script', 'style', 'title', 'textarea', 'svg', 'math', 'template', 'noscript', 'xmp', 'iframe', 'noembed', 'noframes'].includes(name) && !token[0].startsWith('</')) {
      if (/\/\s*>$/.test(token[0])) return null;
      const closing = new RegExp(`</${name}\\s*>`, 'i').exec(source.slice(offset));
      if (!closing) return null;
      const body = source.slice(offset, offset + closing.index);
      if (!['script', 'style', 'title', 'textarea'].includes(name) && new RegExp(`<${name}\\b`, 'i').test(body)) return null;
      if (name !== 'style') skeleton += body; // Scripts, foreign content and templates are opaque and immutable.
      else { styles.push(body); skeleton += '\u0000STYLE\u0000'; }
      skeleton += closing[0];
      offset += closing.index + closing[0].length;
    }
  }
  return { skeleton, styles };
}

function presentationStyleShape(source) {
  // Mask comments/literals verbatim before recognizing numeric layout declarations.
  // Changes inside URLs, comments or strings never count as layout changes.
  let code = '', offset = 0;
  while (offset < source.length) {
    const rest = source.slice(offset);
    const literal = /^(?:\/\*[\s\S]*?\*\/|"(?:\\[\s\S]|[^"\\])*"|'(?:\\[\s\S]|[^'\\])*')/.exec(rest);
    if (literal) { code += `__LITERAL_${hash(literal[0])}__`; offset += literal[0].length; }
    else {
      if (rest.startsWith('/*') || /["'\\]/.test(rest[0])) return null;
      code += rest[0]; offset++;
    }
  }
  if (/@import|expression\s*\(|javascript\s*:|url\s*\((?!\s*__LITERAL_)/i.test(code)) return null;
  const numeric = '[+-]?(?:\\d+(?:\\.\\d+)?|\\.\\d+)(?:px|rem|em|vh|vw|dvh|%|)';
  const declaration = new RegExp(`^([ \\t]*(?:(?:min-|max-)?(?:height|width)|padding(?:-(?:top|right|bottom|left|inline|block))?|margin(?:-(?:top|right|bottom|left|inline|block))?|gap|row-gap|column-gap|font-size|line-height)\\s*:\\s*)${numeric}(?:[ \\t]+${numeric}){0,3}([ \\t]*;[ \\t]*)$`, 'gm');
  return code.replace(declaration, '$1__LAYOUT_VALUE__$2');
}

function onlyPresentationStylesChanged(before, after) {
  const a = htmlStyleParts(before), b = htmlStyleParts(after);
  if (!a || !b || !a.styles.length || a.skeleton !== b.skeleton || a.styles.length !== b.styles.length) return false;
  return a.styles.every((css, index) => {
    if (css === b.styles[index]) return true;
    const shape = presentationStyleShape(css);
    return shape !== null && shape === presentationStyleShape(b.styles[index]);
  });
}

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
  if (file === 'customer-account.js') {
    return status === 'M' && mode === '100644' && oldMode === '100644' &&
      normalizedHash(before) === accountRefreshTransition.before && normalizedHash(after) === accountRefreshTransition.after
      ? answer('L1', 'Exact audited refresh-button presentation/busy-state transition; RPC/auth/order business code unchanged')
      : answer('L3', 'Account code outside the exact audited UI transition');
  }
  if (riskPath.test(file) || ['app.js', 'admin.js', 'supabase-config.js', 'store-settings.js', 'marketing.js', 'category-product-manager.js', 'appearance-settings.js', 'activity-promotions.js'].includes(file))
    return answer('L3', 'High-risk business/security/release control', /^supabase\//.test(file) || /\.sql$/.test(file) || /supabase/.test(file));
  if (/^(?:assets|images|fonts)\/[a-zA-Z0-9_./-]+\.(?:png|jpe?g|webp|gif|ico|woff2?|ttf)$/i.test(file)) return answer('L1', 'Passive static asset');
  if (/\.html$/.test(file)) {
    if (status === 'M' && mode === oldMode && onlyManagedVersionsChanged(file, before.replace(/\r\n/g, '\n'), after.replace(/\r\n/g, '\n')))
      return answer('L1', 'Managed content-version references and optional reviewed numeric layout changes only; complete Git-tree cache validation still required');
    if (status === 'M' && mode === oldMode && onlyPresentationStylesChanged(before.replace(/\r\n/g, '\n'), after.replace(/\r\n/g, '\n')))
      return answer('L1', 'Only numeric layout declarations in style blocks changed; scripts and remaining HTML byte-identical');
    // Only text/presentation-attribute edits with identical remaining markup are L1.
    const structure = s => s.replace(/<!--[\s\S]*?-->/g, '').replace(/\s(?:class|style|title|aria-label)=(?:"[^"]*"|'[^']*')/g, '').replace(/>[^<]*</g, '><').trim();
    if (status === 'M' && !/<script|\son\w+\s*=|javascript:/i.test(before + after) && structure(before) === structure(after)) return answer('L1', 'HTML text/presentation only');
    return answer('L3', 'Executable or structurally ambiguous HTML');
  }
  if (reviewedUiModules.has(file)) {
    const expected = reviewedUiModules.get(file);
    const matches = source => expected.has(hash(source.replace(/\r\n/g, '\n')));
    return status === 'M' && mode === oldMode && matches(before) && matches(after)
      ? answer('L1', 'Reviewed DOM-only UI module; both source fingerprints match the audited presentation scope')
      : answer('L3', 'UI module source/operations not in reviewed scope; unknown JS fails closed');
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
    const resourceVersions = checkResourceVersions(git, base, target, changes);
    const automatic = classifyChanges(changes, { base, head: target, minimumLevel,
      uncertainty: resourceVersions.status === 'FAIL' ? `Cache/version release blocked: ${resourceVersions.problems.join('; ')}` : null });
    return { ...applyTrustedOverride(automatic, changes, git, base, target), resourceVersions };
  } catch {
    return classifyChanges([], { base: sha(base) ? base : null, head: target || null, minimumLevel, uncertainty: 'Cannot establish complete ancestor diff (missing/invalid base, shallow history, binary/oversized/unknown diff)' });
  }
}

export function validateClassification(value) {
  if (value?.override) {
    const o = value.override;
    if (o.status === 'APPLIED') {
      if (!exactKeys(o, ['status','sourceBase','sourceSha256','approval']) || o.sourceBase !== value.base ||
          !digest(o.sourceSha256) || !validApproval(o.approval) || o.approval.diffFingerprint !== value.diffFingerprint ||
          value.minimumLevel === 'L3' || value.backendChanged || value.uncertainty || value.level === 'L3' ||
          value.files.filter(f => f.automaticLevel === 'L3').length !== o.approval.files.length ||
          !o.approval.files.every(r => value.files.some(f => f.path === r.path && f.automaticLevel === 'L3' && f.level === 'L1')))
        throw Error('Invalid or expired manual override evidence');
    } else if (o.status !== 'REJECTED' || !exactKeys(o, ['status','reason','sourceBase']) || o.sourceBase !== value.base || !o.reason || value.files?.some(f => f.automaticLevel))
      throw Error('Invalid manual override rejection');
  } else if (value?.files?.some(f => f.automaticLevel)) throw Error('Missing manual override evidence');
  if (value?.resourceVersions?.status === 'FAIL') throw Error(`Cache/version release blocked: ${value.resourceVersions.problems.join('; ')}`);
  if (value?.resourceVersions && !['PASS', 'NOT_REQUIRED'].includes(value.resourceVersions.status)) throw Error('Invalid resource-version evidence');
  if (value?.resourceVersions?.status === 'PASS' &&
    (!Array.isArray(value.resourceVersions.checked) || value.resourceVersions.checked.length !== Object.keys(managedResources).length ||
      !Array.isArray(value.resourceVersions.problems) || value.resourceVersions.problems.length ||
      Object.keys(managedResources).some(asset => {
        const rows = value.resourceVersions.checked.filter(r => r.asset === asset);
        return rows.length !== 1 || rows[0].html !== managedResources[asset].html || !/^[a-f0-9]{64}$/.test(rows[0].sha256) || rows[0].version !== rows[0].sha256;
      }))) throw Error('Invalid resource-version evidence');
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
  if (result.resourceVersions?.status === 'FAIL') process.exitCode = 1;
}
