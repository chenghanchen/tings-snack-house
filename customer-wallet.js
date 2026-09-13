/* Identity and network access are supplied by the isolated customer account module. */
'use strict';
window.createTingsWallet = ({rpc, identity, onError, dialog}) => {
  const el=(tag,text,className)=>{const node=document.createElement(tag);if(text!=null)node.textContent=text;if(className)node.className=className;return node;};
  const amount=c=>c.discount_kind==='percent' ? `${Number(c.amount)}% OFF` : `$${Number(c.amount).toFixed(2)} OFF`;
  const date=value=>value ? new Date(value).toLocaleDateString('en-US') : '无固定期限';
  const couponsPanel=dialog.querySelector('#customerCouponsPanel'),rewardsPanel=dialog.querySelector('#customerRewardsPanel');
  let request=0, wallet=null, selectedCode='';
  const checkout=el('section',null,'customer-wallet-checkout'); checkout.id='customerWalletCheckout'; checkout.hidden=true;
  document.querySelector('#promotionChoice').before(checkout);
  const couponInput=document.querySelector('#couponCodeInput');
  couponInput.addEventListener('input',()=>{
    selectedCode=couponInput.value.trim().toUpperCase();
    for(const radio of checkout.querySelectorAll('input'))radio.checked=radio.value===selectedCode;
  });
  function reset(){
    request++;wallet=null;checkout.hidden=true;checkout.replaceChildren();
    couponsPanel.replaceChildren();rewardsPanel.replaceChildren();
    if(selectedCode&&couponInput.value.trim().toUpperCase()===selectedCode){couponInput.value='';couponInput.dispatchEvent(new Event('input',{bubbles:true}));}
    selectedCode='';
  }
  function button(text,fn){const node=el('button',text);node.type='button';node.onclick=fn;return node;}
  function card(c){
    const node=el('article',null,'customer-coupon-card');
    node.append(el('strong',amount(c)),el('h4',c.name),el('p',`满 $${Number(c.min_spend).toFixed(2)} 可用`),
      el('p',c.ends_at?`有效期至 ${date(c.ends_at)}`:'无固定到期日'),
      el('small',c.allow_campaign_stack===false?'不可与活动叠加':'活动叠加以结算核算为准'));
    if(c.starts_at&&new Date(c.starts_at)>new Date())node.append(el('p',`开始于 ${date(c.starts_at)}`));
    node.append(el('code',c.code));
    for(const use of c.uses||[])node.append(el('p',use.order_number?`使用于订单 ${use.order_number}`:`已于 ${date(use.used_at)} 使用（历史订单）`));
    return node;
  }
  function groups(panel,rows){
    for(const [status,title] of [['available','可用优惠券'],['used','已使用'],['expired','已过期'],['unavailable','暂不可用']]){
      const matching=rows.filter(c=>c.status===status);if(!matching.length)continue;
      panel.append(el('h3',title),...matching.map(card));
    }
    if(!rows.length)panel.append(el('p','暂无优惠券。符合活动条件后，奖励会显示在这里。','customer-muted'));
  }
  function renderCheckout(){
    document.querySelector('#promotionChoice').before(checkout);
    checkout.replaceChildren();checkout.hidden=!identity()||!wallet; if(checkout.hidden)return;
    const rows=wallet.coupons.filter(c=>c.status==='available');
    if(!rows.length){checkout.hidden=true;return;}
    const fieldset=el('fieldset'),legend=el('legend','可用优惠券（每单选择一张）');
    fieldset.append(legend);
    for(const c of [{code:'',name:'不使用账户优惠券'},...rows]){
      const label=el('label'),radio=el('input');radio.type='radio';radio.name='wallet_coupon_choice';radio.value=c.code;radio.checked=c.code===couponInput.value.trim().toUpperCase();
      const text=c.code?`${amount(c)} · ${c.name} · 满 $${Number(c.min_spend).toFixed(2)} 可用`:c.name;
      label.append(radio,el('span',text));fieldset.append(label);
      radio.onchange=()=>{if(!radio.checked)return;selectedCode=c.code;couponInput.value=c.code;couponInput.dispatchEvent(new Event('input',{bubbles:true}));};
    }
    checkout.append(fieldset,el('small','选择后核算门槛和活动冲突；也可在下方输入兑换码，两者不会叠加。'));
  }
  function render(){
    couponsPanel.replaceChildren(button('刷新优惠券',()=>load()));
    for(const [kind,title] of [['regular','普通优惠券'],['new','新人优惠券']]){
      couponsPanel.append(el('h3',title));groups(couponsPanel,wallet.coupons.filter(c=>c.kind===kind));
    }
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
      const message=error?.code==='PGRST202'?'优惠券服务尚未完成数据库升级，请联系店主。':onError(error,'优惠券暂时无法加载，请重试。');
      for(const panel of [couponsPanel,rewardsPanel])panel.replaceChildren(el('p',message),button('重试',()=>load()));
      if(document.querySelector('#orderDialog').open){checkout.hidden=false;checkout.replaceChildren(el('p',message),button('重新加载优惠券',()=>load()));}
    }finally{if(stamp===identity()&&ticket===request)for(const panel of [couponsPanel,rewardsPanel])panel.setAttribute('aria-busy','false');}
  }
  return {load,reset};
};
