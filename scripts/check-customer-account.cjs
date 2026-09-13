// Offline browser integration checks. No real auth emails, orders or API writes.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const {chromium} = require(process.env.TINGS_PLAYWRIGHT_MODULE || 'playwright');
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
    state.clients.push({customer,storageKey});
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
          products:[{id:1,name:'测试零食',price:state.price ?? 5,stock:state.stock ?? 100,type:'零食',icon:'🍪',is_active:true}],
          categories:[],option_groups:[],option_values:[],variants:[],product_sales:[],campaigns:[]}};
        }
        if(name==='get_my_customer_details'){
          if(state.delayDetails)await new Promise(resolve=>{state.resolveDetails=resolve});
          return {data:state.profile[uid]||{full_name:'',phone:'',address:''}};
        }
        if(name==='get_my_customer_wallet'){
          const data=structuredClone(state.wallet||{coupons:[],referral_codes:[{code:'TSHREF-ACCOUNT-'+uid,amount:5,min_spend:30}],history:[]});
          if(state.delayWallet)await new Promise(resolve=>{state.resolveWallet=resolve});
          return state.walletError?{error:{message:'network'}}:{data};
        }
        if(name==='preview_account_offer')return {data:{valid:args.p_subtotal>=30,discount:5,name:'推荐奖励券',is_referral:false,allow_campaign_stack:true}};
        if(name==='save_my_customer_details_v2'){
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
(async()=>{
  const browser=await chromium.launch({channel:process.env.TINGS_BROWSER_CHANNEL || 'msedge',headless:true});
  try {
    const page=await browser.newPage({viewport:{width:390,height:844}});
    const errors=[];
    page.on('pageerror',e=>errors.push(e.message));
    async function closeCustomerAccount(){
      if(await page.locator('#customerSignedIn').isVisible() && !await page.locator('#customerHomePanel').isVisible())await page.click('#customerAccountBack');
      await page.click('#customerAccountBack');
    }
    async function checkCheckoutLayout(phase) {
      for (const width of [320,390,780,1100,1710]) {
        await page.setViewportSize({width,height:1180});
        for (const fulfillment of ['delivery','pickup']) {
          await page.selectOption('#fulfillment',fulfillment);
          const result=await page.locator('#orderForm').evaluate(form=>{
            const style=el=>getComputedStyle(el),margin=el=>[style(el).marginTop,style(el).marginBottom];
            const root=form.closest('dialog'),heading=document.querySelector('#orderFormWrap>h2'),note=document.querySelector('#orderFormWrap>p.dialog-note');
            const summary=document.querySelector('#orderSummary'),button=document.querySelector('#submitOrder');
            const labels=[...form.querySelectorAll(':scope>label')].filter(el=>el.checkVisibility()),promo=form.querySelector('#promotionChoice>label');
            const rows=[...labels,promo];
            const overlaps=rows.slice(1).filter((el,i)=>el.getBoundingClientRect().top<rows[i].getBoundingClientRect().bottom-0.5).map(el=>el.textContent.trim());
            return {labels:labels.map(margin),controls:[...form.querySelectorAll('input,select,textarea')].filter(el=>el.checkVisibility()).map(el=>[style(el).borderRadius,style(el).marginTop]),
              promo:margin(promo),summary:[style(summary).borderRadius,style(summary).paddingTop,style(summary).paddingBottom,...margin(summary)],
              dialog:[style(root).borderRadius,style(root).paddingTop,style(root).paddingBottom],heading:margin(heading),note:margin(note),
              submit:[style(button).fontSize,style(button).borderRadius,style(button).paddingTop,style(button).paddingBottom,style(button).justifyContent],
              overflow:root.scrollWidth>root.clientWidth+1,headingClear:labels[0].getBoundingClientRect().top>=note.getBoundingClientRect().bottom,overlaps};
          });
          // The fixture also enables the existing optional scheduled-time field.
          assert.deepEqual(result,{labels:[['0px','0px'],...Array(fulfillment==='delivery'?6:5).fill(['8px','8px'])],controls:Array(fulfillment==='delivery'?8:7).fill(['8px','5px']),
            promo:['-20px','-10px'],summary:['15px','10px','10px','10px','10px'],dialog:['10px','30px','25px'],heading:['-10px','10px'],note:['-5px','-5px'],
            submit:['15px','8px','10px','10px','center'],overflow:false,headingClear:true,overlaps:[]},`checkout ${phase} ${width}px ${fulfillment}: ${JSON.stringify(result)}`);
          const hintClear=await page.evaluate(()=>{
            const hint=document.querySelector('#couponCodeHint'),input=document.querySelector('#couponCodeInput');
            const oldText=hint.textContent,oldHidden=hint.hidden;
            hint.textContent='优惠码暂时无法验证，请检查后重试。';hint.hidden=false;
            const clear=hint.getBoundingClientRect().top>=input.getBoundingClientRect().bottom+4;
            hint.textContent=oldText;hint.hidden=oldHidden;return clear;
          });
          assert.ok(hintClear,`coupon hint remains readable ${phase} ${width}px`);
        }
      }
      await page.selectOption('#fulfillment','delivery');
      await page.setViewportSize({width:390,height:1180});
      await page.locator('#orderDialog').evaluate(el=>{el.scrollTop=0});
      if(process.env.TINGS_ACCOUNT_SCREENSHOT)await page.screenshot({path:process.env.TINGS_ACCOUNT_SCREENSHOT.replace('.png',`-checkout-${phase}.png`)});
    }
    await page.route('**/*',route=>{
      const url=new URL(route.request().url());
      if(['localhost','account-public.test'].includes(url.hostname)){
        const file=path.resolve(root,decodeURIComponent(url.pathname==='/'?'index.html':url.pathname.slice(1)));
        if(!file.startsWith(root+path.sep)||!fs.existsSync(file))return route.fulfill({status:404,body:''});
        return route.fulfill({body:fs.readFileSync(file),contentType:{'.html':'text/html; charset=utf-8','.js':'application/javascript','.css':'text/css','.webp':'image/webp'}[path.extname(file)]||'text/plain'});
      }
      if(url.hostname==='cdn.jsdelivr.net'&&url.pathname.includes('supabase-js'))
        return route.fulfill({contentType:'application/javascript',body:`(${mockSdk.toString()})()`});
      return route.fulfill({status:200,body:''});
    });
    await page.goto('http://localhost/');
    await page.waitForSelector('#productGrid .product');
    for(const width of [320,360,375,390,430,600,780,781,1100,1710]){
      await page.setViewportSize({width,height:844});
      const boxes=await page.locator('.site-header').evaluate(header=>[...header.children]
        .filter(el=>getComputedStyle(el).display!=='none').map(el=>{
          const r=el.getBoundingClientRect();return {name:el.id||el.className,left:r.left,right:r.right};
        }));
      for(let i=1;i<boxes.length;i++)assert.ok(boxes[i].left>=boxes[i-1].right-1,JSON.stringify({width,boxes}));
      assert.ok(boxes.at(-1).right<=width,JSON.stringify({width,boxes}));
      await page.click('#openCustomerAccount');
      assert.ok(await page.locator('#customerAccountDialog').evaluate(el=>el.scrollWidth<=el.clientWidth+1));
      await closeCustomerAccount();
    }
    await page.setViewportSize({width:390,height:844});
    assert.equal(await page.evaluate(()=>__accountTest.clients.filter(c=>c.customer).length),1);
    await page.click('#productGrid .add');
    await page.click('#openCart');
    for(const width of [320,390,780,1100,1710]){
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
    await page.evaluate(()=>document.querySelector('#orderForm').requestSubmit());
    await page.waitForFunction(()=>__accountTest.calls.some(c=>c.name==='submit-order'));
    assert.equal((await page.evaluate(()=>__accountTest.calls.find(c=>c.name==='submit-order'))).headers.Authorization,guestHeader.Authorization);
    await page.click('#done');await page.click('#productGrid .add');

    await page.click('#openCustomerAccount');
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
    assert.equal(await page.locator('#customerHomePanel').isVisible(),true);
    assert.equal(await page.locator('#customerOrdersPanel').isVisible(),false);
    assert.deepEqual(await page.locator('.customer-home-menu strong').allTextContents(),['我的订单','收货资料','我的优惠券','推荐奖励']);
    assert.equal(await page.textContent('#customerAccountEmail'),'你好，alice@example.test');
    assert.equal(await page.locator('#customerAccountClose').count(),0);
    assert.equal(await page.locator('#customerAccountBack').isVisible(),true);
    assert.equal(await page.locator('#customerAccountBack').getAttribute('aria-label'),'返回商店');
    assert.equal(await page.locator('#customerOrderRefresh').isVisible(),false);
    for (const width of [320,375,390,780,1100,1710]) {
      await page.setViewportSize({width,height:844});
      assert.ok(await page.locator('#customerAccountDialog').evaluate(el=>el.scrollWidth<=el.clientWidth+1));
      const homeStyle=await page.evaluate(()=>{
        const root=document.querySelector('#customerAccountDialog'),heading=root.querySelector('.customer-account-heading'),close=root.querySelector('#customerAccountBack');
        const style=getComputedStyle(root.querySelector('#customerSignOut'));
        return {color:style.color,background:style.backgroundColor,radius:style.borderRadius,border:style.borderTopStyle,
          margin:getComputedStyle(heading).marginTop,closeInside:close.getBoundingClientRect().top>=root.getBoundingClientRect().top+6};
      });
      assert.deepEqual(homeStyle,{color:'rgb(255, 255, 255)',background:'rgb(79, 48, 48)',radius:'15px',border:'solid',margin:width<=780?'-6px':'-20px',closeInside:true});
      const rows=await page.locator('.customer-home-menu button').evaluateAll(buttons=>buttons.map(el=>{
        const r=el.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom};
      }));
      for (let i=1;i<rows.length;i++)assert.ok(rows[i].top>=rows[i-1].bottom&&rows[i].left===rows[0].left&&rows[i].right===rows[0].right);
    }
    await page.setViewportSize({width:390,height:844});
    if(process.env.TINGS_ACCOUNT_SCREENSHOT)await page.screenshot({path:process.env.TINGS_ACCOUNT_SCREENSHOT.replace('.png','-home.png')});
    for (const [view,panel] of [['coupons','customerCouponsPanel'],['rewards','customerRewardsPanel']]) {
      await page.click(`[data-account-tab=${view}]`);
      assert.equal(await page.locator(`#${panel}`).isVisible(),true);
      await page.waitForFunction(id=>document.getElementById(id).getAttribute('aria-busy')==='false',panel);
      assert.doesNotMatch(await page.textContent(`#${panel}`),/尚未接入|绑定手机号/);
      assert.equal(await page.locator('#customerHomePanel').isVisible(),false);
      await page.click('#customerAccountBack');
      assert.equal(await page.locator(`[data-account-tab=${view}]`).evaluate(el=>el===document.activeElement),true);
    }
    await page.evaluate(()=>{__accountTest.wallet={
      coupons:[
        {id:'reward',code:'RWD-ALICE',name:'推荐奖励券',amount:5,min_spend:30,kind:'referral',status:'available',ends_at:'2099-12-31',uses:[]},
        {id:'normal',code:'TEN',name:'10% 优惠券',amount:10,discount_kind:'percent',min_spend:50,kind:'regular',status:'available',uses:[]},
        {id:'used',code:'RWD-USED',name:'<img src=x onerror=window.walletXss=1>',amount:5,min_spend:30,kind:'referral',status:'used',uses:[{order_number:'TSH-OWN',used_at:'2026-09-12'}]}
      ],referral_codes:[{code:'TSHREF-ACCOUNT-ALICE',amount:5,min_spend:30}],history:[{created_at:'2026-09-12',status:'等待订单完成',reward_amount:5}]
    }});
    await page.click('[data-account-tab=rewards]');
    await page.waitForSelector('#customerRewardsPanel .customer-coupon-card');
    assert.match(await page.textContent('#customerRewardsPanel'),/90 天|90天/);
    assert.equal(await page.locator('#customerRewardsPanel input').count(),0);
    assert.equal(await page.locator('#customerRewardsPanel img').count(),0);
    assert.match(await page.textContent('#customerRewardsPanel'),/使用于订单 TSH-OWN/);
    for(const width of [320,390,780,1710]){
      await page.setViewportSize({width,height:844});
      assert.ok(await page.locator('#customerAccountDialog').evaluate(el=>el.scrollWidth<=el.clientWidth+1));
    }
    await page.setViewportSize({width:390,height:844});
    if(process.env.TINGS_ACCOUNT_SCREENSHOT)await page.screenshot({path:process.env.TINGS_ACCOUNT_SCREENSHOT.replace('.png','-rewards.png')});
    await closeCustomerAccount();
    await page.click('#openCart');await page.click('#checkout');
    await page.waitForSelector('#customerWalletCheckout input[value="RWD-ALICE"]');
    await page.check('#customerWalletCheckout input[value="RWD-ALICE"]');
    assert.equal(await page.inputValue('#couponCodeInput'),'RWD-ALICE');
    await page.check('#customerWalletCheckout input[value="TEN"]');
    assert.equal(await page.locator('#customerWalletCheckout input:checked').count(),1);
    assert.equal(await page.inputValue('#couponCodeInput'),'TEN');
    await page.fill('#couponCodeInput','MANUAL');
    assert.equal(await page.locator('#customerWalletCheckout input:checked').count(),0);
    assert.ok(await page.locator('#orderDialog').evaluate(el=>el.scrollWidth<=el.clientWidth+1));
    if(process.env.TINGS_ACCOUNT_SCREENSHOT)await page.screenshot({path:process.env.TINGS_ACCOUNT_SCREENSHOT.replace('.png','-wallet-checkout.png')});
    await page.click('#closeDialog');
    await page.evaluate(()=>{__accountTest.wallet=null;__accountTest.walletError=true});
    await page.click('#openCustomerAccount');await page.click('[data-account-tab=rewards]');
    await page.waitForFunction(()=>document.querySelector('#customerRewardsPanel').textContent.includes('暂时无法加载'));
    assert.equal(await page.locator('#customerRewardsPanel .customer-coupon-card').count(),0);
    await page.evaluate(()=>{__accountTest.walletError=false});
    await page.click('#customerRewardsPanel button');
    await page.waitForFunction(()=>document.querySelector('#customerRewardsPanel').textContent.includes('我的推荐码'));
    await page.evaluate(()=>{__accountTest.delayWallet=true});
    await page.click('#customerRewardsPanel button');
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
    await page.fill('#customerDetailsForm [name=full_name]','Alice');
    await page.fill('#customerDetailsForm [name=phone]','3125550100');
    await page.fill('#customerDetailsForm [name=address]','Saved address');
    await page.fill('#customerDetailsForm [name=unit]','2B');
    await page.fill('#customerDetailsForm [name=city]','Chicago');
    await page.fill('#customerDetailsForm [name=state]','il');
    await page.fill('#customerDetailsForm [name=zip]','60601-1234');
    assert.equal(await page.inputValue('#customerIdentityEmail'),'alice@example.test');
    assert.equal(await page.locator('#customerIdentityEmail').isEditable(),false);
    await page.click('#customerDetailsForm [type=submit]');
    await page.waitForFunction(()=>document.querySelector('#customerAccountMessage').textContent.includes('已保存'));
    for (const width of [320,390,780,1100]) {
      await page.setViewportSize({width,height:844});
      assert.ok(await page.locator('#customerAccountDialog').evaluate(el=>el.scrollWidth<=el.clientWidth+1));
      const spacing=await page.locator('#customerDetailsForm').evaluate(form=>{
        const label=name=>form.querySelector(`[name="${name}"]`).closest('label');
        const margin=node=>[getComputedStyle(node).marginTop,getComputedStyle(node).marginBottom];
        const rows=['full_name','phone','address','unit','city','state'].map(name=>label(name).getBoundingClientRect());
        rows.push(form.querySelector('#customerIdentityEmail').closest('label').getBoundingClientRect());
        return {phone:margin(label('phone')),unit:margin(label('unit')),region:margin(form.querySelector('.customer-address-region')),
          noOverlap:rows.every((row,i)=>!i||row.top>=rows[i-1].bottom+8),
          stateZipAligned:Math.abs(label('state').getBoundingClientRect().top-label('zip').getBoundingClientRect().top)<1};
      });
      assert.deepEqual(spacing,{phone:['-10px','-10px'],unit:['-10px','-10px'],region:['-30px','-20px'],noOverlap:true,stateZipAligned:true},`address spacing at ${width}px`);
      const density=await page.locator('#customerDetailsForm').evaluate(form=>{
        const style=getComputedStyle(form),dialogStyle=getComputedStyle(form.closest('dialog'));
        const status=getComputedStyle(document.querySelector('#customerDetailsStatus')),address=form.querySelector('[name=address]');
        return {formMargins:[style.marginTop,style.marginBottom],statusMargins:[status.marginTop,status.marginBottom],
          padding:[dialogStyle.paddingTop,dialogStyle.paddingBottom],inputMargins:[...form.querySelectorAll('input')].map(el=>getComputedStyle(el).marginTop),
          addressHeight:address.getBoundingClientRect().height,resize:getComputedStyle(address).resize};
      });
      assert.deepEqual(density,{formMargins:['0px','0px'],statusMargins:['0px','0px'],padding:['10px','10px'],inputMargins:Array(7).fill('0px'),addressHeight:44,resize:'vertical'},`address density at ${width}px`);
    }
    await page.setViewportSize({width:390,height:1000});
    await page.locator('#customerAccountDialog').evaluate(el=>{el.scrollTop=0});
    if(process.env.TINGS_ACCOUNT_SCREENSHOT)await page.screenshot({path:process.env.TINGS_ACCOUNT_SCREENSHOT.replace('.png','-address-v2.png')});
    await closeCustomerAccount();
    await page.click('#openCart');await page.click('#checkout');
    assert.equal(await page.inputValue('#orderForm [name=name]'),'Alice');
    assert.equal(await page.inputValue('#orderForm [name=address]'),'Saved address, Unit 2B, Chicago IL 60601-1234');
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
    await page.evaluate(()=>document.querySelector('#orderForm').requestSubmit());
    await page.waitForFunction(()=>__accountTest.calls.filter(c=>c.name==='submit-order').length===2);
    const submission=await page.evaluate(()=>__accountTest.calls.filter(c=>c.name==='submit-order').at(-1));
    assert.equal(submission.headers.Authorization,'Bearer customer-token-alice@example.test');
    assert.equal('p_user_id' in submission.body,false);
    await page.click('#done');
    await page.click('#productGrid .add');await page.click('#openCart');await page.click('#checkout');
    await page.evaluate(()=>{__accountTest.expired=true});
    assert.match(await page.evaluate(()=>TingsAccount.checkoutHeaders().catch(e=>e.message)),/登录已失效/);
    await page.evaluate(()=>{__accountTest.expired=false;__accountTest.change(null)});
    await page.waitForFunction(()=>document.querySelector('#openCustomerAccount').textContent==='账户');
    assert.equal(await page.inputValue('#orderForm [name=email]'),'');
    assert.match(await page.evaluate(()=>TingsAccount.checkoutHeaders().catch(e=>e.message)),/账户已改变/);
    await page.click('#closeDialog');

    // A late order response from Alice must not appear after switching to Bob.
    await page.evaluate(()=>{__accountTest.change({access_token:'a',user:{id:'alice@example.test',email:'alice@example.test'}})});
    await page.click('#openCustomerAccount');
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
    await page.reload();await page.click('#openCustomerAccount');
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
    await page.click('#customerDiscardDetails');await page.click('#customerReauthenticate');
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
    for (const width of [320,375,390,780,1100,1710]) {
      await page.setViewportSize({width,height:1180});
      const heading=await page.evaluate(()=>{
        const title=document.querySelector('#customerAccountTitle').getBoundingClientRect();
        const back=document.querySelector('#customerAccountBack'),r=back.getBoundingClientRect();
        const heading=document.querySelector('.customer-account-heading').getBoundingClientRect();
        const tools=document.querySelector('#customerOrderRefresh'),refresh=tools.getBoundingClientRect();
        const time=document.querySelector('#customerOrderUpdated').getBoundingClientRect();
        return {label:back.textContent,afterTitle:r.left>=title.right,atRight:Math.abs(r.right-heading.right)<1,
          sameRow:Math.abs(r.top+r.height/2-title.top-title.height/2)<1,
          toolsInHeading:tools.closest('.customer-account-heading')!==null,
          toolsClear:refresh.right<=r.left-4 && time.right<=refresh.right+1 && refresh.bottom<=heading.bottom+1,
          desktopInline:innerWidth<=780 || Math.abs(refresh.top+refresh.height/2-title.top-title.height/2)<1,
          emailMargin:getComputedStyle(document.querySelector('#customerAccountEmail')).marginTop};
      });
      assert.deepEqual(heading,{label:'返回',afterTitle:true,atRight:true,sameRow:true,toolsInHeading:true,toolsClear:true,desktopInline:true,emailMargin:'0px'},`account heading at ${width}px`);
      const compactOrders=await page.evaluate(()=>{
        const root=document.querySelector('#customerAccountDialog'),email=document.querySelector('#customerAccountEmail'),note=document.querySelector('#customerOrdersPanel>p.customer-muted');
        const rootStyle=getComputedStyle(root),noteStyle=getComputedStyle(note);
        const close=root.querySelector('#customerAccountBack').getBoundingClientRect();
        return {padding:[rootStyle.paddingTop,rootStyle.paddingBottom],margin:[noteStyle.marginTop,noteStyle.marginBottom],color:getComputedStyle(email).color,
          noteBelowEmail:note.getBoundingClientRect().top>=email.getBoundingClientRect().bottom,
          closeInside:close.top>=root.getBoundingClientRect().top+6};
      });
      assert.deepEqual(compactOrders,{padding:['10px','10px'],margin:['-10px','-10px'],color:'rgb(0, 0, 0)',noteBelowEmail:true,closeInside:true},`compact orders at ${width}px`);
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
    for (const width of [320,390,780,1100,1710]) {
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
    await page.click('#customerAccountBack');await page.click('[data-account-tab=details]');
    await page.evaluate(()=>{__accountTest.delayDetails=true});
    await page.click('#customerReloadDetails');
    await page.waitForFunction(()=>typeof __accountTest.resolveDetails==='function');
    await page.fill('#customerDetailsForm [name=full_name]','正在编辑的姓名');
    await page.evaluate(()=>{__accountTest.delayDetails=false;__accountTest.resolveDetails()});
    await page.waitForFunction(()=>!document.querySelector('#customerReloadDetails').disabled);
    assert.equal(await page.inputValue('#customerDetailsForm [name=full_name]'),'正在编辑的姓名');
    await page.evaluate(()=>{__accountTest.saveError=true});
    await page.click('#customerDetailsForm [type=submit]');
    await page.waitForFunction(()=>document.querySelector('#customerAccountMessage').textContent.includes('未保存'));
    assert.equal(await page.inputValue('#customerDetailsForm [name=full_name]'),'正在编辑的姓名');
    await page.click('#customerAccountBack');await page.click('[data-account-tab=details]');
    assert.equal(await page.inputValue('#customerDetailsForm [name=full_name]'),'正在编辑的姓名');
    page.once('dialog',dialog=>dialog.dismiss());await page.keyboard.press('Escape');
    assert.equal(await page.locator('#customerAccountDialog').evaluate(el=>el.open),true);
    await page.click('#customerDiscardDetails');
    assert.equal(await page.inputValue('#customerDetailsForm [name=full_name]'),'');
    await page.evaluate(()=>{__accountTest.saveError=false});
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
    for(const width of [320,390,780,1100]){
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
    await page.waitForFunction(()=>document.querySelector('#openCustomerAccount').textContent==='账户');
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
    await page.click('#customerAccountBack');
    page.once('dialog',dialog=>{assert.match(dialog.message(),/未保存/);dialog.dismiss()});
    await page.click('#customerSignOut');
    assert.equal(await page.inputValue('#customerDetailsForm [name=unit]'),'Keep this draft');
    assert.equal(await page.evaluate(()=>__accountTest.calls.filter(c=>c.name==='signOut').length),signOutCalls);
    await page.evaluate(()=>{__accountTest.signOutError=true});
    page.once('dialog',dialog=>{assert.match(dialog.message(),/未保存/);dialog.accept()});
    await page.click('#customerSignOut');
    await page.waitForSelector('#customerRetrySignOut:not([hidden])');
    assert.equal(await page.textContent('#customerOrders'),'');
    await page.evaluate(()=>{__accountTest.signOutError=false});await page.click('#customerRetrySignOut');
    await page.waitForFunction(()=>document.querySelector('#customerAccountMessage').textContent.includes('已退出'));
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
})().catch(error=>{console.error(error);process.exitCode=1});
