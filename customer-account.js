/* Customer accounts use their own Supabase session. Guest checkout stays available. */
(() => {
  'use strict';
  async function guestOfferPreview(args) {
    // Public preview never borrows a logged-in shop-owner session.
    const response=await fetch(`${window.TINGS_SUPABASE.url}/rest/v1/rpc/preview_account_offer`,{
      method:'POST',headers:{apikey:window.TINGS_SUPABASE.anonKey,Authorization:`Bearer ${window.TINGS_SUPABASE.anonKey}`,'Content-Type':'application/json'},
      body:JSON.stringify(args),
    });
    if(!response.ok)throw new Error('Offer preview unavailable');
    return {data:await response.json()};
  }
  // Internal-test release: Auth and server RLS enforce account identity.
  // Guest checkout remains available without a session on every hostname.
  const client = window.createTingsCustomerClient();
  document.body.classList.add('customer-account-preview');
  const button = document.createElement('button');
  button.id = 'openCustomerAccount';
  button.className = 'customer-account-button';
  button.type = 'button';
  button.textContent = '登录账户';
  button.setAttribute('aria-haspopup', 'dialog');
  document.querySelector('#openCart').before(button);

  const dialog = document.createElement('dialog');
  dialog.id = 'customerAccountDialog';
  dialog.setAttribute('aria-labelledby', 'customerAccountTitle');
  // This template contains only application-owned text, never remote data.
  dialog.innerHTML = `
    <div class="customer-account-heading"><div class="customer-account-title-row"><h2 id="customerAccountTitle" tabindex="-1">登录 / 注册</h2>
      <div id="customerOrderRefresh" class="customer-order-refresh" hidden><button type="button" id="customerRefreshOrders">刷新订单</button><span id="customerOrderUpdated" class="customer-muted" aria-live="polite"></span></div>
      <button type="button" id="customerRefreshCoupons" hidden>刷新优惠券</button></div>
      <button type="button" id="customerAccountBack" aria-label="返回商店">返回</button></div>
    <p id="customerAccountMessage" role="status" aria-live="polite"></p>
    <button type="button" id="customerReauthenticate" hidden>重新登录</button>
    <section id="customerSignedOut">
      <p class="customer-muted">邮箱验证码登录，首次登录即创建账户。也可以不登录，直接下单。</p>
      <form id="customerEmailForm"><label>邮箱地址<input name="email" type="email" autocomplete="email" required maxlength="254"></label>
        <button type="submit" class="customer-primary" id="customerSendCode">获取验证码</button></form>
      <form id="customerCodeForm" hidden><p id="customerCodeDestination"></p>
        <label>6 位验证码<input name="code" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" minlength="6" maxlength="6" required></label>
        <button type="submit" class="customer-primary">登录</button>
        <button type="button" id="customerResendCode">重新发送</button>
        <button type="button" id="customerChangeEmail">更换邮箱</button></form>
      <button type="button" id="customerRetrySignOut" hidden>重试退出登录</button>
      <p class="customer-muted">请勿向他人透露验证码。收不到邮件时，请检查垃圾邮件，稍后再试。</p>
    </section>
    <section id="customerSignedIn" hidden>
      <p id="customerAccountEmail" class="customer-muted"></p>
      <section id="customerHomePanel" data-account-panel="home">
        <nav class="customer-home-menu" aria-label="账户内容">
          <button type="button" data-account-tab="orders" aria-controls="customerOrdersPanel"><span><strong>我的订单</strong><small>查看订单、配送和取消状态</small></span><i aria-hidden="true">›</i></button>
          <button type="button" data-account-tab="details" aria-controls="customerDetailsPanel"><span><strong>收货资料</strong><small>管理默认配送信息</small></span><i aria-hidden="true">›</i></button>
          <button type="button" data-account-tab="coupons" aria-controls="customerCouponsPanel"><span><strong>我的优惠券</strong><small>普通券与新人券</small></span><i aria-hidden="true">›</i></button>
          <button type="button" data-account-tab="rewards" aria-controls="customerRewardsPanel"><span><strong>推荐奖励</strong><small>分享好物，领取优惠</small></span><i aria-hidden="true">›</i></button>
        </nav>
        <button type="button" id="customerSignOut">退出登录</button>
      </section>
      <section id="customerOrdersPanel" data-account-panel="orders" hidden><p class="customer-muted">这里只显示登录后提交的订单。旧游客订单仍使用网站的“查订单”。</p>
        <div class="customer-order-toolbar">
          <label>搜索本页订单<input id="customerOrderSearch" type="search" placeholder="订单号、商品或规格" maxlength="100"></label>
          <label>本页状态<select id="customerOrderFilter"><option value="all">全部</option><option value="active">进行中</option><option value="cancelling">取消处理中</option><option value="completed">已完成</option><option value="cancelled">已取消</option></select></label>
        </div>
        <div id="customerOrders" aria-live="polite"></div>
        <div class="customer-pagination"><button type="button" id="customerOrdersPrev">上一页</button>
          <span id="customerOrdersPage"></span><button type="button" id="customerOrdersNext">下一页</button></div>
      </section>
      <section id="customerDetailsPanel" data-account-panel="details" hidden><p class="customer-muted">默认资料会自动填写结算页的空白项。结算时临时修改地址不会覆盖这里的默认资料，也不会修改旧订单。</p>
        <p id="customerDetailsStatus" role="status" class="customer-muted"></p>
        <form id="customerDetailsForm">
          <label>姓名<input name="full_name" autocomplete="name" maxlength="80"></label>
          <label>电话号码<input name="phone" type="tel" inputmode="numeric" autocomplete="tel-national" pattern="[0-9]{10}" maxlength="10" placeholder="10 位数字"></label>
          <label>地址（街道与门牌号）<textarea name="address" autocomplete="address-line1" maxlength="500" rows="2"></textarea></label>
          <label>Unit（房间／单元号，选填）<input name="unit" autocomplete="address-line2" maxlength="40" placeholder="例如 2B"></label>
          <label>City（城市）<input name="city" autocomplete="address-level2" maxlength="80"></label>
          <div class="customer-address-region"><label>State（州）<input name="state" autocomplete="address-level1" maxlength="2" pattern="[A-Za-z]{2}" placeholder="例如 IL" title="请输入两位英文字母州缩写"></label>
          <label>ZIP（邮编）<input name="zip" autocomplete="postal-code" maxlength="10" pattern="[0-9]{5}(-[0-9]{4})?" placeholder="60601 或 60601-1234"></label></div>
          <label>登录邮箱（不可更改）<input id="customerIdentityEmail" type="email" autocomplete="email" readonly aria-readonly="true"></label>
          <button type="submit" id="customerSaveDetails" class="customer-primary" disabled>保存资料</button></form>
      </section>
      <section id="customerCouponsPanel" data-account-panel="coupons" class="customer-feature-note" hidden>
        <p>打开后加载我的优惠券。</p>
      </section>
      <section id="customerRewardsPanel" data-account-panel="rewards" class="customer-feature-note" hidden>
        <p>打开后加载推荐码与奖励。</p>
      </section>
    </section>
    <p class="customer-preview-note">内部测试版 · 邮件服务处于测试阶段，目前仅支持向测试发信账户的注册邮箱发送验证码。其他邮箱暂可使用游客下单。</p>`;
  document.body.append(dialog);
  const $ = (s) => dialog.querySelector(s);
  const emailForm = $('#customerEmailForm'), codeForm = $('#customerCodeForm');
  const detailsForm = $('#customerDetailsForm');
  let session = null, epoch = 0, authKnown = false, authBlocked = false, authExpired = false;
  let details = null, pendingEmail = '', cooldownUntil = 0, sending = false;
  let offset = 0, orderRequest = 0, detailRequest = 0, orderRows = [];
  let detailsBusy = false, detailEdits = 0, reorderBusy = false;
  let detailsSaving = false, detailsSaved = false;
  let ordersLoaded = false;
  let wallet = null;
  const detailFields = ['full_name','phone','address','unit','city','state','zip'];
  let accountView = 'home';
  let pendingAccountView = null, accountOpener = button;
  const accountTitles = {home:'我的账户',orders:'我的订单',details:'收货资料',coupons:'我的优惠券',rewards:'推荐奖励'};
  let checkoutOwner, checkoutContext = Promise.resolve();
  const filled = new Map();
  const message = (text) => { $('#customerAccountMessage').textContent = text; };
  const element = (tag, text, className) => {
    const el = document.createElement(tag);
    if (text !== undefined) el.textContent = text;
    if (className) el.className = className;
    return el;
  };
  const money = value => value != null && Number.isFinite(Number(value)) ? `$${Number(value).toFixed(2)}` : '未记录';
  const detailValues = () => Object.fromEntries(detailFields.map(name => [name, name === 'state' ? detailsForm.elements[name].value.trim().toUpperCase() : detailsForm.elements[name].value.trim()]));
  const deliveryAddress = data => [data.address,data.unit ? `Unit ${data.unit}` : '',[data.city,data.state,data.zip].filter(Boolean).join(' ')].filter(Boolean).join(', ');
  const expiredError = () => Object.assign(new Error('登录已过期'), {code:'ACCOUNT_SESSION_EXPIRED'});
  function accountError(error, fallback) {
    if (['ACCOUNT_SESSION_EXPIRED','PGRST301','PGRST303','28000','bad_jwt','session_not_found','refresh_token_not_found'].includes(error?.code) || error?.status === 401 || error?.name === 'AuthSessionMissingError') {
      authExpired = true; authBlocked = true; $('#customerReauthenticate').hidden = false;
      updateDetailsStatus();
      return '登录已过期，请重新登录后继续。未保存的资料仍保留在当前页面。';
    }
    if (error?.code === 'PGRST202') return '账户资料需要完成数据库升级，本次修改未保存。请联系店主后重试。';
    return fallback;
  }
  async function accountRpc(name, args) {
    const stamp = epoch, expected = session?.user.id;
    if (!expected || authExpired) throw expiredError();
    const {data,error} = await client.auth.getSession();
    if (error) throw error;
    if (stamp !== epoch || session?.user.id !== expected) throw new Error('Account changed');
    if (!data.session?.access_token || data.session.user.id !== expected) throw expiredError();
    return client.rpc(name,args);
  }
  const detailsDirty = () => Object.entries(detailValues()).some(([name,value]) => value !== (details?.[name] || ''));
  function updateDetailsStatus() {
    const dirty = detailsDirty();
    $('#customerDetailsStatus').textContent = detailsBusy ? (detailsSaving ? '正在保存资料…' : '正在同步资料…') : dirty ? '' : details ? '资料已同步' : '资料尚未加载';
    const submit = $('#customerSaveDetails');
    submit.disabled = detailsBusy || !session || !details || authExpired || !dirty;
    submit.textContent = detailsSaving ? '正在保存…' : detailsSaved && !dirty ? '已保存' : '保存资料';
  }
  detailsForm.addEventListener('input', () => { detailEdits++; detailsSaved = false; updateDetailsStatus(); });
  function discardDetails() {
    detailsSaved = false;
    for (const name of detailFields) detailsForm.elements[name].value = details?.[name] || '';
    detailEdits++; updateDetailsStatus();
  }
  function mayDiscard() {
    if (detailsSaving) { message('资料正在保存，请稍候再离开。'); return false; }
    if (session && detailsDirty() && !window.confirm('收货资料尚未保存，确定离开吗？修改不会保存。')) return false;
    if (detailsDirty()) discardDetails();
    return true;
  }
  window.addEventListener('beforeunload', event => {
    if (session && detailsDirty()) { event.preventDefault(); event.returnValue = ''; }
  });
  function clearAutofill() {
    for (const [field, value] of filled) if (field.value === value) field.value = '';
    filled.clear();
  }
  function checkoutHint() {
    const hint = document.getElementById('customerCheckoutHint');
    if (hint) hint.textContent = session
      ? '此订单将保存到我的账户。已保存的资料会填入空白项。'
      : '当前为游客下单；如需将订单保存到账户，请先关闭结算窗口并登录。';
  }
  function fillCheckout() {
    if (!session || !details || !document.querySelector('#orderDialog')?.open) return;
    const form = document.querySelector('#orderForm');
    for (const [name, value] of Object.entries({name: details.full_name, phone: details.phone,
      address: deliveryAddress(details), email: session.user.email})) {
      const field = form?.elements.namedItem(name);
      if (field && !field.value && value) {
        field.value = value; filled.set(field, value);
        field.dispatchEvent(new Event('input', {bubbles: true}));
      }
    }
  }
  function applySession(next) {
    const changed = (session?.user.id || null) !== (next?.user.id || null);
    session = next;
    if (changed) {
      epoch++; orderRequest++; detailRequest++;
      wallet?.reset();
      details = null; offset = 0; clearAutofill(); detailsForm.reset();
      detailEdits++; detailsBusy = false; detailsSaving = false; detailsSaved = false; reorderBusy = false; orderRows = []; ordersLoaded = false;
      authExpired = false; $('#customerReauthenticate').hidden = true;
      if (session) authBlocked = false;
      $('#customerOrderSearch').value = ''; $('#customerOrderFilter').value = 'all';
      $('#customerOrderUpdated').textContent = ''; $('#customerOrdersPage').textContent = '';
      $('#customerOrders').replaceChildren();
      $('#customerOrders').setAttribute('aria-busy','false');
      showAccountView('home');
      message('');
    }
    button.textContent = session ? '我的账户' : '登录账户';
    button.setAttribute('aria-label', button.textContent);
    const mobileAccountEntry = document.getElementById('mobileAccountEntry');
    if (mobileAccountEntry) {
      const label = document.createElement('span');
      label.className = 'mobile-account-label';
      label.textContent = button.textContent;
      mobileAccountEntry.replaceChildren(label);
      if (session?.user.email) {
        const email = document.createElement('span');
        email.className = 'mobile-account-email';
        email.textContent = session.user.email;
        mobileAccountEntry.append(email);
      }
    }
    $('#customerSignedOut').hidden = !!session;
    $('#customerSignedIn').hidden = !session;
    $('#customerAccountTitle').textContent = session ? accountTitles[accountView] : '登录 / 注册';
    $('#customerAccountEmail').textContent = session?.user.email ? `你好，${session.user.email}` : '';
    $('#customerIdentityEmail').value = session?.user.email || '';
    checkoutHint();
    updateDetailsStatus();
    if (changed && session) void loadDetails();
    if (changed && session && pendingAccountView && dialog.open) {
      const destination = pendingAccountView; pendingAccountView = null;
      showAccountView(destination); $('#customerAccountTitle').focus();
      if (destination === 'coupons') void wallet?.load();
    }
  }
  const ready = client.auth.getSession().then(({data, error}) => {
    if (error) throw error;
    if (!authKnown) applySession(data.session);
    authKnown = true;
  }).catch(() => { authBlocked = true; message('暂时无法读取登录状态，请刷新页面后重试。'); });
  client.auth.onAuthStateChange((event, next) => {
    // Do not await another Supabase call inside its auth callback.
    authKnown = true;
    queueMicrotask(() => {
      const lostSession = event === 'SIGNED_OUT' && !!session;
      if (event === 'SIGNED_OUT') authBlocked = false;
      applySession(next);
      if (lostSession) message('登录已过期或已在其他页面退出，请重新登录。');
    });
  });

  async function openAccount(view = 'home', opener = button) {
    const destination = view === 'coupons' ? 'coupons' : 'home';
    accountOpener = opener; pendingAccountView = destination === 'coupons' ? destination : null;
    if (!dialog.open) dialog.showModal();
    await ready;
    if (!dialog.open) return;
    if (session) {
      pendingAccountView = null; showAccountView(destination); $('#customerAccountTitle').focus();
      if (destination === 'coupons') void wallet.load();
    }
    else emailForm.elements.email.focus();
  }
  button.addEventListener('click', () => { void openAccount(); });
  dialog.addEventListener('cancel', event => { if (!mayDiscard()) event.preventDefault(); });
  dialog.addEventListener('close', () => { pendingAccountView = null; codeForm.elements.code.value = ''; accountOpener.focus(); });
  function showAccountView(view) {
    accountView = view;
    for (const panel of dialog.querySelectorAll('[data-account-panel]')) panel.hidden = panel.dataset.accountPanel !== view;
    $('#customerAccountBack').setAttribute('aria-label',session && view !== 'home' ? '返回我的账户' : '返回商店');
    $('#customerOrderRefresh').hidden = !session || view !== 'orders';
    $('#customerRefreshCoupons').hidden = !session || view !== 'coupons';
    $('#customerAccountTitle').textContent = session ? accountTitles[view] : '登录 / 注册';
    dialog.scrollTop = 0;
  }
  for (const tab of dialog.querySelectorAll('[data-account-tab]')) tab.onclick = () => {
    showAccountView(tab.dataset.accountTab);
    message('');
    $('#customerAccountTitle').focus();
    if (accountView === 'orders') void loadOrders();
    if (accountView === 'details') void loadDetails();
    if (accountView === 'coupons' || accountView === 'rewards') void wallet.load();
  };
  $('#customerAccountBack').onclick = () => {
    if (!session || accountView === 'home') { if (mayDiscard()) dialog.close(); return; }
    if (accountView === 'details' && !mayDiscard()) return;
    const previous = accountView; showAccountView('home'); message('');
    dialog.querySelector(`[data-account-tab="${previous}"]`)?.focus();
  };
  function cooldown() {
    const seconds = Math.max(0, Math.ceil((cooldownUntil - Date.now()) / 1000));
    for (const id of ['#customerSendCode','#customerResendCode']) {
      $(id).disabled = sending || seconds > 0;
      $(id).textContent = seconds ? `${seconds} 秒后可重发` : id === '#customerSendCode' ? '获取验证码' : '重新发送';
    }
  }
  setInterval(cooldown, 1000);
  async function sendCode(email) {
    if (sending || Date.now() < cooldownUntil || authBlocked) return;
    sending = true; cooldown(); message('正在发送验证码…');
    const stamp = epoch;
    try {
      const {error} = await client.auth.signInWithOtp({email, options: {shouldCreateUser: true}});
      if (error) throw error;
      if (stamp !== epoch) return;
      pendingEmail = email; cooldownUntil = Date.now() + 60000;
      emailForm.hidden = true; codeForm.hidden = false;
      $('#customerCodeDestination').textContent = `请查看 ${email} 的收件箱和垃圾邮件。`;
      message('验证码已请求发送，请输入邮件中的 6 位验证码。');
      codeForm.elements.code.value = ''; codeForm.elements.code.focus();
    } catch {
      if (stamp === epoch) message('暂时无法发送验证码。请稍后重试；首次启用需先配置验证码邮件服务。');
    } finally { sending = false; cooldown(); }
  }
  emailForm.onsubmit = (event) => {
    event.preventDefault(); void sendCode(emailForm.elements.email.value.trim());
  };
  $('#customerResendCode').onclick = () => { void sendCode(pendingEmail); };
  $('#customerChangeEmail').onclick = () => {
    codeForm.hidden = true; emailForm.hidden = false;
    codeForm.reset(); pendingEmail = ''; message(''); emailForm.elements.email.focus();
  };
  codeForm.onsubmit = async (event) => {
    event.preventDefault();
    const submit = codeForm.querySelector('[type=submit]');
    if (submit.disabled || !pendingEmail) return;
    submit.disabled = true; message('正在验证…');
    const stamp = epoch;
    try {
      const {data, error} = await client.auth.verifyOtp({email: pendingEmail,
        token: codeForm.elements.code.value.trim(), type: 'email'});
      if (error || !data?.session) throw error || new Error('No session');
      authBlocked = false; authExpired = false; $('#customerReauthenticate').hidden = true;
      if (stamp === epoch) applySession(data.session);
      codeForm.reset(); pendingEmail = ''; emailForm.hidden = false; codeForm.hidden = true;
    } catch (error) { if (stamp === epoch) message(error?.code === 'otp_expired' ? '验证码不正确或已过期，请检查或重新获取验证码。' : error?.status >= 500 || error?.name === 'AuthRetryableFetchError' || error instanceof TypeError ? '网络异常，暂时无法验证，请稍后重试。' : '验证码不正确或已过期，请检查或重新获取。'); }
    finally { submit.disabled = false; }
  };

  async function signOut({confirmExit = false} = {}) {
    if (confirmExit) {
      const prompt = detailsDirty() ? '确定退出登录吗？未保存的收货资料修改将被丢弃，购物篮中的商品会保留。' : '确定退出登录吗？购物篮中的商品会保留。';
      if (!window.confirm(prompt)) return;
    } else if (!mayDiscard()) return;
    authBlocked = true; applySession(null); message('正在退出登录…');
    try {
      const {error} = await client.auth.signOut({scope: 'local'});
      if (error) throw error;
      authBlocked = false; emailForm.reset(); codeForm.reset(); pendingEmail = '';
      emailForm.hidden = false; codeForm.hidden = true;
      $('#customerRetrySignOut').hidden = true; message('已退出顾客账户，购物篮已保留。');
    } catch {
      authBlocked = true; $('#customerRetrySignOut').hidden = false;
      message('退出尚未完成。为保护账户，已暂停结算，请重试退出。');
    }
  }
  $('#customerSignOut').onclick = () => void signOut({confirmExit:true});
  $('#customerRetrySignOut').onclick = signOut;
  $('#customerReauthenticate').onclick = signOut;

  async function loadDetails() {
    if (!session || detailsBusy) return;
    const stamp = epoch, request = ++detailRequest, edits = detailEdits;
    detailsBusy = true; updateDetailsStatus();
    try {
      const {data, error} = await accountRpc('get_my_customer_details');
      if (error) throw error;
      if (stamp !== epoch || request !== detailRequest) return;
      // Keep edits made during the read, but refill a draft discarded on Back.
      const preserveDraft = edits !== detailEdits && detailsDirty();
      details = data || {};
      if (!preserveDraft)
        for (const name of detailFields) detailsForm.elements[name].value = details[name] || '';
      fillCheckout();
    } catch (error) { if (stamp === epoch && request === detailRequest) message(accountError(error,'收货资料暂时无法加载，请检查网络后返回账户，再打开“收货资料”重试。')); }
    finally { if (stamp === epoch && request === detailRequest) { detailsBusy = false; updateDetailsStatus(); } }
  }
  detailsForm.onsubmit = async (event) => {
    event.preventDefault();
    if (!session) return;
    const stamp = epoch, submit = detailsForm.querySelector('[type=submit]');
    if (submit.disabled) return;
    const values = detailValues();
    if (deliveryAddress(values).length > 500) { message('完整配送地址过长，请缩短至 500 个字符以内。资料未保存。'); return; }
    detailsBusy = true; detailsSaving = true; detailsSaved = false; updateDetailsStatus(); message('正在保存…');
    try {
      const {data, error} = await accountRpc('save_my_customer_details_v2', Object.fromEntries(detailFields.map(name=>[`p_${name}`,values[name]])));
      if (error) throw error;
      if (stamp !== epoch) return;
      details = data; detailsSaved = !detailsDirty(); fillCheckout(); message(detailsDirty() ? '资料已保存；你随后修改的内容尚未保存。' : '收货资料已保存。');
    } catch (error) { if (stamp === epoch) message(accountError(error,'资料未保存，请检查网络和填写格式后重试。')); }
    finally { if (stamp === epoch) { detailsBusy = false; detailsSaving = false; updateDetailsStatus(); } }
  };

  function renderOrder(order) {
    const entry = element('div', undefined, 'customer-order-entry');
    const card = window.TingsOrderCards.create(order);
    const items = Array.isArray(order.items) ? order.items.filter(item => item && typeof item === 'object') : [];
    const form = card.querySelector('[data-cancel-form]');
    if (form) {
      const reason = form.elements.cancelReason;
      const cancel = form.querySelector('[type=submit]');
      form.onsubmit = async (event) => {
        event.preventDefault(); if (cancel.disabled) return;
        if (!reason.value.trim()) { reason.setCustomValidity('请填写取消原因'); reason.reportValidity(); return; }
        const stamp = epoch; cancel.disabled = true; cancel.textContent = '正在提交…';
        try {
          const {data,error} = await accountRpc('request_my_order_cancellation', {p_order_id: order.id,p_reason: reason.value.trim()});
          if (error) throw error;
          if (stamp !== epoch) return;
          message(data ? '取消申请已提交，等待店主处理。' : '订单状态已变化，请查看最新状态。');
          await loadOrders();
        } catch (error) { if (stamp === epoch) message(accountError(error,'取消申请未提交，请检查网络后重试。')); }
        finally { cancel.disabled = false; cancel.textContent = '提交取消申请'; }
      };
    }
    const copy = element('button', '复制', 'customer-copy-order'); copy.type = 'button';
    copy.setAttribute('aria-label', '复制订单号');
    copy.onclick = async () => {
      const stamp = epoch;
      try { await navigator.clipboard.writeText(String(order.order_number)); if (stamp === epoch) message('订单号已复制。'); }
      catch { if (stamp === epoch) message(`无法自动复制，请长按或选中订单号：${order.order_number}`); }
    };
    const number = card.querySelector('header > div > b');
    const numberRow = element('div', undefined, 'customer-order-number-row');
    number.replaceWith(numberRow); numberRow.append(number, copy);
    const buy = element('button', '再次购买', 'lookup-cancel-button'); buy.type = 'button';
    const preview = element('section', undefined, 'customer-reorder-preview'); preview.hidden = true;
    buy.onclick = () => void prepareReorder(order, preview, buy);
    buy.disabled = !items.length;
    let actions = card.querySelector('.lookup-actions');
    if (!actions) { actions = element('div', undefined, 'lookup-actions'); card.append(actions); }
    actions.prepend(buy); entry.append(card,preview);
    return entry;
  }
  async function prepareReorder(order, region, trigger) {
    if (reorderBusy || !session) return;
    const stamp = epoch;
    reorderBusy = true; trigger.disabled = true; region.hidden = false;
    region.textContent = '正在核对当前商品、规格和库存…';
    const current = () => stamp === epoch && !!session && region.isConnected && dialog.open;
    try {
      if (!window.TingsCart) throw new Error('商品仍在加载，请稍后重试。');
      const plan = await window.TingsCart.prepareReorder(order.items);
      if (current()) showReorder(plan);
    } catch { if (current()) region.textContent = '暂时无法核对商品与库存，请点击“再次购买”重试。'; }
    finally { if (stamp === epoch) { reorderBusy = false; trigger.disabled = false; } }
    function showReorder(plan, changed = false) {
      region.replaceChildren(element('h4', changed ? '商品或购物篮已变化，请重新确认' : '核对本次加入购物篮的商品'));
      const list = element('ul');
      for (const item of plan.additions) list.append(element('li',`${item.product.name}${item.label ? ` · ${item.label}` : ''} × ${item.qty} · 当前标价 ${money(item.price)}/件`));
      region.append(list);
      for (const issue of plan.issues) region.append(element('p',issue,'customer-reorder-issue'));
      region.append(element('p','保留原购物篮。按当前价格与优惠结算，不沿用旧订单价格；最终金额和库存以下单核算为准。','customer-muted'));
      const confirm = element('button','确认加入购物篮','customer-primary'); confirm.type = 'button'; confirm.disabled = !plan.additions.length;
      const dismiss = element('button','暂不加入'); dismiss.type = 'button'; dismiss.onclick = () => { region.hidden = true; };
      confirm.onclick = async () => {
        if (reorderBusy || !current()) return;
        if (!mayDiscard()) return;
        reorderBusy = true; confirm.disabled = true; dismiss.disabled = true; trigger.disabled = true;
        try {
          const result = await window.TingsCart.confirmReorder(order.items,plan,current);
          if (!current()) return;
          if (result.changed) { showReorder(result.plan,true); return; }
          region.replaceChildren(element('p',`已加入 ${result.count} 件商品，原购物篮已保留。`));
          const open = element('button','查看购物篮'); open.type = 'button';
          open.onclick = () => { if (mayDiscard()) { dialog.close(); window.TingsCart.open(); } };
          region.append(open); message('已加入购物篮，请核对后再结算。');
        } catch { if (current()) { message('未加入购物篮，请重新核对后重试。'); confirm.disabled = false; dismiss.disabled = false; } }
        finally { if (stamp === epoch) { reorderBusy = false; trigger.disabled = false; } }
      };
      region.append(confirm,dismiss);
    }
  }
  function renderOrders() {
    if (!ordersLoaded) return;
    const query = $('#customerOrderSearch').value.trim().toLocaleLowerCase(), filter = $('#customerOrderFilter').value;
    const matches = orderRows.filter(order => {
      const terminal = ['已完成','已取消'].includes(order.status);
      const statusMatch = filter === 'all' || (filter === 'active' && !terminal) || (filter === 'cancelling' && order.cancellation_requested && !terminal) || (filter === 'completed' && order.status === '已完成') || (filter === 'cancelled' && order.status === '已取消');
      const haystack = [order.order_number,...(Array.isArray(order.items) ? order.items.map(item => `${item?.name || ''} ${item?.variant_label || ''}`) : [])].join(' ').toLocaleLowerCase();
      return statusMatch && haystack.includes(query);
    });
    const list = $('#customerOrders'); list.replaceChildren(...matches.map(renderOrder));
    if (!matches.length) {
      if (orderRows.length) list.append(element('p','没有符合条件的订单。','customer-orders-no-match'));
      else list.textContent = offset ? '没有更多订单。' : '还没有账户订单，登录后下单就会显示在这里。';
    }
  }
  $('#customerOrderSearch').oninput = renderOrders;
  $('#customerOrderFilter').onchange = renderOrders;
  async function loadOrders() {
    if (!session) return;
    const stamp = epoch, request = ++orderRequest;
    const list = $('#customerOrders'); orderRows = []; ordersLoaded = false; list.textContent = '正在加载订单…'; list.setAttribute('aria-busy','true');
    $('#customerOrderSearch').disabled = true; $('#customerOrderFilter').disabled = true;
    $('#customerOrdersPrev').disabled = true; $('#customerOrdersNext').disabled = true;
    try {
      const {data,error} = await accountRpc('get_my_customer_orders', {p_offset: offset});
      if (error || !Array.isArray(data)) throw error || new Error('Invalid orders');
      if (stamp !== epoch || request !== orderRequest) return;
      orderRows = data; ordersLoaded = true; renderOrders();
      $('#customerOrderUpdated').textContent = `更新于 ${new Date().toLocaleTimeString('zh-CN')}`;
      $('#customerOrdersPage').textContent = `第 ${offset / 20 + 1} 页`;
      $('#customerOrdersPrev').disabled = offset === 0;
      $('#customerOrdersNext').disabled = data.length < 20;
    } catch (error) { if (stamp === epoch && request === orderRequest) { list.textContent = accountError(error,'订单暂时无法加载，请检查网络后点击“刷新订单”重试。'); $('#customerOrdersPrev').disabled = offset === 0; $('#customerOrderUpdated').textContent = authExpired ? '登录已过期' : '加载失败'; } }
    finally { if (stamp === epoch && request === orderRequest) { list.setAttribute('aria-busy','false'); $('#customerOrderSearch').disabled = !ordersLoaded; $('#customerOrderFilter').disabled = !ordersLoaded; } }
  }
  $('#customerRefreshOrders').onclick = () => { offset = 0; void loadOrders(); };
  $('#customerOrdersPrev').onclick = () => { offset = Math.max(0, offset - 20); void loadOrders(); };
  $('#customerOrdersNext').onclick = () => { offset += 20; void loadOrders(); };

  wallet=window.createTingsWallet({rpc:accountRpc,identity:()=>session&&!authExpired?`${epoch}:${session.user.id}`:null,onError:accountError,dialog});
  window.addEventListener('tings:checkout-open', () => {
    checkoutContext = ready.then(() => {
      checkoutOwner = session?.user.id || null;
      if (!document.getElementById('customerCheckoutHint')) {
        const hint = element('p', '', 'customer-checkout-hint'); hint.id = 'customerCheckoutHint';
        document.querySelector('#orderForm').prepend(hint);
      }
      checkoutHint(); fillCheckout();
      if(session)void wallet.load();else wallet.reset();
    });
  });
  window.addEventListener('tings:order-submitted', () => {
    wallet.reset();
    filled.clear(); offset = 0; if (session && dialog.open) void loadOrders();
  });
  window.TingsAccount = {
    open: openAccount,
    async previewAccountOffer(args) {
      await ready;
      if(!session)return guestOfferPreview(args);
      const stamp=epoch;
      const result=await accountRpc('preview_account_offer',args);
      if(stamp!==epoch)throw new Error('Account changed');
      if(result.error)throw result.error;
      return result;
    },
    async checkoutHeaders() {
      await ready; await checkoutContext;
      if (authBlocked) throw new Error('登录状态暂时无法确认，请刷新页面后重试。');
      const expected = session?.user.id || null;
      if (checkoutOwner !== expected) throw new Error('下单账户已改变，请关闭并重新打开结算窗口。');
      if (!session) return {Authorization: `Bearer ${window.TINGS_SUPABASE.anonKey}`};
      const {data,error} = await client.auth.getSession();
      if (error || !data.session?.access_token || data.session.user.id !== expected || (session?.user.id || null) !== expected)
        throw new Error('登录已失效，请重新登录后提交订单。');
      return {Authorization: `Bearer ${data.session.access_token}`};
    },
  };
})();
