(()=>{const money=n=>`$${Number(n||0).toFixed(2)}`,kinds={full_reduction:'满减活动',product_discount:'商品折扣',category_discount:'分类折扣',holiday:'节日活动',free_shipping:'免费配送'};let db,products=[],categories=[],campaigns=[],coupons=[],orders=[],redemptions=[],referrals=[];const $=s=>document.querySelector(s),esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));function toast(s){const t=$('#toast');if(!t)return;t.textContent=s;t.classList.add('show');setTimeout(()=>t.classList.remove('show'),2600)}const val=(id,v)=>{const e=$('#'+id);if(e)e.value=v??''};const list=v=>(v||[]).join(', ');const csv=v=>String(v||'').split(',').map(x=>x.trim()).filter(Boolean);const local=v=>v?new Date(v).toISOString().slice(0,16):'';
async function load(){const r=await Promise.all([db.from('marketing_campaigns').select('*').order('created_at',{ascending:false}),db.from('marketing_coupons').select('*').order('created_at',{ascending:false}),db.from('orders').select('*').order('created_at',{ascending:false}),db.from('coupon_redemptions').select('*'),db.from('customer_referrals').select('*').order('created_at',{ascending:false}),db.from('products').select('id,name'),db.from('categories').select('name')]);[campaigns,coupons,orders,redemptions,referrals,products,categories]=r.map(x=>x.data||[]);render()}
function render(){const root=$('#marketingCenter');if(!root)return;const active=x=>x.active?'启用中':'已停用',uses=id=>redemptions.filter(x=>x.coupon_id===id).length;const stats=statsFor();root.innerHTML=`<div class="panel marketing-panel"><div class="panel-head"><div><p class="eyebrow">MARKETING CENTER</p><h2>营销中心</h2></div><span class="muted">每笔订单只能选择一项优惠</span></div><div class="marketing-grid"><section><h3>优惠券</h3><form id="couponForm"><input id="couponId" type="hidden"><label>兑换码<input id="couponCode" required placeholder="例如 WELCOME5" style="text-transform:uppercase"></label><label>名称<input id="couponName" required placeholder="例如 新客优惠"></label><div class="two"><label>优惠金额（美元）<input id="couponAmount" type="number" min="0.01" step="0.01" required></label><label>最低消费（美元）<input id="couponMin" type="number" min="0" step="0.01" value="0"></label></div><div class="two"><label>总数量<input id="couponQty" type="number" min="1" value="1" required></label><label>每个电话号码限用<input value="1" disabled><small>固定为 1 次</small></label></div><div class="two"><label>开始时间<input id="couponStart" type="datetime-local"></label><label>结束时间<input id="couponEnd" type="datetime-local"></label></div><button class="primary">保存优惠券</button><button id="couponReset" class="text-btn" type="button">新增</button></form><div class="marketing-list">${coupons.map(x=>`<article><b>${esc(x.name)}</b><small>${esc(x.code)} · ${money(x.amount)}，满 ${money(x.min_spend)} 可用 · 已用 ${uses(x.id)}/${x.total_quantity} · ${active(x)}</small><div><button data-edit-coupon="${x.id}">编辑</button><button data-stop-coupon="${x.id}" ${x.active?'':'disabled'}>停用</button></div></article>`).join('')||'<p class="muted">尚无优惠券。</p>'}</div></section><section><h3>活动设置</h3><form id="campaignForm"><input id="campaignId" type="hidden"><label>活动类型<select id="campaignKind">${Object.entries(kinds).map(([id,name])=>`<option value="${id}">${name}</option>`).join('')}</select></label><label>活动名称<input id="campaignName" required placeholder="例如 夏日饮料九折"></label><div class="two"><label>开始时间<input id="campaignStart" type="datetime-local"></label><label>结束时间<input id="campaignEnd" type="datetime-local"></label></div><div class="two"><label>优惠方式<select id="campaignDiscount"><option value="fixed">减 $</option><option value="percent">打折（填写百分比）</option><option value="free_shipping">免费配送</option></select></label><label>优惠金额／百分比<input id="campaignAmount" type="number" min="0" step="0.01" value="0"></label></div><label>满减门槛（仅满减活动）<input id="campaignThreshold" type="number" min="0" step="0.01" value="0"></label><label>指定商品（可多选）<input id="campaignProducts" placeholder="${products.map(x=>x.id+' '+x.name).join('；')}"></label><label>指定分类（可多选）<input id="campaignCategories" placeholder="${categories.map(x=>x.name).join('、')}"></label><button class="primary">保存活动</button><button id="campaignReset" class="text-btn" type="button">新增</button></form><div class="marketing-list">${campaigns.map(x=>`<article><b>${esc(x.name)}</b><small>${kinds[x.kind]} · ${x.discount_kind==='percent'?x.amount+'%':x.kind==='free_shipping'?'免配送':money(x.amount)}${x.threshold?` · 满 ${money(x.threshold)}`:''} · ${active(x)}</small><div><button data-edit-campaign="${x.id}">编辑</button><button data-stop-campaign="${x.id}" ${x.active?'':'disabled'}>停用</button></div></article>`).join('')||'<p class="muted">尚无活动。</p>'}</div></section></div><section class="marketing-referral"><h3>推荐奖励</h3><p>新顾客首次提交订单时可填写推荐人 10 位电话号码或推荐码；双方各自动获得 1 张 <b>$5.00</b> 优惠券，满 <b>$35.00</b> 可用，长期有效。</p><div class="marketing-list compact">${referrals.slice(0,12).map(x=>`<article><b>${esc(x.phone)}</b><small>推荐码：${esc(x.referral_code)}${x.referred_by_phone?' · 推荐人：'+esc(x.referred_by_phone):''}</small></article>`).join('')||'<p class="muted">推荐记录会在首笔订单后出现。</p>'}</div></section><section class="marketing-stats"><div class="panel-head"><h3>数据统计</h3><div class="date-filter"><input id="marketingStart" type="date"><input id="marketingEnd" type="date"><button id="refreshStats">筛选</button></div></div><div class="stats"><div><span>订单数</span><b>${stats.count}</b></div><div><span>销售额</span><b>${money(stats.sales)}</b></div><div><span>优惠使用次数</span><b>${stats.promotions}</b></div><div><span>配送费减免</span><b>${stats.freeShipping}</b></div><div><span>推荐成功数</span><b>${stats.referrals}</b></div></div></section></div>`;bind()}
function statsFor(){const start=$('#marketingStart')?.value,end=$('#marketingEnd')?.value,rows=orders.filter(x=>x.status!=='已取消').filter(x=>!start||x.created_at>=start).filter(x=>!end||x.created_at<new Date(end+'T23:59:59').toISOString());return{count:rows.length,sales:rows.reduce((s,x)=>s+Number(x.total_amount||0),0),promotions:rows.filter(x=>x.promotion_kind).length,freeShipping:rows.filter(x=>x.fulfillment==='delivery'&&Number(x.delivery_fee||0)===0).length,referrals:rows.filter(x=>x.referral_source).length}}
function couponEdit(x){val('couponId',x.id);val('couponCode',x.code);val('couponName',x.name);val('couponAmount',x.amount);val('couponMin',x.min_spend);val('couponQty',x.total_quantity);val('couponStart',local(x.starts_at));val('couponEnd',local(x.ends_at));}
function campaignEdit(x){val('campaignId',x.id);val('campaignKind',x.kind);val('campaignName',x.name);val('campaignDiscount',x.discount_kind);val('campaignAmount',x.amount);val('campaignThreshold',x.threshold);val('campaignProducts',list(x.product_ids));val('campaignCategories',list(x.category_names));val('campaignStart',local(x.starts_at));val('campaignEnd',local(x.ends_at));}
function bind(){const cf=$('#couponForm'),af=$('#campaignForm');cf.onsubmit=async e=>{e.preventDefault();const row={id:$('#couponId').value||undefined,code:$('#couponCode').value.trim().toUpperCase(),name:$('#couponName').value.trim(),amount:+$('#couponAmount').value,min_spend:+$('#couponMin').value,total_quantity:+$('#couponQty').value,per_phone_limit:1,starts_at:$('#couponStart').value||null,ends_at:$('#couponEnd').value||null,active:true,updated_at:new Date().toISOString()};if(!row.id)delete row.id;const {error}=await db.from('marketing_coupons').upsert(row);toast(error?error.message:'优惠券已保存');if(!error)load()};af.onsubmit=async e=>{e.preventDefault();const kind=$('#campaignKind').value,row={id:$('#campaignId').value||undefined,kind,name:$('#campaignName').value.trim(),discount_kind:kind==='free_shipping'?'free_shipping':$('#campaignDiscount').value,amount:+$('#campaignAmount').value,threshold:+$('#campaignThreshold').value,product_ids:csv($('#campaignProducts').value).map(Number).filter(Number.isFinite),category_names:csv($('#campaignCategories').value),starts_at:$('#campaignStart').value||null,ends_at:$('#campaignEnd').value||null,active:true,updated_at:new Date().toISOString()};if(!row.id)delete row.id;const {error}=await db.from('marketing_campaigns').upsert(row);toast(error?error.message:'活动已保存');if(!error)load()};$('#couponReset').onclick=()=>{cf.reset();val('couponId','')};$('#campaignReset').onclick=()=>{af.reset();val('campaignId','')};root=document.querySelector('#marketingCenter');root.onclick=async e=>{const id=e.target.dataset.editCoupon||e.target.dataset.stopCoupon||e.target.dataset.editCampaign||e.target.dataset.stopCampaign;if(!id)return;if(e.target.dataset.editCoupon){couponEdit(coupons.find(x=>x.id===id));return}if(e.target.dataset.editCampaign){campaignEdit(campaigns.find(x=>x.id===id));return}const table=e.target.dataset.stopCoupon?'marketing_coupons':'marketing_campaigns';const {error}=await db.from(table).update({active:false,updated_at:new Date().toISOString()}).eq('id',id);toast(error?error.message:'已停用');if(!error)load()};$('#refreshStats').onclick=()=>render();}
function start(){if(!window.supabase||!window.TINGS_SUPABASE||!$('#marketingCenter'))return setTimeout(start,120);db=window.supabase.createClient(TINGS_SUPABASE.url,TINGS_SUPABASE.anonKey);document.querySelector('[data-view="marketing"]')?.addEventListener('click',()=>{document.querySelectorAll('aside nav button,.view').forEach(x=>x.classList.remove('active'));document.querySelector('[data-view="marketing"]').classList.add('active');$('#marketing').classList.add('active');$('#pageTitle').textContent='营销中心';load()});load()}start()})();


;(() => {
  const parseProducts = text => String(text || '').split('；').map(part => {
    const [value, ...label] = part.trim().split(' ');
    return value ? { value, label: label.join(' ') || value } : null;
  }).filter(Boolean);
  const parseCategories = text => String(text || '').split('、').map(value => value.trim()).filter(Boolean).map(value => ({ value, label: value }));
  const sync = select => {
    const hidden = document.getElementById(select.dataset.target);
    if (hidden) hidden.value = [...select.selectedOptions].map(option => option.value).join(',');
  };
  const selected = select => {
    const hidden = document.getElementById(select.dataset.target);
    const values = new Set(String(hidden?.value || '').split(',').map(value => value.trim()).filter(Boolean));
    [...select.options].forEach(option => { option.selected = values.has(option.value); });
  };
  function replaceInput(id, options, help) {
    const hidden = document.getElementById(id);
    if (!hidden || hidden.dataset.multiReady) return;
    hidden.dataset.multiReady = 'true';
    hidden.type = 'hidden';
    const select = document.createElement('select');
    select.multiple = true; select.size = 4; select.className = 'marketing-multi-select';
    select.dataset.target = id;
    options(hidden.placeholder).forEach(({ value, label }) => select.add(new Option(label, value)));
    hidden.before(select);
    const note = document.createElement('small');
    note.className = 'marketing-multi-help';
    note.textContent = help;
    hidden.after(note);
    selected(select);
    select.addEventListener('change', () => sync(select));
  }
  function enhance() {
    replaceInput('campaignProducts', parseProducts, '可按住 Ctrl／⌘ 多选；不选择代表不限制商品。');
    replaceInput('campaignCategories', parseCategories, '可按住 Ctrl／⌘ 多选；不选择代表不限制分类。');
  }
  function startMultiSelects() {
    const root = document.getElementById('marketingCenter');
    if (!root) return setTimeout(startMultiSelects, 100);
    enhance();
    new MutationObserver(enhance).observe(root, { childList: true, subtree: true });
    document.addEventListener('submit', event => {
      if (event.target.id === 'campaignForm') document.querySelectorAll('select[data-target]').forEach(sync);
    }, true);
    document.addEventListener('click', event => {
      if (event.target.matches('[data-edit-campaign]')) setTimeout(() => document.querySelectorAll('select[data-target]').forEach(selected), 0);
      if (event.target.id === 'campaignReset') setTimeout(() => document.querySelectorAll('select[data-target]').forEach(select => { [...select.options].forEach(option => { option.selected = false; }); sync(select); }), 0);
    });
  }
  startMultiSelects();
})();

/* Retired activity types stay out of the owner interface and cannot be created again. */
;(() => {
  const pruneRetiredCampaignTypes = () => {
    document.querySelectorAll('#campaignKind option[value="holiday"], #campaignKind option[value="free_shipping"], #campaignDiscount option[value="free_shipping"]').forEach(option => option.remove());
    document.querySelectorAll('#marketingCenter .marketing-list article').forEach(card => {
      const text = card.textContent || '';
      if (text.includes('节日活动') || text.includes('免费配送')) card.remove();
    });
  };
  const waitForMarketing = () => {
    const root = document.querySelector('#marketingCenter');
    if (!root) return setTimeout(waitForMarketing, 120);
    pruneRetiredCampaignTypes();
    new MutationObserver(pruneRetiredCampaignTypes).observe(root, { childList: true, subtree: true });
  };
  waitForMarketing();
})();

/* Replace the native multi-select controls with a simple checkbox picker. The
   original controls stay in the form (hidden) so existing save logic remains
   compatible while target selection becomes tap-friendly. */
;(() => {
  function syncHidden(select) {
    const hidden = document.getElementById(select.dataset.target);
    if (hidden) hidden.value = [...select.options].filter(option => option.selected).map(option => option.value).join(',');
  }
  function syncChecks(select) {
    const picker = select.parentElement?.querySelector(`[data-picker-for="${select.dataset.target}"]`);
    if (!picker) return;
    picker.querySelectorAll('input[type="checkbox"]').forEach(box => {
      box.checked = [...select.options].some(option => option.value === box.value && option.selected);
    });
    syncHidden(select);
  }
  function enhancePickers() {
    document.querySelectorAll('select[data-target]').forEach(select => {
      if (select.dataset.checkboxPicker === 'true') { syncChecks(select); return; }
      select.dataset.checkboxPicker = 'true';
      select.hidden = true;
      const picker = document.createElement('div');
      picker.className = 'marketing-checkbox-picker';
      picker.dataset.pickerFor = select.dataset.target;
      picker.innerHTML = [...select.options].map(option => `<label class="marketing-picker-option"><input type="checkbox" value="${option.value}"><span>${option.textContent}</span></label>`).join('') || '<small>暂无可选项目</small>';
      picker.addEventListener('change', event => {
        const box = event.target;
        if (!box.matches('input[type="checkbox"]')) return;
        const option = [...select.options].find(item => item.value === box.value);
        if (option) option.selected = box.checked;
        syncHidden(select);
      });
      select.after(picker);
      const help = select.parentElement?.querySelector('.marketing-multi-help');
      if (help) help.textContent = '可勾选多个；不选择代表不限制。';
      syncChecks(select);
    });
  }
  document.addEventListener('click', event => {
    if (event.target.matches('[data-edit-campaign], #campaignReset')) setTimeout(enhancePickers, 0);
  });
  const observer = new MutationObserver(enhancePickers);
  observer.observe(document.documentElement, { childList: true, subtree: true });
  enhancePickers();
})();





;(() => {
  let referralDb;
  if (!document.getElementById('campaignTargetVisibilityStyle')) {
    const style = document.createElement('style');
    style.id = 'campaignTargetVisibilityStyle';
    style.textContent = `
      #marketingCenter:has(#campaignKind option[value="full_reduction"]:checked) label:has(#campaignProducts),
      #marketingCenter:has(#campaignKind option[value="full_reduction"]:checked) label:has(#campaignCategories),
      #marketingCenter:has(#campaignKind option[value="product_discount"]:checked) label:has(#campaignCategories),
      #marketingCenter:has(#campaignKind option[value="category_discount"]:checked) label:has(#campaignProducts) { display:none !important; }
    `;
    document.head.append(style);
  }
  const $ = selector => document.querySelector(selector);
  const notice = message => {
    const toast = $('#toast');
    if (!toast) return;
    toast.textContent = message;
    toast.classList.add('show');
    setTimeout(() => toast.classList.remove('show'), 2800);
  };
  const targetVisibility = () => {
    const kind = $('#campaignKind')?.value;
    const showProducts = kind === 'product_discount';
    const showCategories = kind === 'category_discount';
    const showThreshold = kind === 'full_reduction';
    const productTarget = $('#campaignProducts');
    const categoryTarget = $('#campaignCategories');
    const thresholdTarget = $('#campaignThreshold');
    if (productTarget) productTarget.closest('label').hidden = !showProducts;
    if (categoryTarget) categoryTarget.closest('label').hidden = !showCategories;
    if (thresholdTarget) thresholdTarget.closest('label').hidden = !showThreshold;
  };
  const forceTargetVisibility = () => {
    const kind = $('#campaignKind')?.value;
    const productLabel = document.querySelector('label:has(#campaignProducts)');
    const categoryLabel = document.querySelector('label:has(#campaignCategories)');
    const thresholdLabel = document.querySelector('label:has(#campaignThreshold)');
    if (productLabel) productLabel.hidden = kind !== 'product_discount';
    if (categoryLabel) categoryLabel.hidden = kind !== 'category_discount';
    if (thresholdLabel) thresholdLabel.hidden = kind !== 'full_reduction';
  };
  async function referralTools() {
    const section = $('.marketing-referral');
    if (!section || section.dataset.referralToolsReady) return;
    if (!window.supabase || !window.TINGS_SUPABASE) return;
    section.dataset.referralToolsReady = 'true';
    referralDb ||= window.supabase.createClient(TINGS_SUPABASE.url, TINGS_SUPABASE.anonKey);
    const { data: settings, error } = await referralDb.from('referral_reward_settings').select('*').eq('id', 1).maybeSingle();
    if (error) { section.dataset.referralToolsReady = ''; notice(error.message); return; }
    const current = settings || { amount: 5, min_spend: 35, valid_days: 0 };
    const tools = document.createElement('div');
    tools.className = 'marketing-grid referral-settings';
    tools.innerHTML = `<section><h3>推荐奖励设置</h3><form id="referralRewardForm"><div class="two"><label>奖励金额（美元）<input id="referralRewardAmount" type="number" min="0.01" step="0.01" value="${current.amount}"></label><label>最低消费（美元）<input id="referralRewardMin" type="number" min="0" step="0.01" value="${current.min_spend}"></label></div><label>奖励券有效期（天）<input id="referralRewardDays" type="number" min="0" step="1" value="${current.valid_days}"><small>填写 0 代表长期有效；该设置也用于本次推荐码立即优惠。</small></label><button class="primary">保存推荐奖励</button></form></section><section><h3>店主生成推荐码</h3><form id="ownerReferralForm"><label>推荐人电话号码<input id="ownerReferralPhone" inputmode="numeric" pattern="[0-9]{10}" maxlength="10" placeholder="输入推荐人的 10 位电话号码" required></label><button class="primary">生成推荐码</button><p class="muted" id="generatedReferralCode">生成后可将推荐码发给顾客使用。</p></form></section>`;
    section.prepend(tools);
    $('#referralRewardForm').onsubmit = async event => {
      event.preventDefault();
      const row = { id: 1, amount: +$('#referralRewardAmount').value, min_spend: +$('#referralRewardMin').value, valid_days: +$('#referralRewardDays').value, updated_at: new Date().toISOString() };
      const { error: saveError } = await referralDb.from('referral_reward_settings').upsert(row);
      notice(saveError ? saveError.message : '推荐奖励已保存');
    };
    $('#ownerReferralForm').onsubmit = async event => {
      event.preventDefault();
      const phone = $('#ownerReferralPhone').value.trim();
      if (!/^[0-9]{10}$/.test(phone)) return notice('请输入 10 位数字电话号码');
      const { data: existing, error: checkError } = await referralDb.from('customer_referrals').select('referral_code').eq('phone', phone).maybeSingle();
      if (checkError) return notice(checkError.message);
      const code = existing?.referral_code || ('TSHREF-' + Math.random().toString(36).slice(2, 10).toUpperCase());
      if (!existing) {
        const { error: createError } = await referralDb.from('customer_referrals').insert({ phone, referral_code: code });
        if (createError) return notice(createError.message);
      }
      $('#generatedReferralCode').textContent = `推荐码：${code}（已绑定 ${phone}）`;
      notice('推荐码已生成');
    };
  }
  function startOfferAdminTools() {
    const root = $('#marketingCenter');
    if (!root) return setTimeout(startOfferAdminTools, 100);
    targetVisibility(); forceTargetVisibility();
    referralTools();
    new MutationObserver(() => { targetVisibility(); forceTargetVisibility(); referralTools(); }).observe(root, { childList: true, subtree: true });
    document.addEventListener('change', event => { if (event.target.id === 'campaignKind') { targetVisibility(); forceTargetVisibility(); } });
    document.addEventListener('click', event => { if (event.target.matches('[data-edit-campaign]') || event.target.id === 'campaignReset') setTimeout(() => { targetVisibility(); forceTargetVisibility(); }, 0); });
    setInterval(forceTargetVisibility, 400);
  }
  startOfferAdminTools();
})();

/* Load the dedicated order-card presentation after the existing admin tools. */
(()=>{const style=document.createElement('link');style.rel='stylesheet';style.href='order-cards.css?v=20260809d';document.head.append(style)})();
