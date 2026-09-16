// Production auth probe: empty items are rejected before any RPC or write.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';

const config = await readFile(new URL('../supabase-config.js', import.meta.url), 'utf8');
const url = /url:\s*"([^"]+)"/.exec(config)?.[1];
const key = /anonKey:\s*"([^"]+)"/.exec(config)?.[1];
assert.ok(url && key, 'Missing public storefront configuration');

async function probe(token) {
  const response = await fetch(`${url}/functions/v1/submit-order`, {
    method: 'POST',
    headers: {
      apikey: key, Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json', Origin: 'https://tings-snack-house.pages.dev',
    },
    body: JSON.stringify({
      p_phone: '3125550199', p_idempotency_key: randomUUID(),
      p_customer_name: 'Guest auth probe (empty cart)', p_fulfillment: 'pickup', p_items: [],
    }),
    signal: AbortSignal.timeout(30_000),
  });
  return { status: response.status, body: await response.json() };
}

const guest = await probe(key);
assert.equal(guest.status, 400, `Guest should reach empty-cart validation: ${JSON.stringify(guest)}`);
assert.equal(guest.body.error, '购物车为空，请先选择商品');
console.log('PASS: production guest identity accepted; empty cart rejected before any database write.');

// Alter a significant signature character; keep the original anon claims.
const parts = key.split('.');
assert.equal(parts.length, 3, 'This probe expects the configured legacy anon JWT');
parts[2] = (parts[2][0] === 'A' ? 'B' : 'A') + parts[2].slice(1);
const forged = await probe(parts.join('.'));
assert.equal(forged.status, 401, 'A forged anon JWT must not be accepted');
console.log('PASS: forged anon JWT rejected despite a valid public apikey header.');
