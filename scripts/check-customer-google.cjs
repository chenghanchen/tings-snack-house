// Reuses the account fixture; no Google/Supabase network traffic or real credentials.
const assert=require('node:assert/strict');
module.exports=async function checkGoogle(browser,mockSdk,width){
  const page=await browser.newPage({viewport:{width,height:844},offlineSdk:mockSdk});
  await page.goto('http://localhost/?customer_oauth=google&code=mock-google-code');
  await page.waitForSelector('#customerAccountDialog[open] #customerHomePanel:not([hidden])');
  assert.equal(page.url(),'http://localhost/');
  assert.equal(await page.textContent('#customerAccountTitle'),'我的账户');
  assert.match(await page.textContent('#customerAccountEmail'),/alice@example.test/);
  const clients=await page.evaluate(()=>__accountTest.clients);
  assert.equal(clients.length,2,'Reuse existing public + customer clients, no OAuth-only client');
  assert.equal(clients.find(c=>!c.customer).auth.detectSessionInUrl,false);
  assert.equal(clients.find(c=>c.customer).auth.flowType,'pkce');
  assert.equal(clients.find(c=>c.customer).auth.detectSessionInUrl,false,'One explicit SDK code exchange');
  assert.deepEqual(await page.evaluate(()=>__accountTest.calls.filter(c=>c.name==='exchange')),
    [{name:'exchange',code:'mock-google-code',customer:true}]);
  await page.click('[data-account-tab="orders"]');
  await page.waitForSelector('#customerOrders .lookup-order-card');
  const orders=await page.evaluate(()=>__accountTest.calls.find(c=>c.name==='get_my_customer_orders'));
  assert.equal(orders.customer,true);assert.equal(orders.uid,'existing-customer-uid');
  assert.ok(!JSON.stringify(orders.args).includes('alice@example.test'),'Orders remain session/UID-based');
  // Persistence uses the same customer storage and getSession, not a Google auth state.
  await page.reload();await page.waitForFunction(()=>window.TingsAccount?.isSignedIn());
  await page.evaluate(()=>window.TingsAccount.open());
  await page.waitForSelector('#customerAccountDialog[open] #customerHomePanel:not([hidden])');
  assert.match(await page.textContent('#customerAccountEmail'),/alice@example.test/);
  page.once('dialog',dialog=>dialog.accept());
  await page.click('#customerSignOut');
  await page.waitForSelector('#customerSignedOut:not([hidden])');
  assert.deepEqual(await page.evaluate(()=>__accountTest.calls.filter(c=>c.name==='signOut')),
    [{name:'signOut',customer:true}]);
  assert.equal(await page.evaluate(()=>window.TingsAccount.isSignedIn()),false);
  // Deferred direct error: repeated clicks must result in a single OAuth request.
  await page.evaluate(()=>{__accountTest.delayOAuth=true;__accountTest.oauthError=true;history.replaceState(null,'','#snacks')});
  await page.click('#customerGoogleSignIn');
  await page.waitForFunction(()=>!!__accountTest.resolveOAuth);
  await page.locator('#customerGoogleSignIn').evaluate(el=>{el.click();el.click()});
  assert.equal(await page.locator('#customerGoogleSignIn').isDisabled(),true);
  assert.equal(await page.getAttribute('#customerGoogleSignIn','aria-busy'),'true');
  assert.deepEqual(await page.evaluate(()=>__accountTest.calls.filter(c=>c.name==='oauth')),[{
    name:'oauth',customer:true,args:{provider:'google',options:{redirectTo:'http://localhost/?customer_oauth=google'}},
  }]);
  await page.evaluate(()=>__accountTest.resolveOAuth());
  await page.waitForFunction(()=>!document.querySelector('#customerGoogleSignIn').disabled);
  assert.equal(await page.textContent('#customerAccountMessage'),'Google 登录失败，请稍后重试。');
  await page.evaluate(()=>{__accountTest.delayOAuth=false;__accountTest.oauthError=false;__accountTest.throwOAuth=true});
  await page.click('#customerGoogleSignIn');
  await page.waitForFunction(()=>!document.querySelector('#customerGoogleSignIn').disabled);
  assert.equal(await page.textContent('#customerAccountMessage'),'Google 登录失败，请稍后重试。');
  await page.evaluate(()=>{__accountTest.throwOAuth=false});
  await page.click('#customerGoogleSignIn');
  await page.waitForFunction(()=>__accountTest.calls.filter(c=>c.name==='oauth').length===3);
  assert.equal(await page.locator('#customerGoogleSignIn').isDisabled(),true,'Stay disabled while navigating');
  // Returning with browser Back must not leave the button permanently disabled.
  await page.evaluate(()=>dispatchEvent(new PageTransitionEvent('pageshow',{persisted:true})));
  assert.equal(await page.locator('#customerGoogleSignIn').isDisabled(),false);
  for(const query of ['?customer_oauth=google&code=invalid',
    '?customer_oauth=google#error=access_denied&error_description=private-details',
    '?customer_oauth=google']){
    await page.goto('http://localhost/'+query);
    await page.waitForFunction(()=>document.querySelector('#customerAccountMessage')?.textContent==='Google 登录失败，请稍后重试。');
    assert.equal(page.url(),'http://localhost/');
    assert.equal(await page.locator('#customerAccountDialog').evaluate(el=>el.open),true);
    assert.equal(await page.locator('#customerGoogleSignIn').isEnabled(),true);
    assert.equal(await page.locator('#customerEmailForm').isVisible(),true,'OTP remains available after OAuth failure');
    assert.equal(await page.evaluate(()=>window.TingsAccount.isSignedIn()),false);
  }
  // A later SDK auth event follows exactly the same UI path as Email OTP.
  await page.evaluate(()=>__accountTest.change({access_token:'mock-google-session',
    user:{id:'existing-customer-uid',email:'alice@example.test',identities:[{provider:'google'}]}}));
  await page.waitForSelector('#customerSignedIn:not([hidden])');
  assert.equal(await page.textContent('#customerAccountTitle'),'我的账户');
  assert.match(await page.textContent('#customerAccountEmail'),/alice@example.test/);
  assert.equal(await page.textContent('#openCustomerAccount'),'我的账户');
  console.log(`PASS Google auth ${width}px: OAuth arguments/reentry/error, callback/session/event, UID orders, logout; all mocked`);
  await page.close();
};
