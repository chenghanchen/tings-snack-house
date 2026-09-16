import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeCustomerPhone,resolveCustomerIdentity} from '../supabase/functions/submit-order/customer-identity.mjs';

test('phone identity normalizes US formatting without accepting other countries or extensions', () => {
  for (const value of ['3125550100',' (312) 555-0100 ','+1 (312) 555-0100','1.312.555.0100'])
    assert.equal(normalizeCustomerPhone(value),'3125550100');
  for (const value of ['',null,'+44 2071234567','3125550100 ext 1','3125550100x','+3125550100','1+3125550100','++13125550100','123'])
    assert.equal(normalizeCustomerPhone(value),null);
});

test('guest identity requires the exact configured public key', async () => {
  assert.equal(await resolveCustomerIdentity('Bearer public-key','public-key',()=>assert.fail('guest should not use user lookup')),null);
  for (const header of [null,'','Basic public-key','Bearer'])
    await assert.rejects(resolveCustomerIdentity(header,'public-key',()=>assert.fail()), /AUTH_REQUIRED/);
  await assert.rejects(resolveCustomerIdentity('Bearer anything',null,()=>assert.fail()), /AUTH_NOT_CONFIGURED/);
});
test('customer identity comes only from verified confirmed Supabase user', async () => {
  let seen;
  assert.equal(await resolveCustomerIdentity('Bearer signed-token','public-key',async token=>{
    seen=token; return {data:{user:{id:'customer-a',email_confirmed_at:'2026-01-01'}}};
  }),'customer-a');
  assert.equal(seen,'signed-token');
  for (const result of [{error:new Error('expired')},{data:{user:null}},
    {data:{user:{id:'a'}}},{data:{user:{id:'a',email_confirmed_at:'today',is_anonymous:true}}}])
    await assert.rejects(resolveCustomerIdentity('Bearer forged-or-expired','public-key',async()=>result),/AUTH_REQUIRED/);
});
