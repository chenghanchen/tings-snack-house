const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {options,allowedURL}=require('./policy.cjs');
const root=path.resolve(__dirname,'../..');
const SDK='https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2';
const ORIGINS=['http://localhost','http://account-public.test']; // explicitly registered local fixtures; never resolved on the network
const mime={'.html':'text/html; charset=utf-8','.css':'text/css','.js':'text/javascript','.svg':'image/svg+xml','.png':'image/png','.webp':'image/webp','.jpg':'image/jpeg'};
async function guard(context,{origins=[],mocks=[],routeHandler}={}) {
  const violations=[];
  const deny=url=>violations.push(String(url));
  await context.exposeBinding('__offlineViolation',(_source,url)=>deny(url));
  await context.addInitScript(()=>{
    const deny=name=>{void window.__offlineViolation(name);throw new Error('Offline network denied: '+name)};
    for(const name of ['RTCPeerConnection','webkitRTCPeerConnection','WebTransport','Worker','SharedWorker'])
      if(name in window)window[name]=class {constructor(){deny(name)}};
    if(navigator.serviceWorker)navigator.serviceWorker.register=()=>{deny('ServiceWorker')};
    // HTTP(S) is handled by the context route; reject non-HTTP transports before dispatch.
    const check=url=>{const u=new URL(url,location.href);if(!['http:','https:'].includes(u.protocol))deny(u.protocol)};
    const fetch=window.fetch;window.fetch=function(input,...args){check(typeof input==='string'||input instanceof URL?input:input.url);return fetch.call(this,input,...args)};
    const open=XMLHttpRequest.prototype.open;XMLHttpRequest.prototype.open=function(method,url,...args){check(url);return open.call(this,method,url,...args)};
    const beacon=navigator.sendBeacon.bind(navigator);navigator.sendBeacon=(url,...args)=>{check(url);return beacon(url,...args)};
  });
  await context.routeWebSocket('**/*',socket=>{deny('WebSocket '+socket.url());socket.close();});
  // Cache scenarios deliberately omit request routing: routing disables Chromium HTTP cache.
  if(routeHandler)await context.route('**/*',async route=>{
    const req=route.request();
    if(!allowedURL(req.url(),origins,mocks)||!['GET','HEAD'].includes(req.method())){deny(req.method()+' '+req.url());return route.abort('blockedbyclient')}
    try {await routeHandler(route)}catch(e){deny(e.message);await route.abort('failed')}
  });
  context.on('page',page=>{
    page.on('pageerror',e=>deny('pageerror: '+e.message));
    page.on('console',e=>{if(e.type()==='error')deny('console: '+e.text())});
  });
  return {violations,assertClean(){assert.deepEqual(violations,[],'Unexpected network / browser error')}};
}
function adapter(browser,{htmlTransform}={}) {
  const contexts=[];
  return {
    async newPage({viewport={width:390,height:1180},offlineSdk}={}) {
      const context=await browser.newContext({...options(viewport.width),viewport});
      const safety=await guard(context,{origins:ORIGINS,mocks:offlineSdk?[SDK]:[],routeHandler:async route=>{
        const u=new URL(route.request().url());
        if(u.href===SDK)return route.fulfill({contentType:'text/javascript',body:`(${offlineSdk.toString()})()`});
        const rel=decodeURIComponent(u.pathname==='/'?'/index.html':u.pathname).slice(1);
        const file=path.resolve(root,rel);
        assert.ok(file.startsWith(root+path.sep)&&!rel.split(/[\\/]/).some(p=>p.startsWith('.')),'Unsafe fixture path');
        assert.ok(fs.existsSync(file)&&fs.statSync(file).isFile(),'Unregistered local resource '+rel);
        let body=fs.readFileSync(file);
        if(rel==='index.html'&&htmlTransform)body=htmlTransform(body.toString());
        return route.fulfill({contentType:mime[path.extname(file)]||'application/octet-stream',body});
      }});
      contexts.push({context,safety});
      const page=await context.newPage();page.setDefaultTimeout(6000);return page;
    },
    async close(){const failures=[];for(const {context,safety} of contexts.splice(0)){await context.close();try{safety.assertClean()}catch(e){failures.push(e.message)}}assert.deepEqual(failures,[],'Fixture failures')},
  };
}
module.exports={root,SDK,ORIGINS,mime,guard,adapter};
