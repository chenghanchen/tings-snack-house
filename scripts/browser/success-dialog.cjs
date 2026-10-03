const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {WIDTHS}=require('./policy.cjs');
const {adapter,root}=require('./harness.cjs');
module.exports=async function successDialog(browser){
  let cases=0;
  for(const width of [...new Set([...WIDTHS,446,600,601])].sort((a,b)=>a-b)){
    const fixture=adapter(browser,{htmlTransform:html=>html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,'')});
    try{
      const page=await fixture.newPage({viewport:{width,height:width===446?753:1180}});
      await page.goto('http://localhost/');
      const app=fs.readFileSync(path.join(root,'app.js'),'utf8'),start=app.indexOf('function closeOrderDialog()'),end=app.indexOf('$("#orderDialog").addEventListener("close"',start);
      assert.ok(start>=0&&end>start);
      await page.addScriptTag({content:'const $=s=>document.querySelector(s);let orderSubmissionPending=false;function resetOrderDialog(){}\n'+app.slice(start,end)});
      const rendering=app.slice(app.indexOf('function setSuccessReferralCode('),app.indexOf('function closeOrderDialog()'));
      const interactions=app.slice(app.indexOf('$("#done").onclick'),app.indexOf('$("#viewSubmittedOrder").onclick'));
      await page.addScriptTag({content:`const settings={pickup_address:'测试自取点',content:{storeSettings:{profile:{phone:'3125550100'}}}};const dollars=n=>'$'+Number(n).toFixed(2);let cart=Array.from({length:6},(_,i)=>({qty:i?2:3,product:{name:'测试商品'+i,icon:'🍪'}}));${rendering}\n${interactions}`});
      await page.evaluate(()=>{
        const form=new FormData();form.set('fulfillment','delivery');form.set('address','2627 S Union Ave, Unit 1, Chicago IL 60616');
        window.__successFixture={order_number:'TSH-260928-437F5',total_amount:80.96,referral_reward:{account_only:true,referral_code:'TSHREF-486ZVY'}};
        window.__successForm=form;showOrderSuccess(__successFixture,form);
        document.querySelector('#orderDialog').showModal();
      });
      assert.equal(await page.textContent('#submittedItemCount'),'13');
      assert.equal(await page.locator('.success-item-thumb').count(),5);
      assert.equal(await page.textContent('.success-item-more'),'+2','Overflow counts unshown product lines, not total quantity');
      const spacing=await page.evaluate(()=>{
        const style=s=>getComputedStyle(document.querySelector(s));
        const dialog=style('#orderDialog'),hero=style('.success-hero'),note=style('.success-preparing-note'),button=style('#viewSubmittedOrder'),referral=style('#successReferralReward'),utility=style('.success-utility');
        const textRange=document.createRange();textRange.selectNodeContents(document.querySelector('.success-utility>p'));
        const a=textRange.getBoundingClientRect(),b=document.querySelector('.success-footer-art svg').getBoundingClientRect();
        return {width:dialog.width,top:dialog.paddingTop,hero:[hero.paddingTop,hero.paddingBottom],note:note.marginTop,gap:[button.rowGap,button.columnGap],referral:[referral.paddingTop,referral.paddingBottom,referral.marginTop],utility:[utility.marginTop,utility.marginBottom],decorationClear:a.right<=b.left||b.right<=a.left||a.bottom<=b.top||b.bottom<=a.top};
      });
      assert.deepEqual(spacing,{width:`${Math.min(520,width-16)}px`,top:'20px',hero:['0px','0px'],note:'0px',gap:['0px','0px'],referral:['5px','5px','10px'],utility:['0px','-40px'],decorationClear:true},`${width} compact confirmation spacing`);
      const mobileSpacing=await page.evaluate(()=>{
        const s=selector=>getComputedStyle(document.querySelector(selector));
        return {hero:s('.success-hero').marginTop,title:s('.success-hero h2').marginLeft,subtitle:s('.success-hero>p:first-of-type').marginLeft,note:s('.success-preparing-note').marginLeft,actions:s('.success-actions').marginTop,support:s('.success-utility>p').marginTop,footer:s('.success-footer-art').marginTop,rules:s('#successReferralReward .success-referral-info').marginTop};
      });
      assert.deepEqual(mobileSpacing,width<=600?{hero:'-10px',title:'30px',subtitle:'20px',note:'15px',actions:'10px',support:'-5px',footer:'15px',rules:'-5px'}:{hero:'0px',title:'0px',subtitle:'0px',note:'0px',actions:'17px',support:'0px',footer:'12px',rules:'0px'},`${width} mobile annotations stay scoped`);
      if(width<=600){
        assert.equal(await page.locator('.success-order-summary>div:has(#submittedOrderTotal)').evaluate(el=>el.getBoundingClientRect().height),60,'Mobile total row is 60px');
        assert.equal(await page.locator('#viewSubmittedOrder').evaluate(el=>el.getBoundingClientRect().height),50,'Mobile order action is 50px');
      }
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
      assert.equal(await page.locator('.success-hero').evaluate(el=>Math.abs(el.getBoundingClientRect().width-el.parentElement.clientWidth)<1),true,'Reference hero spans confirmation width');
      assert.equal(await page.locator('.success-order-summary dt').evaluateAll(els=>els.every(el=>getComputedStyle(el).fontSize===(innerWidth<=600?'14px':'16px')&&el.scrollWidth<=el.clientWidth+1)),true,'Responsive labels fit without truncation');
      assert.equal(await page.locator('#submittedReferralCode').evaluate(el=>getComputedStyle(el).fontSize),width<=600?'14px':'16px');
      await page.evaluate(()=>{document.querySelector('#submittedFulfillmentNote').textContent='2627 S Union Ave, Unit 1, Chicago IL 60616';document.querySelector('#submittedFulfillmentLabel').textContent='配送地址'});
      if(process.env.SUCCESS_CAPTURE_DIR){fs.mkdirSync(process.env.SUCCESS_CAPTURE_DIR,{recursive:true});await page.locator('#orderDialog').screenshot({path:path.join(process.env.SUCCESS_CAPTURE_DIR,`success-${width}.png`)});}
      await page.click('#contactShop');
      assert.equal(await page.locator('#contactShop').getAttribute('aria-expanded'),'true');
      assert.equal(await page.locator('#successContactDetails').isVisible(),true);
      assert.equal(await page.evaluate(()=>{
        const details=document.querySelector('#successContactDetails'),d=details.getBoundingClientRect(),button=document.querySelector('#contactShop').getBoundingClientRect(),note=document.querySelector('.success-utility>p').getBoundingClientRect(),footer=document.querySelector('.success-footer-art').getBoundingClientRect();
        return !!details.closest('.success-utility')&&d.top>=button.bottom&&d.bottom<=note.top&&d.bottom<=footer.top&&details.scrollWidth<=details.clientWidth+1;
      }),true,'Expanded contact details are below the button and above the note/footer');
      if(process.env.SUCCESS_CAPTURE_DIR)await page.locator('#orderDialog').screenshot({path:path.join(process.env.SUCCESS_CAPTURE_DIR,`success-contact-${width}.png`)});
      await page.click('#contactShop');
      assert.equal(await page.locator('#successContactDetails').isHidden(),true);
      assert.equal(await page.locator('#contactShop').getAttribute('aria-expanded'),'false');
      cases+=5;
      if(width===390){
        await page.evaluate(()=>{Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async value=>{if(window.__copyFail)throw Error('denied');window.__copied=value}}});document.execCommand=()=>false;});
        await page.click('#copySubmittedOrder');
        assert.equal(await page.textContent('#copySubmittedOrderLabel'),'✓ 已复制');
        assert.equal(await page.evaluate(()=>__copied),'TSH-260928-437F5');
        await page.click('#copySubmittedOrder');
        await page.waitForFunction(()=>document.querySelector('#copySubmittedOrderLabel').textContent==='');
        await page.click('#copySuccessReferral');
        assert.equal(await page.evaluate(()=>__copied),'TSHREF-486ZVY');
        assert.equal(await page.textContent('#submittedReferralCode'),'TSHREF-486ZVY');
        await page.waitForFunction(()=>document.querySelector('#copySuccessReferral [data-copy-label]').textContent==='复制');
        await page.evaluate(()=>window.__copyFail=true);
        await page.click('#copySubmittedOrder');
        assert.equal(await page.textContent('#copySubmittedOrderLabel'),'复制失败','Denied copies must never claim success');
        await page.evaluate(()=>{showOrderSuccess({...__successFixture,referral_reward:{pending:true}},__successForm)});
        assert.equal(await page.locator('#successReferralReward').isHidden(),true);
        assert.equal(await page.locator('#successReferralPending').isVisible(),true);
        assert.equal(await page.textContent('#copySubmittedOrderLabel'),'');
        await page.evaluate(()=>showOrderSuccess(__successFixture,__successForm));
        assert.equal(await page.locator('#successReferralReward').isVisible(),true);
        assert.equal(await page.locator('#successReferralPending').isHidden(),true);
        await page.click('[data-referral-info="code"]');
        assert.match(await page.textContent('#successReferralInfoText'),/订单完成后.*90 天/);
        await page.click('[data-close-referral-info]');
        await page.click('#contactShop');
        assert.equal(await page.locator('#successContactDetails').isVisible(),true);
        cases+=8;
      }
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
