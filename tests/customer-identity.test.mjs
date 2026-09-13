import test from 'node:test';
import assert from 'node:assert/strict';
import {resolveCustomerIdentity} from '../supabase/functions/submit-order/customer-identity.mjs';

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
