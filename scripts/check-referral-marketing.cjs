// Local-only owner UI checks; every data operation is mocked.
const {chromium}=require(process.env.TINGS_PLAYWRIGHT_MODULE||'playwright');
const assert=require('node:assert/strict'),path=require('node:path');
(async()=>{
  const browser=await chromium.launch({channel:process.env.TINGS_BROWSER_CHANNEL||'msedge',headless:true});
  try{
    const page=await browser.newPage({viewport:{width:1100,height:900}});
    const errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.route('**/*',route=>route.abort());
    await page.setContent('<main><button data-view="marketing">营销</button><div id="marketingCenter"></div></main><div id="toast"></div>');
    await page.addStyleTag({path:path.resolve(__dirname,'../admin.css')});
    await page.addStyleTag({path:path.resolve(__dirname,'../marketing-wizard.css')});
    await page.evaluate(()=>{
      const rows={
        marketing_campaigns:[],products:[],categories:[],coupon_redemptions:[],orders:[{id:'order',order_number:'TSH-TEST',coupon_code:'TSHREF-ACCOUNT',created_at:'2026-09-12',status:'已完成'},{id:'short-order',coupon_code:'K7M4X9P2'}],
        marketing_coupons:[{id:'reward',code:'RWD-TEST',name:'推荐奖励券',amount:5,min_spend:30,total_quantity:1,source:'referral',is_referral_reward:true,claimed_by_user_id:'account-a',active:true,status:'published'},
          {id:'legacy',code:'OLD20',name:'旧折扣券',amount:20,discount_kind:'percent',min_spend:40,total_quantity:20,per_phone_limit:3,requires_claim:false,active:true,status:'published',ends_at:'2099-09-30T23:59:37.456Z'}],
        customer_referrals:[{referral_code:'TSHREF-K7M4X9',referrer_user_id:'account-a',referral_amount:5,referral_min_spend:30,created_at:'2026-09-12'},
          {referral_code:'TSHREF-LEGACY',phone:'3125550123',created_at:'2026-09-12'}],
        referral_reward_settings:{amount:5,min_spend:35,valid_days:0},
        referral_events:[{id:'event',referrer_user_id:'account-a',referred_order_id:'order',status:'rewarded',created_at:'2026-09-12'},{id:'short-event',referrer_user_id:'account-a',referred_order_id:'short-order',status:'pending',created_at:'2026-09-12'}]
      };
      window.__marketingWrites=[];
      window.TINGS_SUPABASE={url:'offline',anonKey:'offline'};
      window.supabase={createClient(){return {from(table){
        let write=null;
        const chain=new Proxy({}, {get(target,key){
          if(key==='then')return fn=>Promise.resolve(write?{data:write,error:null}:{data:rows[table]||[],error:null}).then(fn);
          if(['insert','upsert','update'].includes(key))return value=>{write=value;window.__marketingWrites.push({table,value});return chain};
          return ()=>chain;
        }});return chain;
      }}}};
    });
    await page.addScriptTag({path:path.resolve(__dirname,'../marketing.js')});
    await page.waitForSelector('#accountReferralEvents');
    assert.match(await page.textContent('.referral-summary'),/订单完成后仅推荐人/);
    assert.equal(await page.locator('[data-create-referral],[data-create-referral-code]').count(),0);
    assert.match(await page.textContent('#accountReferralEvents'),/TSH-TEST.*已发奖励/);
    await page.click('[data-show-referral-codes]');
    assert.match(await page.textContent('#referralCodeList'),/account-a/);
    assert.equal(await page.textContent('.referral-code-heading b'),'TSHREF-K7M4X9');
    assert.equal(await page.getAttribute('[data-referral-copy]','data-referral-copy'),'TSHREF-K7M4X9');
    assert.match(await page.textContent('#referralCodeList'),/已用 2/);
    assert.doesNotMatch(await page.textContent('#referralCodeList'),/LEGACY|手机号/);
    await page.click('[data-close-referral-codes]');
    await page.locator('[data-create]:visible').first().click();
    await page.click('[data-wizard-type=coupon]');await page.click('[data-wizard-next]');
    assert.equal(await page.inputValue('#wizDiscountMode'),'fixed');
    await page.fill('#wizName','百分比券');await page.fill('#wizCode','TENOFF');
    await page.fill('#wizAmount','10');await page.selectOption('#wizDiscountMode','percent');
    await page.fill('#wizThreshold','50');await page.click('[data-wizard-next]');
    assert.equal(await page.locator('#wizMaxDiscount').isVisible(),true,'new percent coupon cannot continue without cap');
    assert.equal(await page.evaluate(()=>__marketingWrites.length),0);
    await page.fill('#wizMaxDiscount','8');await page.fill('#wizClaimValidDays','14');
    await page.click('[data-wizard-next]');await page.click('[data-wizard-next]');
    assert.match(await page.textContent('.wizard-preview'),/10% OFF/);
    await page.click('[data-save=published]');
    const write=await page.evaluate(()=>__marketingWrites.at(-1));
    assert.equal(write.table,'marketing_coupons');assert.equal(write.value.discount_kind,'percent');assert.equal(write.value.amount,10);
    assert.equal(write.value.max_discount,8);assert.equal(write.value.claim_valid_days,14);assert.equal(write.value.per_phone_limit,1);
    await page.locator('[data-create]:visible').first().click();
    await page.click('[data-wizard-type=coupon]');await page.click('[data-wizard-next]');
    await page.fill('#wizName','免配送费券');await page.fill('#wizCode','SHIPFREE');await page.selectOption('#wizDiscountMode','free_shipping');
    assert.equal(await page.locator('#wizAmount').count(),0);
    assert.match(await page.textContent('.wizard-form'),/店铺当前配送区域/);
    await page.fill('#wizThreshold','25');await page.fill('#wizClaimValidDays','7');
    await page.click('[data-wizard-next]');await page.click('[data-wizard-next]');
    assert.match(await page.textContent('.wizard-preview'),/免配送费/);
    await page.click('[data-save=published]');
    const shipping=await page.evaluate(()=>__marketingWrites.at(-1).value);
    assert.equal(shipping.discount_kind,'free_shipping');assert.equal(shipping.amount,0);assert.equal(shipping.min_spend,25);
    assert.equal(shipping.claim_valid_days,7);assert.equal(shipping.max_discount,null);
    await page.locator('[data-edit="legacy"]').first().click();
    assert.equal(await page.inputValue('#wizMaxDiscount'),'');
    assert.equal(await page.locator('#wizClaimValidDays').count(),0);
    await page.click('[data-wizard-next]');await page.click('[data-wizard-next]');await page.click('[data-save=published]');
    const legacy=await page.evaluate(()=>__marketingWrites.at(-1).value);
    assert.equal(legacy.max_discount,null);assert.equal(legacy.per_phone_limit,3);
    assert.equal(legacy.ends_at,'2099-09-30T23:59:37.456Z','unchanged old expiry preserves exact time');
    assert.deepEqual(errors,[]);
    console.log('PASS: account referral rules/events, legacy-code exclusion, percentage coupon authoring; all writes mocked.');
  }finally{await browser.close()}
})().catch(error=>{console.error(error);process.exitCode=1});
