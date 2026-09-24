// Offline browser integration checks. No real auth emails, orders or API writes.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
function mockSdk() {
  const state = window.__accountTest = {calls:[], clients:[], profile:{}, delayed:false, expired:false};
  const owner = {access_token:'owner-token',user:{id:'owner',email:'owner@example.test'}};
  const customers = {};
  window.supabase = {createClient(url,key,options) {
    const customer = !!options?.auth?.storageKey;
    const storageKey = options?.auth?.storageKey || 'owner-auth';
    let session = customer ? JSON.parse(localStorage.getItem(storageKey) || 'null') : owner;
    let listener;
    state.clients.push({customer,storageKey,auth:options?.auth});
    const change = (next) => {
      session = next; localStorage.setItem(storageKey,JSON.stringify(next));
      listener?.(next?'SIGNED_IN':'SIGNED_OUT',next);
    };
    if (customer) state.change = change;
    const chain = {then(fn){return Promise.resolve({data:[],error:null}).then(fn)}};
    const query = new Proxy(chain,{get(t,k){return k==='then'?t.then.bind(t):()=>query}});
    return {
      channel(){return {on(){return this},subscribe(){return this}}}, from(){return query},
      functions:{async invoke(name,options){state.calls.push({name,...options}); return {data:{id:'new-order',order_number:'TSH-TEST',total_amount:5,subtotal:5,tax_amount:0,delivery_fee:0}}}},
      auth:{
        async getSession(){return customer && state.expired ? {data:{session:null},error:{message:'expired',status:401}} : {data:{session}}},
        onAuthStateChange(fn){listener=fn; return {data:{subscription:{unsubscribe(){}}}}},
        async signInWithOAuth(args){
          state.calls.push({name:'oauth',args,customer});
          if(state.delayOAuth)await new Promise(resolve=>{state.resolveOAuth=resolve});
          if(state.throwOAuth)throw new Error('private provider details');
          return {error:state.oauthError?{message:'private provider details'}:null};
        },
        async exchangeCodeForSession(code){
          state.calls.push({name:'exchange',code,customer});
          if(code!=='mock-google-code')return {error:{message:'private callback details'}};
          const next={access_token:'mock-google-session',user:{id:'existing-customer-uid',email:'alice@example.test',
            identities:[{provider:'email'},{provider:'google'}]}};
          change(next);return {data:{session:next},error:null};
        },
        async signInWithOtp(args){state.calls.push({name:'otp',args});return state.sendError?{error:{message:'SMTP'}}:{}},
        async verifyOtp({email,token}){
          if(state.verifyError)return {error:state.verifyError};
          if(token!=='123456')return {error:{message:'bad OTP'}};
          const next={access_token:'customer-token-'+email,user:{id:email,email}};
          change(next);return {data:{session:next}};
        },
        async signOut(){state.calls.push({name:'signOut',customer});if(state.signOutError)return {error:{message:'network'}};change(null);return {error:null}},
      },
      async rpc(name,args){
        const uid=session?.user.id;
        state.calls.push({name,args,uid,customer});
        if(name==='get_storefront_snapshot'){
          if(state.delayCatalog)await new Promise(resolve=>{state.resolveCatalog=resolve});
          return {data:{
          settings:{id:1,name:'婷婷的零食屋',english:"Ting’s Snack House",is_accepting_orders:true,delivery_fee:0,free_delivery_threshold:60,tax_rate:0,
            storeSettings:{delivery:{minDelivery:0},order:{minOrder:0}}},
          products:[{id:1,name:'测试零食',price:state.price ?? 5,stock:state.stock ?? 100,type:'热卖',icon:'🍪',is_active:true}],
          categories:[{name:'热卖'}],option_groups:[],option_values:[],variants:[],product_sales:[],campaigns:[]}};
        }
        if(name==='get_my_customer_details'){
          if(state.delayDetails)await new Promise(resolve=>{state.resolveDetails=resolve});
          if(state.detailsError)return {error:{message:'network'}};
          return {data:state.profile[uid]||{full_name:'',phone:'',address:''}};
        }
        if(name==='get_my_customer_wallet'){
          const data=structuredClone(state.wallet||{coupons:[],referral_codes:[{code:uid==='bob@example.test'?'TSHREF-B7M4X9':'TSHREF-K7M4X9',amount:5,min_spend:30}],history:[]});
          if(state.delayWallet)await new Promise(resolve=>{state.resolveWallet=resolve});
          return state.walletError?{error:{message:'network'}}:{data};
        }
        if(name==='claim_customer_coupon'){
          if(state.delayClaim)await new Promise(resolve=>{state.resolveClaim=resolve});
          if(state.claimError)return {error:{message:'领取失败，请重试'}};
          const coupon=state.wallet.coupons.find(c=>c.id===args.p_coupon_id);
          if(coupon)Object.assign(coupon,{status:'available',claimed:true,ends_at:'2099-12-31'});
          return {data:{claimed:true}};
        }
        if(name==='preview_account_offer_v2'){
          if(args.p_code==='TEST-SHIPPING')return {data:args.p_fulfillment==='delivery'
            ?{valid:true,discount:0,name:'配送专享券',is_referral:false,free_shipping:true,shipping_discount:4,allow_campaign_stack:true}
            :{valid:false,discount:0,reason:'仅配送订单可用'}};
          return {data:{valid:args.p_subtotal>=30,discount:5,name:'推荐奖励券',is_referral:false,allow_campaign_stack:true}};
        }
        if(name==='save_my_customer_details_v2'){
          if(state.delaySave)await new Promise(resolve=>{state.resolveSave=resolve});
          if(state.saveError)return {error:{message:'network'}};
          state.profile[uid]=Object.fromEntries(['full_name','phone','address','unit','city','state','zip'].map(key=>[key,args['p_'+key]]));
          return {data:state.profile[uid]};
        }
        if(name==='get_my_customer_orders'){
          if(state.ordersError)return {error:{message:'network'}};
          const data=args.p_offset ? [] : state.orders || [{id:uid+'-order',order_number:'TSH-'+uid,created_at:'2026-09-09T12:00:00Z',
            status:'待确认',items:[{name:'<img src=x onerror=window.xss=1>',qty:1}],fulfillment:'delivery',
            address:'Test address',subtotal:5,total_amount:5,cancellation_requested:customers[uid]?.cancelled}];
          if(state.delayed)await new Promise(resolve=>{state.resolveOrders=resolve});
          return {data};
        }
        if(name==='request_my_order_cancellation'){if(state.cancelError)return {error:{message:'network'}};customers[uid]={cancelled:true};return {data:true}}
        return {data:[]};
      },
    };
  }};
}
module.exports = async function checkAccount(browser, {mode='account', width=390}={}) {
  const responsiveWidths=list=>require('./browser/policy.cjs').matrixFor(width,list);
  try {
    const page=await browser.newPage({viewport:{width,height:1180}, offlineSdk:mockSdk});
    const errors=[];
    page.on('pageerror',e=>errors.push(e.message));
    page.on('console',entry=>{if(entry.type()==='error')errors.push(entry.text())});
    async function openCustomerAccount(){
      if(await page.locator('#mobileMenuToggle').isVisible()){
        await page.click('#mobileMenuToggle');await page.click('#mobileAccountEntry');
      }else await page.locator('#openCustomerAccount').click();
    }
    async function closeCustomerAccount(){
      if(await page.locator('#customerSignedIn').isVisible() && !await page.locator('#customerHomePanel').isVisible())await page.click('#customerAccountBack');
      await page.click('#customerAccountBack');
    }
    async function checkCheckoutLayout(phase) {
      for (const width of responsiveWidths([320,390,780,1100,1710])) {
        await page.setViewportSize({width,height:1180});
        for (const fulfillment of ['delivery','pickup']) {
          await page.selectOption('#fulfillment',fulfillment);
          const result=await page.locator('#orderForm').evaluate(form=>{
            const style=el=>getComputedStyle(el),margin=el=>[style(el).marginTop,style(el).marginBottom];
            const root=form.closest('dialog'),heading=document.querySelector('#orderFormWrap>h2');
            const summary=document.querySelector('#orderSummary'),button=document.querySelector('#submitOrder');
            const labels=[...form.querySelectorAll('.checkout-contact>label,.checkout-delivery>label')].filter(el=>el.checkVisibility()),promo=form.querySelector('#promotionChoice>label');
            const rows=[...labels,promo];
            const overlaps=rows.slice(1).filter((el,i)=>el.getBoundingClientRect().top<rows[i].getBoundingClientRect().bottom-0.5).map(el=>el.textContent.trim());
            return {sections:[...form.querySelectorAll(':scope>.checkout-section')].map(el=>el.querySelector('h3').textContent),controls:[...form.querySelectorAll('input:not([type=radio]),select,textarea')].filter(el=>el.checkVisibility()).map(el=>[style(el).borderRadius,style(el).marginTop]),
              promo:margin(promo),summary:[style(summary).borderRadius,style(summary).paddingTop,style(summary).paddingBottom,...margin(summary)],
              dialog:[style(root).borderRadius,style(root).paddingTop,style(root).paddingBottom],heading:margin(heading),
              headerOffsets:[style(root.querySelector('#closeDialog')).marginTop,style(heading).paddingTop,style(root.querySelector('#orderFormWrap>.eyebrow')).paddingTop,style(root.querySelector('#customerCheckoutHint')).marginBottom],
              compactSpacing:[style(form.querySelector('[name=name]').closest('label')).marginTop,style(form.querySelector('#fulfillment').closest('label')).marginTop,style(form.querySelector('.checkout-delivery')).paddingBottom],
              sectionHeadingsClear:[...form.querySelectorAll('.checkout-contact,.checkout-delivery')].every(section=>section.querySelector('label').getBoundingClientRect().top>=section.querySelector('.checkout-section-heading').getBoundingClientRect().bottom),
              submit:[style(button).fontSize,style(button).borderRadius,style(button).paddingTop,style(button).paddingBottom,style(button).justifyContent],
              overflow:root.scrollWidth>root.clientWidth+1,headingClear:labels[0].getBoundingClientRect().top>=heading.getBoundingClientRect().bottom,overlaps};
          });
          // The fixture also enables the existing optional scheduled-time field.
          assert.deepEqual(result,{sections:['联系信息','配送信息','优惠'],controls:Array(fulfillment==='delivery'?8:7).fill(['8px','5px']),
            promo:['0px','0px'],summary:['12px','16px','16px','0px','0px'],dialog:['16px','20px','0px'],heading:['0px','7px'],headerOffsets:['0px','0px','0px','12px'],compactSpacing:['-5px','-5px','0px'],sectionHeadingsClear:true,
            submit:[width<359?'14px':'16px','10px','12px','12px','center'],overflow:false,headingClear:true,overlaps:[]},`checkout ${phase} ${width}px ${fulfillment}: ${JSON.stringify(result)}`);
          const hintClear=await page.evaluate(()=>{
            const hint=document.querySelector('#couponCodeHint'),input=document.querySelector('#manualCouponCode');
            const oldText=hint.textContent,oldHidden=hint.hidden;
            hint.textContent='优惠码暂时无法验证，请检查后重试。';hint.hidden=false;
            const clear=hint.getBoundingClientRect().top>=input.getBoundingClientRect().bottom+4;
            hint.textContent=oldText;hint.hidden=oldHidden;return clear;
          });
          assert.ok(hintClear,`coupon hint remains readable ${phase} ${width}px`);
          await page.locator('.checkout-total-details>summary').click();
          assert.equal(await page.locator('#orderSummary').isVisible(),true,'amount breakdown remains available');
          await page.waitForFunction(()=>document.querySelector('#checkoutTotal').textContent===document.querySelector('#orderSummary .order-amounts>div:last-child>b:last-child').textContent);
          const amountLayout=await page.locator('#orderSummary').evaluate(el=>{
            const box=el.getBoundingClientRect(),dialog=el.closest('dialog').getBoundingClientRect(),button=document.querySelector('#submitOrder').getBoundingClientRect();
            return {inside:box.left>=dialog.left&&box.right<=dialog.right,aboveSubmit:box.bottom<=button.top,overflow:el.scrollWidth>el.clientWidth+1};
          });
          assert.deepEqual(amountLayout,{inside:true,aboveSubmit:true,overflow:false},`amount disclosure ${phase} ${width}px`);
          await page.locator('.checkout-total-details>summary').click();
        }
      }
      await page.selectOption('#fulfillment','delivery');
      await page.setViewportSize({width:390,height:1180});
      await page.locator('#orderDialog').evaluate(el=>{el.scrollTop=0});
      if(process.env.TINGS_ACCOUNT_SCREENSHOT)await page.screenshot({path:process.env.TINGS_ACCOUNT_SCREENSHOT.replace('.png',`-checkout-${phase}.png`)});
    }
    await page.goto('http://localhost/');
    await page.waitForSelector('#productGrid .product');
    if (mode === 'order-refresh') {
      await require('./check-order-refresh.cjs')(page, errors);
      return;
    }
    await require('./check-customer-google.cjs')(browser, mockSdk, width);
    assert.equal(await page.locator('.activity-card').count(),4);
    assert.equal(await page.textContent('#openCustomerAccount'),'登录账户');
    assert.equal(await page.textContent('#mobileAccountEntry'),'登录账户');
    assert.equal(await page.textContent('#activityWelcomeOffer'),'登录领取新人专属优惠');
    assert.equal(await page.textContent('#activityWelcomeAction'),'立即领取');
    assert.equal(await page.textContent('#story .ft-benefits section:first-child h2'),'品质保证');
    assert.deepEqual(await page.locator('#story .ft-benefits h2').allTextContents(),['品质保证','快速配送','贴心服务','推荐奖励']);
    assert.deepEqual(await page.locator('#story .ft-benefits p').allTextContents(),['精选好味 安心选购','本地配送 方便自取','购物疑问 随时联系','分享好物 领取优惠']);
    for(const icon of ['shield','truck','service','gift']){
      assert.equal(await page.evaluate(async name=>{const img=new Image();img.src=`footer-benefit-${name}.svg`;try{await img.decode();return img.naturalWidth>0}catch{return false}},icon),true,`${icon} footer icon decodes`);
    }
    for(const width of responsiveWidths([320,360,390,430,600,780,781,1100,1710])){
      await page.setViewportSize({width,height:1000});
      const benefits=await page.locator('#story .ft-benefits').evaluate(root=>{
        const sections=[...root.children],boxes=sections.map(el=>el.getBoundingClientRect());
        return {sameRow:boxes.every(b=>Math.abs(b.top-boxes[0].top)<1),equalWidth:boxes.every(b=>Math.abs(b.width-boxes[0].width)<1),overflow:root.scrollWidth>root.clientWidth+1,
          copyFits:sections.every(el=>[...el.querySelectorAll('h2,p')].every(text=>text.scrollWidth<=text.clientWidth+1)),
          separators:sections.slice(1).every(el=>getComputedStyle(el,'::before').borderLeftStyle==='dashed'),
          icon:getComputedStyle(root.querySelector('.ft-service-icon')).backgroundImage,
          background:getComputedStyle(document.querySelector('#story')).backgroundColor};
      });
      assert.equal(benefits.sameRow,true,`footer same row at ${width}`);assert.equal(benefits.equalWidth,true,`footer equal width at ${width}`);assert.equal(benefits.overflow,false);assert.equal(benefits.copyFits,true);
      assert.equal(benefits.background,'rgb(255, 245, 226)');
      if(width<=780){assert.equal(benefits.separators,true);assert.match(benefits.icon,/footer-benefit-shield\.svg/)}
      else {assert.equal(benefits.separators,false);assert.doesNotMatch(benefits.icon,/footer-benefit/)}
      if(process.env.TINGS_ACCOUNT_SCREENSHOT&&[320,390,780].includes(width))await page.locator('#story .ft-benefits').screenshot({path:process.env.TINGS_ACCOUNT_SCREENSHOT.replace('.png',`-benefits-${width}.png`)});
    }
    await page.setViewportSize({width:390,height:844});await page.evaluate(()=>scrollTo(0,0));
    assert.equal(await page.textContent('.cart-button-label'),'购物车');
    for(const asset of ['header-account-icon.svg','header-cart-icon.svg']){
      assert.equal(await page.evaluate(async src=>{const image=new Image();image.src=src;try{await image.decode();return image.naturalWidth>0}catch{return false}},asset),true,`${asset} decodes`);
    }
    assert.equal(await page.locator('#openOrderLookup').textContent(),'查询游客订单');
    assert.equal(await page.locator('#mobileLookupEntry').textContent(),'查询游客订单');
    assert.equal(await page.locator('#filters [data-filter="热销TOP榜"]').count(),0);
    assert.equal(await page.locator('#filters [data-filter="热卖"]').count(),1);
    assert.equal(await page.locator('.activity-card--welcome button').evaluate(el=>getComputedStyle(el).fontWeight),'500');
    assert.equal(await page.locator('#activityPromotionOffer').textContent(),'敬请期待');
    assert.equal(await page.locator('.activity-card:last-child h2').textContent(),'限定促销');
    assert.equal(await page.locator('#activityPromotionCard button').isDisabled(),true);
    await page.evaluate(()=>TingsStorefront.publishCampaigns([{id:'promo',active:true,status:'published',kind:'product_discount',discount_kind:'percent',amount:10}]));
    assert.equal(await page.locator('.activity-card:nth-child(2) h2').textContent(),'限定促销');
    assert.equal(await page.locator('#activityPromotionOffer').textContent(),'10% OFF');
    for(const width of responsiveWidths([320,390,600,780,781,1100,1710])){
      await page.setViewportSize({width,height:1000});
      await page.locator('.activity-announcement').scrollIntoViewIfNeeded();
      await page.locator('.activity-announcement__cards').evaluate(el=>{el.scrollLeft=0});
      const layout=await page.locator('.activity-announcement__cards').evaluate(el=>{
        const rows=[...el.children].map(card=>card.getBoundingClientRect());
        return {sameRow:rows.every(r=>Math.abs(r.top-rows[0].top)<1),scrollable:el.scrollWidth>el.clientWidth+1,
          overflow:document.documentElement.scrollWidth>innerWidth,
          copyFits:[...el.querySelectorAll('.activity-card__copy')].every(copy=>copy.scrollWidth<=copy.clientWidth+1)};
      });
      assert.deepEqual(layout,{sameRow:true,scrollable:width<1710,overflow:false,copyFits:true},`activity cards at ${width}px`);
      const spacing=await page.locator('.activity-announcement').evaluate(section=>{
        const style=getComputedStyle(section),track=section.querySelector('.activity-announcement__cards');
        return {top:style.paddingTop,bottom:style.paddingBottom,width:track.getBoundingClientRect().width};
      });
      assert.equal(spacing.top,'10px');assert.equal(spacing.bottom,'5px');
      assert.equal(await page.locator('#filters').evaluate(el=>getComputedStyle(el).marginBottom),'15px');
      assert.deepEqual(await page.locator('#snacks>.section-heading h2').evaluate(el=>({top:getComputedStyle(el).marginTop,bottom:getComputedStyle(el).marginBottom})),{top:'-10px',bottom:'5px'});
      if(width===1710)assert.equal(spacing.width,1500);
      const sizes=await page.locator('.activity-card').evaluateAll(cards=>cards.map(card=>({width:card.offsetWidth,height:card.offsetHeight})));
      assert.ok(sizes.every(size=>size.width===350&&size.height===160),`fixed card size at ${width}px`);
      assert.equal(await page.locator('.activity-card--welcome button').evaluate(el=>getComputedStyle(el).fontWeight),'500');
      if(width<=780){
        await page.locator('.activity-announcement__cards').evaluate(el=>{el.scrollLeft=el.scrollWidth});
        assert.ok(await page.locator('.activity-announcement__cards').evaluate(el=>el.scrollLeft>0));
        await page.locator('.activity-announcement__cards').evaluate(el=>{el.scrollLeft=0});
      }
      if(process.env.TINGS_ACCOUNT_SCREENSHOT&&[390,1710].includes(width)){
        await page.locator('.activity-card img').evaluateAll(images=>Promise.all(images.map(img=>img.decode())));
        await page.locator('.activity-announcement').screenshot({path:process.env.TINGS_ACCOUNT_SCREENSHOT.replace('.png',`-activities-${width}.png`)});
      }
    }
    await page.setViewportSize({width:1100,height:1000});
    await page.locator('.activity-announcement').scrollIntoViewIfNeeded();
    await page.locator('.activity-announcement__cards').evaluate(el=>{el.scrollLeft=0});
    const dragStart=await page.locator('[data-promotion-account="coupons"]').boundingBox();
    await page.mouse.move(dragStart.x+dragStart.width/2,dragStart.y+dragStart.height/2);
    await page.mouse.down();
    await page.mouse.move(dragStart.x-300,dragStart.y+dragStart.height/2,{steps:12});
    await page.mouse.up();
    assert.ok(await page.locator('.activity-announcement__cards').evaluate(el=>el.scrollLeft>100),'mouse drag scrolls narrow desktop');
    assert.equal(await page.locator('#customerAccountDialog').evaluate(el=>el.open),false,'drag from a button must not activate it');
    await page.click('[data-promotion-filter="促销"]');
    assert.equal(await page.getAttribute('#filters .active','data-filter'),'促销');
    await page.evaluate(()=>TingsStorefront.publishCampaigns([
      {active:true,kind:'full_reduction',threshold:50,amount:5},
      {active:true,kind:'category_discount',discount_kind:'percent',amount:15,category_names:['零食'],customer_scope:'new'},
      {active:true,kind:'product_discount',discount_kind:'fixed',amount:1}
    ]));
    for(const width of responsiveWidths([320,390,1100,1710])){
      await page.setViewportSize({width,height:1000});
      await page.locator('#activityPromotionCard').scrollIntoViewIfNeeded();
      assert.ok(await page.locator('#activityPromotionCard').evaluate(card=>{
        const box=card.getBoundingClientRect(),button=card.querySelector('button').getBoundingClientRect();
        const offer=card.querySelector('p');
        return button.bottom<=box.bottom&&button.top>=offer.getBoundingClientRect().bottom&&offer.scrollHeight>offer.clientHeight;
      }),`multiple offers scroll within the card without covering the button at ${width}px`);
    }
    await page.evaluate(()=>TingsStorefront.publishCampaigns([]));
    assert.equal(await page.locator('.activity-card:last-child h2').textContent(),'限定促销');
    assert.equal(await page.locator('#activityPromotionCard button').isDisabled(),true);
    if(process.env.TINGS_ACCOUNT_SCREENSHOT){
      await page.setViewportSize({width:1710,height:1000});
      await page.locator('.activity-announcement').screenshot({path:process.env.TINGS_ACCOUNT_SCREENSHOT.replace('.png','-activities-empty.png')});
    }
    await page.setViewportSize({width:390,height:844});
    await page.fill('#productSearch','nonexistent');
    await page.click('[data-promotion-filter="热卖"]');
    assert.equal(await page.inputValue('#productSearch'),'');
    assert.equal(await page.getAttribute('#filters .active','data-filter'),'热卖');
    assert.equal(await page.locator('#productGrid .product').count(),1);
    await page.click('[data-promotion-filter="新品"]');
    assert.equal(await page.getAttribute('#filters .active','data-filter'),'新品');
    assert.equal(await page.locator('#productGrid .no-products').count(),1);
    await page.fill('#productSearch','测试零食');
    assert.equal(await page.getAttribute('#filters .active','data-filter'),'全部');
    assert.equal(await page.locator('#productGrid .product').count(),1);
    await page.fill('#productSearch','热卖');
    assert.equal(await page.locator('#productGrid .product').count(),1);
    await page.click('#filters [data-filter="新品"]');
    assert.equal(await page.inputValue('#productSearch'),'');
    assert.equal(await page.locator('#productGrid .no-products').count(),1);
    await page.fill('#productSearch','不存在的零食');
    assert.equal(await page.getAttribute('#filters .active','data-filter'),'全部');
    assert.equal(await page.locator('#productGrid .no-products').count(),1);
    await page.fill('#productSearch','');
    assert.equal(await page.locator('#productGrid .product').count(),1);
    await page.click('#filters [data-filter="全部"]');
    await page.evaluate(()=>scrollTo(0,0));
    for(const width of responsiveWidths([320,360,375,390,430,580,581,600,780,781,1000,1100,1710])){
      await page.setViewportSize({width,height:844});
      const boxes=await page.locator('.site-header').evaluate(header=>[...header.children]
        .filter(el=>getComputedStyle(el).display!=='none').map(el=>{
          const r=el.getBoundingClientRect();return {name:el.id||el.className,left:r.left,right:r.right,top:r.top,bottom:r.bottom};
        }));
      for(let i=0;i<boxes.length;i++)for(let j=i+1;j<boxes.length;j++){
        const a=boxes[i],b=boxes[j];
        assert.ok(a.right<=b.left+1||b.right<=a.left+1||a.bottom<=b.top+1||b.bottom<=a.top+1,JSON.stringify({width,boxes}));
      }
      assert.ok(boxes.at(-1).right<=width,JSON.stringify({width,boxes}));
      assert.ok(await page.locator('.brand-logo').evaluate(img=>img.complete&&img.naturalWidth>0));
      const logoWidth=await page.locator('.brand-logo').evaluate(img=>img.getBoundingClientRect().width);
      const expectedLogoWidth=width<=780?Math.min((width-128)*.7,210):width<=1000?180:210;
      assert.ok(Math.abs(logoWidth-expectedLogoWidth)<1,`logo width at ${width}px: ${logoWidth}`);
      const headerHeight=await page.locator('.site-header').evaluate(el=>el.getBoundingClientRect().height);
      assert.ok(Math.abs(headerHeight-(width<=780?Math.max(56,expectedLogoWidth/3+9):82))<1,`header height at ${width}px: ${headerHeight}`);
      assert.equal(await page.locator('.brand').getAttribute('href'),'#top');
      if(width>780)assert.equal(await page.locator('#openOrderLookup').evaluate(el=>getComputedStyle(el).fontSize),'17px');
      assert.equal(await page.locator('#openCart').evaluate(el=>el.getBoundingClientRect().height),width<=780?44:40);
      if(width>780){
        assert.equal(await page.locator('#openCustomerAccount').evaluate(el=>el.getBoundingClientRect().height),40);
        for(const selector of ['#openCart','#openCustomerAccount'])assert.match(await page.locator(selector).evaluate(el=>getComputedStyle(el,'::before').backgroundImage),/header-(cart|account)-icon\.svg/);
      }else{
        assert.deepEqual(await page.locator('#openCart').evaluate(el=>({width:el.getBoundingClientRect().width,bg:getComputedStyle(el).backgroundColor,radius:getComputedStyle(el).borderRadius,icon:getComputedStyle(el,'::before').content})),{width:44,bg:'rgba(0, 0, 0, 0)',radius:'0px',icon:'none'});
      }
      if(process.env.TINGS_ACCOUNT_SCREENSHOT && [390,1710].includes(width))await page.screenshot({path:process.env.TINGS_ACCOUNT_SCREENSHOT.replace('.png',`-header-${width}.png`)});
      if(width<=780){
        const center=await page.locator('.brand').evaluate(el=>{const r=el.getBoundingClientRect();return r.left+r.width/2});
        assert.ok(Math.abs(center-width/2)<1);
        assert.equal(await page.locator('#openCustomerAccount').isVisible(),false);
        await page.click('#mobileMenuToggle');
        assert.equal(await page.getAttribute('#mobileMenuToggle','aria-expanded'),'true');
        assert.equal(await page.locator('#mobileHeaderMenu').isVisible(),true);
        assert.deepEqual(await page.locator('#mobileHeaderMenu').evaluate(el=>[...el.children].map(item=>item.id||item.textContent)),['mobileAccountEntry','mobileLookupEntry','逛零食','小店故事']);
        assert.equal(await page.locator('#mobileAccountEntry').evaluate(el=>el===document.activeElement),true);
        assert.equal(await page.locator('#mobileAccountEntry').evaluate(el=>el.getBoundingClientRect().height),44);
        if(process.env.TINGS_ACCOUNT_SCREENSHOT&&width===390)await page.screenshot({path:process.env.TINGS_ACCOUNT_SCREENSHOT.replace('.png','-menu-guest.png')});
        await page.keyboard.press('Escape');
        assert.equal(await page.locator('#mobileHeaderMenu').isVisible(),false);
        assert.equal(await page.locator('#mobileMenuToggle').evaluate(el=>el===document.activeElement),true);
      }
      await openCustomerAccount();
      assert.ok(await page.locator('#customerAccountDialog').evaluate(el=>el.scrollWidth<=el.clientWidth+1));
      assert.equal(await page.textContent('#customerAccountTitle'),'登录账户');
      assert.equal(await page.textContent('.customer-login-divider'),'或');
      assert.equal(await page.locator('#customerEmailForm').isVisible(),true);
      assert.equal(await page.locator('#customerCodeForm').isHidden(),true);
      assert.equal(await page.locator('#customerGoogleSignIn').isVisible(),true);
      assert.ok(await page.locator('#customerGoogleSignIn').evaluate(el=>{
        const r=el.getBoundingClientRect(),d=el.closest('dialog').getBoundingClientRect();
        const back=document.querySelector('#customerAccountBack').getBoundingClientRect();
        return r.left>=d.left&&r.right<=d.right&&r.top>=back.bottom&&r.bottom<=d.bottom&&el.scrollWidth<=el.clientWidth;
      }),`Google button fits and does not overlap Back at ${width}px`);
      assert.equal(await page.textContent('#customerSignedOut>p.customer-muted'),'邮箱验证码登录，首次登录即创建账户。也可以游客身份继续下单。');
      const loginLayout=await page.locator('#customerAccountDialog').evaluate(el=>({width:el.getBoundingClientRect().width,top:getComputedStyle(el).paddingTop,bottom:getComputedStyle(el).paddingBottom}));
      assert.equal(loginLayout.top,'15px');assert.equal(loginLayout.bottom,'15px');
      assert.ok(loginLayout.width<=Math.min(460,width-24));
      if(width>=600)assert.equal(loginLayout.width,460);
      if(process.env.TINGS_ACCOUNT_SCREENSHOT&&[390,1710].includes(width))await page.locator('#customerAccountDialog').screenshot({path:process.env.TINGS_ACCOUNT_SCREENSHOT.replace('.png',`-login-${width}.png`)});
      await closeCustomerAccount();
    }
    await page.setViewportSize({width:390,height:844});
    assert.equal(await page.evaluate(()=>__accountTest.clients.filter(c=>c.customer).length),1);
    await page.click('#mobileMenuToggle');await page.click('#mobileLookupEntry');
    assert.equal(await page.locator('#orderLookupDialog').evaluate(el=>el.open),true);
    assert.equal(await page.locator('#mobileHeaderMenu').isVisible(),false);
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('#mobileMenuToggle').evaluate(el=>el===document.activeElement),true);
    for(const width of responsiveWidths([320,350,390,600,780])){
      await page.setViewportSize({width,height:844});
      await page.click('#mobileMenuToggle');await page.click('#mobileLookupEntry');
      const layout=await page.locator('#orderLookupDialog').evaluate(dialog=>{
        const back=dialog.querySelector('[data-return-lookup]').getBoundingClientRect();
        const title=dialog.querySelector('h2').getBoundingClientRect(),bounds=dialog.getBoundingClientRect();
        return {width:back.width,height:back.height,rightGap:bounds.right-back.right,topGap:back.top-bounds.top,
          titleClear:back.bottom<=title.top,overflow:dialog.scrollWidth>dialog.clientWidth};
      });
      assert.deepEqual(layout,{width:56,height:40,rightGap:16,topGap:12,titleClear:true,overflow:false},`lookup Back layout at ${width}px`);
      if(process.env.TINGS_ACCOUNT_SCREENSHOT&&width===390)await page.screenshot({path:process.env.TINGS_ACCOUNT_SCREENSHOT.replace('.png','-lookup-back.png')});
      await page.click('#orderLookupDialog [data-return-lookup]');
      assert.equal(await page.locator('#orderLookupDialog').evaluate(el=>el.open),false);
      assert.equal(await page.locator('#mobileMenuToggle').evaluate(el=>el===document.activeElement),true);
    }
    await page.setViewportSize({width:390,height:844});
    await page.click('#mobileMenuToggle');await page.click('.brand');
    assert.equal(await page.locator('#mobileHeaderMenu').isVisible(),false);
    await page.click('#mobileMenuToggle');await page.setViewportSize({width:1100,height:844});
    await page.waitForFunction(()=>document.querySelector('#mobileHeaderMenu').hidden);
    await page.setViewportSize({width:390,height:844});
    await page.click('#productGrid .add');
    await page.waitForFunction(()=>document.querySelector('#openCart').getAttribute('aria-label').includes('1 件商品'));
    await page.click('#openCart');
    for(const width of responsiveWidths([320,390,780,1100,1710])){
      await page.setViewportSize({width,height:1180});
      await page.locator('#cart').evaluate(el=>Promise.all(el.getAnimations().map(animation=>animation.finished)));
      const cartLayout=await page.locator('#cart').evaluate(cart=>{
        const style=el=>getComputedStyle(el),checkout=cart.querySelector('#checkout'),keep=cart.querySelector('#continueShopping');
        const buttons=[keep,checkout],boxes=buttons.map(el=>el.getBoundingClientRect());
        return {subtotal:style(cart.querySelector('#cartSubtotal')).fontSize,
          rows:[...cart.querySelectorAll('.cart-item')].map(el=>[style(el).paddingTop,style(el).paddingBottom]),
          buttons:buttons.map(el=>[style(el).fontSize,style(el).borderRadius]),align:style(checkout).justifyContent,
          sameRow:Math.abs(boxes[0].top-boxes[1].top)<1,
          fits:buttons.every((el,i)=>el.scrollWidth<=el.clientWidth+1&&boxes[i].left>=0&&boxes[i].right<=innerWidth&&boxes[i].bottom<=innerHeight),
          overflow:cart.scrollWidth>cart.clientWidth+1};
      });
      assert.deepEqual(cartLayout,{subtotal:'15px',rows:[['10px','10px']],buttons:[['15px','10px'],['15px','10px']],align:'center',sameRow:true,fits:true,overflow:false},`cart ${width}px: ${JSON.stringify(cartLayout)}`);
    }
    await page.setViewportSize({width:390,height:844});
    await page.locator('#cart').evaluate(el=>Promise.all(el.getAnimations().map(animation=>animation.finished)));
    assert.ok(await page.locator('#checkout').evaluate(el=>el.getBoundingClientRect().bottom<=innerHeight),'cart footer fits the shorter mobile viewport');
    if(process.env.TINGS_ACCOUNT_SCREENSHOT)await page.screenshot({path:process.env.TINGS_ACCOUNT_SCREENSHOT.replace('.png','-cart.png')});
    const cartBeforeContinue=await page.locator('#cartItems').textContent();
    await page.click('#continueShopping');
    assert.equal(await page.locator('#cart').getAttribute('aria-hidden'),'true');
    await page.click('#openCart');
    assert.equal(await page.locator('#cartItems').textContent(),cartBeforeContinue);
    await page.click('#checkout');
    const guestHeader=await page.evaluate(()=>TingsAccount.checkoutHeaders());
    await checkCheckoutLayout('guest');
    assert.equal(guestHeader.Authorization,await page.evaluate(()=>`Bearer ${TINGS_SUPABASE.anonKey}`));
    assert.notEqual(guestHeader.Authorization,'Bearer owner-token');
    await page.fill('#orderForm [name=name]','Guest');
    await page.fill('#orderForm [name=phone]','3125550100');
    await page.fill('#orderForm [name=address]','Guest address');
    await page.evaluate(()=>{
      settings.content.storeSettings.delivery.minDelivery=30;
      document.querySelector('#fulfillment').dispatchEvent(new Event('change',{bubbles:true}));
    });
    await page.waitForFunction(()=>document.querySelector('#fulfillment').value==='delivery');
    const submissionsBeforeMinimumCheck=await page.evaluate(()=>__accountTest.calls.filter(c=>c.name==='submit-order').length);
    await page.evaluate(()=>document.querySelector('#orderForm').requestSubmit());
    await page.waitForSelector('#checkoutOrderError:not([hidden])');
    assert.equal(await page.textContent('#checkoutOrderErrorTitle'),'🚗 还差 $25.00 即可配送');
    assert.equal(await page.textContent('#checkoutOrderErrorDetail'),'配送订单商品小计最低 $30.00，当前商品小计 $5.00。');
    assert.equal(await page.evaluate(()=>__accountTest.calls.filter(c=>c.name==='submit-order').length),submissionsBeforeMinimumCheck);
    for(const width of responsiveWidths([320,390,780,1100,1710])){
      await page.setViewportSize({width,height:1180});
      const errorLayout=await page.locator('#checkoutOrderError').evaluate(error=>{
        const dialog=error.closest('dialog'),buttons=[...error.querySelectorAll('button')],bounds=error.getBoundingClientRect();
        return {overflow:error.scrollWidth>error.clientWidth+1||dialog.scrollWidth>dialog.clientWidth+1,
          buttonsFit:buttons.every(button=>button.scrollWidth<=button.clientWidth+1),
          insideDialog:bounds.left>=dialog.getBoundingClientRect().left&&bounds.right<=dialog.getBoundingClientRect().right};
      });
      assert.deepEqual(errorLayout,{overflow:false,buttonsFit:true,insideDialog:true},`checkout minimum error ${width}px`);
    }
    await page.setViewportSize({width:390,height:844});
    await page.click('#checkoutErrorContinue');
    assert.equal(await page.locator('#orderDialog').evaluate(el=>el.open),false);
    await page.click('#openCart');await page.click('#checkout');
    await page.fill('#orderForm [name=name]','Guest');
    await page.fill('#orderForm [name=phone]','3125550100');
    await page.fill('#orderForm [name=address]','Guest address');
    await page.evaluate(()=>document.querySelector('#orderForm').requestSubmit());
    await page.waitForSelector('#checkoutOrderError:not([hidden])');
    await page.click('#checkoutErrorPickup');
    assert.equal(await page.inputValue('#fulfillment'),'pickup');
    assert.equal(await page.locator('#checkoutOrderError').isHidden(),true);
    await page.evaluate(()=>document.querySelector('#orderForm').requestSubmit());
    await page.waitForFunction(()=>__accountTest.calls.some(c=>c.name==='submit-order'));
    assert.equal((await page.evaluate(()=>__accountTest.calls.find(c=>c.name==='submit-order'))).headers.Authorization,guestHeader.Authorization);
    await page.evaluate(()=>{settings.content.storeSettings.delivery.minDelivery=0});
    assert.equal(await page.textContent('#submittedFulfillmentLabel'),'自取');
    assert.equal(await page.textContent('#submittedFulfillmentNote'),'天河城二楼，Archer Ave');
    assert.equal(await page.getAttribute('#submittedFulfillmentIcon','data-kind'),'pickup');
    assert.equal(await page.locator('.success-address-row').count(),0);
    assert.equal(await page.textContent('#viewSubmittedOrder'),'查看订单');
    await page.click('#copySubmittedOrder');
    await page.waitForFunction(()=>document.querySelector('#copySubmittedOrderLabel').textContent==='已复制订单号');
    assert.equal(await page.textContent('#copySubmittedOrderLabel'),'已复制订单号');
    await page.click('#done');await page.click('#productGrid .add');

    await page.click('[data-promotion-account="coupons"]');
    await page.fill('#customerEmailForm input','alice@example.test');
    await page.evaluate(()=>{__accountTest.sendError=true});
    await page.click('#customerSendCode');
    await page.waitForFunction(()=>document.querySelector('#customerAccountMessage').textContent.includes('暂时无法发送'));
    await page.evaluate(()=>{__accountTest.sendError=false});
    await page.click('#customerSendCode');
    await page.waitForSelector('#customerCodeForm:not([hidden])');
    assert.equal(await page.locator('#customerResendCode').isDisabled(),true);
    await page.fill('#customerCodeForm input','000000');await page.click('#customerCodeForm [type=submit]');
    await page.waitForFunction(()=>document.querySelector('#customerAccountMessage').textContent.includes('不正确'));
    await page.evaluate(()=>{__accountTest.verifyError={code:'otp_expired'}});
    await page.click('#customerCodeForm [type=submit]');
    await page.waitForFunction(()=>document.querySelector('#customerAccountMessage').textContent.includes('重新获取验证码'));
    await page.evaluate(()=>{__accountTest.verifyError={status:503}});
    await page.click('#customerCodeForm [type=submit]');
    await page.waitForFunction(()=>document.querySelector('#customerAccountMessage').textContent.includes('网络异常'));
    await page.evaluate(()=>{__accountTest.verifyError=null});
    await page.fill('#customerCodeForm input','123456');await page.click('#customerCodeForm [type=submit]');
    await page.waitForSelector('#customerSignedIn:not([hidden])');
    assert.equal(await page.textContent('#openCustomerAccount'),'我的账户');
    assert.equal(await page.textContent('#activityWelcomeAction'),'查看优惠券');
    assert.equal(await page.textContent('#mobileAccountEntry .mobile-account-label'),'我的账户');
    assert.equal(await page.locator('#mobileHeaderMenu').evaluate(el=>el.firstElementChild.id),'mobileAccountEntry');
    assert.equal(await page.textContent('#mobileAccountEntry .mobile-account-email'),'alice@example.test');
    for(const selector of ['#openOrderLookup','#openOrderLookupMobile','#mobileLookupEntry']) {
      assert.equal(await page.locator(selector).evaluate(el=>el.hidden),true);
      assert.equal(await page.locator(selector).evaluate(el=>getComputedStyle(el).display),'none');
    }
    for(const width of responsiveWidths([781,1000,1100,1710])){
      await page.setViewportSize({width,height:844});
      assert.ok(await page.locator('.site-header').evaluate(header=>{
        const boxes=[...header.children].filter(el=>getComputedStyle(el).display!=='none').map(el=>el.getBoundingClientRect());
        return boxes.every((box,index)=>box.right<=innerWidth&&boxes.slice(index+1).every(next=>box.right<=next.left+1||next.right<=box.left+1));
      }),`longer signed-in header labels fit at ${width}px`);
    }
    if(process.env.TINGS_ACCOUNT_SCREENSHOT){
      await page.locator('#customerAccountDialog').evaluate(el=>el.close());
      const originalCount=await page.textContent('#cartCount');
      for(const count of ['7','123']){
        await page.locator('#cartCount').evaluate((el,value)=>{el.textContent=value},count);
        assert.equal(await page.locator('#cartCount').evaluate(el=>el.scrollWidth<=el.clientWidth),true);
      }
      await page.locator('#cartCount').evaluate(el=>{el.textContent='7'});
      await page.locator('.site-header').screenshot({path:process.env.TINGS_ACCOUNT_SCREENSHOT.replace('.png','-signed-in-header.png')});
      await page.locator('#cartCount').evaluate((el,value)=>{el.textContent=value},originalCount);
      await page.setViewportSize({width:390,height:844});await page.click('#mobileMenuToggle');
      await page.screenshot({path:process.env.TINGS_ACCOUNT_SCREENSHOT.replace('.png','-menu-account.png')});
      await page.keyboard.press('Escape');
      await page.locator('#customerAccountDialog').evaluate(el=>el.showModal());
    }
    await page.setViewportSize({width:390,height:844});
    assert.equal(await page.locator('#customerCouponsPanel').isVisible(),true);
    await page.click('#customerAccountBack');
    assert.equal(await page.locator('#customerHomePanel').isVisible(),true);
    assert.equal(await page.locator('#customerOrdersPanel').isVisible(),false);
    assert.deepEqual(await page.locator('.customer-home-menu strong').allTextContents(),['我的订单','收货资料','我的优惠券','推荐奖励']);
    assert.equal(await page.textContent('#customerAccountEmail'),'你好，alice@example.test');
    assert.equal(await page.locator('#customerAccountClose').count(),0);
    assert.equal(await page.locator('#customerAccountBack').isVisible(),true);
    assert.equal(await page.locator('#customerAccountBack').getAttribute('aria-label'),'返回商店');
    assert.equal(await page.locator('#customerOrderRefresh').isVisible(),false);
    assert.equal(await page.textContent('#customerAccountAvatar'),'A');
    assert.equal(await page.locator('.customer-home-icon svg').count(),4);
    assert.equal(await page.locator('.customer-preview-note').count(),0,'Internal-test footer removed');
    assert.equal(await page.textContent('#customerHomeDetailsStatus'),'待完善','An empty profile must not say saved');
    assert.doesNotMatch(await page.locator('.customer-home-menu').textContent(),/1 个进行中|2 张可用|\$5\.00/,'Illustration numbers are not account data');
    const assertAccountBack = async (view,width) => {
      const style=await page.locator('#customerAccountBack').evaluate(el=>{
        const s=getComputedStyle(el),r=el.getBoundingClientRect(),title=document.querySelector('#customerAccountTitle').getBoundingClientRect();
        return {width:r.width,height:r.height,fontSize:s.fontSize,padding:[s.paddingTop,s.paddingRight,s.paddingBottom,s.paddingLeft],
          clear:r.left>=title.right,clickable:document.elementFromPoint(r.left+r.width/2,r.top+r.height/2)===el};
      });
      assert.deepEqual(style,{width:70,height:40,fontSize:'15px',padding:['0px','0px','0px','0px'],clear:true,clickable:true},`${view} back at ${width}px`);
    };
    for (const width of responsiveWidths([320,375,390,780,781,782,1100,1710])) {
      await page.setViewportSize({width,height:844});
      await assertAccountBack('home',width);
      assert.ok(await page.locator('#customerAccountDialog').evaluate(el=>el.scrollWidth<=el.clientWidth+1));
      const homeStyle=await page.evaluate(()=>{
        const root=document.querySelector('#customerAccountDialog'),heading=root.querySelector('.customer-account-heading'),close=root.querySelector('#customerAccountBack');
        const style=getComputedStyle(root.querySelector('#customerSignOut'));
        return {color:style.color,background:style.backgroundColor,radius:style.borderRadius,border:style.borderTopStyle,
          margin:getComputedStyle(heading).marginTop,closeInside:close.getBoundingClientRect().top>=root.getBoundingClientRect().top+6};
      });
      assert.deepEqual(homeStyle,{color:'rgb(99, 55, 25)',background:'rgba(0, 0, 0, 0)',radius:'12px',border:'solid',margin:'0px',closeInside:true});
      assert.ok(await page.locator('#customerAccountDialog').evaluate(dialog=>{
        const root=dialog.getBoundingClientRect();
        const heading=dialog.querySelector('.customer-account-heading').getBoundingClientRect();
        const email=dialog.querySelector('#customerAccountEmail').getBoundingClientRect();
        return root.left>=0&&root.right<=innerWidth&&root.top>=0&&root.bottom<=innerHeight&&email.top>=heading.bottom&&email.right<=root.right;
      }),`Home header and email fit ${width}px`);
      for(const row of await page.locator('.customer-home-menu button').all()){
        await row.scrollIntoViewIfNeeded();
        assert.ok(await row.evaluate(el=>{
          const r=el.getBoundingClientRect(),parts=[...el.children].map(child=>child.getBoundingClientRect());
          return el.scrollWidth<=el.clientWidth&&parts.every((p,i)=>p.left>=r.left&&p.right<=r.right&&p.top>=r.top&&p.bottom<=r.bottom&&(!i||p.left>=parts[i-1].right))&&el.contains(document.elementFromPoint(r.left+r.width/2,r.top+r.height/2));
        }),`Home card content is not clipped or overlapping at ${width}px`);
      }
      await page.locator('#customerAccountTitle').scrollIntoViewIfNeeded();
      const rows=await page.locator('.customer-home-menu button').evaluateAll(buttons=>buttons.map(el=>{
        const r=el.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom};
      }));
      for (let i=1;i<rows.length;i++)assert.ok(rows[i].top>=rows[i-1].bottom&&rows[i].left===rows[0].left&&rows[i].right===rows[0].right);
    }
    await page.setViewportSize({width:width<=780?320:1710,height:844});
    await page.evaluate(()=>__accountTest.change({access_token:'customer-token-alice@example.test',user:{id:'alice@example.test',email:'averylongcustomeremailaddress.for.layout@example.test'}}));
    await page.waitForFunction(()=>document.querySelector('#customerAccountEmail').textContent.includes('averylong'));
    assert.ok(await page.locator('#customerAccountDialog').evaluate(el=>el.scrollWidth<=el.clientWidth));
    assert.ok(await page.locator('#customerAccountEmail').evaluate(el=>el.scrollWidth<=el.clientWidth),'Long email wraps rather than clips');
    await page.evaluate(()=>__accountTest.change({access_token:'customer-token-alice@example.test',user:{id:'alice@example.test',email:'alice@example.test'}}));
    await page.waitForFunction(()=>document.querySelector('#customerAccountEmail').textContent==='你好，alice@example.test');
    await page.setViewportSize({width:390,height:844});
    if(process.env.TINGS_ACCOUNT_SCREENSHOT)await page.screenshot({path:process.env.TINGS_ACCOUNT_SCREENSHOT.replace('.png','-home.png')});
    for (const [view,panel] of [['coupons','customerCouponsPanel'],['rewards','customerRewardsPanel']]) {
      await page.click(`[data-account-tab=${view}]`);
      assert.equal(await page.locator(`#${panel}`).isVisible(),true);
      assert.equal(await page.locator('#customerRefreshCoupons').count(),0);
      await page.waitForFunction(id=>document.getElementById(id).getAttribute('aria-busy')==='false',panel);
      assert.doesNotMatch(await page.textContent(`#${panel}`),/尚未接入|绑定手机号/);
      assert.equal(await page.locator('#customerHomePanel').isVisible(),false);
      for(const width of responsiveWidths([320,390,780,781,782,1710])){
        await page.setViewportSize({width,height:844});
        await assertAccountBack(view,width);
        assert.equal(await page.locator('#customerAccountDialog').evaluate(el=>el.scrollWidth<=el.clientWidth),true,`${view} overflow at ${width}px`);
      }
      await page.setViewportSize({width:390,height:844});
      await page.click('#customerAccountBack');
      assert.equal(await page.locator(`[data-account-tab=${view}]`).evaluate(el=>el===document.activeElement),true);
    }
    await page.evaluate(()=>{__accountTest.wallet={
      coupons:[
        {id:'reward',code:'RWD-ALICE',name:'推荐奖励券',amount:5,min_spend:30,kind:'referral',status:'available',ends_at:'2099-12-31',uses:[]},
        {id:'normal',code:'TEN',name:'10% 优惠券',amount:10,discount_kind:'percent',min_spend:50,kind:'regular',status:'available',uses:[]},
        {id:'new',code:'NEW',name:'首单专享',amount:5,min_spend:35,kind:'new',status:'available',uses:[]},
        {id:'expired',code:'EXPIRED',name:'过期券',amount:5,min_spend:30,kind:'regular',status:'expired',uses:[]},
        {id:'unavailable',code:'UNAVAILABLE',name:'不可用券',amount:5,min_spend:30,kind:'new',status:'unavailable',uses:[]},
        {id:'used',code:'RWD-USED',name:'<img src=x onerror=window.walletXss=1>',amount:5,min_spend:30,kind:'referral',status:'used',uses:[{order_number:'TSH-OWN',used_at:'2026-09-12'}]}
      ],referral_codes:[{code:'TSHREF-K7M4X9',amount:5,min_spend:30}],history:[{created_at:'2026-09-12',status:'等待订单完成',reward_amount:5}]
    }});
    await page.click('[data-account-tab=coupons]');
    await page.waitForSelector('#customerCouponsPanel .customer-coupon-card');
    assert.equal(await page.textContent('#activityWelcomeOffer'),'满 $35 减 $5');
    assert.deepEqual(await page.locator('#customerCouponsPanel h3').allTextContents(),['可用优惠券 · 3张']);
    assert.deepEqual(await page.locator('#customerCouponsPanel>.customer-coupon-card .customer-coupon-source').allTextContents(),['推荐奖励 · ','店铺优惠券 · ','新人券 · ']);
    assert.equal(await page.locator('#customerCouponsPanel .customer-coupon-card code').count(),0,'Coupon codes are never rendered, including collapsed content');
    assert.doesNotMatch(await page.textContent('#customerCouponsPanel'),/优惠码|RWD-ALICE|RWD-USED|EXPIRED|UNAVAILABLE|TEN|NEW/);
    assert.equal(await page.locator('#customerCouponsPanel button[aria-label^="复制"]').count(),0,'No coupon copy action');
    const walletHistory=page.locator('#customerCouponsPanel>.customer-coupon-history');
    assert.equal(await walletHistory.evaluate(el=>el.open),false,'Unavailable coupons default to collapsed');
    assert.equal(await walletHistory.locator('summary').first().textContent(),'不可用优惠券 · 2张');
    assert.equal(await walletHistory.locator('.customer-coupon-use').count(),0,'Unavailable status is not a fake action');
    assert.deepEqual(await walletHistory.locator('.customer-coupon-state').allTextContents(),['暂不可用','已使用']);
    assert.equal(await page.locator('#customerCouponsPanel [data-code="EXPIRED"]').count(),0,'Expired coupons are not rendered or counted');
    assert.deepEqual(await page.locator('#customerCouponsPanel>.customer-coupon-card').evaluateAll(cards=>cards.map(c=>c.dataset.code)),['RWD-ALICE','TEN','NEW']);
    assert.doesNotMatch(await page.textContent('#customerCouponsPanel'),/全店商品/);
    assert.deepEqual(await page.locator('#customerCouponsPanel>.customer-coupon-card .customer-coupon-title').allTextContents(),['推荐奖励 · 推荐奖励券','店铺优惠券 · 10% 优惠券','新人券 · 首单专享']);
    assert.deepEqual(await page.locator('#customerCouponsPanel>.customer-coupon-card small').allTextContents(),Array(3).fill('限用一次，不可与其他优惠券叠加使用'));
    assert.match(await page.textContent('#customerCouponsPanel'),/满 \$35\.00 可用/);
    assert.equal(await page.locator('#customerCouponsPanel>button').count(),0);
    for(const width of responsiveWidths([320,390,780,781,1710])){
      await page.setViewportSize({width,height:1000});
      const layout=await page.evaluate(()=>{
        const root=document.querySelector('#customerAccountDialog'),title=document.querySelector('#customerAccountTitle'),back=document.querySelector('#customerAccountBack');
        const t=title.getBoundingClientRect(),b=back.getBoundingClientRect(),s=getComputedStyle(root);
        return {padding:[s.paddingTop,s.paddingBottom],clear:t.right<=b.left-4,overflow:root.scrollWidth>root.clientWidth+1};
      });
      assert.deepEqual(layout,{padding:['20px','20px'],clear:true,overflow:false},`coupon heading at ${width}px`);
      assert.deepEqual(await page.locator('#customerCouponsPanel>.customer-coupon-card').first().evaluate(card=>{
        const s=getComputedStyle(card),f=getComputedStyle(card.querySelector('.customer-coupon-flourish'));
        return [s.paddingTop,s.paddingBottom,s.marginBottom,f.fontSize,f.fontWeight,getComputedStyle(card.querySelector('.customer-coupon-minimum b')).fontSize,getComputedStyle(document.querySelector('#customerAccountEmail')).fontSize];
      }),['0px','0px','0px','10px','500','20px','15px'],`Coupon annotations at ${width}px`);
      assert.ok(await page.locator('#customerCouponsPanel>.customer-coupon-card').evaluateAll(cards=>cards.every(card=>{
        const r=card.getBoundingClientRect(),b=card.querySelector('.customer-coupon-benefit').getBoundingClientRect(),d=card.querySelector('.customer-coupon-details').getBoundingClientRect(),a=card.querySelector('.customer-coupon-action').getBoundingClientRect(),copy=card.querySelector('.customer-coupon-summary>div').getBoundingClientRect();
        return r.height>=104&&card.scrollWidth<=card.clientWidth&&b.right<=d.left&&copy.right<=a.left&&a.right<=r.right&&[b,d,a].every(p=>p.top>=r.top&&p.bottom<=r.bottom);
      })),`Wallet amount/details/action never overlap at ${width}px`);
      const colors=await page.locator('#customerCouponsPanel>.customer-coupon-card').evaluateAll(cards=>cards.map(card=>{const s=getComputedStyle(card.querySelector('.customer-coupon-use'));return [getComputedStyle(card).backgroundColor,s.backgroundColor,s.color]}));
      assert.deepEqual(colors,Array.from({length:3},()=>['rgb(255, 237, 232)','rgb(233, 34, 53)','rgb(255, 255, 255)']));
      await walletHistory.locator('summary').first().click();
      assert.ok(await walletHistory.locator('.customer-coupon-card').evaluateAll(cards=>cards.every(c=>c.scrollWidth<=c.clientWidth&&c.querySelector('.customer-coupon-summary>div').getBoundingClientRect().right<=c.querySelector('.customer-coupon-action').getBoundingClientRect().left)),`Expanded unavailable cards fit ${width}px`);
      assert.equal(await walletHistory.locator('[data-code="EXPIRED"]').count(),0,'Expanding history cannot reveal expired coupons');
      await walletHistory.locator('summary').first().press('Enter');
      assert.equal(await walletHistory.evaluate(el=>el.open),false,'Keyboard can collapse unavailable coupons');
    }
    if(process.env.TINGS_ACCOUNT_SCREENSHOT)await page.screenshot({path:process.env.TINGS_ACCOUNT_SCREENSHOT.replace('.png','-desktop.png')});
    await page.setViewportSize({width:390,height:1000});
    await page.evaluate(()=>{__accountTest.wallet.coupons.push(
      {id:'claim-cap',code:'CLAIM-CAP',name:'精选折扣券',discount_kind:'percent',amount:15,max_discount:8,min_spend:35,requires_claim:true,claim_valid_days:7,kind:'regular',status:'claimable'},
      {id:'claim-ship',code:'CLAIM-SHIP',name:'配送专享券',discount_kind:'free_shipping',amount:0,min_spend:25,requires_claim:true,claim_valid_days:14,kind:'regular',status:'claimable'}
    )});
    const reopenCoupons=async()=>{await page.click('#customerAccountBack');await page.click('[data-account-tab=coupons]');await page.waitForFunction(()=>document.querySelector('#customerCouponsPanel').getAttribute('aria-busy')==='false')};
    await reopenCoupons();
    // UI grouping follows the existing eligibility result, including a stale API status.
    await page.evaluate(()=>{__accountTest.wallet.coupons.push({id:'stale-expired',code:'STALE-END',name:'旧状态过期券',amount:5,min_spend:35,kind:'regular',status:'available',ends_at:'2000-01-01',uses:[]},{id:'soon',code:'SOON',name:'即将过期券',amount:5,min_spend:35,kind:'regular',status:'available',ends_at:new Date(Date.now()+86400000).toISOString(),uses:[]})});
    await reopenCoupons();
    assert.equal(await page.locator('#customerCouponsPanel>.customer-coupon-history [data-code="STALE-END"] .customer-coupon-use').count(),0);
    assert.equal(await page.locator('#customerCouponsPanel [data-code="STALE-END"]').count(),0,'Past end dates are hidden even when the API status is stale');
    assert.equal(await page.locator('#customerCouponsPanel>[data-code="SOON"] .customer-coupon-state').textContent(),'即将过期');
    await page.evaluate(()=>{__accountTest.wallet.coupons=__accountTest.wallet.coupons.filter(c=>!['stale-expired','soon'].includes(c.id))});await reopenCoupons();
    await page.evaluate(()=>{__accountTest.savedCoupons=__accountTest.wallet.coupons;__accountTest.wallet.coupons=__accountTest.savedCoupons.filter(c=>c.status==='expired')});await reopenCoupons();
    assert.equal(await page.locator('#customerCouponsPanel .customer-coupon-card,#customerCouponsPanel>.customer-coupon-history').count(),0,'Expired-only wallet has no cards or empty history section');
    assert.match(await page.textContent('#customerCouponsPanel'),/暂无可用优惠券/);
    await page.evaluate(()=>{__accountTest.wallet.coupons=__accountTest.savedCoupons;delete __accountTest.savedCoupons});await reopenCoupons();
    const capCard=page.locator('#customerCouponsPanel [data-code="CLAIM-CAP"]');
    await capCard.waitFor();assert.match(await capCard.textContent(),/8.5折/);assert.match(await capCard.textContent(),/最高减 \$8/);
    assert.equal(await capCard.locator('small').textContent(),'限用一次，不可与其他优惠券叠加使用');
    assert.equal(await capCard.locator('.customer-coupon-use').textContent(),'立即领取');
    assert.equal(await capCard.evaluate(el=>getComputedStyle(el).backgroundColor),'rgb(255, 237, 232)');
    await page.evaluate(()=>{__accountTest.claimError=true});
    await capCard.locator('.customer-coupon-use').click();await page.waitForFunction(()=>document.querySelector('[data-code="CLAIM-CAP"] .customer-coupon-reason').textContent.includes('领取失败'));
    assert.equal(await capCard.locator('.customer-coupon-use').isEnabled(),true);
    await page.evaluate(()=>{__accountTest.claimError=false;__accountTest.delayClaim=true});
    await capCard.locator('.customer-coupon-use').click();await page.waitForFunction(()=>!!__accountTest.resolveClaim);
    assert.equal(await capCard.locator('.customer-coupon-use').isDisabled(),true);
    await page.evaluate(()=>{__accountTest.delayClaim=false;__accountTest.resolveClaim()});
    await page.waitForFunction(()=>document.querySelector('[data-code="CLAIM-CAP"] .customer-coupon-use').textContent==='去使用');
    assert.equal(await capCard.locator('.customer-coupon-use').evaluate(el=>el.classList.contains('is-claimed')),true);
    await reopenCoupons();await capCard.waitFor();
    assert.equal(await capCard.locator('.customer-coupon-use').textContent(),'去使用');
    assert.deepEqual(await capCard.evaluate(el=>{const s=getComputedStyle(el.querySelector('.customer-coupon-use'));return [getComputedStyle(el).backgroundColor,s.backgroundColor,s.color]}),['rgb(255, 237, 232)','rgb(233, 34, 53)','rgb(255, 255, 255)']);
    assert.equal(await page.evaluate(()=>__accountTest.calls.filter(c=>c.name==='claim_customer_coupon').length),2);
    assert.match(await page.locator('#customerCouponsPanel [data-code="CLAIM-SHIP"]').textContent(),/店铺当前配送区域/);
    for(const width of responsiveWidths([320,390,780,1710])){
      await page.setViewportSize({width,height:1000});
      assert.ok(await page.locator('#customerCouponsPanel').evaluate(el=>[...el.querySelectorAll('.customer-coupon-card')].every(c=>c.scrollWidth<=c.clientWidth+1)));
    }
    await page.setViewportSize({width:390,height:1000});
    if(process.env.TINGS_ACCOUNT_SCREENSHOT)await page.screenshot({path:process.env.TINGS_ACCOUNT_SCREENSHOT.replace('.png','-coupons.png')});
    await page.evaluate(()=>{__accountTest.wallet.coupons=__accountTest.wallet.coupons.filter(c=>!c.id.startsWith('claim-'))});
    await page.evaluate(()=>{__accountTest.walletError=true});await reopenCoupons();
    await page.waitForFunction(()=>document.querySelector('#customerCouponsPanel').textContent.includes('暂时无法加载'));
    assert.equal(await page.textContent('#activityWelcomeOffer'),'查看新人专属优惠');
    assert.equal(await page.locator('#customerCouponsPanel .customer-coupon-card').count(),0);
    assert.equal(await page.locator('#customerCouponsPanel').getByRole('button',{name:'重试',exact:true}).isEnabled(),true);
    await page.evaluate(()=>{__accountTest.walletError=false;__accountTest.savedCoupons=__accountTest.wallet.coupons;__accountTest.wallet.coupons=__accountTest.savedCoupons.filter(c=>c.status!=='available')});
    await page.locator('#customerCouponsPanel').getByRole('button',{name:'重试',exact:true}).click();await page.waitForFunction(()=>document.querySelector('#customerCouponsPanel').textContent.includes('暂无可用优惠券'));
    assert.equal(await page.locator('#customerCouponsPanel>.customer-coupon-card').count(),0);
    assert.equal(await page.locator('#customerCouponsPanel .customer-coupon-history .customer-coupon-card').count(),2);
    await page.evaluate(()=>{__accountTest.wallet.coupons=__accountTest.savedCoupons});
    await reopenCoupons();await page.waitForSelector('#customerCouponsPanel .customer-coupon-card');
    await page.click('#customerAccountBack');
    await page.click('[data-account-tab=rewards]');
    await page.waitForSelector('#customerRewardsPanel .customer-coupon-card',{state:'attached'});
    await page.click('.referral-earned>summary');
    assert.match(await page.textContent('#customerRewardsPanel'),/90 天|90天/);
    assert.equal(await page.locator('#customerRewardsPanel input').count(),0);
    assert.equal(await page.locator('#customerRewardsPanel img').count(),0);
    assert.match(await page.textContent('#customerRewardsPanel'),/使用于订单 TSH-OWN/);
    assert.equal(await page.getByRole('button',{name:'刷新推荐奖励',exact:true}).count(),0);
    assert.equal(await page.textContent('.referral-code-row>code'),'TSHREF-K7M4X9');
    assert.equal(await page.textContent('.referral-code-card>.customer-muted'),'分享推荐码给好友，好友首次符合条件的订单即可享受优惠。');
    assert.doesNotMatch(await page.textContent('#customerRewardsPanel'),/请以微信中的实际发送结果为准/);
    assert.equal(await page.locator('#customerAccountDialog>.customer-preview-note').count(),0,'Internal-test footer removed');
    await page.evaluate(()=>Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async text=>{__accountTest.copiedCode=text}}}));
    await page.getByRole('button',{name:'复制推荐码',exact:true}).click();
    assert.equal(await page.evaluate(()=>__accountTest.copiedCode),'TSHREF-K7M4X9');
    assert.equal(await page.locator('.referral-full-rules').evaluate(el=>el.open),false);
    assert.match(await page.textContent('.referral-hero'),/好友首单.*满 \$30 减 \$5.*你的奖励.*满 \$30 减 \$5 奖励券/);
    await page.click('.referral-full-rules>summary');
    assert.match(await page.textContent('.referral-full-rules'),/进行中的订单暂占新客资格/);
    assert.match(await page.textContent('.referral-full-rules'),/完成后取消或退款不恢复新客资格/);
    await page.click('.referral-full-rules>summary');
    await page.evaluate(()=>Object.defineProperty(navigator,'share',{configurable:true,value:async payload=>{__accountTest.sharePayload=payload}}));
    await page.getByRole('button',{name:'复制邀请文案',exact:true}).click();
    assert.equal(await page.evaluate(()=>__accountTest.copiedCode),'我在婷婷的零食屋买零食，符合条件的新客首次下单满 $30 可以减 $5。\n推荐码：TSHREF-K7M4X9\nhttps://tings-snack-house.pages.dev/');
    assert.equal(await page.evaluate(()=>__accountTest.sharePayload),undefined,'copy invitation must not open native share');
    assert.match(await page.textContent('.referral-action-status'),/已复制.*选择好友后粘贴发送/);
    await page.getByRole('button',{name:'分享给好友',exact:true}).click();
    assert.equal(await page.textContent('.referral-action-status'),'','native hand-off must not claim delivery');
    assert.equal(await page.getByRole('button',{name:'分享给好友',exact:true}).isEnabled(),true);
    assert.equal(await page.getByRole('button',{name:'复制邀请文案',exact:true}).isEnabled(),true);
    assert.equal(await page.evaluate(()=>__accountTest.sharePayload.url),'https://tings-snack-house.pages.dev/');
    assert.match(await page.evaluate(()=>__accountTest.sharePayload.text),/TSHREF-K7M4X9/);
    assert.match(await page.evaluate(()=>__accountTest.sharePayload.text),/符合条件的新客/);
    // WeChat must guide the user to its own menu, even when navigator.share exists.
    await page.evaluate(()=>{
      __accountTest.sharePayload=null;__accountTest.copiedCode='unchanged';
      Object.defineProperty(navigator,'userAgent',{configurable:true,value:'Mozilla/5.0 (iPhone) MicroMessenger/8.0'});
    });
    await page.getByRole('button',{name:'分享给好友',exact:true}).click();
    const wechatGuide=page.getByRole('dialog',{name:'微信分享引导',exact:true});
    assert.equal(await wechatGuide.isVisible(),true);
    assert.equal(await page.textContent('#referralWechatInstruction'),'点击右上角 ···，选择『发送给朋友』。');
    assert.equal(await page.evaluate(()=>__accountTest.sharePayload),null,'WeChat must not call native share');
    assert.equal(await page.evaluate(()=>__accountTest.copiedCode),'unchanged','guide must not copy without permission');
    assert.equal(await page.evaluate(()=>document.activeElement.textContent),'我知道了');
    for(const width of responsiveWidths([320,390,780])){
      await page.setViewportSize({width,height:844});
      assert.ok(await wechatGuide.evaluate(el=>el.scrollWidth<=el.clientWidth+1));
      assert.ok(await page.locator('.referral-guide-arrow').evaluate(el=>{const b=el.getBoundingClientRect();return b.top<60&&b.right>innerWidth-50&&b.bottom<150;}));
      if(process.env.TINGS_ACCOUNT_SCREENSHOT&&width===390)await page.screenshot({path:process.env.TINGS_ACCOUNT_SCREENSHOT.replace('.png','-wechat-guide.png')});
    }
    await page.getByRole('button',{name:'我知道了',exact:true}).click();
    await page.waitForSelector('.referral-wechat-guide',{state:'detached'});
    assert.equal(await page.evaluate(()=>document.activeElement.textContent),'分享给好友');
    await page.getByRole('button',{name:'分享给好友',exact:true}).click();await page.keyboard.press('Escape');
    await page.waitForSelector('.referral-wechat-guide',{state:'detached'});
    await page.getByRole('button',{name:'分享给好友',exact:true}).click();await page.mouse.click(10,700);
    await page.waitForSelector('.referral-wechat-guide',{state:'detached'});
    await page.evaluate(()=>Object.defineProperty(navigator,'share',{configurable:true,value:undefined}));
    await page.getByRole('button',{name:'分享给好友',exact:true}).click();
    assert.equal(await wechatGuide.isVisible(),true,'WeChat guide also works without Web Share API');
    await page.evaluate(()=>document.querySelector('#customerAccountDialog').close());
    await page.waitForSelector('.referral-wechat-guide',{state:'detached'});
    await page.evaluate(()=>{delete navigator.userAgent;document.querySelector('#customerAccountDialog').showModal();});
    await page.setViewportSize({width:390,height:1000});
    await page.evaluate(()=>{__accountTest.copiedCode='unchanged';Object.defineProperty(navigator,'share',{configurable:true,value:async()=>{throw new DOMException('Cancelled','AbortError')}})});
    await page.getByRole('button',{name:'分享给好友',exact:true}).click();
    assert.equal(await page.textContent('.referral-action-status'),'已取消分享。');
    assert.equal(await page.evaluate(()=>__accountTest.copiedCode),'unchanged','cancelling native share must not copy unexpectedly');
    await page.evaluate(()=>Object.defineProperty(navigator,'share',{configurable:true,value:async()=>{throw new Error('share failed')}}));
    await page.getByRole('button',{name:'分享给好友',exact:true}).click();
    assert.match(await page.textContent('.referral-action-status'),/暂时无法分享.*复制邀请文案/);
    await page.evaluate(()=>Object.defineProperty(navigator,'share',{configurable:true,value:undefined}));
    await page.getByRole('button',{name:'分享给好友',exact:true}).click();
    assert.equal(await page.evaluate(()=>__accountTest.copiedCode),'unchanged','unavailable native share must not copy without a copy action');
    assert.match(await page.textContent('.referral-action-status'),/不支持系统分享.*复制邀请文案/);
    await page.getByRole('button',{name:'复制邀请文案',exact:true}).click();
    assert.match(await page.evaluate(()=>__accountTest.copiedCode),/TSHREF-K7M4X9\nhttps:\/\/tings-snack-house.pages.dev\//);
    await page.evaluate(()=>Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async()=>{throw new Error('blocked')}}}));
    await page.getByRole('button',{name:'复制邀请文案',exact:true}).click();
    assert.match(await page.textContent('.referral-action-status'),/暂时无法复制邀请文案.*手动复制/);
    assert.equal(await page.getByRole('button',{name:'复制邀请文案',exact:true}).isEnabled(),true);
    assert.equal(await page.getByRole('button',{name:'分享给好友',exact:true}).isEnabled(),true);
    await page.getByRole('button',{name:'复制推荐码',exact:true}).click();
    assert.match(await page.textContent('.referral-action-status'),/手动复制/);
    await page.click('.referral-earned>summary');
    for(const width of responsiveWidths([320,390,780,1710])){
      await page.setViewportSize({width,height:844});
      assert.ok(await page.locator('#customerAccountDialog').evaluate(el=>el.scrollWidth<=el.clientWidth+1));
      assert.ok(await page.locator('.referral-code-row').evaluate(el=>el.scrollWidth<=el.clientWidth+1));
      assert.ok(await page.locator('.referral-share-actions').evaluate(el=>el.scrollWidth<=el.clientWidth+1&&[...el.children].every(b=>b.scrollWidth<=b.clientWidth+1)));
      assert.deepEqual(await page.locator('#customerRewardsPanel').evaluate(el=>{
        const style=s=>getComputedStyle(el.querySelector(s));
        const hero=style('.referral-hero'),first=style('.referral-benefits>div:first-child>.referral-benefit-label'),second=style('.referral-benefits>div:nth-child(2)>.referral-benefit-label'),note=style('.referral-benefits>div:first-child>.referral-benefit-note');
        return [hero.paddingTop,hero.paddingBottom,hero.paddingLeft,first.marginTop,second.marginTop,note.marginTop,note.marginBottom,style('.referral-full-rules>summary').marginTop];
      }),['10px','10px','20px','-10px','-5px','3px','-5px','-15px'],`annotated rewards spacing at ${width}px`);
      assert.deepEqual(await page.locator('#customerAccountDialog').evaluate(el=>({top:getComputedStyle(el).paddingTop,bottom:getComputedStyle(el).paddingBottom})),{top:'20px',bottom:'20px'});
      if(process.env.TINGS_ACCOUNT_SCREENSHOT&&[390,1710].includes(width))await page.locator('#customerAccountDialog').screenshot({path:process.env.TINGS_ACCOUNT_SCREENSHOT.replace('.png',`-rewards-${width}.png`)});
    }
    await page.setViewportSize({width:390,height:844});
    if(process.env.TINGS_ACCOUNT_SCREENSHOT)await page.screenshot({path:process.env.TINGS_ACCOUNT_SCREENSHOT.replace('.png','-rewards.png')});
    await page.evaluate(()=>{__accountTest.referralSavedWallet=structuredClone(__accountTest.wallet);__accountTest.wallet.history=[];__accountTest.wallet.coupons=[]});
    await page.click('#customerAccountBack');
    assert.equal(await page.locator('#customerAccountDialog>.customer-preview-note').count(),0,'No internal-test footer on account views');
    await page.click('[data-account-tab=rewards]');
    await page.waitForSelector('.referral-empty');
    assert.equal(await page.textContent('.referral-section-heading>span'),'0 条');
    assert.equal(await page.locator('.referral-earned').count(),0);
    if(process.env.TINGS_ACCOUNT_SCREENSHOT)await page.locator('#customerAccountDialog').screenshot({path:process.env.TINGS_ACCOUNT_SCREENSHOT.replace('.png','-rewards-empty.png')});
    await page.evaluate(()=>{__accountTest.wallet.history=['奖励已发放','等待订单完成','订单已取消，未发奖励','订单取消，奖励已撤销','未满足奖励条件'].map(status=>({status,created_at:'2026-09-12T12:00:00Z',reward_amount:5}))});
    await page.click('#customerAccountBack');await page.click('[data-account-tab=rewards]');
    await page.waitForSelector('.referral-history-list li');
    assert.equal(await page.locator('.referral-history-list li').count(),5);
    assert.match(await page.textContent('.referral-history-list [data-status=rewarded]'),/已获得 \$5/);
    for(const status of ['pending','cancelled','revoked','ineligible'])assert.doesNotMatch(await page.textContent(`.referral-history-list [data-status=${status}] .referral-status`),/\$5/);
    if(process.env.TINGS_ACCOUNT_SCREENSHOT)await page.locator('#customerAccountDialog').screenshot({path:process.env.TINGS_ACCOUNT_SCREENSHOT.replace('.png','-rewards-history.png')});
    await page.evaluate(()=>{__accountTest.wallet=__accountTest.referralSavedWallet});
    await page.evaluate(()=>{__accountTest.wallet.coupons.push({id:'test-shipping',code:'TEST-SHIPPING',name:'配送专享券',discount_kind:'free_shipping',amount:0,min_spend:25,requires_claim:true,claimed:true,kind:'regular',status:'available'})});
    await page.click('#customerAccountBack');await page.click('[data-account-tab=rewards]');
    await page.waitForSelector('#customerWalletCheckout [data-code="TEST-SHIPPING"]',{state:'attached'});
    await closeCustomerAccount();
    await page.click('#openCart');
    // Increase the real local basket; keep only delivery configuration mocked.
    while(Number((await page.textContent('#cartSubtotal')).replace(/[^0-9.]/g,''))<50)await page.locator('#cartItems [data-change="1"]').first().click();
    await page.evaluate(()=>{__accountTest.originalFee=settings.delivery_fee;settings.delivery_fee=4});
    await page.click('#checkout');
    await page.waitForSelector('#customerWalletCheckout input[value="RWD-ALICE"]',{state:'attached'});
    assert.equal(await page.locator('#customerWalletCheckout input[value="RWD-ALICE"]').isVisible(),false);
    const availableToggle=page.locator('#customerWalletCheckout .customer-coupon-toggle');
    assert.equal(await availableToggle.getAttribute('aria-expanded'),'false');
    assert.equal(await availableToggle.locator('span').evaluate(el=>getComputedStyle(el).listStyleType),'disclosure-closed','collapsed triangle matches native details marker');
    const historyToggle=page.locator('#customerWalletCheckout .checkout-history-toggle');
    assert.equal(await availableToggle.locator('span').evaluate(el=>getComputedStyle(el).listStyleType),await historyToggle.locator('span').evaluate(el=>getComputedStyle(el).listStyleType));
    await availableToggle.click();
    assert.equal(await availableToggle.getAttribute('aria-expanded'),'true');
    assert.equal(await availableToggle.locator('span').evaluate(el=>getComputedStyle(el).listStyleType),'disclosure-open','expanded triangle matches native details marker');
    assert.equal(await page.locator('#customerWalletCheckout input[value="RWD-ALICE"]').isVisible(),true);
    await page.click('#customerWalletCheckout input[value=""]');
    assert.equal(await availableToggle.getAttribute('aria-expanded'),'false');
    await availableToggle.click();
    assert.equal(await page.textContent('#customerWalletCheckout legend>span'),'优惠券');
    assert.equal(await page.textContent('#customerWalletCheckout legend>small'),'每单限用一张；推荐奖励与优惠券不能叠加。');
    assert.equal(await page.locator('#customerWalletCheckout>small').count(),0);
    assert.equal(await page.locator('.checkout-offer-rules').isVisible(),true);
    assert.equal(await page.textContent('.checkout-offer-rules'),'每单限用一张；推荐奖励与优惠券不能叠加');
    for(const width of responsiveWidths([320,390,780,1710])){
      await page.setViewportSize({width,height:1000});
      const layout=await page.evaluate(()=>{
        const root=document.querySelector('#customerWalletCheckout'),field=root.querySelector('fieldset'),legend=root.querySelector('legend'),summary=root.querySelector('.checkout-history-toggle'),note=document.querySelector('#orderNoteCount'),cards=[...field.querySelectorAll(':scope>.customer-coupon-card')];
        const noteRange=document.createRange();noteRange.selectNodeContents(note);
        const noteBox=noteRange.getBoundingClientRect(),noteClear=[...legend.children].every(el=>{const b=el.getBoundingClientRect();return b.top>=noteBox.bottom||b.right<=noteBox.left||b.left>=noteBox.right});
        return {fieldMargin:getComputedStyle(field).marginTop,summaryMargin:getComputedStyle(summary).marginTop,noteClear,summaryClear:summary.getBoundingClientRect().bottom<=cards[0].getBoundingClientRect().top,overflow:root.scrollWidth>root.clientWidth+1};
      });
      const expectedMargin='0px';
      assert.deepEqual(layout,{fieldMargin:expectedMargin,summaryMargin:expectedMargin,noteClear:true,summaryClear:true,overflow:false},`checkout coupon spacing at ${width}px`);
      const offerAlignment=await page.evaluate(()=>{
        const textBox=node=>{const range=document.createRange();range.selectNodeContents(node);return range.getClientRects()[0]};
        const toggle=textBox(document.querySelector('#customerWalletCheckout .customer-coupon-toggle>span'));
        const summary=textBox(document.querySelector('#customerWalletCheckout .checkout-history-toggle>span'));
        const rules=document.querySelector('.checkout-offer-rules').getBoundingClientRect(),optOut=document.querySelector('.checkout-coupon-opt-out').getBoundingClientRect();
        return {aligned:Math.abs(toggle.top-summary.top)<=1,rulesClear:rules.bottom<=optOut.top};
      });
      assert.deepEqual(offerAlignment,{aligned:true,rulesClear:true},`coupon link alignment and rule copy ${width}px`);
      assert.deepEqual(await availableToggle.evaluate(el=>{const s=getComputedStyle(el);return [s.paddingTop,s.paddingBottom,s.marginTop,s.marginBottom];}),['3px','3px','0px','0px'],`coupon toggle spacing at ${width}px`);
      const history=page.locator('#customerWalletCheckout .customer-coupon-history');
      await historyToggle.click();
      assert.equal(await historyToggle.getAttribute('aria-expanded'),'true');
      assert.equal(await historyToggle.getAttribute('aria-controls'),await history.getAttribute('id'));
      const expanded=await page.evaluate(()=>{
        const root=document.querySelector('#customerWalletCheckout'),summary=root.querySelector('.checkout-history-toggle'),cards=[...root.querySelectorAll('.customer-coupon-history>.customer-coupon-card')],promo=document.querySelector('#promotionChoice');
        const left=root.querySelector('.customer-coupon-toggle').getBoundingClientRect(),right=summary.getBoundingClientRect(),firstAvailable=root.querySelector('fieldset>.customer-coupon-card').getBoundingClientRect();
        return {summaryBottom:getComputedStyle(summary).marginBottom,bodyBottom:getComputedStyle(cards[0].querySelector('.customer-coupon-body')).marginBottom,promoTop:getComputedStyle(promo).marginTop,summaryClear:right.bottom<=cards[0].getBoundingClientRect().top,controlsAbove:left.bottom<=firstAvailable.top&&right.bottom<=firstAvailable.top,aligned:Math.abs(left.top-right.top)<=1&&left.right<=right.left,promoClear:promo.getBoundingClientRect().top>=cards.at(-1).getBoundingClientRect().bottom,reasonsInside:cards.every(c=>c.querySelector('.customer-coupon-reason').getBoundingClientRect().bottom<=c.getBoundingClientRect().bottom)};
      });
      assert.deepEqual(expanded,{summaryBottom:'0px',bodyBottom:'0px',promoTop:'0px',summaryClear:true,controlsAbove:true,aligned:true,promoClear:true,reasonsInside:true},`expanded coupons at ${width}px`);
      if(process.env.TINGS_ACCOUNT_SCREENSHOT&&width===1710){await historyToggle.scrollIntoViewIfNeeded();await page.screenshot({path:process.env.TINGS_ACCOUNT_SCREENSHOT.replace('.png','-expanded.png')})}
      await historyToggle.click();
      if(process.env.TINGS_ACCOUNT_SCREENSHOT&&width===1710){await page.locator('#customerWalletCheckout legend').scrollIntoViewIfNeeded();await page.screenshot({path:process.env.TINGS_ACCOUNT_SCREENSHOT.replace('.png','-heading.png')})}
    }
    await page.setViewportSize({width:390,height:844});
    const foldedCoupons=page.locator('#customerWalletCheckout .customer-coupon-history');
    assert.equal(await historyToggle.getAttribute('aria-expanded'),'false');
    assert.equal(await foldedCoupons.isVisible(),false);
    assert.equal(await page.locator('#promotionChoice').isVisible(),true);
    await page.evaluate(()=>{__accountTest.originalCouponContext=window.TingsCouponContext;window.TingsCouponContext=()=>({...__accountTest.originalCouponContext(),subtotal:10});window.dispatchEvent(new Event('tings:coupon-context'))});
    assert.equal(await page.locator('#customerWalletCheckout>fieldset>.customer-coupon-card').count(),0);
    assert.equal(await page.locator('#customerWalletCheckout [data-code="TEN"]').isVisible(),false);
    await historyToggle.click();
    assert.match(await page.textContent('#customerWalletCheckout [data-code="TEN"] .customer-coupon-reason'),/达到使用门槛/);
    await page.evaluate(()=>window.dispatchEvent(new Event('tings:coupon-context')));
    assert.equal(await historyToggle.getAttribute('aria-expanded'),'true');
    assert.equal(await foldedCoupons.isVisible(),true);
    await historyToggle.click();
    await page.evaluate(()=>{window.TingsCouponContext=__accountTest.originalCouponContext;window.dispatchEvent(new Event('tings:coupon-context'))});
    assert.equal(await page.locator('#customerWalletCheckout>fieldset>[data-code="TEN"]').isVisible(),true);
    assert.ok(await page.locator('#customerWalletCheckout>fieldset>[data-code="TEN"] .customer-coupon-body').evaluate(el=>el.getBoundingClientRect().height>=100));
    await page.check('#customerWalletCheckout input[value="RWD-ALICE"]');
    assert.equal(await page.inputValue('#couponCodeInput'),'RWD-ALICE');
    assert.equal(await page.locator('#promotionChoice').isVisible(),true);
    assert.equal(await page.inputValue('#manualCouponCode'),'','selected coupon code is not exposed in the optional entry field');
    assert.equal(await page.locator('#couponCodeInput').isEnabled(),true);
    assert.equal(await page.locator('#customerWalletCheckout>fieldset>.customer-coupon-card:visible').count(),1,'only selected coupon stays expanded');
    await availableToggle.click();
    await page.check('#customerWalletCheckout input[value="TEN"]');
    assert.equal(await page.locator('#customerWalletCheckout input:checked').count(),1);
    assert.equal(await page.inputValue('#couponCodeInput'),'TEN');
    await page.waitForFunction(()=>document.querySelector('#couponCodeHint').classList.contains('valid'));
    assert.match(await page.textContent('#orderSummary .order-amounts'),/优惠券：推荐奖励券/);
    assert.equal(await page.locator('#customerWalletCheckout [data-code="TEN"]').evaluate(el=>el.classList.contains('is-selected')),true);
    assert.equal(await page.locator('#customerWalletCheckout [data-code="TEN"]').evaluate(el=>getComputedStyle(el).backgroundColor),'rgb(255, 207, 202)');
    await page.selectOption('#fulfillment','pickup');
    assert.equal(await page.locator('#customerWalletCheckout input[value="TEST-SHIPPING"]').isDisabled(),true);
    assert.match(await page.textContent('#customerWalletCheckout [data-code="TEST-SHIPPING"] .customer-coupon-reason'),/仅配送/);
    assert.equal(await foldedCoupons.locator('[data-code="TEST-SHIPPING"]').count(),1);
    assert.equal(await foldedCoupons.locator('[data-code="TEST-SHIPPING"]').evaluate(el=>getComputedStyle(el).backgroundColor),'rgb(244, 243, 237)');
    assert.equal(await page.locator('#customerWalletCheckout [data-code="TEST-SHIPPING"]').isVisible(),false);
    await page.selectOption('#fulfillment','delivery');
    await availableToggle.click();
    await page.check('#customerWalletCheckout input[value="TEST-SHIPPING"]');
    await page.waitForFunction(()=>document.querySelector('#couponCodeHint').textContent.includes('减免整笔配送费'));
    assert.equal(await page.textContent('#orderSummary .fee-value b'),'$0.00');
    assert.equal(await page.evaluate(()=>__accountTest.calls.filter(c=>c.name==='preview_account_offer_v2').at(-1).args.p_fulfillment),'delivery');
    const visibleCouponHeights=await page.locator('#customerWalletCheckout>fieldset>.customer-coupon-card:visible').evaluateAll(cards=>cards.map(c=>({code:c.dataset.code,height:c.getBoundingClientRect().height,body:c.querySelector('.customer-coupon-body')?.getBoundingClientRect().height,html:c.innerHTML.slice(0,120)})));
    assert.ok(visibleCouponHeights.every(c=>c.height>=100),JSON.stringify({cards:visibleCouponHeights,style:await page.locator('#customerWalletCheckout>fieldset>.customer-coupon-card').first().evaluate(c=>{const b=c.querySelector('.customer-coupon-body'),s=getComputedStyle(b);return {display:s.display,visibility:s.visibility,contentVisibility:s.contentVisibility,height:s.height,minHeight:s.minHeight,card:getComputedStyle(c).contentVisibility,html:c.outerHTML}})}));
    if(process.env.TINGS_ACCOUNT_SCREENSHOT)await page.screenshot({path:process.env.TINGS_ACCOUNT_SCREENSHOT.replace('.png','-shipping.png')});
    await page.selectOption('#fulfillment','pickup');
    await page.waitForFunction(()=>document.querySelector('#couponCodeHint').textContent.includes('仅配送'));
    assert.equal(await foldedCoupons.locator('[data-code="TEST-SHIPPING"]').count(),1);
    await page.check('#customerWalletCheckout input[value=""]');
    assert.equal(await page.locator('#promotionChoice').isVisible(),true);
    assert.equal(await page.inputValue('#couponCodeInput'),'');
    assert.equal(await availableToggle.getAttribute('aria-expanded'),'false');
    assert.equal(await page.locator('#customerWalletCheckout>fieldset>.customer-coupon-card:visible').count(),0);
    await page.evaluate(()=>window.dispatchEvent(new Event('tings:coupon-context')));
    assert.equal(await availableToggle.getAttribute('aria-expanded'),'false');
    await availableToggle.click();
    await page.check('#customerWalletCheckout input[value="RWD-ALICE"]');
    assert.equal(await page.inputValue('#couponCodeInput'),'RWD-ALICE');
    assert.equal(await availableToggle.isVisible(),true);
    assert.match(await availableToggle.textContent(),/更换优惠券|收起优惠券/);
    await page.check('#customerWalletCheckout input[value=""]');
    assert.equal(await page.locator('#customerWalletCheckout>fieldset>.customer-coupon-card:visible').count(),0);
    for(const width of responsiveWidths([320,390,780,781,1710])){
      await page.setViewportSize({width,height:1000});
      const collapsedLayout=await page.evaluate(()=>{
        const root=document.querySelector('#customerWalletCheckout'),toggle=root.querySelector('.customer-coupon-toggle'),summary=root.querySelector('.checkout-history-toggle'),promo=document.querySelector('#promotionChoice>label');
        const a=toggle.getBoundingClientRect(),b=summary.getBoundingClientRect();
        return {toggleClear:a.bottom<=b.top||a.right<=b.left,promoClear:b.bottom<=promo.getBoundingClientRect().top,overflow:root.scrollWidth>root.clientWidth+1};
      });
      assert.deepEqual(collapsedLayout,{toggleClear:true,promoClear:true,overflow:false},`collapsed coupons at ${width}px`);
      if(process.env.TINGS_ACCOUNT_SCREENSHOT&&width===1710){await availableToggle.scrollIntoViewIfNeeded();await page.screenshot({path:process.env.TINGS_ACCOUNT_SCREENSHOT.replace('.png','-collapsed-desktop.png')})}
    }
    await page.setViewportSize({width:390,height:844});
    await page.fill('#manualCouponCode','MANUAL');
    await page.click('#applyCouponCode');
    assert.equal(await page.inputValue('#couponCodeInput'),'MANUAL');
    assert.equal(await page.locator('#customerWalletCheckout input:checked').count(),0);
    assert.ok(await page.locator('#orderDialog').evaluate(el=>el.scrollWidth<=el.clientWidth+1));
    if(process.env.TINGS_ACCOUNT_SCREENSHOT)await page.screenshot({path:process.env.TINGS_ACCOUNT_SCREENSHOT.replace('.png','-wallet-checkout.png')});
    await page.click('#closeDialog');
    await page.evaluate(()=>{settings.delivery_fee=__accountTest.originalFee});
    await page.evaluate(()=>{__accountTest.wallet=null;__accountTest.walletError=true});
    await openCustomerAccount();await page.click('[data-account-tab=rewards]');
    await page.waitForFunction(()=>document.querySelector('#customerRewardsPanel').textContent.includes('暂时无法加载'));
    assert.equal(await page.locator('#customerRewardsPanel .customer-coupon-card').count(),0);
    await page.evaluate(()=>{__accountTest.walletError=false});
    await page.click('#customerRewardsPanel button');
    await page.waitForFunction(()=>document.querySelector('#customerRewardsPanel').textContent.includes('我的推荐码'));
    await page.evaluate(()=>{__accountTest.delayWallet=true});
    await page.click('#customerAccountBack');await page.click('[data-account-tab=rewards]');
    await page.waitForFunction(()=>!!__accountTest.resolveWallet);
    await page.evaluate(()=>{
      const finish=__accountTest.resolveWallet;__accountTest.delayWallet=false;
      __accountTest.change({access_token:'customer-token-bob@example.test',user:{id:'bob@example.test',email:'bob@example.test'}});
      finish();
    });
    await page.waitForFunction(()=>document.querySelector('#customerAccountEmail').textContent.includes('bob@example.test'));
    assert.equal(await page.textContent('#customerRewardsPanel'),'');
    await page.evaluate(()=>__accountTest.change({access_token:'customer-token-alice@example.test',user:{id:'alice@example.test',email:'alice@example.test'}}));
    await page.waitForFunction(()=>document.querySelector('#customerAccountEmail').textContent.includes('alice@example.test'));
    await page.click('[data-account-tab=orders]');
    await page.waitForSelector('#customerOrders .lookup-order-card');
    // Refresh UI uses the existing request lifecycle, including rapid-click protection.
    const refreshCount = () => page.evaluate(()=>__accountTest.calls.filter(c=>c.name==='get_my_customer_orders').length);
    const callsBeforeRefresh = await refreshCount();
    await page.evaluate(()=>{
      __accountTest.delayed=true; delete __accountTest.resolveOrders;
    });
    await page.click('#customerRefreshOrders');
    await page.waitForFunction(()=>typeof __accountTest.resolveOrders==='function');
    assert.equal(await page.locator('#customerRefreshOrders').isDisabled(),true);
    assert.equal(await page.getAttribute('#customerRefreshOrders','aria-busy'),'true');
    assert.equal(await page.locator('#customerRefreshOrders svg').evaluate(el=>getComputedStyle(el).animationIterationCount),'infinite');
    const spinning = await page.locator('#customerRefreshOrders svg').evaluate(el=>getComputedStyle(el).transform);
    await page.waitForFunction(old=>getComputedStyle(document.querySelector('#customerRefreshOrders svg')).transform!==old,spinning);
    await page.evaluate(()=>{for(let i=0;i<8;i++)document.querySelector('#customerRefreshOrders').click()});
    assert.equal(await refreshCount(),callsBeforeRefresh+1,'rapid clicks must not issue duplicate order requests');
    await page.emulateMedia({reducedMotion:'reduce'});
    assert.equal(await page.locator('#customerRefreshOrders svg').evaluate(el=>getComputedStyle(el).animationName),'none');
    await page.emulateMedia({reducedMotion:'no-preference'});
    await page.evaluate(()=>{__accountTest.delayed=false;__accountTest.resolveOrders()});
    await page.waitForFunction(()=>!document.querySelector('#customerRefreshOrders').disabled);
    assert.equal(await page.getAttribute('#customerRefreshOrders','aria-busy'),'false');
    assert.equal(await page.locator('#customerRefreshOrders svg').evaluate(el=>getComputedStyle(el).animationName),'none');
    assert.equal(await page.locator('#customerOrderUpdated').count(),0);
    assert.equal(await page.locator('#customerOrders .lookup-order-card img').count(),0);
    assert.equal(await page.evaluate(()=>window.xss),undefined);
    await page.click('#customerOrders [data-show-cancel]');
    assert.equal(await page.locator('#customerOrders [name=cancelPhone]').count(),0);
    await page.fill('#customerOrders [name=cancelReason]','测试取消');
    assert.equal(await page.textContent('#customerOrders .lookup-cancel-count'),'4 / 100');
    await page.evaluate(()=>{__accountTest.cancelError=true});
    await page.click('#customerOrders .lookup-cancel-submit');
    await page.waitForFunction(()=>document.querySelector('#customerAccountMessage').textContent.includes('取消申请未提交'));
    assert.equal(await page.inputValue('#customerOrders [name=cancelReason]'),'测试取消');
    await page.evaluate(()=>{__accountTest.cancelError=false});
    await page.click('#customerOrders .lookup-cancel-submit');
    await page.waitForFunction(()=>document.querySelector('#customerOrders').textContent.includes('取消申请中'));
    assert.equal(await page.evaluate(()=>__accountTest.calls.some(c=>c.name==='request_order_cancellation_v2')),false);
    await page.click('#customerAccountBack');await page.click('[data-account-tab=details]');
    await page.waitForFunction(()=>!document.querySelector('#customerDetailsStatus').textContent.includes('正在'));
    assert.equal(await page.locator('#customerDiscardDetails, #customerReloadDetails, #customerDetailsForm > small').count(),0);
    assert.equal(await page.locator('#customerDetailsPanel').getByText('默认资料会自动填写结算页的空白项。',{exact:false}).count(),0);
    assert.equal(await page.textContent('#customerDetailsStatus'),'');
    assert.equal(await page.locator('#customerDetailsStatus').isVisible(),false);
    assert.equal(await page.locator('#customerSaveDetails').isDisabled(),true);
    assert.equal(await page.textContent('#customerSaveDetails'),'保存资料');
    assert.match(await page.locator('#customerIdentityEmail').locator('..').textContent(),/不可更改/);
    await page.fill('#customerDetailsForm [name=full_name]','Alice');
    await page.fill('#customerDetailsForm [name=phone]','3125550100');
    await page.fill('#customerDetailsForm [name=address]','Saved address');
    await page.fill('#customerDetailsForm [name=unit]','2B');
    await page.fill('#customerDetailsForm [name=city]','Chicago');
    await page.fill('#customerDetailsForm [name=state]','il');
    await page.fill('#customerDetailsForm [name=zip]','60601-1234');
    assert.equal(await page.locator('#customerSaveDetails').isEnabled(),true);
    assert.equal(await page.inputValue('#customerIdentityEmail'),'alice@example.test');
    assert.equal(await page.locator('#customerIdentityEmail').isEditable(),false);
    await page.click('#customerDetailsForm [type=submit]');
    await page.waitForFunction(()=>document.querySelector('#customerAccountMessage').textContent.includes('已保存'));
    assert.equal(await page.textContent('#customerSaveDetails'),'已保存');
    assert.equal(await page.textContent('#customerHomeDetailsStatus'),'已保存','Home badge reflects the saved complete profile');
    assert.equal(await page.locator('#customerSaveDetails').isDisabled(),true);
    for (const width of responsiveWidths([320,390,780,781,782,1100,1723])) {
      await page.setViewportSize({width,height:844});
      assert.ok(await page.locator('#customerAccountDialog').evaluate(el=>el.scrollWidth<=el.clientWidth+1));
      const detailsBack=await page.locator('#customerAccountBack').evaluate(el=>{
        const s=getComputedStyle(el),r=el.getBoundingClientRect(),title=document.querySelector('#customerAccountTitle').getBoundingClientRect();
        return {width:r.width,height:r.height,fontSize:s.fontSize,padding:[s.paddingTop,s.paddingRight,s.paddingBottom,s.paddingLeft],
          clear:r.left>=title.right,clickable:document.elementFromPoint(r.left+r.width/2,r.top+r.height/2)===el};
      });
      assert.deepEqual(detailsBack,{width:70,height:40,fontSize:'15px',padding:['0px','0px','0px','0px'],clear:true,clickable:true},`details back at ${width}px`);
      assert.equal(await page.locator('#customerDetailsStatus').isVisible(),false);
      if(process.env.TINGS_ACCOUNT_SCREENSHOT && [390,1723].includes(width))await page.locator('#customerAccountDialog').screenshot({path:process.env.TINGS_ACCOUNT_SCREENSHOT.replace('.png',`-details-${width}.png`)});
      const spacing=await page.locator('#customerDetailsForm').evaluate(form=>{
        const label=name=>form.querySelector(`[name="${name}"]`).closest('label');
        const margin=node=>[getComputedStyle(node).marginTop,getComputedStyle(node).marginBottom];
        const rows=['full_name','phone','address','unit','city','state'].map(name=>label(name).getBoundingClientRect());
        rows.push(form.querySelector('#customerIdentityEmail').closest('label').getBoundingClientRect());
        return {phone:margin(label('phone')),unit:margin(label('unit')),region:margin(form.querySelector('.customer-address-region')),
          regionHeight:form.querySelector('.customer-address-region').getBoundingClientRect().height,
          noOverlap:rows.every((row,i)=>!i||row.top>=rows[i-1].bottom+1),
          stateZipAligned:Math.abs(label('state').getBoundingClientRect().top-label('zip').getBoundingClientRect().top)<1};
      });
      assert.deepEqual(spacing,{phone:['-15px','-15px'],unit:['-15px','-15px'],region:['-32px','-20px'],regionHeight:85,noOverlap:true,stateZipAligned:true},`address spacing at ${width}px`);
      const density=await page.locator('#customerDetailsForm').evaluate(form=>{
        const style=getComputedStyle(form),dialogStyle=getComputedStyle(form.closest('dialog'));
        const status=getComputedStyle(document.querySelector('#customerDetailsStatus')),address=form.querySelector('[name=address]');
        return {formMargins:[style.marginTop,style.marginBottom],statusMargins:[status.marginTop,status.marginBottom],
          padding:[dialogStyle.paddingTop,dialogStyle.paddingBottom],inputMargins:[...form.querySelectorAll('input')].map(el=>getComputedStyle(el).marginTop),
          addressHeight:address.getBoundingClientRect().height,resize:getComputedStyle(address).resize};
      });
      assert.deepEqual(density,{formMargins:['0px','0px'],statusMargins:['0px','0px'],padding:['20px','20px'],inputMargins:Array(7).fill('0px'),addressHeight:44,resize:'vertical'},`address density at ${width}px`);
    }
    await page.setViewportSize({width:390,height:1000});
    await page.locator('#customerAccountDialog').evaluate(el=>{el.scrollTop=0});
    if(process.env.TINGS_ACCOUNT_SCREENSHOT)await page.screenshot({path:process.env.TINGS_ACCOUNT_SCREENSHOT.replace('.png','-address-v2.png')});
    await closeCustomerAccount();
    await page.click('#openCart');await page.click('#checkout');
    assert.equal(await page.inputValue('#orderForm [name=name]'),'Alice');
    assert.equal(await page.inputValue('#orderForm [name=address]'),'Saved address, Unit 2B, Chicago IL 60601-1234');
    assert.equal(await page.locator('#checkoutAutofillBadge').isVisible(),true);
    assert.equal(await page.locator('#checkoutEmailBadge').isVisible(),true);
    await page.fill('#orderForm [name=email]','different@example.test');
    assert.equal(await page.locator('#checkoutEmailBadge').isVisible(),false,'edited email must not pretend to be account-bound');
    await page.fill('#orderForm [name=email]','alice@example.test');
    await checkCheckoutLayout('account');
    assert.equal((await page.evaluate(()=>TingsAccount.checkoutHeaders())).Authorization,'Bearer customer-token-alice@example.test');
    await page.fill('#orderForm [name=name]','Manually entered');
    const profileSaves=await page.evaluate(()=>__accountTest.calls.filter(c=>c.name==='save_my_customer_details_v2').length);
    await page.fill('#orderForm [name=address]','Temporary delivery address');
    await page.evaluate(()=>dispatchEvent(new Event('tings:checkout-open')));
    assert.equal(await page.inputValue('#orderForm [name=name]'),'Manually entered');
    assert.equal(await page.inputValue('#orderForm [name=address]'),'Temporary delivery address');
    assert.equal(await page.evaluate(()=>__accountTest.profile['alice@example.test'].address),'Saved address');
    assert.equal(await page.evaluate(()=>__accountTest.calls.filter(c=>c.name==='save_my_customer_details_v2').length),profileSaves);
    assert.equal(await page.evaluate(()=>Object.keys(__accountTest.calls.find(c=>c.name==='save_my_customer_details_v2').args).some(key=>/email|user_id/.test(key))),false);
    await page.evaluate(()=>{
      settings.content.storeSettings.profile={phone:'312-826-1822',email:'shop@example.test'};
      document.querySelector('#orderForm').requestSubmit();
    });
    await page.waitForFunction(()=>__accountTest.calls.filter(c=>c.name==='submit-order').length===2);
    const submission=await page.evaluate(()=>__accountTest.calls.filter(c=>c.name==='submit-order').at(-1));
    assert.equal(submission.headers.Authorization,'Bearer customer-token-alice@example.test');
    assert.equal('p_user_id' in submission.body,false);
    assert.equal(await page.textContent('#submittedFulfillmentLabel'),'配送');
    assert.equal(await page.textContent('#submittedFulfillmentNote'),'Temporary delivery address');
    assert.equal(await page.getAttribute('#submittedFulfillmentIcon','data-kind'),'delivery');
    assert.equal(await page.locator('.success-progress-note').count(),0);
    assert.equal(await page.textContent('#viewSubmittedOrder'),'我的订单');
    assert.equal(await page.textContent('#copySubmittedOrderLabel'),'复制订单号');
    await page.setViewportSize({width:1710,height:1180});
    const successLayout=await page.evaluate(()=>{
      const style=selector=>getComputedStyle(document.querySelector(selector));
      const dialogNode=document.querySelector('#orderDialog'),dialog=style('#orderDialog'),hero=style('.order-success>.success-hero'),
        close=document.querySelector('#closeDialog').getBoundingClientRect(),fulfillment=document.querySelector('#submittedFulfillmentNote').parentElement,
        label=fulfillment.querySelector('dt').getBoundingClientRect(),address=fulfillment.querySelector('dd').getBoundingClientRect();
      return {dialogPadding:[dialog.paddingTop,dialog.paddingBottom],heroPadding:[hero.paddingTop,hero.paddingBottom],
        referralSize:style('#successReferralReward .success-referral-line').fontSize,codeSize:style('#submittedReferralCode').fontSize,
        radius:dialog.borderRadius,close:[Math.round(close.width),Math.round(close.height)],labelWidth:Math.round(label.width),
        addressWidth:Math.round(address.width),orderNumberSize:style('#submittedOrderNumber').fontSize,
        overflow:dialogNode.scrollWidth>dialogNode.clientWidth+1};
    });
    assert.deepEqual(successLayout,{dialogPadding:['20px','20px'],heroPadding:['0px','0px'],referralSize:'17px',codeSize:'16px',
      radius:'15px',close:[50,50],labelWidth:80,addressWidth:330,orderNumberSize:'15px',overflow:false});
    for(const width of responsiveWidths([320,390,780])){
      await page.setViewportSize({width,height:844});
      const mobileSuccessLayout=await page.evaluate(()=>{
        const dialog=document.querySelector('#orderDialog'),close=document.querySelector('#closeDialog').getBoundingClientRect(),
          row=document.querySelector('#submittedFulfillmentNote').parentElement,label=row.querySelector('dt').getBoundingClientRect(),
          address=row.querySelector('dd'),addressBox=address.getBoundingClientRect();
        return {radius:getComputedStyle(dialog).borderRadius,close:[Math.round(close.width),Math.round(close.height)],
          labelWidth:Math.round(label.width),orderNumberSize:getComputedStyle(document.querySelector('#submittedOrderNumber')).fontSize,
          addressWrap:getComputedStyle(address).whiteSpace,addressFits:address.scrollWidth<=address.clientWidth+1,
          rowFits:row.scrollWidth<=row.clientWidth+1,addressInside:addressBox.right<=row.getBoundingClientRect().right+1,
          dialogFits:dialog.scrollWidth<=dialog.clientWidth+1};
      });
      assert.deepEqual(mobileSuccessLayout,{radius:'15px',close:[50,50],labelWidth:80,orderNumberSize:'15px',addressWrap:'normal',
        addressFits:true,rowFits:true,addressInside:true,dialogFits:true},`mobile success ${width}px`);
    }
    await page.setViewportSize({width:1710,height:1180});
    await page.click('#contactShop');
    assert.equal(await page.textContent('#successContactDetails'),'电话：312-826-1822\n邮箱：shop@example.test');
    assert.equal(await page.locator('#successContactDetails').evaluate(el=>getComputedStyle(el).whiteSpace),'pre-line');
    assert.equal(await page.locator('#successContactDetails').evaluate(el=>getComputedStyle(el).borderRadius),'10px');
    await page.click('#copySubmittedOrder');
    await page.waitForFunction(()=>document.querySelector('#copySubmittedOrderLabel').textContent==='已复制订单号');
    assert.equal(await page.textContent('#copySubmittedOrderLabel'),'已复制订单号');
    await page.click('#viewSubmittedOrder');
    await page.waitForSelector('#customerOrdersPanel:not([hidden])');
    assert.equal(await page.textContent('#customerAccountTitle'),'我的订单');
    assert.equal(await page.locator('#orderDialog').evaluate(el=>el.open),false);
    await closeCustomerAccount();
    await page.click('#productGrid .add');await page.click('#openCart');await page.click('#checkout');
    await page.evaluate(()=>{__accountTest.expired=true});
    assert.match(await page.evaluate(()=>TingsAccount.checkoutHeaders().catch(e=>e.message)),/登录已失效/);
    await page.evaluate(()=>{__accountTest.expired=false;__accountTest.change(null)});
    await page.waitForFunction(()=>document.querySelector('#openCustomerAccount').textContent==='登录账户');
    assert.equal(await page.textContent('#activityWelcomeAction'),'立即领取');
    assert.equal(await page.textContent('#activityWelcomeOffer'),'登录领取新人专属优惠');
    assert.equal(await page.inputValue('#orderForm [name=email]'),'');
    assert.match(await page.evaluate(()=>TingsAccount.checkoutHeaders().catch(e=>e.message)),/账户已改变/);
    await page.click('#closeDialog');

    // A late order response from Alice must not appear after switching to Bob.
    await page.evaluate(()=>{__accountTest.change({access_token:'a',user:{id:'alice@example.test',email:'alice@example.test'}})});
    await openCustomerAccount();
    await page.click('[data-account-tab=orders]');
    await page.waitForSelector('#customerOrders .lookup-order-card');
    await page.evaluate(()=>{__accountTest.delayed=true});
    await page.click('#customerRefreshOrders');
    await page.waitForFunction(()=>typeof __accountTest.resolveOrders==='function');
    assert.match(await page.textContent('#customerOrders'),/正在加载/);
    assert.equal(await page.getAttribute('#customerOrders','aria-busy'),'true');
    await page.evaluate(()=>{
      const resolve=__accountTest.resolveOrders;__accountTest.delayed=false;
      __accountTest.change({access_token:'b',user:{id:'bob@example.test',email:'bob@example.test'}});resolve();
    });
    await page.waitForSelector('#customerHomePanel:not([hidden])');
    await page.click('[data-account-tab=orders]');
    await page.waitForFunction(()=>document.querySelector('#customerOrders').textContent.includes('TSH-bob'));
    assert.equal((await page.textContent('#customerOrders')).includes('TSH-alice'),false);
    await page.reload();await openCustomerAccount();
    await page.waitForSelector('#customerSignedIn:not([hidden])');
    assert.equal(await page.textContent('#customerAccountEmail'),'你好，bob@example.test');
    // Distinguish an empty result from a failed request, and support a safe expiry/relogin flow.
    await page.evaluate(()=>{__accountTest.orders=[]});
    await page.click('[data-account-tab=orders]');
    await page.waitForFunction(()=>document.querySelector('#customerOrders').textContent.includes('还没有账户订单'));
    await page.evaluate(()=>{__accountTest.ordersError=true});await page.click('#customerRefreshOrders');
    await page.waitForFunction(()=>document.querySelector('#customerOrders').textContent.includes('检查网络'));
    assert.equal(await page.locator('#customerOrderSearch').isDisabled(),true);
    assert.equal(await page.getAttribute('#customerOrders','aria-busy'),'false');
    assert.equal(await page.locator('#customerRefreshOrders').isDisabled(),false);
    assert.equal(await page.getAttribute('#customerRefreshOrders','aria-busy'),'false');
    assert.equal(await page.locator('#customerRefreshOrders svg').evaluate(el=>getComputedStyle(el).animationName),'none');
    await page.evaluate(()=>{__accountTest.ordersError=false});await page.click('#customerRefreshOrders');
    await page.waitForFunction(()=>document.querySelector('#customerOrders').textContent.includes('还没有账户订单'));
    await page.click('#customerAccountBack');await page.click('[data-account-tab=details]');
    await page.fill('#customerDetailsForm [name=unit]','Unsaved 2B');
    await page.evaluate(()=>{__accountTest.expired=true});await page.click('#customerDetailsForm [type=submit]');
    await page.waitForFunction(()=>document.querySelector('#customerAccountMessage').textContent.includes('登录已过期'));
    assert.equal(await page.inputValue('#customerDetailsForm [name=unit]'),'Unsaved 2B');
    assert.equal(await page.locator('#customerDetailsForm [type=submit]').isDisabled(),true);
    page.once('dialog',dialog=>dialog.dismiss());await page.click('#customerReauthenticate');
    assert.equal(await page.inputValue('#customerDetailsForm [name=unit]'),'Unsaved 2B');
    page.once('dialog',dialog=>dialog.accept());await page.click('#customerReauthenticate');
    await page.waitForSelector('#customerSignedOut:not([hidden])');
    await page.evaluate(()=>{__accountTest.expired=false;__accountTest.change({access_token:'b',user:{id:'bob@example.test',email:'bob@example.test'}})});
    await page.waitForSelector('#customerSignedIn:not([hidden])');
    // Account-only controls live inside the shared card, without changing guest lookup cards.
    await page.evaluate(()=>{
      __accountTest.orders=[{id:'layout-order',order_number:'TSH-260912-EE019',created_at:'2026-09-11T12:00:00Z',status:'待确认',
        fulfillment:'delivery',address:'Test address',subtotal:10,total_amount:10,items:[{product_id:1,name:'测试零食',qty:2,price:5}]}];
      Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async text=>{window.__copiedOrder=text}}});
    });
    assert.equal(await page.locator('#customerHomePanel').isVisible(),true);
    await page.click('[data-account-tab=orders]');
    await page.waitForFunction(()=>document.querySelector('#customerOrders').textContent.includes('TSH-260912-EE019'));
    for (const width of responsiveWidths([320,360,375,390,414,768,780,781,782,1100,1710])) {
      await page.setViewportSize({width,height:1180});
      await assertAccountBack('orders',width);
      const heading=await page.evaluate(()=>{
        const title=document.querySelector('#customerAccountTitle').getBoundingClientRect();
        const back=document.querySelector('#customerAccountBack'),r=back.getBoundingClientRect();
        const heading=document.querySelector('.customer-account-heading').getBoundingClientRect();
        const tools=document.querySelector('#customerOrderRefresh'),refresh=document.querySelector('#customerRefreshOrders').getBoundingClientRect();
        return {label:back.textContent,afterTitle:r.left>=title.right,atRight:Math.abs(r.right-heading.right)<1,
          sameRow:Math.abs(r.top+r.height/2-title.top-title.height/2)<1,
          toolsInHeading:tools.closest('.customer-account-heading')!==null,
          toolsClear:refresh.left>=title.right && refresh.right<=r.left-4 && refresh.bottom<=heading.bottom+1,
          desktopInline:innerWidth<=780 || Math.abs(refresh.top+refresh.height/2-title.top-title.height/2)<1,
          emailMargin:getComputedStyle(document.querySelector('#customerAccountEmail')).marginTop};
      });
      assert.deepEqual(heading,{label:'返回',afterTitle:true,atRight:true,sameRow:true,toolsInHeading:true,toolsClear:true,desktopInline:true,emailMargin:'0px'},`account heading at ${width}px`);
      const refreshStyle=await page.locator('#customerRefreshOrders').evaluate(button=>{
        const s=getComputedStyle(button),r=button.getBoundingClientRect();
        return {color:s.color,background:s.backgroundColor,fontSize:s.fontSize,radius:s.borderRadius,border:s.borderTopColor,
          padding:[s.paddingTop,s.paddingRight,s.paddingBottom,s.paddingLeft],width:Math.round(r.width),height:Math.round(r.height),overflow:button.scrollWidth>button.clientWidth+1};
      });
      assert.deepEqual(refreshStyle,{color:'rgb(215, 91, 75)',background:'rgb(255, 255, 255)',fontSize:'15px',radius:'8px',border:'rgb(215, 91, 75)',padding:['0px','5px','0px','5px'],width:94,height:36,overflow:false},`refresh button at ${width}px`);
      assert.equal(await page.locator('#customerAccountDialog').evaluate(el=>el.scrollWidth<=el.clientWidth),true,`dialog overflow at ${width}px`);
      if(process.env.TINGS_ACCOUNT_SCREENSHOT && [390,1710].includes(width))await page.screenshot({path:process.env.TINGS_ACCOUNT_SCREENSHOT.replace('.png',`-refresh-${width}.png`)});
      const compactOrders=await page.evaluate(()=>{
        const root=document.querySelector('#customerAccountDialog'),email=document.querySelector('#customerAccountEmail'),note=document.querySelector('#customerOrdersPanel>p.customer-muted');
        const rootStyle=getComputedStyle(root),noteStyle=getComputedStyle(note);
        const close=root.querySelector('#customerAccountBack').getBoundingClientRect();
        return {padding:[rootStyle.paddingTop,rootStyle.paddingBottom],margin:[noteStyle.marginTop,noteStyle.marginBottom],color:getComputedStyle(email).color,
          noteBelowEmail:note.getBoundingClientRect().top>=email.getBoundingClientRect().bottom,
          closeInside:close.top>=root.getBoundingClientRect().top+6};
      });
      assert.deepEqual(compactOrders,{padding:['20px','20px'],margin:['-10px','-10px'],color:'rgb(0, 0, 0)',noteBelowEmail:true,closeInside:true},`compact orders at ${width}px`);
      const layout=await page.evaluate(()=>{
        const card=document.querySelector('#customerOrders .lookup-order-card');
        const copy=card.querySelector('.customer-copy-order'),number=copy.previousElementSibling;
        const [buy,cancel]=card.querySelector('.lookup-actions').children;
        const rect=node=>node.getBoundingClientRect();
        const a=rect(buy),b=rect(cancel),c=rect(copy),n=rect(number);
        const properties=['fontSize','fontWeight','color','backgroundColor','border','borderRadius','padding','minHeight'];
        return {sameStyle:properties.every(key=>getComputedStyle(buy)[key]===getComputedStyle(cancel)[key]),
          sameRow:Math.abs(a.y-b.y)<1&&a.right<b.left,copyAfter:c.x>=n.right&&Math.abs((c.y+c.height/2)-(n.y+n.height/2))<1,
          compact:c.height<39,overflow:card.scrollWidth>card.clientWidth+1,buyText:buy.textContent,cancelText:cancel.textContent};
      });
      assert.deepEqual(layout,{sameStyle:true,sameRow:true,copyAfter:true,compact:true,overflow:false,buyText:'再次购买',cancelText:'申请取消订单'},`account buttons at ${width}px`);
    }
    await page.getByRole('button',{name:'复制订单号',exact:true}).click();
    assert.equal(await page.evaluate(()=>window.__copiedOrder),'TSH-260912-EE019');
    assert.equal(await page.locator('#customerOrders .lookup-details').isVisible(),false);
    await page.setViewportSize({width:390,height:1180});
    if(process.env.TINGS_ACCOUNT_SCREENSHOT)await page.screenshot({path:process.env.TINGS_ACCOUNT_SCREENSHOT.replace('.png','-pending.png')});
    // Rebuy never posts an order and requires a second confirmation when the price changes.
    await page.evaluate(()=>{
      __accountTest.stock=3;
      __accountTest.orders=[{id:'bob-order',order_number:'TSH-REBUY',created_at:'2026-09-11T12:00:00Z',status:'已完成',
        fulfillment:'pickup',subtotal:10,discount_amount:0,tax_amount:0,delivery_fee:0,total_amount:10,
        items:[{product_id:1,name:'测试零食',qty:2,price:1},{product_id:999,name:'旧商品',qty:1}]}];
    });
    await page.click('#customerRefreshOrders');
    await page.waitForFunction(()=>document.querySelector('#customerOrders').textContent.includes('TSH-REBUY'));
    assert.equal(await page.locator('#customerOrders .lookup-actions > button').count(),1);
    assert.equal(await page.locator('#customerOrders .lookup-actions > button').textContent(),'再次购买');
    await page.fill('#customerOrderSearch','找不到');assert.equal(await page.locator('#customerOrders .lookup-order-card').count(),0);
    assert.equal(await page.textContent('#customerOrders'),'没有符合条件的订单。');
    for (const width of responsiveWidths([320,390,780,1100,1710])) {
      await page.setViewportSize({width,height:844});
      const empty=await page.locator('.customer-orders-no-match').evaluate(el=>{
        const s=getComputedStyle(el),r=el.getBoundingClientRect(),parent=el.parentElement.getBoundingClientRect(),ps=getComputedStyle(el.parentElement);
        const center=parent.left+(parent.width+parseFloat(ps.paddingLeft)-parseFloat(ps.paddingRight))/2;
        return {margins:[s.marginTop,s.marginBottom],centered:Math.abs(r.left+r.width/2-center)<0.5,
          inside:r.left>=parent.left&&r.right<=parent.right};
      });
      assert.deepEqual(empty,{margins:['40px','40px'],centered:true,inside:true},`empty search at ${width}px: ${JSON.stringify(empty)}`);
    }
    await page.setViewportSize({width:390,height:844});
    if(process.env.TINGS_ACCOUNT_SCREENSHOT)await page.screenshot({path:process.env.TINGS_ACCOUNT_SCREENSHOT.replace('.png','-no-match.png')});
    await page.fill('#customerOrderSearch','测试零食');assert.equal(await page.locator('#customerOrders .lookup-order-card').count(),1);
    assert.equal(await page.locator('.customer-orders-no-match').count(),0);
    await page.selectOption('#customerOrderFilter','active');assert.equal(await page.locator('#customerOrders .lookup-order-card').count(),0);
    await page.selectOption('#customerOrderFilter','completed');
    const beforeCount=Number(await page.textContent('#cartCount'));
    const beforeSubmissions=await page.evaluate(()=>__accountTest.calls.filter(c=>c.name==='submit-order').length);
    await page.getByRole('button',{name:'再次购买',exact:true}).click();
    await page.waitForSelector('.customer-reorder-preview .customer-primary');
    assert.match(await page.textContent('.customer-reorder-preview'),/已下架/);
    await page.evaluate(()=>{__accountTest.price=7});
    await page.getByRole('button',{name:'确认加入购物篮',exact:true}).click();
    await page.waitForFunction(()=>document.querySelector('.customer-reorder-preview').textContent.includes('已变化'));
    assert.equal(Number(await page.textContent('#cartCount')),beforeCount);
    assert.match(await page.textContent('.customer-reorder-preview'),/7.00/);
    await page.getByRole('button',{name:'确认加入购物篮',exact:true}).click();
    await page.waitForFunction(()=>document.querySelector('.customer-reorder-preview').textContent.includes('已加入 2 件'));
    assert.equal(Number(await page.textContent('#cartCount')),beforeCount+2);
    assert.equal(await page.evaluate(()=>__accountTest.calls.filter(c=>c.name==='submit-order').length),beforeSubmissions);
    assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('tings-snack-house-cart-v1')).items[0].qty),3);
    // Fully occupied stock cannot be added twice.
    await page.getByRole('button',{name:'再次购买',exact:true}).click();
    await page.waitForFunction(()=>document.querySelector('.customer-reorder-preview').textContent.includes('达到当前库存'));
    assert.equal(await page.getByRole('button',{name:'确认加入购物篮',exact:true}).isDisabled(),true);
    // Dirty fields survive delayed loads, failed saves and a dismissed close confirmation.
    await page.click('#customerAccountBack');
    await page.evaluate(()=>{__accountTest.delayDetails=true});
    await page.click('[data-account-tab=details]');
    await page.waitForFunction(()=>typeof __accountTest.resolveDetails==='function');
    assert.equal(await page.locator('#customerDetailsStatus').isVisible(),true);
    assert.match(await page.textContent('#customerDetailsStatus'),/正在同步/);
    await page.fill('#customerDetailsForm [name=full_name]','正在编辑的姓名');
    await page.evaluate(()=>{__accountTest.delayDetails=false;__accountTest.resolveDetails()});
    await page.waitForFunction(()=>!document.querySelector('#customerSaveDetails').disabled);
    assert.equal(await page.inputValue('#customerDetailsForm [name=full_name]'),'正在编辑的姓名');
    await page.evaluate(()=>{__accountTest.saveError=true});
    await page.click('#customerDetailsForm [type=submit]');
    await page.waitForFunction(()=>document.querySelector('#customerAccountMessage').textContent.includes('未保存'));
    assert.equal(await page.inputValue('#customerDetailsForm [name=full_name]'),'正在编辑的姓名');
    page.once('dialog',dialog=>{assert.match(dialog.message(),/未保存/);dialog.dismiss()});
    await page.click('#customerAccountBack');
    assert.equal(await page.locator('#customerDetailsPanel').isVisible(),true);
    assert.equal(await page.inputValue('#customerDetailsForm [name=full_name]'),'正在编辑的姓名');
    page.once('dialog',dialog=>dialog.dismiss());await page.keyboard.press('Escape');
    assert.equal(await page.locator('#customerAccountDialog').evaluate(el=>el.open),true);
    const savesBeforeDiscard=await page.evaluate(()=>__accountTest.calls.filter(c=>c.name==='save_my_customer_details_v2').length);
    page.once('dialog',dialog=>dialog.accept());await page.click('#customerAccountBack');
    assert.equal(await page.locator('#customerHomePanel').isVisible(),true);
    await page.click('[data-account-tab=details]');
    await page.waitForFunction(()=>!document.querySelector('#customerDetailsStatus').textContent.includes('正在'));
    assert.equal(await page.inputValue('#customerDetailsForm [name=full_name]'),'');
    assert.equal(await page.evaluate(()=>__accountTest.calls.filter(c=>c.name==='save_my_customer_details_v2').length),savesBeforeDiscard);
    assert.equal(await page.locator('#customerSaveDetails').isDisabled(),true);
    await page.evaluate(()=>{__accountTest.saveError=false});
    // A save commits its submitted snapshot, never overwriting later edits.
    await page.fill('#customerDetailsForm [name=full_name]','Saved snapshot');
    await page.evaluate(()=>{__accountTest.delaySave=true});await page.click('#customerSaveDetails');
    await page.waitForFunction(()=>typeof __accountTest.resolveSave==='function');
    await page.click('#customerAccountBack');
    assert.equal(await page.locator('#customerDetailsPanel').isVisible(),true);
    assert.match(await page.textContent('#customerAccountMessage'),/正在保存/);
    await page.fill('#customerDetailsForm [name=full_name]','Later draft');
    await page.evaluate(()=>{__accountTest.delaySave=false;__accountTest.resolveSave()});
    await page.waitForFunction(()=>!document.querySelector('#customerSaveDetails').disabled);
    assert.equal(await page.inputValue('#customerDetailsForm [name=full_name]'),'Later draft');
    assert.equal(await page.textContent('#customerSaveDetails'),'保存资料');
    assert.equal(await page.evaluate(()=>__accountTest.profile['bob@example.test'].full_name),'Saved snapshot');
    await page.click('#customerSaveDetails');
    await page.waitForFunction(()=>document.querySelector('#customerSaveDetails').textContent==='已保存');
    await page.fill('#customerDetailsForm [name=full_name]','Another draft');
    assert.equal(await page.textContent('#customerSaveDetails'),'保存资料');
    assert.equal(await page.locator('#customerSaveDetails').isEnabled(),true);
    page.once('dialog',dialog=>dialog.accept());await page.click('#customerAccountBack');
    // With the reload button removed, re-entering the view retries a failed read.
    await page.evaluate(()=>{__accountTest.detailsError=true});await page.click('[data-account-tab=details]');
    await page.waitForFunction(()=>document.querySelector('#customerAccountMessage').textContent.includes('暂时无法加载'));
    await page.click('#customerAccountBack');
    await page.evaluate(()=>{__accountTest.detailsError=false});await page.click('[data-account-tab=details]');
    await page.waitForFunction(()=>document.querySelector('#customerDetailsStatus').textContent==='' && document.querySelector('#customerSaveDetails').disabled);
    assert.equal(await page.inputValue('#customerDetailsForm [name=full_name]'),'Later draft');
    // Discard during a slow read must not resurrect the abandoned edit or cancel default-address loading.
    await page.click('#customerAccountBack');
    await page.evaluate(()=>{__accountTest.delayDetails=true;__accountTest.resolveDetails=null});
    await page.click('[data-account-tab=details]');
    await page.waitForFunction(()=>typeof __accountTest.resolveDetails==='function');
    await page.fill('#customerDetailsForm [name=full_name]','Abandoned during read');
    page.once('dialog',dialog=>dialog.accept());await page.click('#customerAccountBack');
    await page.evaluate(()=>{__accountTest.delayDetails=false;__accountTest.resolveDetails()});
    await page.waitForFunction(()=>document.querySelector('#customerDetailsStatus').textContent==='' && document.querySelector('#customerSaveDetails').disabled);
    assert.equal(await page.inputValue('#customerDetailsForm [name=full_name]'),'Later draft');
    await page.click('[data-account-tab=details]');
    await page.click('#customerAccountBack');await page.click('[data-account-tab=orders]');
    await page.waitForSelector('#customerOrders .lookup-order-card');
    await page.click('#customerOrders .lookup-order-card header');
    assert.equal(await page.locator('#customerOrders .lookup-details').isVisible(),true);
    await page.locator('#customerOrders .lookup-order-card').focus();await page.keyboard.press('Enter');
    assert.equal(await page.locator('#customerOrders .lookup-details').isVisible(),false);
    // A real held mouse click must not toggle, while keyboard access still works afterwards.
    await page.click('#customerOrders .lookup-order-label',{delay:650});
    assert.equal(await page.locator('#customerOrders .lookup-details').isVisible(),false);
    await page.locator('#customerOrders .lookup-order-card').focus();await page.keyboard.press('Enter');
    assert.equal(await page.locator('#customerOrders .lookup-details').isVisible(),true);
    await page.click('#customerOrders .lookup-order-label',{delay:650});
    assert.equal(await page.locator('#customerOrders .lookup-details').isVisible(),true);
    await page.evaluate(()=>getSelection().removeAllRanges());
    await page.click('#customerOrders .lookup-order-label');
    assert.equal(await page.locator('#customerOrders .lookup-details').isVisible(),false);
    const gestureFailures=await page.evaluate(async()=>{
      const failures=[],guestHost=document.querySelector('#lookupResult');
      guestHost.innerHTML=lookupOrderCard(__accountTest.orders[0]);
      for (const [surface,card] of [['account',document.querySelector('#customerOrders .lookup-order-card')],['lookup',guestHost.querySelector('.lookup-order-card')]]) {
        const target=card.querySelector('.lookup-order-label'),details=card.querySelector('.lookup-details');
        const pointer=(type,extra={})=>target.dispatchEvent(new PointerEvent(type,{bubbles:true,pointerId:42,pointerType:'touch',isPrimary:true,button:0,clientX:20,clientY:20,...extra}));
        const click=()=>target.dispatchEvent(new MouseEvent('click',{bubbles:true,detail:1}));
        const expect=(expanded,step)=>{if(details.hidden===expanded)failures.push(`${surface}: ${step}`)};
        for (const initial of [false,true]) {
          details.hidden=!initial;
          pointer('pointerdown');await new Promise(resolve=>setTimeout(resolve,550));pointer('pointerup');click();
          expect(initial,'touch long press');
          pointer('pointerdown');pointer('pointermove',{clientY:50});pointer('pointerup');click();
          expect(initial,'scroll or drag');
          pointer('pointerdown');pointer('pointercancel');click();expect(initial,'cancelled gesture');
          pointer('pointerdown');target.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true}));pointer('pointerup');click();expect(initial,'native context menu');
          pointer('pointerdown');pointer('pointerup');click();expect(!initial,'next tap works');
        }
        if(surface==='account') {
          details.hidden=true;
          const range=document.createRange();range.selectNodeContents(target);getSelection().removeAllRanges();getSelection().addRange(range);
          pointer('pointerdown');pointer('pointerup');click();expect(false,'text selection');
          getSelection().removeAllRanges();
        }
        details.hidden=true;card.classList.remove('is-expanded');card.setAttribute('aria-expanded','false');
      }
      guestHost.replaceChildren();return failures;
    });
    assert.deepEqual(gestureFailures,[]);
    for(const width of responsiveWidths([320,390,780,1100])){
      await page.setViewportSize({width,height:844});
      assert.ok(await page.locator('#customerAccountDialog').evaluate(el=>el.scrollWidth<=el.clientWidth+1));
      const differences = await page.evaluate(()=>{
        const accountHost=document.querySelector('#customerOrders');
        const lookupHost=document.querySelector('#lookupResult');
        const lookupDialog=document.querySelector('#orderLookupDialog');
        const lookupForm=document.querySelector('#orderLookupFormWrap');
        const issues=[];
        lookupForm.hidden=true;lookupHost.hidden=false;lookupDialog.classList.add('has-lookup-results');lookupDialog.show();
        const props=['fontFamily','fontSize','fontWeight','lineHeight','color','backgroundColor','display','gap','padding','margin','border','borderRadius','boxShadow','gridTemplateColumns'];
        for(const fulfillment of ['pickup','delivery'])for(const status of ['待确认','已确认','配送中','已完成','已取消']){
          const order={...__accountTest.orders[0],fulfillment,status,address:'123 Test Street',order_number:'TSH-260911-AB123',
            items:[{product_id:1,name:'测试零食',variant_label:'原味',qty:2,price:5,icon:'🍪'}]};
          const card=TingsOrderCards.create(order);accountHost.append(card);
          lookupHost.innerHTML=lookupOrderCard(order);
          const reference=lookupHost.querySelector('.lookup-order-card');
          for(const expanded of [false,true]){
            for(const node of [card,reference]){
              node.classList.toggle('is-expanded',expanded);node.querySelector('.lookup-details').hidden=!expanded;
            }
            const actual=[card,...card.querySelectorAll('*')].filter(el=>!el.closest('[data-cancel-form]'));
            const expected=[reference,...reference.querySelectorAll('*')].filter(el=>!el.closest('[data-cancel-form]'));
            if(actual.length!==expected.length)issues.push({fulfillment,status,expanded,error:'markup length'});
            for(let i=0;i<Math.min(actual.length,expected.length);i++){
              for(const prop of props){
                const a=getComputedStyle(actual[i])[prop],b=getComputedStyle(expected[i])[prop];
                if(a!==b)issues.push({fulfillment,status,expanded,element:actual[i].className,prop,a,b});
              }
            }
            const a=card.getBoundingClientRect(),b=reference.getBoundingClientRect();
            if(Math.abs(a.width-b.width)>1||Math.abs(a.height-b.height)>1)issues.push({fulfillment,status,expanded,dimensions:[a.width,a.height,b.width,b.height]});
          }
          const accountForm=card.querySelector('[data-cancel-form]'),guestForm=reference.querySelector('[data-cancel-form]');
          if(accountForm&&guestForm){
            for(const selector of ['.lookup-cancel-submit','.lookup-cancel-close','[name=cancelReason]']){
              const a=getComputedStyle(accountForm.querySelector(selector)),b=getComputedStyle(guestForm.querySelector(selector));
              for(const prop of props)if(a[prop]!==b[prop])issues.push({selector,prop,a:a[prop],b:b[prop]});
            }
          }
          card.remove();
        }
        lookupDialog.close();lookupDialog.classList.remove('has-lookup-results');lookupHost.replaceChildren();lookupHost.hidden=true;lookupForm.hidden=false;
        if(issues.length)issues.unshift({containers:[document.querySelector('#customerAccountDialog'),accountHost,lookupDialog,lookupHost].map(el=>({id:el.id,width:getComputedStyle(el).width,maxWidth:getComputedStyle(el).maxWidth,padding:getComputedStyle(el).padding,client:el.clientWidth,offset:el.offsetWidth,box:getComputedStyle(el).boxSizing}))});
        return issues;
      });
      assert.equal(differences.length,0,`Shared lookup/account card styling at ${width}px: ${JSON.stringify(differences.slice(0,8))}`);
    }
    await page.setViewportSize({width:390,height:844});
    if(process.env.TINGS_ACCOUNT_SCREENSHOT)await page.screenshot({path:process.env.TINGS_ACCOUNT_SCREENSHOT});
    // A confirmed reorder finishing after logout must never modify the cart.
    await page.evaluate(()=>{__accountTest.stock=10});
    await page.getByRole('button',{name:'再次购买',exact:true}).click();
    await page.waitForFunction(()=>!document.querySelector('.customer-reorder-preview .customer-primary').disabled);
    await page.evaluate(()=>{__accountTest.delayCatalog=true;delete __accountTest.resolveCatalog});
    await page.getByRole('button',{name:'确认加入购物篮',exact:true}).click();
    await page.waitForFunction(()=>typeof __accountTest.resolveCatalog==='function');
    await page.evaluate(()=>{__accountTest.change(null);__accountTest.delayCatalog=false;__accountTest.resolveCatalog()});
    await page.waitForFunction(()=>document.querySelector('#openCustomerAccount').textContent==='登录账户');
    assert.equal(Number(await page.textContent('#cartCount')),3);
    await page.evaluate(()=>{__accountTest.change({access_token:'b',user:{id:'bob@example.test',email:'bob@example.test'}})});
    await page.waitForSelector('#customerSignedIn:not([hidden])');
    const signOutCalls=await page.evaluate(()=>__accountTest.calls.filter(c=>c.name==='signOut').length);
    page.once('dialog',dialog=>{assert.match(dialog.message(),/确定退出登录/);dialog.dismiss()});
    await page.click('#customerSignOut');
    assert.equal(await page.locator('#customerSignedIn').isVisible(),true);
    assert.equal(await page.evaluate(()=>__accountTest.calls.filter(c=>c.name==='signOut').length),signOutCalls);
    await page.click('[data-account-tab=details]');
    await page.fill('#customerDetailsForm [name=unit]','Keep this draft');
    page.once('dialog',dialog=>{assert.match(dialog.message(),/未保存/);dialog.dismiss()});
    await page.click('#customerAccountBack');
    assert.equal(await page.inputValue('#customerDetailsForm [name=unit]'),'Keep this draft');
    assert.equal(await page.evaluate(()=>__accountTest.calls.filter(c=>c.name==='signOut').length),signOutCalls);
    page.once('dialog',dialog=>{assert.match(dialog.message(),/未保存/);dialog.accept()});
    await page.click('#customerAccountBack');
    assert.equal(await page.inputValue('#customerDetailsForm [name=unit]'),'');
    await page.evaluate(()=>{__accountTest.signOutError=true});
    page.once('dialog',dialog=>{assert.match(dialog.message(),/确定退出登录/);dialog.accept()});
    await page.click('#customerSignOut');
    await page.waitForSelector('#customerRetrySignOut:not([hidden])');
    assert.equal(await page.textContent('#customerOrders'),'');
    await page.evaluate(()=>{__accountTest.signOutError=false});await page.click('#customerRetrySignOut');
    await page.waitForFunction(()=>document.querySelector('#customerAccountMessage').textContent.includes('已退出'));
    assert.equal(await page.textContent('#openCustomerAccount'),'登录账户');
    assert.equal(await page.textContent('#mobileAccountEntry'),'登录账户');
    assert.equal(await page.locator('#mobileAccountEntry .mobile-account-email').count(),0);
    for(const selector of ['#openOrderLookup','#openOrderLookupMobile','#mobileLookupEntry']) {
      assert.equal(await page.locator(selector).evaluate(el=>el.hidden),false);
    }
    await page.goto('http://account-public.test/');
    await page.waitForSelector('#productGrid .product');
    assert.equal(await page.locator('#openCustomerAccount').count(),1);
    assert.equal(await page.evaluate(()=>__accountTest.clients.filter(c=>c.customer).length),1);
    await page.click('#productGrid .add');await page.click('#openCart');await page.click('#checkout');
    assert.equal((await page.evaluate(()=>TingsAccount.checkoutHeaders())).Authorization,await page.evaluate(()=>`Bearer ${TINGS_SUPABASE.anonKey}`));
    assert.equal(await page.locator('#customerCheckoutHint').count(),1);
    await checkCheckoutLayout('public');
    assert.deepEqual(errors,[]);
    console.log('PASS: responsive account UI; OTP; owner isolation; profile save/autofill/dirty edits; checkout; cancellation; XSS; session races; reorder price changes/stock/confirmation/cart preservation; hosted account entry with anonymous guest checkout.');
  } finally {await browser.close()}
};
module.exports.mockSdk=mockSdk;
if(require.main===module) require('./check-browser-baseline.cjs').run().catch(error=>{console.error(error);process.exitCode=1});
