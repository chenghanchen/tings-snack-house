const assert=require('node:assert/strict');
const {WIDTHS}=require('./policy.cjs');
const {adapter}=require('./harness.cjs');
const {mockSdk}=require('../check-customer-account.cjs');
// Only fixture data differs: keep the real app, category rendering and cart handlers.
const sdk={toString:()=>`function(){(${mockSdk.toString()})();const create=window.supabase.createClient;window.supabase.createClient=(...args)=>{const client=create(...args),rpc=client.rpc;client.rpc=async(...a)=>{const r=await rpc(...a);if(a[0]==='get_storefront_snapshot'){r.data.categories=['热卖','辣条','坚果','饼干','饮料','促销','新品'].map(name=>({name}));r.data.products=r.data.categories.map((c,i)=>({...r.data.products[0],id:i+1,name:'测试零食 '+c.name,type:c.name,stock:3,image:i===1?'footer-benefit-shield.svg':'',note:'商品简介 '+i}));}return r};return client}}`};
module.exports=async function storefront(browser){
  let cases=0;
  for(const width of WIDTHS){
    const fixture=adapter(browser);
    try{
      const page=await fixture.newPage({viewport:{width,height:1180},offlineSdk:sdk});
      await page.goto('http://localhost/');await page.locator('#productGrid .product').first().waitFor();
      const geometry=await page.evaluate(()=>{
        const root=document.documentElement;
        const cards=[...document.querySelectorAll('#productGrid .product')];
        return {scroll:root.scrollWidth,client:root.clientWidth,mask:[getComputedStyle(root).overflowX,getComputedStyle(document.body).overflowX],
          cards:cards.map(el=>{const r=el.getBoundingClientRect();return {overflow:el.scrollWidth>el.clientWidth,contained:[...el.querySelectorAll('h3,.product-image,.product-action-wrap,.product-price-wrap,.stock-warning')].every(c=>{const b=c.getBoundingClientRect();return b.left>=r.left-1&&b.right<=r.right+1})}})};
      });
      assert.ok(geometry.scroll<=geometry.client,`${width}: page overflow ${JSON.stringify(geometry)}`);
      assert.ok(geometry.mask.every(v=>!['hidden','clip'].includes(v)),'No global overflow masking');
      assert.ok(geometry.cards.length>0&&geometry.cards.every(c=>!c.overflow&&c.contained),`${width}: card overflow`);
      assert.equal(await page.locator('#productGrid .product').evaluateAll(cards=>cards.every(card=>{
        const parts=[...card.querySelectorAll('h3,.product-image,.product-action-wrap>.add,.product-action-wrap>.card-quantity,.product-price-wrap,.stock-warning')].map(el=>el.getBoundingClientRect()).filter(r=>r.width&&r.height);
        return parts.every((a,i)=>parts.slice(i+1).every(b=>Math.min(a.right,b.right)-Math.max(a.left,b.left)<=1||Math.min(a.bottom,b.bottom)-Math.max(a.top,b.top)<=1));
      })),true,`${width}: image/title/price/action/stock must not overlap`);
      const first=page.locator('#productGrid .product').first();
      const noticeAboveAction=async()=>assert.ok(await first.evaluate(card=>{
        const n=card.querySelector('.stock-warning').getBoundingClientRect();
        const a=card.querySelector('.add,.card-quantity').getBoundingClientRect();
        return n.bottom<=a.top&&n.left>=a.left-1&&n.right<=a.right+1;
      }),`${width}: stock notice above purchase control`);
      await noticeAboveAction();
      // Click/tap the image itself, never the desktop-only magnifier.
      const visual=first.locator('.product-image');
      if(width<=780)await visual.tap();else await visual.click();
      await page.locator('#imagePreviewDialog').waitFor({state:'visible'});
      assert.equal(await page.locator('#imagePreviewEmoji').isVisible(),true);
      assert.equal(await page.locator('#imagePreviewDescription').textContent(),'商品简介 0');
      assert.equal(await page.locator('#cartCount').count()?await page.locator('#cartCount').textContent():await page.locator('#openCart b').textContent(),'0');
      await page.locator('#closeImagePreview').click();
      const photo=page.locator('#productGrid .product-image').nth(1);
      if(width<=780)await photo.tap();else await photo.press('Enter');
      await page.locator('#imagePreviewDialog').waitFor({state:'visible'});
      assert.equal(await page.locator('#imagePreviewLarge').isVisible(),true);
      assert.match(await page.locator('#imagePreviewLarge').getAttribute('src'),/footer-benefit-shield\.svg$/);
      await page.locator('#closeImagePreview').click();
      await visual.press('Space');
      await page.locator('#imagePreviewDialog').waitFor({state:'visible'});
      await page.locator('#closeImagePreview').click();
      await first.locator('.add').click();
      await first.locator('.card-quantity').waitFor();
      assert.match(await first.locator('.stock-warning').textContent(),/仅剩 2 件/);
      await noticeAboveAction();
      await first.locator('[data-card-change="-1"]').click();
      await first.locator('.add').waitFor();
      assert.match(await first.locator('.stock-warning').textContent(),/仅剩 3 件/);
      if(width<=780){
        assert.ok(await page.locator('#snacks>.section-heading>div').evaluate(el=>{const r=el.getBoundingClientRect(),p=el.parentElement.getBoundingClientRect();return Math.abs((r.left+r.right)-(p.left+p.right))<2}),'Catalog heading centered');
        assert.equal(await page.locator('.ft-benefits').evaluate(el=>getComputedStyle(el).paddingBottom),'10px');
        assert.ok(await page.locator('.ft-benefits').evaluate(el=>el.getBoundingClientRect().top>=document.querySelector('#deliveryInfo').getBoundingClientRect().bottom),'Service strip does not overlap delivery');
      }
      if(width<=600){
        assert.ok(await page.locator('.ft-links').evaluate(el=>{
          const s=getComputedStyle(el),r=el.getBoundingClientRect();
          return s.paddingTop==='10px'&&s.paddingBottom==='10px'&&el.scrollHeight<=el.clientHeight&&[...el.querySelectorAll('button,a')].every(b=>{const c=b.closest('section').getBoundingClientRect(),a=b.getBoundingClientRect();return a.top>=r.top&&a.bottom<=r.bottom&&Math.abs(a.left+a.right-c.left-c.right)<2});
        }),'Footer links centered without clipping');
        assert.equal(await page.locator('.ft-brand').evaluate(el=>getComputedStyle(el).aspectRatio),'1164 / 370');
      }
      if(width<=780){
        const filters=page.locator('#filters'),buttons=filters.locator('button'),n=await buttons.count();assert.ok(n>=7);
        assert.equal(await filters.evaluate(el=>getComputedStyle(el).flexWrap),'nowrap');
        await buttons.nth(n-1).click();
        await page.waitForFunction(()=>{const e=document.querySelector('#filters');return Math.abs(e.scrollWidth-e.clientWidth-e.scrollLeft)<2});
        await buttons.first().click();await page.waitForFunction(()=>document.querySelector('#filters').scrollLeft<2);
        await filters.scrollIntoViewIfNeeded();
        if(await filters.evaluate(el=>el.scrollWidth>el.clientWidth)){
        const box=await filters.boundingBox();
        const session=await page.context().newCDPSession(page);
        await session.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:box.x+box.width-20,y:box.y+box.height/2}]});
        for(const offset of [40,80,120,160])await session.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:box.x+box.width-20-offset,y:box.y+box.height/2}]});
        await session.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await session.detach();
        await page.waitForFunction(()=>document.querySelector('#filters').scrollLeft>10);
        }else assert.equal(await buttons.evaluateAll(els=>els.every(el=>el.getBoundingClientRect().right<=innerWidth)),true);
        await page.locator('#mobileMenuToggle').click();await page.locator('#mobileAccountEntry').click();
      }else await page.locator('#openCustomerAccount').click();
      assert.equal(await page.locator('#customerAccountDialog').isVisible(),true);
      await page.locator('#customerAccountBack').click();
      if([390,1710].includes(width)){
        await page.locator('#filters button').first().click();
        await page.locator('#productGrid .add').first().click();await page.locator('#openCart').click();
        assert.equal(await page.locator('#checkout').isEnabled(),true);
        await page.locator('#checkout').click();assert.equal(await page.locator('#orderDialog').isVisible(),true);
      }
      cases++;console.log(`PASS storefront geometry/header/category ${width}px touch=${width<=780}`);
    }finally{await fixture.close()}
  }
  return cases;
};
