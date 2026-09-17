import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { TARGET, PROJECT, REPOSITORY, BRANCH, ENVIRONMENT_ID, IMAGE, FILES, SLUGS,
  hash, configFor, assertContext, compressBundle, rawBundle, validateProof, loadPrepared,
  metadata, compareProduction, managementClient, deploySequential, approvalFrom } from '../scripts/p1-edge-deploy.mjs';

// Protocol/negative tests only. These do not claim real platform acceptance.
const env = { GITHUB_ACTIONS: 'true', GITHUB_REPOSITORY: REPOSITORY, GITHUB_REF: `refs/heads/${BRANCH}`,
  GITHUB_EVENT_NAME: 'push', GITHUB_RUN_ATTEMPT: '1', GITHUB_RUN_ID: '123', GITHUB_SHA: 'a'.repeat(40) };
const raw = Buffer.from('ESZIP_V2_fixture_only_not_a_real_bundle');
const payload = compressBundle(raw);
const expected = slug => ({ payload, rawSha256: hash(raw), ezbrSha256: hash(payload), config: configFor(slug) });
const meta = (slug, version = 3) => ({ id: slug === 'submit-order' ? '11111111-1111-1111-1111-111111111111' : '22222222-2222-2222-2222-222222222222',
  slug, version, status: 'ACTIVE', ...configFor(slug), ezbr_sha256: hash(payload) });
const bundles = Object.fromEntries(SLUGS.map(s => [s, expected(s)]));
function mockClient(tweak = () => {}) {
  const calls = []; const versions = Object.fromEntries(SLUGS.map(s => [s, 3]));
  const client = async (method, slug, options = {}) => {
    calls.push({ method, slug, body: options.body });
    if (method === 'PATCH') versions[slug]++;
    const value = options.body ? raw : meta(slug, versions[slug]);
    await tweak({ method, slug, options, versions, value, calls });
    return value;
  };
  return { calls, client };
}
function proof() {
  const sourceManifest = Object.fromEntries(Object.entries(FILES).filter(([f]) => f.startsWith('supabase/functions/')).map(([f, h]) => [f.slice(19), h]));
  return { commit: TARGET, image: IMAGE, result: 'PASS', cases: SLUGS.flatMap(slug => ['normal', 'tampered', 'control'].map(mode => ({
    slug, mode, sourceManifest, result: 'PASS', lockUnchanged: true,
    originalLockSha256: FILES[`supabase/functions/${slug}/deno.lock`], status: mode === 'tampered' ? 1 : 0,
    bundleBytes: mode === 'tampered' ? 0 : raw.length,
  }))) };
}
test('only fixed branch/repository/push and first run attempt are accepted', () => {
  assert.doesNotThrow(() => assertContext(env));
  for (const [key, value] of Object.entries({ GITHUB_REF: 'refs/heads/main', GITHUB_REPOSITORY: 'other/repo', GITHUB_RUN_ATTEMPT: '2',
    GITHUB_EVENT_NAME: 'pull_request', GITHUB_SHA: TARGET.slice(0, 7), GITHUB_ACTIONS: 'false' }))
    assert.throws(() => assertContext({ ...env, [key]: value }), /WORKFLOW_CONTEXT/);
});
test('unknown slug cannot construct deployment configuration', () => {
  assert.throws(() => configFor('anything-else'), /SLUG_NOT_ALLOWED/);
  assert.equal(configFor('submit-order').verify_jwt, true);
});
test('official EZBR envelope preserves bundle; raw body is not double-decompressed', () => {
  assert.deepEqual(rawBundle(payload), raw); assert.deepEqual(rawBundle(raw), raw);
  assert.throws(() => compressBundle(Buffer.from('not-eszip')), /INVALID_LOCAL/);
  assert.throws(() => rawBundle(Buffer.from('{}')), /NOT_ESZIP/);
});
test('Docker proof requires all six cases, same commit/digest and frozen source/locks', () => {
  assert.doesNotThrow(() => validateProof(proof()));
  for (const mutate of [p => p.commit = 'wrong', p => p.image = 'supabase/edge-runtime:latest', p => p.cases.pop(),
    p => p.cases[1].result = 'PENDING', p => p.cases[0].sourceManifest = {},
    p => p.cases[0].lockUnchanged = false, p => p.cases[1].status = 0, p => p.cases[1].bundleBytes = 3]) {
    const p = proof(); mutate(p); assert.throws(() => validateProof(p));
  }
});
test('production approval must be a human approval for this exact environment', () => {
  const ok = [{ state: 'approved', user: { login: 'chenghanchen', type: 'User' }, environments: [{ name: 'production', id: ENVIRONMENT_ID }] }];
  assert.equal(approvalFrom(ok).result, 'PASS');
  for (const list of [[], [{ ...ok[0], state: 'rejected' }], [{ ...ok[0], environments: [{ name: 'production', id: 1 }] }],
    [{ ...ok[0], user: { login: 'chenghanchen', type: 'Bot' } }]]) assert.throws(() => approvalFrom(list), /APPROVAL/);
});
test('unknown metadata, disabled JWT, wrong slug or unavailable fingerprint cannot pass', () => {
  for (const patch of [{ version: 0 }, { status: 'DEPLOYING' }, { verify_jwt: false }, { slug: 'x' },
    { ezbr_sha256: null }, { import_map: undefined }]) assert.throws(() => metadata({ ...meta('submit-order'), ...patch }, 'submit-order'));
});
test('post-capture requires exact bundle plus entrypoint/JWT/config and stable version', () => {
  const m = metadata(meta('submit-order'), 'submit-order');
  assert.equal(compareProduction(m, m, expected('submit-order'), raw, 'submit-order').result, 'MATCH');
  assert.throws(() => compareProduction(m, { ...m, version: 5 }, expected('submit-order'), raw, 'submit-order'), /CHANGED/);
  for (const patch of [{ verify_jwt: false }, { import_map: true }, { entrypoint_path: 'wrong' }, { import_map_path: 'wrong' }]) {
    const changed = { ...m, ...patch }; assert.throws(() => compareProduction(changed, changed, expected('submit-order'), raw, 'submit-order'), /CONFIG_MISMATCH/);
  }
  assert.throws(() => compareProduction(m, m, expected('submit-order'), Buffer.from('ESZIP_V2_different'), 'submit-order'), /BUNDLE_MISMATCH/);
});
test('two functions deploy sequentially, verify each immediately, then recheck both', async () => {
  const { client, calls } = mockClient(); const result = await deploySequential(client, bundles);
  assert.equal(result.length, 2); assert.ok(result.every(r => r.result === 'MATCH' && r.version === 4));
  assert.deepEqual(calls.slice(0, 2).map(c => c.method), ['GET', 'GET']);
  assert.deepEqual(calls.filter(c => c.method === 'PATCH').map(c => c.slug), SLUGS);
  const secondWrite = calls.findIndex(c => c.method === 'PATCH' && c.slug === SLUGS[1]);
  assert.ok(calls.slice(0, secondWrite).some(c => c.slug === SLUGS[0] && c.body));
});
test('preflight failure on either function means zero production writes', async () => {
  const { client, calls } = mockClient(({ slug, value }) => { if (slug === SLUGS[1]) value.verify_jwt = false; });
  await assert.rejects(deploySequential(client, bundles)); assert.equal(calls.filter(c => c.method === 'PATCH').length, 0);
});
test('unknown upload outcome is never retried, second function untouched', async () => {
  const { client, calls } = mockClient(({ method }) => { if (method === 'PATCH') throw Error('network'); });
  await assert.rejects(deploySequential(client, bundles)); assert.equal(calls.filter(c => c.method === 'PATCH').length, 1);
});
test('first function verification failure prevents second deployment', async () => {
  const { client, calls } = mockClient(({ slug, versions, value }) => {
    if (slug === SLUGS[0] && versions[slug] > 3 && !Buffer.isBuffer(value)) value.entrypoint_path = 'wrong';
  });
  await assert.rejects(deploySequential(client, bundles)); assert.equal(calls.filter(c => c.method === 'PATCH').length, 1);
});
test('second function failure retains first verified result and does not retry or roll back', async () => {
  const events = []; const { client, calls } = mockClient(({ method, slug }) => { if (method === 'PATCH' && slug === SLUGS[1]) throw Error('fail'); });
  await assert.rejects(deploySequential(client, bundles, e => events.push(e)));
  assert.ok(events.some(e => e.slug === SLUGS[0] && e.result === 'MATCH'));
  assert.equal(calls.filter(c => c.method === 'PATCH').length, 2);
});
test('unexpected version change before upload aborts without write', async () => {
  const { client, calls } = mockClient(({ calls, value }) => { if (calls.length === 3) value.version++; });
  await assert.rejects(deploySequential(client, bundles), /VERSION_DRIFT/); assert.equal(calls.filter(c => c.method === 'PATCH').length, 0);
});
test('PATCH uses exact production allowlist, official prebundled content type and no redirects', async () => {
  let call;
  const client = managementClient('unit-test-placeholder', async (url, options) => { call = { url, options }; return Response.json(meta(SLUGS[0], 4)); });
  await client('PATCH', SLUGS[0], bundles[SLUGS[0]]);
  assert.equal(call.url.origin, 'https://api.supabase.com');
  assert.equal(call.url.pathname, `/v1/projects/${PROJECT}/functions/submit-order`);
  assert.equal(call.options.headers['Content-Type'], 'application/vnd.denoland.eszip');
  assert.equal(call.url.searchParams.get('verify_jwt'), 'true');
  assert.equal(call.url.searchParams.get('ezbr_sha256'), hash(payload));
  assert.deepEqual(call.options.body, payload); assert.equal(call.options.redirect, 'error');
  for (const [method, slug] of [['DELETE', SLUGS[0]], ['POST', SLUGS[1]], ['GET', 'other-function']]) await assert.rejects(client(method, slug), /NOT_ALLOWED/);
});
test('missing secret cannot make any request', () => assert.throws(() => managementClient(''), /SECRET_MISSING/));
test('API errors never echo response body, bearer token or network exception details', async () => {
  const client = managementClient('unit-test-placeholder', async () => new Response('PRIVATE_TOKEN_OR_SOURCE', { status: 403 }));
  await assert.rejects(client('GET', SLUGS[0]), e => e.code === 'MANAGEMENT_GET_HTTP_403' && !e.message.includes('PRIVATE'));
  const network = managementClient('unit-test-placeholder', async () => { throw Error('PRIVATE_TOKEN_OR_SOURCE'); });
  await assert.rejects(network('PATCH', SLUGS[0], bundles[SLUGS[0]]), /UPLOAD_OUTCOME_UNKNOWN_STOP/);
});
test('bounded API reader rejects oversized metadata rather than logging it', async () => {
  const client = managementClient('unit-test-placeholder', async () => new Response('x'.repeat(1024 * 1024 + 1)));
  await assert.rejects(client('GET', SLUGS[0]), /API_BODY_TOO_LARGE/);
});
test('downloaded artifact must match current run, workflow commit, frozen manifest and both payloads', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'p1-edge-deploy-test-'));
  try {
    const m = { target: TARGET, image: IMAGE, workflowCommit: env.GITHUB_SHA, runId: env.GITHUB_RUN_ID,
      sourceConfigLockManifestSha256: hash(JSON.stringify(FILES)), files: FILES,
      bundles: Object.fromEntries(SLUGS.map(s => [s, { ...expected(s), payload: undefined }])) };
    const bytes = JSON.stringify(m); writeFileSync(path.join(dir, 'manifest.json'), bytes);
    for (const s of SLUGS) writeFileSync(path.join(dir, `${s}.ezbr`), payload);
    assert.deepEqual(Object.keys(loadPrepared(dir, hash(bytes), env)), SLUGS);
    assert.throws(() => loadPrepared(dir, '0'.repeat(64), env), /MANIFEST_MISMATCH/);
    assert.throws(() => loadPrepared(dir, hash(bytes), { ...env, GITHUB_RUN_ID: '456' }), /BINDING/);
    writeFileSync(path.join(dir, `${SLUGS[1]}.ezbr`), 'tampered');
    assert.throws(() => loadPrepared(dir, hash(bytes), env), /BUNDLE_MISMATCH/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
test('workflow keeps frozen checkout, pinned tooling, protected job and single scoped secret step', () => {
  const yaml = readFileSync(new URL('../.github/workflows/p1-edge-production.yml', import.meta.url), 'utf8');
  assert.equal(yaml.match(new RegExp(`ref: ${TARGET}`, 'g')).length, 2);
  assert.match(yaml, /environment: production/); assert.match(yaml, /needs: prepare/);
  assert.equal((yaml.match(/secrets\.SUPABASE_ACCESS_TOKEN/g) || []).length, 1);
  assert.ok([...yaml.matchAll(/uses: ([^\n]+)/g)].every(m => /@[a-f0-9]{40}$/.test(m[1])));
  assert.doesNotMatch(yaml, /pull_request_target|secrets: inherit|persist-credentials: true|continue-on-error: true/);
  assert.doesNotMatch(yaml, /run:.*(?:db push|migration|functions invoke|git merge|git push)/);
});
