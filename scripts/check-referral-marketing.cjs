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
        marketing_campaigns:[],products:[],categories:[],coupon_redemptions:[],orders:[{id:'order',order_number:'TSH-TEST',created_at:'2026-09-12',status:'已完成'}],
        marketing_coupons:[{id:'reward',code:'RWD-TEST',name:'推荐奖励券',amount:5,min_spend:30,total_quantity:1,source:'referral',is_referral_reward:true,claimed_by_user_id:'account-a',active:true,status:'published'}],
        customer_referrals:[{referral_code:'TSHREF-ACCOUNT',referrer_user_id:'account-a',referral_amount:5,referral_min_spend:30,created_at:'2026-09-12'},
          {referral_code:'TSHREF-LEGACY',phone:'3125550123',created_at:'2026-09-12'}],
        referral_reward_settings:{amount:5,min_spend:35,valid_days:0},
        referral_events:[{id:'event',referrer_user_id:'account-a',referred_order_id:'order',status:'rewarded',created_at:'2026-09-12'}]
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
    assert.doesNotMatch(await page.textContent('#referralCodeList'),/LEGACY|手机号/);
    await page.click('[data-close-referral-codes]');
    await page.locator('[data-create]:visible').first().click();
    await page.click('[data-wizard-type=coupon]');await page.click('[data-wizard-next]');
    assert.equal(await page.inputValue('#wizDiscountMode'),'fixed');
    await page.fill('#wizName','百分比券');await page.fill('#wizCode','TENOFF');
    await page.fill('#wizAmount','10');await page.selectOption('#wizDiscountMode','percent');
    await page.fill('#wizThreshold','50');await page.click('[data-wizard-next]');await page.click('[data-wizard-next]');
    assert.match(await page.textContent('.wizard-preview'),/10% OFF/);
    await page.click('[data-save=published]');
    const write=await page.evaluate(()=>__marketingWrites.at(-1));
    assert.equal(write.table,'marketing_coupons');assert.equal(write.value.discount_kind,'percent');assert.equal(write.value.amount,10);
    assert.deepEqual(errors,[]);
    console.log('PASS: account referral rules/events, legacy-code exclusion, percentage coupon authoring; all writes mocked.');
  }finally{await browser.close()}
})().catch(error=>{console.error(error);process.exitCode=1});
