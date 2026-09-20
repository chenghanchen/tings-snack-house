const assert=require('node:assert/strict');
const {guard}=require('./harness.cjs');
module.exports=async function networkPolicy(browser){
  const context=await browser.newContext({serviceWorkers:'block'});
  const safety=await guard(context,{origins:['http://fixture.test'],mocks:['https://cdn.fixture.test/sdk.js'],routeHandler:route=>route.fulfill({contentType:'text/html',body:'<!doctype html><title>offline policy</title>'})});
  try{
    const page=await context.newPage();
    await page.goto('http://fixture.test/');
    assert.equal(await page.title(),'offline policy');safety.assertClean();
    await page.evaluate(async()=>{
      for(const url of ['https://unregistered.invalid/request','http://localhost:9/unknown','file:///unregistered'])try{await fetch(url)}catch{}
      try{new Worker('http://fixture.test/worker.js')}catch{}
      await new Promise(resolve=>{const socket=new WebSocket('wss://unregistered.invalid/socket');socket.onclose=resolve;socket.onerror=resolve});
    });
    assert.ok(safety.violations.some(v=>v.includes('https://unregistered.invalid/request')));
    assert.ok(safety.violations.some(v=>v.includes('http://localhost:9/unknown')));
    assert.ok(safety.violations.some(v=>v==='file:'));
    assert.ok(safety.violations.some(v=>v==='Worker'));
    assert.ok(safety.violations.some(v=>v.startsWith('WebSocket ')));
    console.log('PASS real browser network policy: registered fixture allowed; external/local-unknown/file/worker/WebSocket denied');
    return 6;
  }finally{await context.close()}
};
