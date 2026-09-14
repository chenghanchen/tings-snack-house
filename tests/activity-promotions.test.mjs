import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';

const source = await readFile(new URL('../activity-promotions.js', import.meta.url), 'utf8');
function setup() {
  let now = Date.parse('2026-09-14T12:00:00Z'), callback, pending;
  const offer = {}, button = {}, welcome = {}, popular = {}, fresh = {}, card = {querySelector:()=>button};
  const track = {children:[welcome,popular,fresh,card],querySelector:()=>popular,addEventListener(){},
    insertBefore(node,before){this.children=this.children.filter(item=>item!==node);this.children.splice(this.children.indexOf(before),0,node)},
    append(node){this.children=this.children.filter(item=>item!==node);this.children.push(node)}};
  Object.defineProperty(card,'nextElementSibling',{get:()=>track.children[track.children.indexOf(card)+1] || null});
  const events = {}, store = {campaigns:null,subscribeCampaigns(fn){callback=fn}};
  const document = {querySelector:()=>track,getElementById:id=>id==='activityPromotionCard'?card:offer,
    addEventListener(name,fn){events[name]=fn},hidden:false};
  vm.runInNewContext(source,{document,window:{TingsStorefront:store,addEventListener(){}},
    Date:{now:()=>now,parse:Date.parse},setTimeout(fn,delay){pending={fn,delay};return 1},clearTimeout(){pending=null}});
  return {offer,button,card,track,events,store,
    publish(value){store.campaigns=value;callback(value)},
    advance(milliseconds){now+=milliseconds;pending.fn()},
    get delay(){return pending?.delay}};
}
const promo = extra => ({id:'test',active:true,status:'published',kind:'product_discount',discount_kind:'percent',amount:10,...extra});

test('限定促销只读真实活动：未开始、过期、停用、草稿和无效优惠不展示', () => {
  assert.doesNotMatch(source,/\.from\(|\.rpc\(|functions\.invoke|innerHTML/);
  const ui=setup();
  ui.publish([]);
  assert.equal(ui.offer.textContent,'敬请期待');
  assert.equal(ui.button.disabled,true);
  assert.equal(ui.track.children.at(-1),ui.card);
  for(const extra of [
    {active:false},{active:null},{status:'draft'},{starts_at:'2026-09-15T00:00:00Z'},
    {ends_at:'2026-09-13T00:00:00Z'},{starts_at:'not a date'},{ends_at:'bad date'},
    {amount:0},{amount:-10},{amount:Infinity},{amount:'<img onerror=bad>'},{amount:101},{kind:'retired'}
  ]) {
    ui.publish([promo(extra)]);
    assert.equal(ui.offer.textContent,'敬请期待',JSON.stringify(extra));
    assert.equal(ui.button.disabled,true);
  }
  ui.publish([promo({name:'<img onerror=bad>'})]);
  assert.equal(ui.offer.textContent,'10% OFF');
  assert.equal(ui.button.disabled,false);
  assert.equal(ui.track.children[1],ui.card);
  ui.publish([promo({active:false})]);
  assert.equal(ui.track.children.at(-1),ui.card);
});

test('限定促销显示全部有效优惠并去重，保留门槛、指定商品和新客限制', () => {
  const ui=setup();
  ui.publish([
    promo({}),promo({}),
    promo({kind:'full_reduction',threshold:35,amount:5}),
    promo({discount_kind:'fixed',amount:1.5,product_ids:[1],customer_scope:'new'}),
    promo({kind:'free_shipping',amount:0}),
    promo({kind:'full_reduction',threshold:'bad',amount:5})
  ]);
  assert.equal(ui.offer.textContent,'10% OFF\n满 $35 减 $5\n新客：指定商品 每件减 $1.50\n配送费全免');
  assert.equal(ui.offer.title,ui.offer.textContent);
  assert.equal(ui.offer.tabIndex,0);
  ui.publish(null);
  assert.equal(ui.offer.textContent,'敬请期待');
});

test('活动定时开始与结束无需后台再次推送，回到页面也刷新', () => {
  const ui=setup();
  ui.publish([promo({starts_at:'2026-09-14T12:00:01Z',ends_at:'2026-09-14T12:00:02Z'})]);
  assert.equal(ui.offer.textContent,'敬请期待');
  assert.equal(ui.delay,1000);
  ui.advance(1000);
  assert.equal(ui.offer.textContent,'10% OFF');
  assert.equal(ui.track.children[1],ui.card);
  ui.advance(1000);
  assert.equal(ui.offer.textContent,'10% OFF','end timestamp is inclusive, consistent with checkout');
  ui.advance(20);
  assert.equal(ui.offer.textContent,'敬请期待');
  assert.equal(ui.track.children.at(-1),ui.card);
  ui.events.visibilitychange();
  assert.equal(ui.button.disabled,true);
});
