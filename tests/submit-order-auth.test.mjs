import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';
import vm from 'node:vm';
import { webcrypto } from 'node:crypto';
import { normalizeCustomerPhone, resolveCustomerIdentity } from '../supabase/functions/submit-order/customer-identity.mjs';

const source = stripTypeScriptTypes((await readFile(
  new URL('../supabase/functions/submit-order/index.ts', import.meta.url), 'utf8',
)).replace(/^import .*;\r?\n/gm, ''));

function harness(overrides = {}) {
  const env = {
    SUPABASE_URL: 'https://example.supabase.co',
    SUPABASE_SERVICE_ROLE_KEY: 'server-only-key',
    ORDER_RATE_LIMIT_SALT: 'test-only-salt',
    SUPABASE_ANON_KEY: 'platform-default-key',
    ORDER_GUEST_ANON_KEY: 'storefront-public-key',
    ...overrides,
  };
  const calls = [];
  let handler;
  const admin = {
    auth: { async getUser(token) {
      calls.push(['auth', token]);
      return token === 'confirmed-user-token'
        ? { data: { user: { id: 'verified-customer', email_confirmed_at: 'today' } } }
        : { error: new Error('Invalid or expired token') };
    } },
    async rpc(name, args) {
      calls.push([name, args]);
      return { data: name === 'check_order_submission_rate_limit' ? true : { order_number: 'MOCK' } };
    },
  };
  vm.runInNewContext(source, {
    Deno: { env: { get: key => env[key] }, serve: fn => { handler = fn; } },
    createClient: () => admin, normalizeCustomerPhone, resolveCustomerIdentity,
    TextEncoder, Response, Request, Error, crypto: webcrypto, console,
  });
  return { calls, invoke: (token, items = []) => handler(new Request('https://example.test', {
    method: 'POST', headers: { authorization: `Bearer ${token}`, apikey: 'storefront-public-key' },
    body: JSON.stringify({
      p_phone: '3125550199', p_idempotency_key: 'c24a46cc-180c-4b96-b48f-9f16f33339d1',
      p_customer_name: 'Test', p_fulfillment: 'pickup', p_items: items,
      p_user_id: 'untrusted-body-user',
    }),
  })) };
}

test('configured storefront guest key works when platform default differs, without writes for empty carts', async () => {
  const h = harness();
  const response = await h.invoke('storefront-public-key');
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { error: '购物车为空，请先选择商品' });
  assert.deepEqual(h.calls, []);
});

test('legacy default remains supported only when storefront override is absent', async () => {
  const h = harness({ ORDER_GUEST_ANON_KEY: undefined });
  assert.equal((await h.invoke('platform-default-key')).status, 400);
  assert.deepEqual(h.calls, []);
});

test('invalid, expired and replaced keys do not become guests even with a public apikey', async () => {
  for (const token of ['forged-token', 'expired-token', 'platform-default-key']) {
    const h = harness();
    assert.equal((await h.invoke(token)).status, 401);
    assert.deepEqual(h.calls, [['auth', token]]);
  }
});

test('blank explicit guest configuration fails closed', async () => {
  const h = harness({ ORDER_GUEST_ANON_KEY: '  ' });
  assert.equal((await h.invoke('storefront-public-key')).status, 503);
  assert.deepEqual(h.calls, []);
});

test('verified customer empty-cart probe also avoids all writes', async () => {
  const h = harness();
  assert.equal((await h.invoke('confirmed-user-token')).status, 400);
  assert.deepEqual(h.calls, [['auth', 'confirmed-user-token']]);
});

test('nonempty guest and customer submissions retain both rate checks and server order validation', async () => {
  for (const [token, userId] of [['storefront-public-key', null], ['confirmed-user-token', 'verified-customer']]) {
    const h = harness();
    assert.equal((await h.invoke(token, [{ product_id: 'mock-product', quantity: 1 }])).status, 200);
    const rpcCalls = h.calls.filter(([name]) => name !== 'auth');
    assert.deepEqual(rpcCalls.map(([name]) => name), [
      'check_order_submission_rate_limit', 'check_order_submission_rate_limit', 'submit_shop_order_account',
    ]);
    assert.equal(rpcCalls[2][1].p_user_id, userId);
  }
});
