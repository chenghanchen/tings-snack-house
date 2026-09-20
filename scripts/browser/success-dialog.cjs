const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {WIDTHS}=require('./policy.cjs');
const {adapter,root}=require('./harness.cjs');
module.exports=async function successDialog(browser){
  let cases=0;
  for(const width of WIDTHS){
    const fixture=adapter(browser,{htmlTransform:html=>html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,'')});
    try{
      const page=await fixture.newPage({viewport:{width,height:1180}});
      await page.goto('http://localhost/');
      const app=fs.readFileSync(path.join(root,'app.js'),'utf8'),start=app.indexOf('function closeOrderDialog()'),end=app.indexOf('$("#orderDialog").addEventListener("close"',start);
      assert.ok(start>=0&&end>start);
      await page.addScriptTag({content:'const $=s=>document.querySelector(s);let orderSubmissionPending=false;function resetOrderDialog(){}\n'+app.slice(start,end)});
      await page.evaluate(()=>{
        document.querySelector('#orderFormWrap').hidden=true;document.querySelector('#successMessage').hidden=false;
        document.querySelector('#successReferralReward').hidden=false;
        for(const [id,value]of Object.entries({submittedReferralCode:'TSHREF-ABC123',submittedOrderNumber:'TSH-TEST-123',submittedOrderTotal:'$58.07',submittedItemCount:'7'}))document.getElementById(id).textContent=value;
        document.querySelector('#orderDialog').showModal();
      });
      for(const long of [false,true])for(const label of ['配送','自取']){
        await page.evaluate(({long,label})=>{document.querySelector('#submittedFulfillmentLabel').textContent=label;document.querySelector('#submittedFulfillmentNote').textContent=long?'12345 Very Long Street Name, Apartment 12345, Chicago Illinois 60616 '+ 'X'.repeat(120):'2627 S Union Ave, Unit 1, Chicago IL 60616'},{long,label});
        const m=await page.evaluate(()=>{
          const dialog=document.querySelector('#orderDialog'),d=dialog.getBoundingClientRect(),hero=document.querySelector('.success-hero'),h=hero.getBoundingClientRect(),p=hero.parentElement.getBoundingClientRect();
          const dd=document.querySelector('#submittedFulfillmentNote'),row=dd.parentElement,a=row.querySelector('dt').getBoundingClientRect(),b=dd.getBoundingClientRect(),r=row.getBoundingClientRect();
          return {viewport:d.left>=0&&d.right<=innerWidth+1&&d.top>=0&&d.bottom<=innerHeight+1,overflow:dialog.scrollWidth>dialog.clientWidth,
            centered:Math.abs((h.left-p.left)-(p.right-h.right))<1,heroFits:hero.scrollWidth<=hero.clientWidth&&[...hero.children].every(el=>{const c=el.getBoundingClientRect();return c.left>=h.left-1&&c.right<=h.right+1}),
            address:b.left>=a.right&&b.right<=r.right+1&&b.bottom<=r.bottom+1&&dd.scrollWidth<=dd.clientWidth+1&&dd.scrollHeight<=dd.clientHeight+1,
            wraps:getComputedStyle(dd).whiteSpace==='normal'};
        });
        assert.deepEqual(m,{viewport:true,overflow:false,centered:true,heroFits:true,address:true,wraps:true},`${width} long=${long} ${label}`);cases++;
      }
      const close=page.locator('#closeDialog');
      await page.locator('#orderDialog').evaluate(el=>{el.scrollTop=0});
      assert.equal(await close.evaluate(el=>{const b=el.getBoundingClientRect();return [3,25,47].every(x=>[3,25,47].every(y=>el.contains(document.elementFromPoint(b.x+x,b.y+y))))}),true,'Entire close target unobstructed');
      assert.equal(await page.locator('.success-hero').evaluate(el=>Math.abs(el.getBoundingClientRect().width-Math.min(300,el.parentElement.clientWidth))<1),true,'Approved 300px hero contract');
      assert.equal(await page.locator('.success-order-summary dt').evaluateAll(els=>els.every(el=>getComputedStyle(el).fontSize==='16px'&&el.scrollWidth<=el.clientWidth+1)),true,'Approved 16px labels fit');
      assert.equal(await page.locator('#submittedReferralCode').evaluate(el=>getComputedStyle(el).fontSize),'16px');
      for(const position of [{x:3,y:3},{x:25,y:25},{x:47,y:47}]){
        await close.click({position});assert.equal(await page.locator('#orderDialog').evaluate(el=>el.open),false);
        await page.locator('#orderDialog').evaluate(el=>el.showModal());
      }
      await page.locator('#successReferralInfoDialog').evaluate(el=>el.hidden=false);
      assert.equal(await close.evaluate(el=>{const r=el.getBoundingClientRect();return el.contains(document.elementFromPoint(r.x+25,r.y+25))}),false);
      console.log(`PASS success dialog/hero/address/close ${width}px`);
    }finally{await fixture.close()}
  }
  return cases;
};
