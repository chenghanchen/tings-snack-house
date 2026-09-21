// Focused offline checks, sharing the existing account suite's SDK fixture/routes.
const assert = require('node:assert/strict');
module.exports = async (page, errors) => {
  await page.evaluate(() => {
    __accountTest.change({access_token:'fixture',user:{id:'refresh@example.test',email:'refresh@example.test'}});
    TingsAccount.open();
  });
  await page.click('[data-account-tab=orders]');
  await page.waitForSelector('#customerOrders .lookup-order-card');
  const button = page.locator('#customerRefreshOrders');
  const icon = button.locator('svg');
  const count = () => page.evaluate(() => __accountTest.calls.filter(c=>c.name==='get_my_customer_orders').length);
  const idle = async () => {
    await page.waitForFunction(()=>!document.querySelector('#customerRefreshOrders').disabled);
    assert.equal(await button.getAttribute('aria-busy'),'false');
    assert.equal(await icon.evaluate(el=>getComputedStyle(el).animationName),'none');
  };
  await idle();
  const before = await count();
  await page.evaluate(()=>{
    __accountTest.delayed=true;
  });
  await button.click();
  await page.waitForFunction(()=>typeof __accountTest.resolveOrders==='function');
  assert.equal(await button.isDisabled(),true);
  assert.equal(await button.getAttribute('aria-busy'),'true');
  assert.equal(await icon.evaluate(el=>getComputedStyle(el).animationIterationCount),'infinite');
  const transform=await icon.evaluate(el=>getComputedStyle(el).transform);
  await page.waitForFunction(old=>getComputedStyle(document.querySelector('#customerRefreshOrders svg')).transform!==old,transform);
  await page.evaluate(()=>{for(let i=0;i<10;i++)document.querySelector('#customerRefreshOrders').click()});
  assert.equal(await count(),before+1);
  await page.emulateMedia({reducedMotion:'reduce'});
  assert.equal(await icon.evaluate(el=>getComputedStyle(el).animationName),'none');
  await page.emulateMedia({reducedMotion:'no-preference'});
  await page.evaluate(()=>{__accountTest.delayed=false;__accountTest.resolveOrders()});
  await idle();
  assert.equal(await page.locator('#customerOrderUpdated').count(),0);
  await page.evaluate(()=>{__accountTest.ordersError=true});
  await button.click();
  await page.waitForFunction(()=>document.querySelector('#customerOrders').textContent.includes('检查网络'));
  await idle();
  await page.evaluate(()=>{__accountTest.ordersError=false});
  await button.click();
  await page.waitForSelector('#customerOrders .lookup-order-card');
  await idle();
  await page.mouse.move(0,0);
  for (const width of require('./browser/policy.cjs').WIDTHS.filter(w=>(w<=780)===(page.viewportSize().width<=780))) {
    await page.setViewportSize({width,height:844});
    const layout=await page.evaluate(()=>{
      const rect=id=>document.getElementById(id).getBoundingClientRect();
      const title=rect('customerAccountTitle'),refresh=rect('customerRefreshOrders'),back=rect('customerAccountBack');
      const root=document.getElementById('customerAccountDialog'),s=getComputedStyle(document.getElementById('customerRefreshOrders'));
      return {clear:title.right<=refresh.left && refresh.right<back.left,
        inline:Math.abs(title.top+title.height/2-refresh.top-refresh.height/2)<1 && Math.abs(back.top+back.height/2-refresh.top-refresh.height/2)<1,
        overflow:root.scrollWidth>root.clientWidth,
        titleSize:getComputedStyle(document.getElementById('customerAccountTitle')).fontSize,
        padding:[getComputedStyle(root).paddingTop,getComputedStyle(root).paddingBottom],
        style:[s.color,s.borderTopColor,s.borderRadius,s.fontSize,refresh.height,s.paddingLeft,s.paddingRight]};
    });
    assert.equal(layout.clear,true,`header overlap at ${width}: ${JSON.stringify(layout)}`);
    assert.equal(layout.inline,true,`header row at ${width}`);
    assert.equal(layout.overflow,false,`dialog overflow at ${width}`);
    assert.equal(layout.titleSize,'24px');
    assert.deepEqual(layout.padding,['20px','20px']);
    assert.deepEqual(layout.style,['rgb(215, 91, 75)','rgb(215, 91, 75)','8px','15px',36,'5px','5px']);
    if(process.env.TINGS_ACCOUNT_SCREENSHOT && [390,1710].includes(width))await page.screenshot({path:process.env.TINGS_ACCOUNT_SCREENSHOT.replace('.png',`-refresh-${width}.png`)});
  }
  await page.fill('#customerOrderSearch','no-match-fixture');
  assert.equal(await page.locator('#customerOrders .lookup-order-card').count(),0);
  await page.fill('#customerOrderSearch','');
  await page.selectOption('#customerOrderFilter','completed');
  assert.equal(await page.locator('#customerOrders .lookup-order-card').count(),0);
  await page.selectOption('#customerOrderFilter','all');
  assert.equal(await page.locator('#customerOrders .lookup-order-card').count(),1);
  await page.click('#customerAccountBack');
  assert.equal(await page.locator('#customerHomePanel').isVisible(),true);
  // Stale requests cannot leave a spinner running across account changes.
  await page.click('[data-account-tab=orders]');
  await idle();
  await page.evaluate(()=>{__accountTest.delayed=true;delete __accountTest.resolveOrders});
  await button.click();
  await page.waitForFunction(()=>typeof __accountTest.resolveOrders==='function');
  await page.evaluate(()=>{__accountTest.change(null);__accountTest.delayed=false;__accountTest.resolveOrders()});
  await idle();
  assert.equal(await page.locator('#customerOrderRefresh').isVisible(),false);
  assert.deepEqual(errors,[]);
  console.log('PASS order refresh: one request; rapid-click lock; busy animation/start/stop; failure/retry; no timestamp; session reset; reduced motion; search/filter/back; mobile/desktop layout matrix; no page errors.');
};
