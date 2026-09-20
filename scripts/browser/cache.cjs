// Real HTTP cache, ordinary reload/revisit in the SAME context. No Playwright routing.
const http=require('node:http'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {createHash}=require('node:crypto');
const {root,mime,guard}=require('./harness.cjs');
const {options}=require('./policy.cjs');
module.exports=async function cache(browser){
  const html=fs.readFileSync(path.join(root,'index.html'),'utf8'),assets=['styles.css','mobile-header.js'];
  // Git/Cache Version Guard use LF; Windows checkout may materialize CRLF.
  const current=Object.fromEntries(assets.map(f=>[f,Buffer.from(fs.readFileSync(path.join(root,f),'utf8').replace(/\r\n/g,'\n'))]));
  const refs=Object.fromEntries(assets.map(f=>{const m=html.match(new RegExp(f.replace('.','\\.')+'\\?v=([a-f0-9]{64})'));assert.ok(m,`Managed version ${f}`);assert.equal(m[1],createHash('sha256').update(current[f]).digest('hex'));return [f,m[0]]}));
  let phase='old',requests=[],violations=[];
  const host='cache.fixture.test';
  const server=http.createServer((req,res)=>{
    try{
      const u=new URL(req.url,`http://${host}`);
      assert.equal(u.origin,`http://${host}`,'Unregistered proxy destination');assert.equal(req.method,'GET');
      requests.push({phase,url:u.pathname+u.search});
      if(u.pathname==='/'){
        let body=html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,s=>s.includes('src="mobile-header.js?')?s:'');
        if(phase==='old')for(const f of assets)body=body.replace(refs[f],f+'?v=offline-old');
        res.setHeader('Content-Type','text/html; charset=utf-8');res.setHeader('Cache-Control','no-cache');return res.end(body);
      }
      const relative=decodeURIComponent(u.pathname.slice(1)),file=path.resolve(root,relative);
      assert.ok(file.startsWith(root+path.sep)&&!relative.split(/[\\/]/).some(p=>p.startsWith('.')));
      assert.ok(fs.existsSync(file)&&fs.statSync(file).isFile(),'Unknown cache fixture resource');
      let body=fs.readFileSync(file);
      if(assets.includes(relative)){
        body=current[relative];
        assert.ok(u.search==='?v=offline-old'||u.pathname.slice(1)+u.search===refs[relative]);
        if(u.search==='?v=offline-old')body=Buffer.concat([current[relative],Buffer.from(relative.endsWith('.css')?'\n:root{--offline-cache-proof:old}':'\nwindow.__offlineOldHeader=true;')]);
      }
      res.setHeader('Content-Type',mime[path.extname(file)]||'application/octet-stream');res.setHeader('Cache-Control','public, max-age=31536000, immutable');res.end(body);
    }catch(e){violations.push(e.message);res.writeHead(403);res.end('Blocked offline request')}
  });
  server.on('connect',(req,socket)=>{violations.push('Unexpected CONNECT '+req.url);socket.end('HTTP/1.1 403 Forbidden\r\n\r\n')});
  server.on('upgrade',(req,socket)=>{violations.push('Unexpected upgrade '+req.url);socket.destroy()});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  try{
    for(const width of [390,1710]){
      phase='old';requests=[];
      const context=await browser.newContext({...options(width),proxy:{server:`http://127.0.0.1:${server.address().port}`,bypass:'<-loopback>'}});
      const safety=await guard(context);
      try{
        const page=await context.newPage();page.setDefaultTimeout(6000);
        const read=()=>page.evaluate(()=>({css:getComputedStyle(document.documentElement).getPropertyValue('--offline-cache-proof').trim(),js:window.__offlineOldHeader===true}));
        await page.goto(`http://${host}/`);assert.deepEqual(await read(),{css:'old',js:true});
        await page.goto(`http://${host}/?ordinary-revisit=1`);
        for(const f of assets)assert.equal(requests.filter(r=>r.url===`/${f}?v=offline-old`).length,1,'Old asset actually reused from cache');
        phase='new';await page.reload();assert.deepEqual(await read(),{css:'',js:false});
        for(const f of assets)assert.equal(requests.filter(r=>r.phase==='new'&&r.url==='/'+refs[f]).length,1,'New version requested on normal reload');
        await page.goto(`http://${host}/`);assert.deepEqual(await read(),{css:'',js:false});
        for(const f of assets)assert.equal(requests.filter(r=>r.url==='/'+refs[f]).length,1,'New version cached on ordinary revisit');
        assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth),true);
        console.log(`PASS real HTTP cache old -> normal reload -> normal revisit ${width}px`);
      }finally{await context.close();safety.assertClean()}
    }
    assert.deepEqual(violations,[],'Proxy blocked unregistered network');return 2;
  }finally{await new Promise(resolve=>server.close(resolve))}
};
