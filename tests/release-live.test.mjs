import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { checkCloudflare, checkSupabase, allowBrowserRequest, liveCheck, PROJECT } from '../scripts/release-live.mjs';
import { createReport, recordCheck, outcome } from '../scripts/release-report-core.mjs';
const sha = 'a'.repeat(40);
const env = { CLOUDFLARE_API_TOKEN: 'test-only', SUPABASE_ACCESS_TOKEN: 'test-only' };
const response = body => async () => ({ ok: true, json: async () => body });
const deployment = () => ({ success: true, result: { canonical_deployment: { id: 'example', environment: 'production', latest_stage: { name: 'deploy', status: 'success' }, deployment_trigger: { metadata: { branch: 'main', commit_hash: sha, commit_dirty: false } } } } });
test('missing platform credentials remain PENDING, not PASS', async () => {
  assert.equal((await checkCloudflare(sha, {})).status, 'PENDING');
  assert.equal((await checkSupabase('.', sha, {})).status, 'PENDING');
  const r = createReport(sha, 'main', 'test');
  recordCheck(r, 'cloudflare', 'PENDING', 'missing token');
  assert.equal(outcome(r), 'INCOMPLETE');
});
test('Cloudflare verifies canonical clean production/main exact SHA; does not expose env vars', async () => {
  const d = deployment(); d.result.env_vars = { private: 'do-not-log' };
  const r = await checkCloudflare(sha, env, response(d));
  assert.equal(r.status, 'PASS'); assert.ok(!r.evidence.includes('do-not-log'));
  for (const mutate of [d => d.environment = 'preview', d => d.latest_stage.status = 'failure', d => d.deployment_trigger.metadata.commit_hash = 'b'.repeat(40), d => d.deployment_trigger.metadata.commit_dirty = true, d => d.deployment_trigger.metadata.branch = 'other', d => d.is_skipped = true]) {
    const bad = deployment(); mutate(bad.result.canonical_deployment);
    await assert.rejects(checkCloudflare(sha, env, response(bad)), /not successful/);
  }
});
test('management authorization failure cannot pass; Supabase requires JWT and source provenance', async () => {
  await assert.rejects(checkCloudflare(sha, env, async () => ({ ok: false, status: 403 })), /HTTP 403/);
  const f = { slug: 'submit-order', status: 'ACTIVE', version: 5, verify_jwt: true, ezbr_sha256: 'a'.repeat(64) };
  const both = async url => ({ ok: true, json: async () => ({ ...f, slug: url.split('/').at(-1) }) });
  assert.equal((await checkSupabase('not-a-real-directory', sha, env, both)).status, 'PENDING');
  await assert.rejects(checkSupabase('.', sha, env, response({ ...f, verify_jwt: false })), /JWT/);
});
test('verification remains required even when deployment need is unknown; report preserves distinction', async () => {
  const check = await liveCheck('supabase', { root: '.', version: sha, env: {} });
  assert.deepEqual(check.requirements, { deploymentRequired: 'UNKNOWN', verificationRequired: true });
  const report = createReport(sha, 'main', 'test');
  recordCheck(report, 'supabase', check.status, check.evidence, undefined, check.requirements);
  assert.equal(report.checks.supabase.requirements.verificationRequired, true);
});
test('Supabase validates both functions and rejects a baseline without reviewed source evidence', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'release-baseline-test-'));
  writeFileSync(path.join(root, 'release-supabase-baseline.json'), JSON.stringify({ schemaVersion: 1, project: PROJECT, sourceCommit: sha, migrationEvidence: 'test fixture', functions: [{ slug: 'submit-order' }, { slug: 'admin-media-cleanup' }] }));
  const requested = [];
  const fetcher = async url => { requested.push(url); return { ok: true, json: async () => ({ slug: url.split('/').at(-1), status: 'ACTIVE', version: 1, verify_jwt: true, ezbr_sha256: sha.padEnd(64, 'a') }) }; };
  await assert.rejects(checkSupabase(root, sha, env, fetcher), /source\/review\/production/);
  assert.equal(requested.length, 2);
});
test('reviewed two-function fixture matches without redeploy; drift fails closed', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'release-reviewed-fixture-'));
  const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  git('init', '-b', 'main');
  git('-c', 'user.name=Test', '-c', 'user.email=test@example.test', '-c', 'commit.gpgsign=false', 'commit', '--allow-empty', '-m', 'Test source only');
  const sourceCommit = git('rev-parse', 'HEAD');
  const functions = ['submit-order', 'admin-media-cleanup'].map(slug => ({ slug, functionVersion: 2, bundleSha256: 'a'.repeat(64), verifyJwt: true, sourceEvidence: 'Synthetic fixture source review', productionEvidence: 'Synthetic fixture only; not live', reviewedBy: 'test', reviewedAt: '2026-09-16T00:00:00Z' }));
  writeFileSync(path.join(root, 'release-supabase-baseline.json'), JSON.stringify({ schemaVersion: 1, project: PROJECT, sourceCommit, migrationEvidence: 'Fixture only', functions }));
  const fetcher = async url => ({ ok: true, json: async () => ({ slug: url.split('/').at(-1), status: 'ACTIVE', version: 2, verify_jwt: true, ezbr_sha256: 'a'.repeat(64) }) });
  const check = await liveCheck('supabase', { root, version: sourceCommit, env, fetcher });
  assert.equal(check.status, 'PASS');
  assert.deepEqual(check.requirements, { deploymentRequired: false, verificationRequired: true });
  functions[1].bundleSha256 = 'b'.repeat(64);
  writeFileSync(path.join(root, 'release-supabase-baseline.json'), JSON.stringify({ schemaVersion: 1, project: PROJECT, sourceCommit, migrationEvidence: 'Fixture only', functions }));
  assert.equal((await liveCheck('supabase', { root, version: sourceCommit, env, fetcher })).status, 'FAIL');
});
test('missing API evidence is PENDING but observed production mismatches are FAIL', async () => {
  const args = { root: '.', version: sha, env, fetcher: async () => ({ ok: false, status: 403 }) };
  assert.equal((await liveCheck('cloudflare', args)).status, 'PENDING');
  assert.equal((await liveCheck('supabase', args)).status, 'PENDING');
  args.fetcher = async () => { throw new Error('offline'); };
  assert.equal((await liveCheck('cloudflare', args)).status, 'PENDING');
  const d = deployment(); d.result.canonical_deployment.deployment_trigger.metadata.commit_hash = 'b'.repeat(40);
  args.fetcher = response(d);
  assert.equal((await liveCheck('cloudflare', args)).status, 'FAIL');
});
test('browser verification prevents order, auth, coupon and mutation requests', () => {
  const origin = `https://${PROJECT}.supabase.co`;
  assert.ok(allowBrowserRequest(`${origin}/rest/v1/rpc/get_storefront_snapshot`, 'POST'));
  for (const suffix of ['/functions/v1/submit-order', '/auth/v1/otp', '/rest/v1/rpc/refresh_shop_order_availability', '/rest/v1/rpc/claim_coupon']) assert.equal(allowBrowserRequest(origin + suffix, 'POST'), false);
  assert.equal(allowBrowserRequest('https://other.invalid/rest/v1/rpc/get_storefront_snapshot', 'POST'), false);
  assert.equal(allowBrowserRequest(origin + '/rest/v1/products', 'DELETE'), false);
});
