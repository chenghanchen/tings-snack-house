import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { collectFunction, PROJECT } from '../scripts/collect-supabase-evidence.mjs';

const source = 'export const example = true;\n';
const sources = [{ path: 'supabase/functions/submit-order/index.ts', text: source }];
const meta = { slug: 'submit-order', version: 5, status: 'ACTIVE', verify_jwt: true, ezbr_sha256: 'a'.repeat(64), secret: 'must-not-export' };
function fake({ body = source, drift = false, status = 200, contentType, jwt = true } = {}) {
  const calls = [];
  const fetcher = async (url, options) => {
    calls.push({ url, options });
    assert.equal(options.method, 'GET');
    assert.equal(options.redirect, 'error');
    assert.ok(url.startsWith(`https://api.supabase.com/v1/projects/${PROJECT}/functions/submit-order`));
    if (status !== 200) return new Response('sensitive error', { status });
    if (url.endsWith('/body')) {
      if (contentType) return new Response(body, { headers: { 'content-type': contentType } });
      const form = new FormData();
      form.append('metadata', JSON.stringify({ secret: 'must-not-export' }));
      form.append('file', new Blob([body]), '../../index.ts');
      return new Response(form);
    }
    return Response.json({ ...meta, verify_jwt: jwt, version: drift && calls.length === 3 ? 6 : 5 });
  };
  return { calls, fetcher };
}
test('collector uses only scoped GETs, stable metadata and normalized Git source hashes', async () => {
  const f = fake({ body: source.replace(/\n/g, '\r\n') });
  const r = await collectFunction('submit-order', { token: 'test-token', sources, fetcher: f.fetcher });
  assert.equal(r.collection, 'COLLECTED');
  assert.equal(r.sourceComparison, 'MATCH');
  assert.equal(r.review, 'PENDING');
  assert.equal(r.stableDuringCapture, true);
  assert.equal(f.calls.length, 3);
  assert.doesNotMatch(JSON.stringify(r), /must-not-export|test-token|\.\.\/|export const/);
});
test('auth failure and deployment races preserve PENDING without raw errors', async () => {
  for (const options of [{ status: 403 }, { drift: true }]) {
    const r = await collectFunction('submit-order', { token: 'test-token', sources, fetcher: fake(options).fetcher });
    assert.equal(r.collection, 'PENDING');
    assert.doesNotMatch(JSON.stringify(r), /sensitive error/);
  }
});
test('unknown source, binary body and missing source never become reviewed matches', async () => {
  const r = await collectFunction('submit-order', { token: 'test-token', sources, fetcher: fake({ body: 'different source' }).fetcher });
  assert.equal(r.sourceComparison, 'PENDING');
  assert.equal(r.missingGitPaths.length, 1);
  const binary = await collectFunction('submit-order', { token: 'test-token', sources, fetcher: fake({ contentType: 'application/octet-stream' }).fetcher });
  assert.equal(binary.collection, 'PENDING');
});
test('credential-like source is withheld and disabled JWT is explicit failure', async () => {
  const secret = ['sbp', 'a'.repeat(40)].join('_');
  const r = await collectFunction('submit-order', { token: 'test-token', sources, fetcher: fake({ body: secret }).fetcher });
  assert.equal(r.collection, 'PENDING');
  assert.doesNotMatch(JSON.stringify(r), new RegExp(secret));
  const bad = await collectFunction('submit-order', { token: 'test-token', sources, fetcher: fake({ jwt: false }).fetcher });
  assert.equal(bad.configuration, 'FAIL');
});
test('workflow is manual, main-only and uploads only sanitized evidence, not raw source', () => {
  const yml = readFileSync(new URL('../.github/workflows/supabase-evidence.yml', import.meta.url), 'utf8');
  assert.match(yml, /workflow_dispatch/);
  assert.match(yml, /contents: read/);
  assert.match(yml, /persist-credentials: false/);
  assert.match(yml, /refs\/heads\/main/);
  assert.doesNotMatch(yml, /contents: write|supabase deploy|pull_request_target|\.build\/\*\*/);
});
