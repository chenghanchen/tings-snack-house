// Render the source markup/styles without application scripts or external requests.
const fs=require('node:fs');
const path=require('node:path');
const assert=require('node:assert/strict');
const {chromium}=require(process.env.TINGS_PLAYWRIGHT_MODULE||'playwright');
const root=path.resolve(__dirname,'..');
(async()=>{
  const browser=await chromium.launch({channel:process.env.TINGS_BROWSER_CHANNEL||'msedge',headless:true});
  try{
    const page=await browser.newPage();
    await page.route('**/*',route=>{
      const url=new URL(route.request().url());
      if(url.hostname!=='success-layout.test')return route.abort();
      const file=path.resolve(root,url.pathname==='/'?'index.html':url.pathname.slice(1));
      if(!file.startsWith(root+path.sep)||!fs.existsSync(file))return route.fulfill({status:404,body:''});
      let body=fs.readFileSync(file);
      if(file.endsWith('.html'))body=body.toString().replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,'');
      return route.fulfill({body,contentType:{'.html':'text/html; charset=utf-8','.css':'text/css','.webp':'image/webp'}[path.extname(file)]||'text/plain'});
    });
    await page.goto('https://success-layout.test/');
    await page.evaluate(()=>{
      document.querySelector('#orderFormWrap').hidden=true;
      document.querySelector('#successMessage').hidden=false;
      document.querySelector('#orderDialog').showModal();
    });
    for(const width of [320,390,780,781,1710]){
      await page.setViewportSize({width,height:1180});
      for(const long of [false,true])for(const label of ['配送地址','自取地址']){
        await page.evaluate(({long,label})=>{
          document.querySelector('#submittedAddressLabel').textContent=label;
          document.querySelector('#submittedAddress').textContent=long?'12345 Very Long Street Name, Apartment 12345, Chicago Illinois 60616 '+ 'X'.repeat(120):'2627 S Union Ave, Unit 1, 2 IL 60616';
        },{long,label});
        const result=await page.locator('.success-address-row').evaluate(row=>{
          const dt=row.querySelector('dt'),dd=row.querySelector('dd');
          const a=dt.getBoundingClientRect(),b=dd.getBoundingClientRect(),r=row.getBoundingClientRect();
          return {labelWidth:a.width,addressWidth:b.width,gap:b.left-a.right,contained:b.right<=r.right&&b.bottom<=r.bottom,
            overflow:dd.scrollWidth>dd.clientWidth,clipped:dd.scrollHeight>dd.clientHeight,whiteSpace:getComputedStyle(dd).whiteSpace,
            lineHeight:parseFloat(getComputedStyle(dd).lineHeight),height:b.height};
        });
        assert.ok(result.gap>=5&&result.contained&&!result.overflow&&!result.clipped,`${width} ${label} long=${long}: ${JSON.stringify(result)}`);
        assert.equal(result.whiteSpace,'normal');
        if(width>780){
          assert.ok(Math.abs(result.labelWidth-110.53)<1);
          assert.ok(result.addressWidth>=295&&result.addressWidth<=301,`${width}: ${JSON.stringify(result)}`);
          if(!long)assert.ok(result.height<=result.lineHeight+1,'reference address fits one desktop line');
        }
      }
    }
    console.log('PASS: success address grid at 320, 390, 780, 781 and 1710px; delivery/pickup; long addresses wrap without clipping or overlap.');
  }finally{await browser.close()}
})().catch(error=>{console.error(error);process.exitCode=1});
