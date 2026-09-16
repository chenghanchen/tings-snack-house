import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { readJsonObject } from '../supabase/functions/_shared/request-body.mjs';

function streaming(chunks, headers = {}) {
  let pulls = 0, cancelled = false;
  const stream = new ReadableStream({
    pull(controller) { if (pulls < chunks.length) controller.enqueue(chunks[pulls++]); else controller.close(); },
    cancel() { cancelled = true; },
  }, { highWaterMark: 0 });
  return { request: new Request('https://local.test', { method: 'POST', body: stream, duplex: 'half', headers }), stats: () => ({ pulls, cancelled }) };
}
const bytes = s => new TextEncoder().encode(s);
test('body reader stops and cancels immediately on first over-limit chunk without Content-Length', async () => {
  const f = streaming(Array.from({ length: 100 }, () => new Uint8Array(1024)));
  await assert.rejects(readJsonObject(f.request), e => e.status === 413);
  assert.deepEqual(f.stats(), { pulls: 33, cancelled: true });
});
test('body reader counts bytes, handles UTF-8 split across chunks and exact limit', async () => {
  const unicode = bytes(JSON.stringify({ value: '零食' }));
  assert.deepEqual(await readJsonObject(streaming([unicode.slice(0,11), unicode.slice(11)]).request), { value: '零食' });
  const exact = bytes('{"v":"' + 'a'.repeat(32760) + '"}');
  assert.equal(exact.length, 32768);
  assert.equal((await readJsonObject(streaming([exact]).request)).v.length,32760);
  await assert.rejects(readJsonObject(streaming([bytes(JSON.stringify({ v: '零'.repeat(12000) }))]).request), e => e.status === 413);
});
test('declared oversize reads nothing, underreported length cannot bypass actual byte limit', async () => {
  const big = streaming([bytes('{}')], { 'content-length': '32769' });
  await assert.rejects(readJsonObject(big.request), e => e.status === 413);
  assert.deepEqual(big.stats(), { pulls: 0, cancelled: true });
  await assert.rejects(readJsonObject(streaming([new Uint8Array(32769)], { 'content-length': '1' }).request), e => e.status === 413);
});
test('malformed JSON, non-object JSON and malformed UTF-8 are rejected', async () => {
  for (const data of [bytes('null'),bytes('[]'),bytes('true'),bytes('{'),new Uint8Array([255])])
    await assert.rejects(readJsonObject(streaming([data]).request), e => e.status === 400);
});

test('oversize does not wait for cancellation and a broken stream fails closed', async () => {
  for (const headers of [{}, { 'content-length': '32769' }]) {
    let cancelled = false;
    const body = new ReadableStream({
      pull(controller) { controller.enqueue(new Uint8Array(32769)); },
      cancel() { cancelled = true; return new Promise(() => {}); },
    }, { highWaterMark: 0 });
    const request = new Request('https://local.test', { method: 'POST', body, duplex: 'half', headers });
    await assert.rejects(readJsonObject(request), e => e.status === 413);
    assert.equal(cancelled, true);
  }
  const body = new ReadableStream({ pull(controller) { controller.error(new Error('private transport details')); } });
  await assert.rejects(readJsonObject(new Request('https://local.test', { method: 'POST', body, duplex: 'half' })),
    e => e.status === 400 && !e.message.includes('private'));
});
test('both function entrypoints use the bounded reader instead of unbounded body parsing', () => {
  for (const slug of ['submit-order','admin-media-cleanup']) {
    const source = readFileSync(new URL(`../supabase/functions/${slug}/index.ts`, import.meta.url),'utf8');
    assert.match(source, /await readJsonObject\(request\)/);
    assert.doesNotMatch(source, /request\.(text|json|arrayBuffer)\(/);
  }
});
