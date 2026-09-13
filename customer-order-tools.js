/* Pure account helpers. Reorders never use historical prices or infer a variant. */
(function (root) {
  'use strict';
  const id = value => value != null && /^[1-9][0-9]*$/.test(String(value)) ? String(value) : null;
  function planReorder(items, catalog, cart = []) {
    const additions = [], issues = [], reserved = new Map();
    for (const row of cart) reserved.set(row.key, (reserved.get(row.key) || 0) + Math.max(0, Number(row.qty) || 0));
    for (const line of Array.isArray(items) ? items : []) {
      const name = String(line?.name || '商品');
      const problem = text => issues.push(`${name}：${text}`);
      const product = catalog.products.find(p => id(p.id) && id(p.id) === id(line?.product_id));
      if (!product || product.is_active === false) { problem('已下架或无法找到，未加入'); continue; }
      const hasVariant = line.variant_id != null;
      const variant = hasVariant && catalog.variants.find(v => id(v.id) && id(v.id) === id(line.variant_id) && id(v.product_id) === id(product.id));
      const requiresVariant = catalog.groups.some(g => id(g.product_id) === id(product.id));
      if ((hasVariant && !variant) || (!hasVariant && requiresVariant) || (hasVariant && !requiresVariant)) {
        problem('规格已变更，请到商品列表重新选择'); continue;
      }
      const requested = Number(line.qty), price = Number(variant ? variant.price : product.price);
      if (!Number.isSafeInteger(requested) || requested < 1 || !Number.isFinite(price) || price < 0) {
        problem('数量或价格无法确认，未加入'); continue;
      }
      const stock = Math.max(0, Math.floor(Number(variant ? variant.stock : product.stock) || 0));
      if (!Number.isFinite(stock) || !stock || (variant ? variant.is_out_of_stock : product.is_out_of_stock)) { problem('暂时缺货，未加入'); continue; }
      const key = variant ? `v-${variant.id}` : `p-${product.id}`;
      const available = Math.max(0, stock - (reserved.get(key) || 0));
      const qty = Math.min(requested, available);
      if (!qty) { problem('购物篮数量已达到当前库存，未重复加入'); continue; }
      if (qty < requested) problem(`原购 ${requested} 件，当前最多可再加入 ${qty} 件`);
      reserved.set(key, (reserved.get(key) || 0) + qty);
      const existing = additions.find(row => row.key === key);
      if (existing) existing.qty += qty;
      else additions.push({key, product, variant: variant || null, price, stock, out: false,
        image: variant?.image || product.image,
        label: variant?.option_values?.map(x => x.name).join(' / ') || '', qty});
    }
    return {additions, issues};
  }
  function cancellationState(order) {
    if (order.status === '已取消') return {title:'订单已取消', text:'订单已取消，以店主确认的最终处理结果为准。', canRequest:false};
    if (order.cancellation_requested) return {title:'取消申请处理中', text:'申请已提交，尚不代表订单已取消。请等待店主处理。', canRequest:false};
    const canRequest = ['待确认','已确认'].includes(order.status);
    if (order.cancellation_rejected_at) return {title:'取消申请未通过', text:`上次申请未通过，订单仍按当前状态处理。${canRequest ? '如仍需取消，可重新填写原因申请。' : ''}`, canRequest};
    return {title:'', text:canRequest ? '提交取消申请后，需等待店主确认。' : '当前阶段不支持在线申请取消，请联系店主。', canRequest};
  }
  const api = {planReorder, cancellationState};
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.TingsOrderTools = api;
})(typeof window === 'undefined' ? globalThis : window);
