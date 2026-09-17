import { createHash } from 'node:crypto';
import { brotliCompressSync, brotliDecompressSync, constants } from 'node:zlib';
import { readFileSync, writeFileSync, mkdirSync, appendFileSync, lstatSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const TARGET = '6b4b7b9d236b1c2b04368e175df1a75521b229ef';
export const PROJECT = 'ragqunnuxsfwhrfqpylg';
export const REPOSITORY = 'chenghanchen/tings-snack-house';
export const BRANCH = 'deploy/p1-frozen-6b4b7b9';
export const ENVIRONMENT_ID = 22115045546;
export const IMAGE = 'supabase/edge-runtime@sha256:cc355c3d0e9c063a351cad56d1c4c52a3c4d85aff4e1fad9d91688e75f9aad09';
export const SLUGS = Object.freeze(['submit-order', 'admin-media-cleanup']);
export const FILES = Object.freeze({
  'supabase/config.toml': '7e1184725a2136686f09b7fbbe6261773bacdd592cd7a26f0c084b3b761dfdcb',
  'supabase/edge-toolchain.json': '47eac5df5a4ee08c2abfb4fa3143a50ca87f47f36c9c4eb7c005e6e400e43388',
  'supabase/functions/_shared/request-body.mjs': 'a158ce79966e06d876d93017053ec96c8916817e89bd7145c308e92f9163a10d',
  'supabase/functions/admin-media-cleanup/deno.json': 'a7e8ba5aa11b242662014be9a3e9f2fc0c461808e00964ceb9c749b9014c4100',
  'supabase/functions/admin-media-cleanup/deno.lock': 'c7073848a84c7897bb267aa2ea2c63b81c5b9e073812168eebd909e123d84d7c',
  'supabase/functions/admin-media-cleanup/index.ts': '67d4e6334a4fa98ed0e8bb609c36ca7dae36316b2837ebc396752d51378daa12',
  'supabase/functions/admin-media-cleanup/media-cleanup-core.mjs': 'dae87c12f0bd35ca4a600d866bebdff20b7a355731ad0cbb6fe6d6658be0d7a6',
  'supabase/functions/submit-order/customer-identity.mjs': '59ecc6551ba86b71ea8e5cacb06edb5fee3fa9ced555065c1486330568de4a41',
  'supabase/functions/submit-order/deno.json': 'a7e8ba5aa11b242662014be9a3e9f2fc0c461808e00964ceb9c749b9014c4100',
  'supabase/functions/submit-order/deno.lock': 'c7073848a84c7897bb267aa2ea2c63b81c5b9e073812168eebd909e123d84d7c',
  'supabase/functions/submit-order/index.ts': '069a52ff879984780bfd39d7c1ec30e04eaeb23157e148295a6318cbf73d3680',
});
export const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const MAX_BODY = 64 * 1024 * 1024;
export class GateError extends Error {
  constructor(code, status = 'FAIL') { super(code); this.code = code; this.status = status; }
}
export function requireGate(ok, code, status) { if (!ok) throw new GateError(code, status); }
export function configFor(slug) {
  requireGate(SLUGS.includes(slug), 'SLUG_NOT_ALLOWED');
  return { verify_jwt: true, entrypoint_path: `file:///workspace/supabase/functions/${slug}/index.ts`, import_map: false, import_map_path: '' };
}
export function assertContext(env = process.env) {
  requireGate(env.GITHUB_ACTIONS === 'true' && env.GITHUB_REPOSITORY === REPOSITORY &&
    env.GITHUB_REF === `refs/heads/${BRANCH}` && env.GITHUB_EVENT_NAME === 'push' &&
    env.GITHUB_RUN_ATTEMPT === '1' && /^\d+$/.test(env.GITHUB_RUN_ID || '') &&
    /^[a-f0-9]{40}$/.test(env.GITHUB_SHA || ''), 'WORKFLOW_CONTEXT_NOT_ALLOWED');
  // Re-runs cannot reuse an earlier approval. Start a new reviewed orchestration commit/run.
}
export function verifyFrozen(root) {
  const git = (...args) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  requireGate(git('rev-parse', 'HEAD') === TARGET, 'FROZEN_COMMIT_MISMATCH');
  requireGate(git('status', '--porcelain', '--untracked-files=all') === '', 'FROZEN_WORKTREE_DIRTY');
  const paths = git('ls-files', 'supabase/functions', 'supabase/config.toml', 'supabase/edge-toolchain.json').split('\n').filter(Boolean).sort();
  requireGate(JSON.stringify(paths) === JSON.stringify(Object.keys(FILES).sort()), 'FROZEN_FILE_SET_MISMATCH');
  for (const [name, expected] of Object.entries(FILES)) {
    const target = path.join(root, name);
    requireGate(lstatSync(target).isFile() && !lstatSync(target).isSymbolicLink(), 'FROZEN_FILE_TYPE_MISMATCH');
    requireGate(hash(readFileSync(target)) === expected, 'FROZEN_FILE_HASH_MISMATCH');
    const blob = execFileSync('git', ['-C', root, 'show', `${TARGET}:${name}`], { stdio: ['ignore', 'pipe', 'pipe'] });
    requireGate(hash(blob) === expected, 'FROZEN_GIT_BLOB_MISMATCH');
  }
  return { target: TARGET, sourceConfigLockManifestSha256: hash(JSON.stringify(FILES)), files: FILES };
}
export function compressBundle(raw) {
  requireGate(raw.length > 8 && raw.length <= MAX_BODY && raw.subarray(0, 5).toString() === 'ESZIP', 'INVALID_LOCAL_ESZIP');
  return Buffer.concat([Buffer.from('EZBR'), brotliCompressSync(raw, { params: { [constants.BROTLI_PARAM_QUALITY]: 6 } })]);
}
export function rawBundle(bytes) {
  const raw = bytes.subarray(0, 4).toString() === 'EZBR'
    ? brotliDecompressSync(bytes.subarray(4), { maxOutputLength: MAX_BODY }) : bytes;
  requireGate(raw.length > 8 && raw.subarray(0, 5).toString() === 'ESZIP', 'PRODUCTION_BODY_NOT_ESZIP');
  return raw;
}
export function validateProof(proof) {
  requireGate(proof.commit === TARGET && proof.image === IMAGE && proof.result === 'PASS' && proof.cases?.length === 6, 'DOCKER_PROOF_NOT_PASS');
  const sources = Object.fromEntries(Object.entries(FILES).filter(([f]) => f.startsWith('supabase/functions/')).map(([f, v]) => [f.slice(19), v]));
  for (const slug of SLUGS) for (const mode of ['normal', 'tampered', 'control']) {
    const matches = proof.cases.filter(c => c.slug === slug && c.mode === mode);
    requireGate(matches.length === 1, 'DOCKER_PROOF_CASE_MISSING');
    const c = matches[0];
    requireGate(c.result === 'PASS' && c.lockUnchanged && c.originalLockSha256 === FILES[`supabase/functions/${slug}/deno.lock`], 'DOCKER_PROOF_CASE_INVALID');
    requireGate(JSON.stringify(Object.entries(c.sourceManifest).sort()) === JSON.stringify(Object.entries(sources).sort()), 'DOCKER_SOURCE_MANIFEST_MISMATCH');
    requireGate(mode === 'tampered' ? c.status !== 0 && c.bundleBytes === 0 : c.status === 0 && c.bundleBytes > 8, 'DOCKER_PROOF_EXIT_INVALID');
  }
}
export function prepare(root, out) {
  const frozen = verifyFrozen(root);
  const proof = JSON.parse(readFileSync(path.join(root, '.build/edge-bundle-proof/evidence/report.json'), 'utf8'));
  validateProof(proof);
  mkdirSync(out, { recursive: true });
  const manifest = { ...frozen, image: IMAGE, runId: process.env.GITHUB_RUN_ID, workflowCommit: process.env.GITHUB_SHA, bundles: {} };
  for (const slug of SLUGS) {
    const raw = readFileSync(path.join(root, `.build/edge-bundle-proof/${slug}-normal/output/output.eszip`));
    requireGate(hash(raw) === proof.cases.find(c => c.slug === slug && c.mode === 'normal').bundleSha256, 'PREPARED_BUNDLE_HASH_MISMATCH');
    const payload = compressBundle(raw);
    manifest.bundles[slug] = { rawSha256: hash(raw), ezbrSha256: hash(payload), config: configFor(slug) };
    writeFileSync(path.join(out, `${slug}.ezbr`), payload);
  }
  const bytes = JSON.stringify(manifest, null, 2) + '\n';
  writeFileSync(path.join(out, 'manifest.json'), bytes);
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `manifest_sha256=${hash(bytes)}\n`);
  return manifest;
}
export function loadPrepared(out, expectedManifestHash, env = process.env) {
  const bytes = readFileSync(path.join(out, 'manifest.json'));
  requireGate(/^[a-f0-9]{64}$/.test(expectedManifestHash || '') && hash(bytes) === expectedManifestHash, 'ARTIFACT_MANIFEST_MISMATCH');
  const m = JSON.parse(bytes);
  requireGate(m.target === TARGET && m.image === IMAGE && m.workflowCommit === env.GITHUB_SHA && m.runId === env.GITHUB_RUN_ID &&
    m.sourceConfigLockManifestSha256 === hash(JSON.stringify(FILES)) && JSON.stringify(m.files) === JSON.stringify(FILES), 'ARTIFACT_BINDING_MISMATCH');
  requireGate(JSON.stringify(Object.keys(m.bundles).sort()) === JSON.stringify([...SLUGS].sort()), 'ARTIFACT_SLUG_MISMATCH');
  const bundles = {};
  for (const slug of SLUGS) {
    const expected = m.bundles[slug];
    const payload = readFileSync(path.join(out, `${slug}.ezbr`));
    requireGate(hash(payload) === expected.ezbrSha256 && hash(rawBundle(payload)) === expected.rawSha256 &&
      JSON.stringify(expected.config) === JSON.stringify(configFor(slug)), 'ARTIFACT_BUNDLE_MISMATCH');
    bundles[slug] = { ...expected, payload };
  }
  return bundles;
}
async function boundedBody(response, limit) {
  requireGate(response.body, 'MISSING_API_BODY', 'PENDING');
  const reader = response.body.getReader(); const chunks = []; let count = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read(); if (done) break;
      count += value.length;
      if (count > limit) { await reader.cancel(); throw new GateError('API_BODY_TOO_LARGE'); }
      chunks.push(Buffer.from(value));
    }
  } finally { reader.releaseLock(); }
  return Buffer.concat(chunks);
}
export function managementClient(token, request = fetch) {
  requireGate(typeof token === 'string' && token.length > 0, 'PRODUCTION_SECRET_MISSING', 'PENDING');
  return async (method, slug, { payload, body = false, config, ezbrSha256 } = {}) => {
    requireGate(SLUGS.includes(slug) && ['GET', 'PATCH'].includes(method) && !(body && method !== 'GET'), 'API_OPERATION_NOT_ALLOWED');
    const url = new URL(`https://api.supabase.com/v1/projects/${PROJECT}/functions/${slug}${body ? '/body' : ''}`);
    if (method === 'PATCH') {
      requireGate(payload && hash(payload) === ezbrSha256 && JSON.stringify(config) === JSON.stringify(configFor(slug)), 'UPLOAD_INPUT_MISMATCH');
      for (const [key, value] of Object.entries({ ...config, ezbr_sha256: ezbrSha256 })) url.searchParams.set(key, String(value));
    }
    let response;
    try {
      response = await request(url, { method, redirect: 'error', signal: AbortSignal.timeout(120000),
        headers: { Authorization: `Bearer ${token}`, Accept: body ? '*/*' : 'application/json',
          ...(method === 'PATCH' ? { 'Content-Type': 'application/vnd.denoland.eszip' } : {}) },
        ...(method === 'PATCH' ? { body: payload } : {}) });
    } catch { throw new GateError(method === 'PATCH' ? 'UPLOAD_OUTCOME_UNKNOWN_STOP' : 'MANAGEMENT_NETWORK_UNAVAILABLE', 'PENDING'); }
    if (!response.ok) {
      await response.body?.cancel(); // Never log an API error body (may echo a credential or source).
      throw new GateError(`MANAGEMENT_${method}_HTTP_${response.status}`, response.status === 401 || response.status === 403 ? 'PENDING' : 'FAIL');
    }
    const bytes = await boundedBody(response, body ? MAX_BODY : 1024 * 1024);
    if (body) return bytes;
    try { return JSON.parse(bytes); } catch { throw new GateError('MANAGEMENT_JSON_INVALID'); }
  };
}
export function metadata(m, slug) {
  requireGate(m?.slug === slug && typeof m.id === 'string' && /^[a-f0-9-]{36}$/i.test(m.id) &&
    Number.isSafeInteger(m.version) && m.version > 0 && m.status === 'ACTIVE' && m.verify_jwt === true, 'FUNCTION_METADATA_NOT_ACTIVE_OR_JWT_INVALID');
  requireGate(/^[a-f0-9]{64}$/.test(m.ezbr_sha256 || ''), 'FUNCTION_BUNDLE_FINGERPRINT_MISSING', 'PENDING');
  requireGate(typeof m.entrypoint_path === 'string' && (m.import_map === false || m.import_map === true) &&
    (m.import_map_path == null || typeof m.import_map_path === 'string'), 'FUNCTION_CONFIG_EVIDENCE_MISSING', 'PENDING');
  // Only typed, allowlisted evidence is exported; never raw management metadata.
  return { id: m.id, slug, version: m.version, status: m.status, verify_jwt: m.verify_jwt,
    ezbr_sha256: m.ezbr_sha256, entrypoint_path: m.entrypoint_path,
    import_map: m.import_map, import_map_path: m.import_map_path ?? '' };
}
export function compareProduction(before, after, expected, raw, slug) {
  requireGate(JSON.stringify(before) === JSON.stringify(after), 'FUNCTION_CHANGED_DURING_CAPTURE');
  const config = configFor(slug);
  for (const [key, value] of Object.entries(config)) requireGate(after[key] === value, 'PRODUCTION_CONFIG_MISMATCH');
  requireGate(after.ezbr_sha256 === expected.ezbrSha256 && hash(rawBundle(raw)) === expected.rawSha256, 'PRODUCTION_BUNDLE_MISMATCH');
  return { id: after.id, slug, version: after.version, status: after.status, verifyJwt: after.verify_jwt,
    rawBundleSha256: expected.rawSha256, ezbrSha256: expected.ezbrSha256,
    configSha256: hash(JSON.stringify(config)), sourceConfigLockManifestSha256: hash(JSON.stringify(FILES)),
    sourceEvidence: 'EXACT_PREBUNDLED_ESZIP_MATCH', result: 'MATCH' };
}
export async function deploySequential(client, bundles, record = () => {}) {
  const initial = {};
  // Read both functions before any write; absence, unknown configuration or JWT problems stop both.
  for (const slug of SLUGS) initial[slug] = metadata(await client('GET', slug), slug);
  const results = [];
  for (const slug of SLUGS) {
    const fresh = metadata(await client('GET', slug), slug);
    requireGate(JSON.stringify(fresh) === JSON.stringify(initial[slug]), 'PREDEPLOY_VERSION_DRIFT');
    record({ slug, previousVersion: fresh.version, state: 'UPLOAD_STARTED_OUTCOME_UNKNOWN' });
    const uploaded = metadata(await client('PATCH', slug, bundles[slug]), slug);
    requireGate(uploaded.id === fresh.id && uploaded.version > fresh.version, 'DEPLOY_VERSION_NOT_ADVANCED');
    const before = metadata(await client('GET', slug), slug);
    requireGate(JSON.stringify(before) === JSON.stringify(uploaded), 'DEPLOY_RESPONSE_CAPTURE_MISMATCH');
    const raw = await client('GET', slug, { body: true });
    const after = metadata(await client('GET', slug), slug);
    const result = compareProduction(before, after, bundles[slug], raw, slug);
    results.push({ ...result, previousVersion: fresh.version }); record(results.at(-1));
  }
  // Recheck both after the second upload, without calling either function.
  for (const slug of SLUGS) {
    const latest = metadata(await client('GET', slug), slug);
    const result = results.find(r => r.slug === slug);
    requireGate(latest.id === result.id && latest.version === result.version && latest.ezbr_sha256 === result.ezbrSha256 &&
      Object.entries(configFor(slug)).every(([k, v]) => latest[k] === v), 'FINAL_METADATA_DRIFT');
  }
  return results;
}
export function approvalFrom(reviews) {
  requireGate(Array.isArray(reviews), 'APPROVAL_EVIDENCE_MISSING', 'PENDING');
  const scoped = reviews.filter(r => r.environments?.some(e => e.name === 'production' && e.id === ENVIRONMENT_ID));
  requireGate(scoped.length > 0 && scoped.every(r => r.state === 'approved' && r.user?.login === 'chenghanchen' && r.user?.type === 'User'), 'HUMAN_APPROVAL_NOT_PROVEN', 'PENDING');
  return { environment: 'production', environmentId: ENVIRONMENT_ID, reviewer: 'chenghanchen', result: 'PASS' };
}
async function checkApproval(out) {
  assertContext();
  requireGate(process.env.GITHUB_TOKEN, 'GITHUB_REVIEW_TOKEN_MISSING', 'PENDING');
  let r;
  try { r = await fetch(`https://api.github.com/repos/${REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}/approvals`, {
    redirect: 'error', signal: AbortSignal.timeout(30000), headers: { Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
      Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' } }); }
  catch { throw new GateError('APPROVAL_API_UNAVAILABLE', 'PENDING'); }
  requireGate(r.ok, 'APPROVAL_API_DENIED', 'PENDING');
  const approval = approvalFrom(JSON.parse(await boundedBody(r, 1024 * 1024)));
  mkdirSync(out, { recursive: true });
  writeFileSync(path.join(out, 'approval.json'), JSON.stringify({ ...approval, runId: process.env.GITHUB_RUN_ID,
    workflowCommit: process.env.GITHUB_SHA, runAttempt: '1' }, null, 2) + '\n');
}
async function main() {
  const [mode, rootArg, outArg] = process.argv.slice(2);
  const root = path.resolve(rootArg || 'frozen'); const out = path.resolve(outArg || 'prepared');
  if (mode === 'frozen') { console.log(JSON.stringify(verifyFrozen(root))); return; }
  if (mode === 'prepare') { assertContext(); prepare(root, out); console.log('FROZEN_DEPLOY_ARTIFACT_PREPARED'); return; }
  if (mode === 'approval') { await checkApproval(out); console.log('HUMAN_APPROVAL_PASS'); return; }
  requireGate(mode === 'deploy', 'UNKNOWN_COMMAND');
  const reportDir = path.resolve('edge-deploy-report'); mkdirSync(reportDir, { recursive: true });
  const report = { scope: 'Two frozen Edge Functions only; not a full release', target: TARGET,
    project: PROJECT, workflowCommit: process.env.GITHUB_SHA, runId: process.env.GITHUB_RUN_ID,
    startedAt: new Date().toISOString(), result: 'INCOMPLETE', mediaCleanup: 'PAUSED_DO_NOT_RESUME',
    databaseModified: false, functions: [] };
  const save = () => writeFileSync(path.join(reportDir, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  try {
    assertContext(); verifyFrozen(root);
    const approval = JSON.parse(readFileSync(path.join(out, 'approval.json'), 'utf8'));
    requireGate(approval.result === 'PASS' && approval.environmentId === ENVIRONMENT_ID && approval.runId === process.env.GITHUB_RUN_ID &&
      approval.workflowCommit === process.env.GITHUB_SHA && approval.runAttempt === '1', 'APPROVAL_RUN_BINDING_MISMATCH');
    const bundles = loadPrepared(out, process.env.PREPARED_MANIFEST_SHA256);
    const client = managementClient(process.env.SUPABASE_ACCESS_TOKEN);
    report.functions = await deploySequential(client, bundles, event => {
      const existing = report.functions.findIndex(f => f.slug === event.slug);
      if (existing >= 0) report.functions[existing] = event; else report.functions.push(event); save();
    });
    report.result = 'MATCH';
  } catch (error) {
    report.errorCode = error instanceof GateError ? error.code : 'LOCAL_OR_PROTOCOL_ERROR_DETAILS_WITHHELD';
    report.result = error instanceof GateError && error.status === 'FAIL' ? 'RELEASE FAILED' : 'INCOMPLETE';
    process.exitCode = 1;
  } finally {
    report.finishedAt = new Date().toISOString(); save();
    const summary = `## P1 Edge deployment: ${report.result}\n\nFrozen commit: ${TARGET}\n\n` +
      report.functions.map(f => `- ${f.slug}: ${f.result || f.state}; previous version ${f.previousVersion}; new version ${f.version || 'unverified'}`).join('\n') +
      `\n\n${report.errorCode || ''}\n\nMedia cleanup remains PAUSED. No database changes, main merge, function invocations or media deletion.\n`;
    writeFileSync(path.join(reportDir, 'SUMMARY.md'), summary);
    if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary);
    console.log(summary);
  }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { await main(); } catch (error) {
    console.error(error instanceof GateError ? error.code : 'LOCAL_OR_PROTOCOL_ERROR_DETAILS_WITHHELD'); process.exitCode = 1;
  }
}
