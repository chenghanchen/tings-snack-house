import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const source=readFileSync(new URL('../supabase-config.js',import.meta.url),'utf8');
function config(href){
  const calls=[];
  const window={location:new URL(href),supabase:{createClient(url,key,options){
    const client={channel(){return {on(){return this},subscribe(){return this}}}};
    calls.push({options,client});return client;
  }}};
  vm.runInNewContext(source,{window,URLSearchParams});
  const customer=window.createTingsCustomerClient();
  assert.equal(window.createTingsCustomerClient(),customer);
  assert.equal(calls.length,2,'No extra client for Google');
  assert.equal(calls[1].options.auth.storageKey,'tings-customer-auth-v1');
  assert.equal(calls[1].options.auth.flowType,'pkce');
  assert.equal(calls[1].options.auth.detectSessionInUrl,false,'Explicit SDK exchange, never duplicate auto-exchange');
  assert.equal(calls[1].options.auth.persistSession,true);
  assert.equal(calls[1].options.auth.autoRefreshToken,true);
  assert.equal(window.supabase.createClient(window.TINGS_SUPABASE.url,window.TINGS_SUPABASE.anonKey),window.TingsDb);
  return {window,calls};
}
test('customer OAuth callback cannot be consumed by owner namespace',()=>{
  for(const suffix of ['&code=example','#error=access_denied']){
    const {window,calls}=config('https://shop.example/?customer_oauth=google'+suffix);
    assert.equal(window.TingsCustomerOAuthReturn,true);
    assert.equal(calls[0].options.auth.detectSessionInUrl,false);
  }
});
test('ordinary storefront and admin auth options remain unchanged',()=>{
  for(const path of ['/#snacks','/?code=owner-code','/admin','/admin.html?customer_oauth=google&code=owner-code']){
    const {window,calls}=config('https://shop.example'+path);
    assert.equal(window.TingsCustomerOAuthReturn,false);
    assert.equal(calls[0].options,undefined);
  }
});
