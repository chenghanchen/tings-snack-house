/* Identity and network access are supplied by the isolated customer account module. */
'use strict';
window.createTingsWallet = ({rpc, identity, onError, dialog}) => {
  const el=(tag,text,className)=>{const node=document.createElement(tag);if(text!=null)node.textContent=text;if(className)node.className=className;return node;};
  const money=value=>`$${Number(value).toFixed(2).replace(/\.00$/,'')}`;
  const amount=c=>c.discount_kind==='free_shipping'?'免配送费':c.discount_kind==='percent'?`${Number(((100-Number(c.amount))/10).toFixed(2))}折`:money(c.amount);
  const date=value=>value ? new Date(value).toLocaleDateString('en-US') : '无固定期限';
  const couponsPanel=dialog.querySelector('#customerCouponsPanel'),rewardsPanel=dialog.querySelector('#customerRewardsPanel');
  const refreshCoupons=dialog.querySelector('#customerRefreshCoupons');
  refreshCoupons.onclick=()=>load();
  let request=0, wallet=null, selectedCode='',previewResult=null;
  const claiming=new Set(),justClaimed=new Set(),checkoutCards=new Map();
  const checkout=el('section',null,'customer-wallet-checkout'); checkout.id='customerWalletCheckout'; checkout.hidden=true;
  document.querySelector('#promotionChoice').before(checkout);
  const couponInput=document.querySelector('#couponCodeInput');
  couponInput.addEventListener('input',()=>{
    selectedCode=couponInput.value.trim().toUpperCase();
    previewResult=null;syncCheckout();
  });
  function reset(){
    request++;wallet=null;previewResult=null;claiming.clear();justClaimed.clear();checkoutCards.clear();checkout.hidden=true;checkout.replaceChildren();
    window.dispatchEvent(new CustomEvent('tings:wallet-summary',{detail:null}));
    refreshCoupons.disabled=false;
    couponsPanel.replaceChildren();rewardsPanel.replaceChildren();
    if(selectedCode&&couponInput.value.trim().toUpperCase()===selectedCode){couponInput.value='';couponInput.dispatchEvent(new Event('input',{bubbles:true}));}
    selectedCode='';
  }
  function button(text,fn){const node=el('button',text);node.type='button';node.onclick=fn;return node;}
  function unavailable(c,inCheckout=false){
    if(!['available','claimable'].includes(c.status))return c.unavailable_reason||({expired:'优惠券已过期',used:'此券已使用',unavailable:'暂不符合此券使用条件'})[c.status]||'暂不可用';
    if(c.ends_at&&new Date(c.ends_at)<new Date())return '优惠券已过期';
    if(!inCheckout)return '';
    if(c.status==='claimable')return '请先到账户中领取';
    const context=window.TingsCouponContext?.();
    if(context){
      if(context.subtotal<Number(c.min_spend))return `还差 ${money(Number(c.min_spend)-context.subtotal)} 达到使用门槛`;
      if(c.discount_kind==='free_shipping'&&context.fulfillment!=='delivery')return '仅配送订单可用';
      if(c.discount_kind==='free_shipping'&&context.subtotal<Number(context.minimumDelivery||0))return `店铺最低配送消费为 ${money(context.minimumDelivery)}`;
      if(c.discount_kind==='free_shipping'&&context.delivery<=0)return '本单配送费已免';
    }
    if(previewResult?.code===c.code&&previewResult.valid===false)return previewResult.reason||'本单暂不符合使用条件';
    return '';
  }
  function choose(c){selectedCode=c?.code||'';couponInput.value=selectedCode;couponInput.dispatchEvent(new Event('input',{bubbles:true}));}
  async function claim(c,action,message){
    if(!identity()||claiming.has(c.id))return;
    const stamp=identity();claiming.add(c.id);action.disabled=true;action.textContent='领取中…';
    try{
      const {data,error}=await rpc('claim_customer_coupon',{p_coupon_id:c.id});
      if(error)throw error;if(!data?.claimed)throw new Error('Claim failed');
      if(identity()!==stamp)return;
      justClaimed.add(c.id);await load();
    }catch(error){
      if(identity()!==stamp)return;
      message.textContent=onError(error,error?.code==='PGRST202'?'领券服务尚未升级，请稍后重试。':error?.message||'领取失败，请重试。');
      message.hidden=false;action.textContent='立即领取';action.disabled=false;
    }finally{if(identity()===stamp)claiming.delete(c.id);}
  }
  function card(c,showSource=false,inCheckout=false){
    const node=el('article',null,'customer-coupon-card');
    node.dataset.code=c.code;
    node.dataset.shipping=String(c.discount_kind==='free_shipping');
    const body=el('div',null,'customer-coupon-body'),details=el('div',null,'customer-coupon-details'),aside=el('div',null,'customer-coupon-action');
    body.append(el('strong',amount(c),'customer-coupon-benefit'));
    details.append(el('p',`满 $${Number(c.min_spend).toFixed(2)} 可用`,'customer-coupon-minimum'));
    if(c.discount_kind==='free_shipping'){
      details.append(el('p','仅配送订单 · 店铺当前配送区域','customer-coupon-scope'));
      details.append(el('p','减免整笔配送费','customer-coupon-scope'));
      const deliveryInfo=el('p',window.TingsCouponContext?.().deliveryText||'配送范围以店铺配送说明为准','customer-coupon-delivery-info');
      details.append(deliveryInfo);
    }
    if(c.discount_kind==='percent')details.append(el('p',c.max_discount!=null?`最高减 ${money(c.max_discount)}`:'无固定金额封顶（旧券）','customer-coupon-cap'));
    if(c.customer_scope==='new'||c.kind==='new')details.append(el('p','仅限符合条件的新客','customer-coupon-scope'));
    const title=el('div',null,'customer-coupon-title');
    if(showSource)title.append(el('span',`【${({new:'新人券',regular:'店铺优惠券',referral:'推荐奖励'})[c.kind]||'店铺优惠券'}】`,'customer-coupon-source'));
    title.append(el('h4',c.name));
    details.append(title,el('p',c.status==='claimable'&&c.claim_valid_days?`领取后 ${c.claim_valid_days} 天有效${c.ends_at?'，不超过 '+date(c.ends_at):''}`:c.ends_at?`有效期至 ${date(c.ends_at)}`:'无固定到期日'));
    const usageLimit=!c.requires_claim&&Number(c.per_user_limit)>1?`限用 ${Number(c.per_user_limit)} 次`:'限用一次';
    details.append(el('small',`${usageLimit}，不可与其他优惠券叠加使用${c.allow_campaign_stack===false?'；不可与活动叠加':''}`));
    if(c.starts_at&&new Date(c.starts_at)>new Date())details.append(el('p',`开始于 ${date(c.starts_at)}`));
    for(const use of c.uses||[])details.append(el('p',use.order_number?`使用于订单 ${use.order_number}`:`已于 ${date(use.used_at)} 使用（历史订单）`));
    const reason=el('p',unavailable(c,inCheckout),'customer-coupon-reason');reason.hidden=!reason.textContent;reason.setAttribute('role','status');
    details.append(reason);body.append(details);node.append(body,aside);node.classList.toggle('is-unavailable',!!reason.textContent);
    if(inCheckout){
      const label=el('label',null,'customer-coupon-select'),radio=el('input'),text=el('span','使用');
      radio.type='radio';radio.name='wallet_coupon_choice';radio.value=c.code;radio.setAttribute('aria-label',`使用${c.name}，${amount(c)}`);
      label.append(radio,text);aside.append(label);radio.onchange=()=>{if(radio.checked)choose(c)};
      checkoutCards.set(c.code,{c,node,radio,text,reason});
    }else{
      const action=button(c.status==='claimable'?'立即领取':(c.claimed||justClaimed.has(c.id))?'已领取':'去使用',()=>{
        if(c.status==='claimable')void claim(c,action,reason);
        else {choose(c);dialog.close();if(document.querySelector('#orderDialog').open)couponInput.focus();else window.TingsCart?.open();}
      });
      action.className='customer-coupon-use';action.disabled=!!reason.textContent;
      if(c.status==='claimable')action.classList.add('is-claimable');else if(c.claimed||justClaimed.has(c.id))action.classList.add('is-claimed');
      if(reason.textContent)action.textContent='不可用';if(c.claimed||justClaimed.has(c.id))action.title='已领取，点击去使用';
      aside.append(action);
    }
    return node;
  }
  function groups(panel,rows){
    for(const [status,title] of [['available','可用优惠券'],['used','已使用'],['expired','已过期'],['unavailable','暂不可用']]){
      const matching=rows.filter(c=>c.status===status);if(!matching.length)continue;
      panel.append(el('h3',title),...matching.map(c=>card(c)));
    }
    if(!rows.length)panel.append(el('p','暂无优惠券。符合活动条件后，奖励会显示在这里。','customer-muted'));
  }
  function renderCheckout(){
    document.querySelector('#promotionChoice').before(checkout);
    checkout.replaceChildren();checkout.hidden=!identity()||!wallet; if(checkout.hidden)return;
    const rows=wallet.coupons.filter(c=>c.status!=='claimable');
    if(!rows.length){checkout.hidden=true;return;}
    checkoutCards.clear();
    const fieldset=el('fieldset'),legend=el('legend','账户优惠券（每单选择一张）');
    fieldset.append(legend);
    for(const c of [{code:'',name:'不使用账户优惠券'}]){
      const label=el('label'),radio=el('input');radio.type='radio';radio.name='wallet_coupon_choice';radio.value=c.code;radio.checked=c.code===couponInput.value.trim().toUpperCase();
      const text=c.code?`${amount(c)} · ${c.name} · 满 $${Number(c.min_spend).toFixed(2)} 可用`:c.name;
      label.append(radio,el('span',text));fieldset.append(label);
      radio.onchange=()=>{if(!radio.checked)return;selectedCode=c.code;couponInput.value=c.code;couponInput.dispatchEvent(new Event('input',{bubbles:true}));};
    }
    for(const c of rows.filter(c=>c.status==='available'))fieldset.append(card(c,true,true));
    const historyRows=rows.filter(c=>c.status!=='available');
    if(historyRows.length){const history=el('details',null,'customer-coupon-history');history.append(el('summary','查看不可用优惠券及原因'),...historyRows.map(c=>card(c,true,true)));fieldset.append(history)}
    checkout.append(fieldset,el('small','选择后核算门槛和活动冲突；也可在下方输入兑换码，两者不会叠加。'));syncCheckout();
  }
  function syncCheckout(){
    const deliveryText=window.TingsCouponContext?.().deliveryText;
    if(deliveryText)for(const node of document.querySelectorAll('.customer-coupon-delivery-info'))node.textContent=deliveryText;
    for(const radio of checkout.querySelectorAll('input'))radio.checked=radio.value===couponInput.value.trim().toUpperCase();
    for(const {c,node,radio,text,reason} of checkoutCards.values()){
      const why=unavailable(c,true);radio.disabled=!!why;reason.textContent=why;reason.hidden=!why;
      node.classList.toggle('is-selected',radio.checked);node.classList.toggle('is-unavailable',!!why);text.textContent=why?'不可用':radio.checked?'✓ 已选':'使用';
    }
  }
  document.querySelector('#orderForm').addEventListener('input',event=>{if(event.target.name!=='wallet_coupon_choice')syncCheckout()});
  document.querySelector('#orderForm').addEventListener('change',syncCheckout);
  window.addEventListener('tings:coupon-context',syncCheckout);
  window.addEventListener('tings:coupon-preview',event=>{previewResult=event.detail;syncCheckout()});
  function render(){
    const available=wallet.coupons.filter(c=>c.status==='available');
    const newcomer=available.find(c=>c.kind==='new');
    window.dispatchEvent(new CustomEvent('tings:wallet-summary',{detail:newcomer?{amount:newcomer.amount,min_spend:newcomer.min_spend,discount_kind:newcomer.discount_kind}:null}));
    couponsPanel.replaceChildren(el('h3','可用优惠券'),...available.map(c=>card(c,true)));
    if(!available.length)couponsPanel.append(el('p','暂无可用优惠券。','customer-muted'));
    const claimable=wallet.coupons.filter(c=>c.status==='claimable');
    if(claimable.length)couponsPanel.append(el('h3','可领取优惠券'),...claimable.map(c=>card(c,true)));
    const unavailableRows=wallet.coupons.filter(c=>!['available','claimable'].includes(c.status));
    if(unavailableRows.length){const history=el('details',null,'customer-coupon-history');history.append(el('summary','不可用优惠券'),...unavailableRows.map(c=>card(c,true)));couponsPanel.append(history)}
    rewardsPanel.replaceChildren(button('刷新推荐奖励',()=>load()));
    rewardsPanel.append(el('p','推荐码与奖励只属于当前邮箱账户，手机号仅用于收货联系。'));
    rewardsPanel.append(el('p','新客首个有效订单满 $30 减 $5。订单完成后，您获得一张满 $30 减 $5 的奖励券，有效期 90 天。每位新客仅一次，奖励不可转让。','customer-muted'));
    rewardsPanel.append(el('h3','我的推荐码'));
    if(!wallet.referral_codes.length)rewardsPanel.append(el('p','推荐码暂未生成，请刷新重试。'));
    for(const item of wallet.referral_codes){
      const copy=button('复制推荐码',async()=>{try{await navigator.clipboard.writeText(item.code);copy.textContent='已复制';}catch{copy.textContent='无法复制，请长按上方推荐码复制';}});
      rewardsPanel.append(el('code',item.code),copy,el('p',`新客优惠：满 $${Number(item.min_spend).toFixed(2)} 减 $${Number(item.amount).toFixed(2)}；有效性以结算核算为准。`));
    }
    groups(rewardsPanel,wallet.coupons.filter(c=>c.kind==='referral'));
    rewardsPanel.append(el('h3','推荐记录'));
    if(!wallet.history.length)rewardsPanel.append(el('p','暂无推荐记录。'));
    for(const item of wallet.history)rewardsPanel.append(el('p',`${date(item.created_at)} · ${item.status} · $${Number(item.reward_amount).toFixed(2)}`));
    renderCheckout();
  }
  async function load(){
    if(!identity()){reset();return;}
    const stamp=identity(),ticket=++request;
    refreshCoupons.disabled=true;
    for(const panel of [couponsPanel,rewardsPanel]){panel.replaceChildren(el('p','正在加载优惠券和奖励…'));panel.setAttribute('aria-busy','true');}
    checkout.hidden=true;
    try{
      const {data,error}=await rpc('get_my_customer_wallet');if(error)throw error;
      if(!data||!Array.isArray(data.coupons)||!Array.isArray(data.referral_codes)||!Array.isArray(data.history))throw new Error('Invalid wallet');
      if(stamp!==identity()||ticket!==request)return;
      wallet=data;render();
    }catch(error){
      if(stamp!==identity()||ticket!==request)return;
      wallet=null;
      window.dispatchEvent(new CustomEvent('tings:wallet-summary',{detail:null}));
      const message=error?.code==='PGRST202'?'优惠券服务尚未完成数据库升级，请联系店主。':onError(error,'优惠券暂时无法加载，请重试。');
      for(const panel of [couponsPanel,rewardsPanel])panel.replaceChildren(el('p',message),button('重试',()=>load()));
      if(document.querySelector('#orderDialog').open){checkout.hidden=false;checkout.replaceChildren(el('p',message),button('重新加载优惠券',()=>load()));}
    }finally{if(stamp===identity()&&ticket===request){refreshCoupons.disabled=false;for(const panel of [couponsPanel,rewardsPanel])panel.setAttribute('aria-busy','false');}}
  }
  return {load,reset};
};
