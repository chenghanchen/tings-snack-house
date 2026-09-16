import test from 'node:test';
import assert from 'node:assert/strict';
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
  assert.equal((await checkSupabase('not-a-real-directory', sha, env, response(f))).status, 'PENDING');
  await assert.rejects(checkSupabase('.', sha, env, response({ ...f, verify_jwt: false })), /JWT/);
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
