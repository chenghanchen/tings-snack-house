import test from 'node:test';
import assert from 'node:assert/strict';
import tools from '../customer-order-tools.js';
const product = {id:1,name:'饼干',price:6,stock:10,is_active:true};
const catalog = {products:[product],variants:[],groups:[]};
test('reorder uses current price, keeps existing cart and caps duplicate lines to remaining stock',()=>{
  const cart=[{key:'p-1',qty:7}];
  const result=tools.planReorder([{product_id:1,qty:2,price:0.01},{product_id:1,qty:3}],catalog,cart);
  assert.equal(result.additions.length,1);
  assert.equal(result.additions[0].qty,3);
  assert.equal(result.additions[0].price,6);
  assert.equal(cart[0].qty,7);
  assert.match(result.issues[0],/最多可再加入 1 件/);
});
test('reorder rejects removed products, inactive stock, malformed quantities and changed variants',()=>{
  for (const line of [{product_id:99,qty:1},{product_id:1,variant_id:33,qty:1},{product_id:1,qty:-1},{product_id:1,qty:1.2},{product_id:1,qty:Infinity}])
    assert.equal(tools.planReorder([line],catalog).additions.length,0);
  for (const changes of [{is_active:false},{stock:0},{stock:Infinity},{is_out_of_stock:true},{price:'bad'}])
    assert.equal(tools.planReorder([{product_id:1,qty:1}],{...catalog,products:[{...product,...changes}]}).additions.length,0);
  assert.equal(tools.planReorder([{product_id:1,qty:1}],{...catalog,groups:[{product_id:1}]}).additions.length,0);
});
test('reorder retains exact variant identity and never substitutes a variant from another product',()=>{
  const variant={id:2,product_id:1,price:8,stock:4,option_values:[{name:'香辣味'}]};
  const data={...catalog,groups:[{product_id:1}],variants:[variant]};
  assert.equal(tools.planReorder([{product_id:1,variant_id:2,qty:2}],data).additions[0].label,'香辣味');
  assert.equal(tools.planReorder([{product_id:1,variant_id:2,qty:2}],{...data,variants:[{...variant,product_id:9}]}).additions.length,0);
});
test('cancellation distinguishes requested, rejected and final cancellation without promising refunds',()=>{
  assert.equal(tools.cancellationState({status:'待确认'}).canRequest,true);
  assert.equal(tools.cancellationState({status:'已确认',cancellation_requested:true}).canRequest,false);
  assert.match(tools.cancellationState({status:'已确认',cancellation_rejected_at:'2026-09-11'}).title,/未通过/);
  assert.equal(tools.cancellationState({status:'已取消',cancellation_requested:true}).title,'订单已取消');
  assert.equal(tools.cancellationState({status:'已完成'}).canRequest,false);
});
