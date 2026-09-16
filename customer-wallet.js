/* Identity and network access are supplied by the isolated customer account module. */
'use strict';
window.createTingsWallet = ({rpc, identity, onError, dialog}) => {
  const el=(tag,text,className)=>{const node=document.createElement(tag);if(text!=null)node.textContent=text;if(className)node.className=className;return node;};
  const money=value=>`$${Number(value).toFixed(2).replace(/\.00$/,'')}`;
  const amount=c=>c.discount_kind==='free_shipping'?'免配送费':c.discount_kind==='percent'?`${Number(((100-Number(c.amount))/10).toFixed(2))}折`:money(c.amount);
  const date=value=>value ? new Date(value).toLocaleDateString('en-US') : '无固定期限';
  const couponsPanel=dialog.querySelector('#customerCouponsPanel'),rewardsPanel=dialog.querySelector('#customerRewardsPanel');
  let request=0, wallet=null, selectedCode='',previewResult=null,availableExpanded=false;
  const claiming=new Set(),justClaimed=new Set(),checkoutCards=new Map();
  const checkout=el('section',null,'customer-wallet-checkout'); checkout.id='customerWalletCheckout'; checkout.hidden=true;
  document.querySelector('#promotionChoice').before(checkout);
  const couponInput=document.querySelector('#couponCodeInput');
  couponInput.addEventListener('input',()=>{
    selectedCode=couponInput.value.trim().toUpperCase();
    previewResult=null;syncCheckout();
  });
  function reset(){
    request++;wallet=null;previewResult=null;availableExpanded=false;claiming.clear();justClaimed.clear();checkoutCards.clear();checkout.hidden=true;checkout.replaceChildren();
    window.dispatchEvent(new CustomEvent('tings:wallet-summary',{detail:null}));
    couponsPanel.replaceChildren();rewardsPanel.replaceChildren();
    if(selectedCode&&couponInput.value.trim().toUpperCase()===selectedCode){couponInput.value='';couponInput.dispatchEvent(new Event('input',{bubbles:true}));}
    selectedCode='';
    document.querySelector('#promotionChoice').hidden=false;
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
    node.dataset.status=c.status;
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
    if(showSource)title.append(el('span',`【${({new:'新人券',regular:'店铺优惠券',referral:'推荐奖励'})[c.kind]||'店铺优惠券'}】：`,'customer-coupon-source'));
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
      const action=button(c.status==='claimable'?'立即领取':'去使用',()=>{
        if(c.status==='claimable')void claim(c,action,reason);
        else {choose(c);dialog.close();if(document.querySelector('#orderDialog').open)checkout.querySelector('input:checked:not(:disabled)')?.focus();else window.TingsCart?.open();}
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
    checkout.replaceChildren();checkoutCards.clear();document.querySelector('#promotionChoice').hidden=false;
    checkout.hidden=!identity()||!wallet; if(checkout.hidden)return;
    const rows=wallet.coupons.filter(c=>c.status!=='claimable');
    checkout.dataset.availableCollapsed=String(!availableExpanded&&!rows.some(c=>c.code===couponInput.value.trim().toUpperCase()));
    checkout.dataset.hasSelected=String(rows.some(c=>c.code===couponInput.value.trim().toUpperCase()));
    if(!rows.length){checkout.hidden=true;return;}
    checkoutCards.clear();
    const fieldset=el('fieldset'),legend=el('legend');
    legend.append(el('span','优惠券'),el('small','每单限用一张；推荐奖励与优惠券不能叠加。','customer-wallet-rules'));
    fieldset.append(legend);
    for(const c of [{code:'',name:'不使用账户优惠券'}]){
      const label=el('label'),radio=el('input');radio.type='radio';radio.name='wallet_coupon_choice';radio.value=c.code;radio.checked=c.code===couponInput.value.trim().toUpperCase();
      const text=c.code?`${amount(c)} · ${c.name} · 满 $${Number(c.min_spend).toFixed(2)} 可用`:c.name;
      label.append(radio,el('span',text));fieldset.append(label);
      const optOut=()=>{if(!radio.checked)return;availableExpanded=false;if(couponInput.value)choose(null);else syncCheckout();};
      radio.onchange=optOut;radio.onclick=optOut;
    }
    const availableToggle=button('',()=>{availableExpanded=!availableExpanded;syncCheckout();});
    availableToggle.className='customer-coupon-toggle';fieldset.append(availableToggle);
    const history=el('details',null,'customer-coupon-history');history.append(el('summary','查看不可用优惠券及原因'));fieldset.append(history);
    for(const c of rows){const node=card(c,true,true);if(unavailable(c,true))history.append(node);else fieldset.insertBefore(node,history);}
    checkout.append(fieldset);syncCheckout();
  }
  function syncCheckout(){
    const hasSelected=!!identity()&&!!wallet&&!checkout.hidden&&checkoutCards.has(couponInput.value.trim().toUpperCase());
    document.querySelector('#promotionChoice').hidden=hasSelected;
    const fieldset=checkout.querySelector('fieldset'),history=fieldset?.querySelector('.customer-coupon-history');
    // Rebuild when eligibility or folding changes to avoid stale container-query layout on restored cards.
    if(history&&(checkout.dataset.hasSelected!==String(hasSelected)||checkout.dataset.availableCollapsed!==String(!hasSelected&&!availableExpanded)||[...checkoutCards.values()].some(({c,node})=>node.parentElement!==(unavailable(c,true)?history:fieldset)))){
      const wasOpen=history.open,focused=document.activeElement,focusedCode=focused?.name==='wallet_coupon_choice'?focused.value:null;
      renderCheckout();
      const nextHistory=checkout.querySelector('.customer-coupon-history');if(nextHistory&&!nextHistory.hidden)nextHistory.open=wasOpen;
      if(focusedCode!=null){const target=[...checkout.querySelectorAll('input')].find(input=>input.value===focusedCode);if(target?.disabled&&nextHistory&&!nextHistory.open)nextHistory.querySelector('summary').focus();else target?.focus();}
      else if(focused?.classList.contains('customer-coupon-toggle'))checkout.querySelector('.customer-coupon-toggle')?.focus();
      return;
    }
    let unavailableCount=0,availableCount=0;
    const deliveryText=window.TingsCouponContext?.().deliveryText;
    if(deliveryText)for(const node of document.querySelectorAll('.customer-coupon-delivery-info'))node.textContent=deliveryText;
    for(const radio of checkout.querySelectorAll('input'))radio.checked=radio.value===couponInput.value.trim().toUpperCase();
    for(const {c,node,radio,text,reason} of checkoutCards.values()){
      const why=unavailable(c,true);
      node.hidden=!why&&!hasSelected&&!availableExpanded;
      radio.checked=radio.value===couponInput.value.trim().toUpperCase();
      radio.disabled=!!why;reason.textContent=why;reason.hidden=!why;
      node.classList.toggle('is-selected',radio.checked);node.classList.toggle('is-unavailable',!!why);text.textContent=why?'不可用':radio.checked?'✓ 已选':'使用';
      if(why)unavailableCount++;else availableCount++;
    }
    const availableToggle=checkout.querySelector('.customer-coupon-toggle');
    if(availableToggle){availableToggle.hidden=hasSelected||!availableCount;availableToggle.textContent=`${availableExpanded?'收起':'展开'}可用优惠券（${availableCount}）`;availableToggle.setAttribute('aria-expanded',String(availableExpanded||hasSelected));}
    if(history){history.hidden=!unavailableCount;history.querySelector('summary').textContent=`查看不可用优惠券及原因（${unavailableCount}）`;if(!unavailableCount)history.open=false;}
  }
  document.querySelector('#orderForm').addEventListener('input',event=>{if(event.target.name!=='wallet_coupon_choice')syncCheckout()});
  document.querySelector('#orderForm').addEventListener('change',syncCheckout);
  window.addEventListener('tings:coupon-context',syncCheckout);
  window.addEventListener('tings:coupon-preview',event=>{previewResult=event.detail;syncCheckout()});
  function renderRewards(){
    rewardsPanel.replaceChildren();
    const hero=el('section',null,'referral-hero');
    hero.append(el('p','邀请好友 · 双方有礼','referral-eyebrow'));
    const benefits=el('div',null,'referral-benefits');
    for(const [label,value,note] of [['好友首单','满 $30 减 $5','符合新客条件即可享受'],['你的奖励','满 $30 减 $5 奖励券','好友订单完成后发放 · 有效期 90 天']]){
      const benefit=el('div');benefit.append(el('p',label,'referral-benefit-label'),el('strong',value),el('p',note,'referral-benefit-note'));benefits.append(benefit);
    }
    hero.append(benefits);rewardsPanel.append(hero);
    const codeCard=el('section',null,'referral-code-card');codeCard.append(el('h3','我的推荐码'));
    if(!wallet.referral_codes.length)codeCard.append(el('p','推荐码暂未生成，请返回后重新打开推荐奖励。','customer-muted'));
    for(const item of wallet.referral_codes){
      const codeRow=el('div',null,'referral-code-row'),code=el('code',item.code),feedback=el('p','','referral-action-status');
      feedback.setAttribute('role','status');feedback.setAttribute('aria-live','polite');
      const stamp=identity(),current=()=>identity()===stamp&&codeCard.isConnected;
      const copy=button('复制',async()=>{
        if(!current())return;
        try{await navigator.clipboard.writeText(item.code);if(current()){copy.textContent='已复制';feedback.textContent='推荐码已复制，分享给好友吧。';}}
        catch{if(current())feedback.textContent='暂时无法复制，请长按或选中推荐码手动复制。';}
      });
      copy.className='referral-copy';copy.setAttribute('aria-label','复制推荐码');
      codeRow.append(code,copy);codeCard.append(codeRow);
      codeCard.append(el('p','把推荐码分享给新用户，好友首次符合条件的订单即可享受优惠。','customer-muted'));
      const text=`我在婷婷的零食屋买零食，符合条件的新客首次下单满 $30 可以减 $5。\n推荐码：${item.code}`;
      const url='https://tings-snack-house.pages.dev/';
      const invitation=`${text}\n${url}`;
      const copyInvitation=button('复制邀请文案',async()=>{
        if(!current())return;
        copyInvitation.disabled=true;share.disabled=true;feedback.textContent='';
        try{
          await navigator.clipboard.writeText(invitation);
          if(current())feedback.textContent='邀请文案和链接已复制，请打开微信，选择好友后粘贴发送。';
        }catch{if(current())feedback.textContent='暂时无法复制邀请文案，请长按或选中上方推荐码手动复制。';}
        finally{if(current()){copyInvitation.disabled=false;share.disabled=false;}}
      });
      const share=button('系统分享',async()=>{
        if(!current())return;
        share.disabled=true;copyInvitation.disabled=true;feedback.textContent='';
        try{
          if(typeof navigator.share==='function'){
            await navigator.share({title:'婷婷的零食屋 · 邀请好友',text,url});
            // Native hand-off does not confirm recipient selection or message delivery.
          }else{
            if(current())feedback.textContent='当前浏览器不支持系统分享，请点击“复制邀请文案”后发送给好友。';
          }
        }catch(error){if(current())feedback.textContent=error?.name==='AbortError'?'已取消分享。':'暂时无法分享，请点击“复制邀请文案”后发送给好友。';}
        finally{if(current()){share.disabled=false;copyInvitation.disabled=false;}}
      });
      share.className='customer-primary referral-share';copyInvitation.className='referral-copy-invitation';
      const actions=el('div',null,'referral-share-actions');actions.append(share,copyInvitation);
      codeCard.append(actions,el('p','请以微信中的实际发送结果为准；也可复制邀请文案，粘贴给好友。','customer-muted'),feedback);
    }
    rewardsPanel.append(codeCard);
    const rewardCoupons=wallet.coupons.filter(c=>c.kind==='referral');
    if(rewardCoupons.length){
      const earned=el('details',null,'referral-earned');earned.append(el('summary',`我的奖励 · ${rewardCoupons.filter(c=>c.status==='available').length} 张可用`));
      groups(earned,rewardCoupons);rewardsPanel.append(earned);
    }
    const history=el('section',null,'referral-history'),heading=el('div',null,'referral-section-heading');
    heading.append(el('h3','推荐记录'),el('span',`${wallet.history.length} 条`));history.append(heading);
    if(!wallet.history.length){
      const empty=el('div',null,'referral-empty'),gift=el('span','🎁','referral-empty-icon');gift.setAttribute('aria-hidden','true');
      empty.append(gift,el('strong','还没有推荐记录'),el('p','分享推荐码给好友，完成首单后奖励会显示在这里。'));history.append(empty);
    }else{
      const list=el('ul',null,'referral-history-list');
      const states={pending:['等待订单完成','待确认','pending'],rewarded:['好友首单完成','已获得','rewarded'],cancelled:['好友首单取消','未获得奖励','cancelled'],revoked:['订单取消，奖励已撤销','奖励已撤销','revoked'],ineligible:['未满足奖励条件','未获得奖励','ineligible']};
      const labels={'等待订单完成':'pending','奖励已发放':'rewarded','订单已取消，未发奖励':'cancelled','订单取消，奖励已撤销':'revoked','未满足奖励条件':'ineligible'};
      for(const item of wallet.history){
        const state=states[labels[item.status]||item.status]||['推荐记录更新','待核实','unknown'];
        const row=el('li'),time=el('time'),copy=el('span',state[0],'referral-history-label');
        const parsed=new Date(item.created_at);const valid=Number.isFinite(parsed.getTime());
        time.textContent=valid?parsed.toLocaleDateString('en-US',{month:'2-digit',day:'2-digit'}):'—';
        if(valid){time.dateTime=parsed.toISOString();time.title=date(item.created_at);}
        const status=el('span',state[2]==='rewarded'?`${state[1]} ${money(item.reward_amount)}`:state[1],'referral-status');
        row.dataset.status=state[2];row.append(time,copy,status);list.append(row);
      }
      history.append(list);
    }
    rewardsPanel.append(history);
    const rules=el('section',null,'referral-rules');rules.append(el('h3','推荐规则'));
    const highlights=el('ul');
    for(const line of ['新客首单满 $30 减 $5','订单完成后，你获得满 $30 减 $5 奖励券','奖励券有效期 90 天'])highlights.append(el('li',line));
    const full=el('details',null,'referral-full-rules');full.append(el('summary','查看完整规则'));
    const terms=el('ul');
    for(const line of ['每位新客终身仅享一次推荐新客优惠，更换推荐码不重复享受；游客也可使用。','资格按登录账户、规范化邮箱、规范化手机号及历史订单/推荐记录核验。已有完成订单的顾客不属于新客。','进行中的订单暂占新客资格，尚不发放推荐奖励；未完成便取消可重试。','订单完成后确认并发放奖励；完成后取消或退款不恢复新客资格，订单取消可能导致已发奖励撤销。','推荐码与奖励只属于当前邮箱账户，奖励不可转让；推荐优惠不可与优惠券叠加使用。'])terms.append(el('li',line));
    full.append(terms);rules.append(highlights,full);rewardsPanel.append(rules);
  }
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
    renderRewards();
    renderCheckout();
  }
  async function load(){
    if(!identity()){reset();return;}
    const stamp=identity(),ticket=++request;
    for(const panel of [couponsPanel,rewardsPanel]){panel.replaceChildren(el('p','正在加载优惠券和奖励…'));panel.setAttribute('aria-busy','true');}
    checkout.hidden=true;document.querySelector('#promotionChoice').hidden=false;
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
    }finally{if(stamp===identity()&&ticket===request){for(const panel of [couponsPanel,rewardsPanel])panel.setAttribute('aria-busy','false');}}
  }
  return {load,reset};
};
