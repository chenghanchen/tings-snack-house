(() => {
  const money = (n) => `$${Number(n || 0).toFixed(2)}`;
  const $ = (s) => document.querySelector(s);
  const esc = (v) =>
    String(v ?? "").replace(
      /[&<>"']/g,
      (c) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        })[c],
    );
  const now = () => new Date();
  const localValue = (value) =>
    value ? new Date(value).toISOString().slice(0, 16) : "";
  const asArray = (value) => (Array.isArray(value) ? value : []);
  const currentStatus = (item) =>
    item.status || (item.active ? "published" : "stopped");
  const isPublished = (item) =>
    currentStatus(item) === "published" && item.active !== false;
  const isRunning = (item) =>
    isPublished(item) &&
    (!item.starts_at || new Date(item.starts_at) <= now()) &&
    (!item.ends_at || new Date(item.ends_at) >= now());
  const typeNames = {
    full_reduction: "满减优惠",
    discount: "折扣",
    coupon: "优惠券",
    referral: "推荐奖励",
    referral_code: "推荐码",
    free_shipping: "免配送费",
    product_special: "指定商品优惠",
    limited: "限时促销",
  };
  let db,
    products = [],
    categories = [],
    campaigns = [],
    coupons = [],
    orders = [],
    redemptions = [],
    referrals = [],
    rewards = null,
    wizard = null;
  let metricRange = "month",
    customMetricStart = "",
    customMetricEnd = "";

  function toast(message) {
    const el = $("#toast");
    if (!el) return;
    el.textContent = message;
    el.classList.add("show");
    setTimeout(() => el.classList.remove("show"), 2800);
  }
  function blank(type = "full_reduction") {
    return {
      type,
      id: "",
      name: "",
      code: "",
      amount: "",
      threshold: "",
      discountMode: "percent",
      fold: "20",
      quantity: 100,
      customerScope: "all",
      targetMode: type === "product_special" ? "products" : "all",
      productIds: new Set(),
      categoryNames: new Set(),
      allowCouponStack: true,
      allowCampaignStack: true,
      startsAt: "",
      endsAt: "",
      referralAmount: rewards?.referral_amount ?? rewards?.amount ?? 5,
      referralMin: rewards?.referral_min_spend ?? rewards?.min_spend ?? 35,
      referralDays: rewards?.referral_valid_days ?? rewards?.valid_days ?? 0,
      referralUseLimit: rewards?.referral_max_uses ?? 0,
      rewardAmount: rewards?.reward_amount ?? rewards?.amount ?? 5,
      rewardMin: rewards?.reward_min_spend ?? rewards?.min_spend ?? 35,
      rewardDays: rewards?.reward_valid_days ?? rewards?.valid_days ?? 0,
      originalStatus: "published",
    };
  }

  async function load() {
    const result = await Promise.all([
      db
        .from("marketing_campaigns")
        .select("*")
        .order("created_at", { ascending: false }),
      db
        .from("marketing_coupons")
        .select("*")
        .order("created_at", { ascending: false }),
      db.from("orders").select("*").order("created_at", { ascending: false }),
      db.from("coupon_redemptions").select("*"),
      db
        .from("customer_referrals")
        .select("*")
        .order("created_at", { ascending: false }),
      db.from("products").select("id,name"),
      db.from("categories").select("name"),
      db.from("referral_reward_settings").select("*").eq("id", 1).maybeSingle(),
    ]);
    [campaigns, coupons, orders, redemptions, referrals, products, categories] =
      result.slice(0, 7).map((x) => x.data || []);
    rewards = result[7].data || { amount: 5, min_spend: 35, valid_days: 0 };
    render();
  }
  function chicagoDate(value = new Date()) {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: "America/Chicago",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    })
      .formatToParts(new Date(value))
      .reduce((out, part) => ((out[part.type] = part.value), out), {});
    return `${parts.year}-${parts.month}-${parts.day}`;
  }
  function chicagoTime(value) {
    return value
      ? new Intl.DateTimeFormat("zh-CN", {
          timeZone: "America/Chicago",
          year: "numeric",
          month: "numeric",
          day: "numeric",
          hour: "2-digit",
          minute: "2-digit",
          hour12: false,
        }).format(new Date(value))
      : "";
  }
  function shiftDate(date, days) {
    const copy = new Date(`${date}T12:00:00Z`);
    copy.setUTCDate(copy.getUTCDate() + days);
    return copy.toISOString().slice(0, 10);
  }
  function metricWindow() {
    const today = chicagoDate();
    if (metricRange === "today") return { start: today, end: today };
    if (metricRange === "7d")
      return { start: shiftDate(today, -6), end: today };
    if (metricRange === "30d")
      return { start: shiftDate(today, -29), end: today };
    if (metricRange === "month")
      return { start: `${today.slice(0, 7)}-01`, end: today };
    return { start: customMetricStart || null, end: customMetricEnd || null };
  }
  function inMetricWindow(order, window) {
    const date = chicagoDate(order.created_at);
    return (
      (!window.start || date >= window.start) &&
      (!window.end || date <= window.end)
    );
  }
  function stats() {
    const eligible = orders.filter((x) => x.status !== "已取消"),
      window = metricWindow(),
      rows = eligible.filter((x) => inMetricWindow(x, window)),
      discounted = rows.filter(
        (x) =>
          Number(x.discount_amount || 0) > 0 ||
          (x.fulfillment === "delivery" && Number(x.delivery_fee || 0) === 0),
      ),
      firstByPhone = new Map();
    eligible
      .slice()
      .sort((a, b) => new Date(a.created_at) - new Date(b.created_at))
      .forEach((x) => {
        if (x.phone && !firstByPhone.has(x.phone))
          firstByPhone.set(x.phone, x.id);
      });
    return {
      sales: rows.reduce((s, x) => s + Number(x.total_amount || 0), 0),
      orders: discounted.length,
      savings: rows.reduce((s, x) => s + Number(x.discount_amount || 0), 0),
      newCustomers: new Set(
        rows
          .filter((x) => x.phone && firstByPhone.get(x.phone) === x.id)
          .map((x) => x.phone),
      ).size,
    };
  }
  function metricRangeControl() {
    const custom = metricRange === "custom",
      window = metricWindow(),
      label =
        metricRange === "today"
          ? "今日"
          : metricRange === "7d"
            ? "近 7 天"
            : metricRange === "30d"
              ? "近 30 天"
              : metricRange === "month"
                ? "本月"
                : "自定义日期";
    return `<div class="marketing-metrics-head"><span class="marketing-metrics-label">数据统计</span><div class="marketing-date-filter"><select aria-label="统计时间范围" data-metric-range><option value="today" ${metricRange === "today" ? "selected" : ""}>今日</option><option value="7d" ${metricRange === "7d" ? "selected" : ""}>近 7 天</option><option value="30d" ${metricRange === "30d" ? "selected" : ""}>近 30 天</option><option value="month" ${metricRange === "month" ? "selected" : ""}>本月</option><option value="custom" ${custom ? "selected" : ""}>自定义日期</option></select>${custom ? `<div class="custom-date-range"><input aria-label="开始日期" data-metric-start type="date" value="${esc(window.start || "")}"><span>至</span><input aria-label="结束日期" data-metric-end type="date" value="${esc(window.end || "")}"></div>` : ""}</div><button class="primary marketing-create" data-create>＋ 创建活动</button></div>`;
  }
  function campaignType(item) {
    if (item.kind === "full_reduction") return "full_reduction";
    if (item.kind === "free_shipping") return "free_shipping";
    if (asArray(item.product_ids).length) return "product_special";
    return item.ends_at || item.starts_at ? "limited" : "discount";
  }
  function offerText(item, coupon = false) {
    if (coupon)
      return `${esc(item.code)} · 立减 ${money(item.amount)}，满 ${money(item.min_spend)} 可用`;
    if (item.kind === "free_shipping") return "配送费全免";
    if (item.kind === "full_reduction")
      return `满 ${money(item.threshold)} 立减 ${money(item.amount)}`;
    return item.discount_kind === "percent"
      ? `商品 ${Number(item.amount || 0)}% Off`
      : `每件立减 ${money(item.amount)}`;
  }
  function timeText(item) {
    if (!item.starts_at && !item.ends_at) return "长期有效";
    const f = (v) =>
      new Intl.DateTimeFormat("zh-CN", {
        month: "numeric",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      }).format(new Date(v));
    return `${item.starts_at ? f(item.starts_at) : "立即"} — ${item.ends_at ? f(item.ends_at) : "长期"}`;
  }
  function statusLabel(item) {
    const status = currentStatus(item);
    return status === "draft"
      ? "草稿"
      : status === "stopped"
        ? "已停用"
        : isRunning(item)
          ? "进行中"
          : item.starts_at && new Date(item.starts_at) > now()
            ? "待开始"
            : "已结束";
  }
  function offerCard(item, coupon = false) {
    const status = statusLabel(item),
      used = coupon
        ? `已用 ${redemptions.filter((x) => x.coupon_id === item.id).length}/${item.total_quantity} · ${item.allow_campaign_stack === false ? "不可与活动叠加" : "可与活动叠加"}`
        : item.allow_coupon_stack === false
          ? "不可与优惠券叠加"
          : "可与优惠券叠加";
    const actions =
      currentStatus(item) === "draft"
        ? `<button data-publish="${item.id}" data-table="${coupon ? "coupon" : "campaign"}">立即发布</button><button data-edit="${item.id}" data-table="${coupon ? "coupon" : "campaign"}">编辑</button>`
        : currentStatus(item) === "stopped"
          ? `<button data-publish="${item.id}" data-table="${coupon ? "coupon" : "campaign"}">重新发布</button><button data-edit="${item.id}" data-table="${coupon ? "coupon" : "campaign"}">编辑</button>`
          : `<button data-edit="${item.id}" data-table="${coupon ? "coupon" : "campaign"}">编辑</button><button data-stop="${item.id}" data-table="${coupon ? "coupon" : "campaign"}">停用</button>`;
    return `<article class="marketing-offer-card ${status === "进行中" ? "running" : ""}"><div class="offer-dot"></div><div class="offer-content"><div class="offer-title"><b>${esc(item.name)}</b><span class="offer-status ${currentStatus(item)}">${status}</span></div><p>${offerText(item, coupon)}</p><small>${timeText(item)} · ${used}</small></div><div class="offer-actions">${actions}</div></article>`;
  }
  function render() {
    const root = $("#marketingCenter");
    if (!root) return;
    const s = stats(),
      referralRewardCoupons = coupons.filter((coupon) => coupon.is_referral_reward),
      active = [
        ...campaigns.filter(isRunning),
        ...coupons
          .filter((coupon) => !coupon.is_referral_reward && isRunning(coupon))
          .map((x) => ({ ...x, _coupon: true })),
      ];
    const referralAmount = rewards?.referral_amount ?? rewards?.amount ?? 5,
      referralMin = rewards?.referral_min_spend ?? rewards?.min_spend ?? 35,
      referralDays = rewards?.referral_valid_days ?? rewards?.valid_days ?? 0,
      rewardAmount = rewards?.reward_amount ?? rewards?.amount ?? 5,
      rewardMin = rewards?.reward_min_spend ?? rewards?.min_spend ?? 35,
      rewardDays = rewards?.reward_valid_days ?? rewards?.valid_days ?? 0;
    root.innerHTML = `<div class="marketing-home"><section class="panel marketing-overview"><div class="marketing-hero"><div><p class="eyebrow">MARKETING CENTER</p><h2>营销中心</h2><p class="muted">创建、发布并追踪每一个优惠活动。</p></div><button class="primary marketing-create" data-create>＋ 创建营销活动</button></div>${metricRangeControl()}<div class="marketing-metrics"><div><span>营销销售额</span><b>${money(s.sales)}</b></div><div><span>优惠订单</span><b>${s.orders}</b></div><div><span>优惠金额</span><b>${money(s.savings)}</b></div><div><span>新客</span><b>${s.newCustomers}</b></div></div></section><section class="panel marketing-active${active.length ? "" : " is-empty"}"><div class="panel-head"><div><h2>正在进行的活动</h2><p class="muted">顾客当前可享受的优惠</p></div><span class="marketing-count">${active.length} 项</span></div><div class="marketing-offer-list">${active.map((x) => offerCard(x, !!x._coupon)).join("") || '<p class="muted empty-offer">暂时没有正在进行的活动。点击“创建营销活动”开始设置。</p>'}</div></section><section class="panel marketing-library"><div class="panel-head"><div><h2>活动与优惠券</h2><p class="muted">草稿、待开始、已结束或已停用的活动也会保留在这里。</p></div><button class="text-btn" data-create>＋ 创建</button></div><div class="marketing-offer-list">${
      [...campaigns, ...coupons.map((x) => ({ ...x, _coupon: true }))]
        .filter((x) => !isRunning(x))
        .map((x) => offerCard(x, !!x._coupon))
        .join("") || '<p class="muted empty-offer">还没有草稿或历史活动。</p>'
    }</div></section><section class="panel referral-summary"><div><p class="eyebrow">REFERRAL REWARD</p><h2>推荐奖励</h2><p>新生成推荐码：新客首单立减 <b>${money(referralAmount)}</b>，满 <b>${money(referralMin)}</b> 可用${Number(referralDays) ? `，有效期 ${referralDays} 天` : "，长期有效"}${Number(rewards?.referral_max_uses || 0) ? `，每码最多 ${rewards.referral_max_uses} 次` : "，不限次数"}。新生成推荐奖励券：双方各获 <b>${money(rewardAmount)}</b> 券，满 <b>${money(rewardMin)}</b> 可用${Number(rewardDays) ? `，有效期 ${rewardDays} 天` : "，长期有效"}，每券限用一次。调整不会影响已经生成的推荐码或推荐券。</p></div><div><b>${referrals.length}</b><small>已生成推荐码</small><div class="referral-summary-actions"><div><button class="text-btn" data-show-referral-codes>查看推荐码</button><button class="text-btn" data-create-referral-code>调整推荐码</button></div><div><button class="text-btn" data-show-referral-rewards>查看推荐券</button><button class="text-btn" data-create-referral>调整推荐券</button></div></div></div></section></div>${wizard ? wizardView() : ""}`;
    root.querySelector(".marketing-library .muted").textContent =
      "草稿，已结束或已停用的活动也会保留在这里。";
    root.querySelector(".marketing-active h2").textContent =
      "进行中的活动/优惠券";
    root.querySelector(".marketing-library h2").textContent =
      "已结束的活动/优惠券";
    root.querySelector(".referral-summary h2").insertAdjacentHTML(
      "afterend",
      `<span class="referral-code-total">已生成推荐码：<b>${referrals.length}</b></span><span class="referral-code-total">已生成推荐券：<b>${referralRewardCoupons.length}</b></span>`,
    );
    bind();
  }
  function choice(type, icon, title, note) {
    return `<button type="button" class="wizard-type${wizard?.type === type ? " selected" : ""}" data-wizard-type="${type}"><i>${icon}</i><b>${title}</b><small>${note}</small></button>`;
  }
  function stepIndicator(step) {
    return `<div class="wizard-steps">${["选择类型", "设置优惠", "适用范围", "时间与预览"].map((l, i) => `<span class="${i + 1 === step ? "active" : i + 1 < step ? "done" : ""}"><i>${i + 1}</i>${l}</span>`).join("")}</div>`;
  }
  function wizardView() {
    const w = wizard,
      heading = ["referral", "referral_code"].includes(w.type)
        ? w.type === "referral_code"
          ? "调整推荐码"
          : "调整推荐券"
        : w.id
          ? "编辑营销活动"
          : "创建营销活动",
      typeName = typeNames[w.type] || "营销活动",
      body =
        w.step === 1
          ? `<div class="wizard-type-grid">${choice("full_reduction", "💵", "满减优惠", "消费满额立减")}${choice("discount", "🛍", "商品优惠", "全店、分类或商品折扣")}${choice("coupon", "🎟", "优惠券", "创建兑换码")}${choice("referral", "🎁", "推荐奖励", "设置推荐奖励券")}${choice("free_shipping", "🚗", "免配送费", "配送订单免运费")}${choice("limited", "⏰", "限时促销", "为优惠设置活动时间")}</div>`
          : w.step === 2
            ? wizardCore(w)
            : w.step === 3
              ? wizardAudience(w)
              : wizardPreview(w),
      next =
        w.step === 4
          ? ""
          : `<button class="primary" data-wizard-next>${w.step === 1 ? "下一步" : "继续"} →</button>`,
      previous =
        w.step > 1
          ? '<button class="text-btn" data-wizard-back>← 上一步</button>'
          : "";
    return `<section class="marketing-wizard-shell" aria-label="营销活动向导"><div class="marketing-wizard"><div class="wizard-head"><div><p class="eyebrow">CAMPAIGN WIZARD</p><h2>${heading}</h2><p class="muted">${w.step === 1 ? "第一步：你想做什么？" : typeName}</p></div><button class="close-wizard" data-wizard-close aria-label="关闭">×</button></div>${stepIndicator(w.step)}<div class="wizard-body">${body}</div><div class="wizard-footer"><div>${previous}</div>${next}</div></div></section>`;
  }
  function field(label, content, hint = "") {
    return `<label>${label}${content}${hint ? `<small>${hint}</small>` : ""}</label>`;
  }
  function input(id, value, opts = "") {
    return `<input id="${id}" value="${esc(value)}" ${opts}>`;
  }
  function wizardCore(w) {
    if (w.type === "coupon")
      return `<div class="wizard-form"><h3>创建优惠券</h3><p class="muted">顾客会在结账页输入兑换码使用。</p>${field("活动名称", input("wizName", w.name, 'required placeholder="例如：开学零食券"'))}<div class="two">${field("兑换码", input("wizCode", w.code, 'required placeholder="例如：WELCOME5" style="text-transform:uppercase"'))}${field("立减金额（美元）", input("wizAmount", w.amount, 'type="number" min="0.01" step="0.01" required placeholder="5"'))}</div><div class="two">${field("最低消费（美元）", input("wizThreshold", w.threshold, 'type="number" min="0" step="0.01" placeholder="35"'))}${field("总数量", input("wizQuantity", w.quantity, 'type="number" min="1" step="1" required'))}</div></div>`;
    if (w.type === "referral")
      return `<div class="wizard-form"><h3>设置推荐奖励券</h3><p class="muted">新顾客成功使用推荐码后，新顾客和推荐人各获得一张奖励券；每张奖励券固定只能使用一次。</p><div class="two">${field("奖励券满减金额（美元）", input("wizRewardAmount", w.rewardAmount, 'type="number" min="0.01" step="0.01" required'))}${field("奖励券最低消费（美元）", input("wizRewardMin", w.rewardMin, 'type="number" min="0" step="0.01" required'))}</div>${field("奖励券有效期（天）", input("wizRewardDays", w.rewardDays, 'type="number" min="0" step="1"'), "填写 0 代表长期有效；只用于之后生成的奖励券。")}</div>`;
    if (w.type === "referral_code")
      return `<div class="wizard-form"><h3>设置推荐码</h3><p class="muted">规则只会应用到之后新生成的推荐码，已生成推荐码会保留各自生成时的规则。</p><div class="two">${field("推荐码满减金额（美元）", input("wizReferralAmount", w.referralAmount, 'type="number" min="0.01" step="0.01" required'))}${field("推荐码最低消费（美元）", input("wizReferralMin", w.referralMin, 'type="number" min="0" step="0.01" required'))}</div><div class="two">${field("推荐码有效期（天）", input("wizReferralDays", w.referralDays, 'type="number" min="0" step="1"'), "填写 0 代表长期有效。")}${field("每个推荐码可成功使用次数", input("wizReferralUseLimit", w.referralUseLimit, 'type="number" min="0" step="1"'), "填写 0 代表不限次数；达到次数后立即失效。")}</div></div>`;
    if (w.type === "free_shipping")
      return `<div class="wizard-form"><h3>配送费全免</h3><p class="muted">仅配送到家的订单可享受；到店自取不会显示配送费。</p>${field("活动名称", input("wizName", w.name, 'required placeholder="例如：周末免配送"'))}</div>`;
    const full = w.type === "full_reduction";
    return `<div class="wizard-form"><h3>${full ? "设置满减优惠" : "设置折扣"}</h3>${field("活动名称", input("wizName", w.name, `required placeholder="例如：${full ? "周末零食节" : "夏日饮料折扣"}"`))}${full ? `<div class="two">${field("消费满（美元）", input("wizThreshold", w.threshold, 'type="number" min="0" step="0.01" required placeholder="50"'))}${field("优惠（美元）", input("wizAmount", w.amount, 'type="number" min="0.01" step="0.01" required placeholder="8"'))}</div>` : `<div class="two">${field("优惠方式", `<select id="wizDiscountMode"><option value="percent" ${w.discountMode === "percent" ? "selected" : ""}>% Off</option><option value="fixed" ${w.discountMode === "fixed" ? "selected" : ""}>每件减 $</option></select>`)}${w.discountMode === "percent" ? field("优惠比例（输入 20 表示 20% Off）", input("wizFold", w.fold, 'type="number" min="0.1" max="100" step="0.1" required')) : field("每件优惠（美元）", input("wizAmount", w.amount, 'type="number" min="0.01" step="0.01" required'))}</div>`}</div>`;
  }
  function checked(set, value) {
    return set.has(String(value)) ? "checked" : "";
  }
  function picker(title, key, rows, selected) {
    return `<div class="wizard-picker"><b>${title}</b><div class="wizard-choice-list">${rows.map((r) => `<label><input type="checkbox" data-picker="${key}" value="${esc(r.value)}" ${checked(selected, r.value)}><span>${esc(r.label)}</span></label>`).join("") || "<small>暂无可选项目</small>"}</div></div>`;
  }
  function wizardAudience(w) {
    if (w.type === "referral" || w.type === "referral_code")
      return `<div class="wizard-form"><h3>确认${w.type === "referral_code" ? "推荐码" : "推荐奖励券"}设置</h3><p class="muted">保存后只会用于之后生成的${w.type === "referral_code" ? "推荐码" : "推荐奖励券"}。</p></div>`;
    const coupon = w.type === "coupon",
      shipping = w.type === "free_shipping",
      target =
        shipping || coupon
          ? ""
          : `<div class="wizard-target-options"><b>适用商品</b><div class="segment-control"><button data-target-mode="all" class="${w.targetMode === "all" ? "selected" : ""}">所有商品</button><button data-target-mode="categories" class="${w.targetMode === "categories" ? "selected" : ""}">指定分类</button><button data-target-mode="products" class="${w.targetMode === "products" ? "selected" : ""}">指定商品</button></div>${
              w.targetMode === "products"
                ? picker(
                    "选择商品（可多选）",
                    "products",
                    products.map((x) => ({
                      value: String(x.id),
                      label: x.name,
                    })),
                    w.productIds,
                  )
                : ""
            }${
              w.targetMode === "categories"
                ? picker(
                    "选择分类（可多选）",
                    "categories",
                    categories.map((x) => ({ value: x.name, label: x.name })),
                    w.categoryNames,
                  )
                : ""
            }</div>`;
    const stackChoice = coupon
      ? `<label class="stack-choice"><input id="wizStack" type="checkbox" ${w.allowCampaignStack ? "checked" : ""}><span><b>允许与活动叠加</b><small>取消勾选后，顾客使用此优惠券时不能同时使用活动优惠。</small></span></label>`
      : `<label class="stack-choice"><input id="wizStack" type="checkbox" ${w.allowCouponStack ? "checked" : ""}><span><b>允许与优惠券／推荐码叠加</b><small>取消勾选后，顾客使用这个活动时不能同时使用兑换码。</small></span></label>`;
    return `<div class="wizard-form"><h3>适用范围</h3><div class="wizard-target-options"><b>适用顾客</b><div class="segment-control"><button data-customer-scope="all" class="${w.customerScope === "all" ? "selected" : ""}">所有顾客</button><button data-customer-scope="new" class="${w.customerScope === "new" ? "selected" : ""}">仅新顾客</button></div></div>${target}${stackChoice}</div>`;
  }
  function previewDescription(w) {
    if (w.type === "coupon")
      return `兑换码 ${w.code || "—"}：立减 ${money(w.amount || 0)}，满 ${money(w.threshold || 0)} 可用`;
    if (w.type === "referral")
      return `双方各获得 ${money(w.rewardAmount || 0)} 券，满 ${money(w.rewardMin || 0)} 可用`;
    if (w.type === "referral_code")
      return `新客首单立减 ${money(w.referralAmount || 0)}，满 ${money(w.referralMin || 0)} 可用`;
    if (w.type === "free_shipping") return "配送订单免配送费";
    if (w.type === "full_reduction")
      return `满 ${money(w.threshold || 0)} 立减 ${money(w.amount || 0)}`;
    return w.discountMode === "percent"
      ? `指定范围商品 ${w.fold || 0}% Off`
      : `指定范围商品每件立减 ${money(w.amount || 0)}`;
  }
  function wizardPreview(w) {
    if (w.type === "referral" || w.type === "referral_code")
      return `<div class="wizard-preview"><p class="eyebrow">PREVIEW</p><h3>${w.type === "referral_code" ? "推荐码规则" : "推荐奖励券规则"}</h3><b>${previewDescription(w)}</b><p>${w.type === "referral_code" ? `${Number(w.referralDays) ? `有效期 ${w.referralDays} 天` : "长期有效"} · ${Number(w.referralUseLimit) ? `每码最多 ${w.referralUseLimit} 次` : "不限使用次数"}` : `${Number(w.rewardDays) ? `有效期 ${w.rewardDays} 天` : "长期有效"} · 每券限用一次`}</p><div class="wizard-preview-actions"><button class="text-btn" data-save-referral>保存设置</button></div></div>`;
    const scope =
      w.targetMode === "products"
        ? `指定 ${w.productIds.size || 0} 件商品`
        : w.targetMode === "categories"
          ? `指定 ${w.categoryNames.size || 0} 个分类`
          : "所有商品";
    const stackNote =
      w.type === "coupon"
        ? `<p>${w.allowCampaignStack ? "可与活动叠加" : "不可与活动叠加"}</p>`
        : w.type !== "referral"
          ? `<p>${w.allowCouponStack ? "可与优惠券／推荐码叠加" : "不可与其他优惠同时使用"}</p>`
          : "";
    return `<div class="wizard-form wizard-schedule"><h3>设置活动时间</h3><p class="muted">留空即为立即开始、长期有效。</p><div class="two">${field("开始时间", input("wizStartsAt", w.startsAt, 'type="datetime-local"'))}${field("结束时间", input("wizEndsAt", w.endsAt, 'type="datetime-local"'))}</div></div><div class="wizard-preview"><p class="eyebrow">PREVIEW</p><h3>${esc(w.name || (w.type === "referral" ? "推荐奖励" : "未命名活动"))}</h3><b>${previewDescription(w)}</b><p>${w.type === "coupon" || w.type === "referral" ? (w.customerScope === "new" ? "仅新顾客" : "所有顾客") : `${w.customerScope === "new" ? "仅新顾客 · " : "所有顾客 · "}${scope}`}</p><p>${w.startsAt ? timeText({ starts_at: w.startsAt, ends_at: w.endsAt }) : "立即开始 — 长期有效"}</p>${stackNote}<div class="wizard-preview-actions">${w.type === "referral" ? '<button class="text-btn" data-save-referral>保存设置</button>' : '<button class="text-btn" data-save="draft">保存草稿</button><button class="primary" data-save="published">立即发布</button>'}</div></div>`;
  }
  function collect(step) {
    if (!wizard) return;
    const get = (id) => $("#" + id)?.value?.trim() ?? "";
    if (step === 2) {
      wizard.name = get("wizName");
      wizard.code = get("wizCode").toUpperCase();
      wizard.amount = get("wizAmount");
      wizard.threshold = get("wizThreshold");
      wizard.quantity = get("wizQuantity") || wizard.quantity;
      wizard.discountMode = $("#wizDiscountMode")?.value || wizard.discountMode;
      wizard.fold = get("wizFold") || wizard.fold;
      wizard.rewardAmount = get("wizRewardAmount") || wizard.rewardAmount;
      wizard.rewardMin = get("wizRewardMin") || wizard.rewardMin;
      wizard.rewardDays = get("wizRewardDays") || wizard.rewardDays;
      wizard.referralAmount = get("wizReferralAmount") || wizard.referralAmount;
      wizard.referralMin = get("wizReferralMin") || wizard.referralMin;
      wizard.referralDays = get("wizReferralDays") || wizard.referralDays;
      wizard.referralUseLimit = get("wizReferralUseLimit") || wizard.referralUseLimit;
    }
    if (step === 3 && $("#wizStack")) {
      if (wizard.type === "coupon") wizard.allowCampaignStack = $("#wizStack").checked;
      else wizard.allowCouponStack = $("#wizStack").checked;
    }
    if (step === 4) {
      wizard.startsAt = get("wizStartsAt");
      wizard.endsAt = get("wizEndsAt");
    }
  }
  function validStep() {
    if (wizard.step === 1) return !!wizard.type;
    if (wizard.step === 2) {
      if (wizard.type === "coupon")
        return wizard.name && wizard.code && Number(wizard.amount) > 0;
      if (wizard.type === "referral") return Number(wizard.rewardAmount) > 0;
      if (wizard.type === "referral_code")
        return Number(wizard.referralAmount) > 0 && Number(wizard.referralUseLimit) >= 0;
      if (wizard.type === "free_shipping") return !!wizard.name;
      if (!wizard.name) return false;
      return wizard.type === "full_reduction"
        ? Number(wizard.threshold) >= 0 && Number(wizard.amount) > 0
        : wizard.discountMode === "percent"
          ? Number(wizard.fold) > 0 && Number(wizard.fold) <= 100
          : Number(wizard.amount) > 0;
    }
    if (
      wizard.step === 3 &&
      wizard.targetMode === "products" &&
      wizard.type === "product_special"
    )
      return wizard.productIds.size > 0;
    return true;
  }
  function campaignRow(status) {
    const w = wizard,
      fixed = w.discountMode === "fixed";
    let kind = "product_discount";
    if (w.type === "full_reduction") kind = "full_reduction";
    if (w.type === "free_shipping") kind = "free_shipping";
    if (w.targetMode === "categories") kind = "category_discount";
    const amount =
        w.type === "full_reduction"
          ? Number(w.amount)
          : w.type === "free_shipping"
            ? 0
            : fixed
              ? Number(w.amount)
              : Math.max(0, Number(w.fold)),
      row = {
        kind,
        name: w.name.trim(),
        discount_kind:
          w.type === "free_shipping"
            ? "free_shipping"
            : w.type === "full_reduction"
              ? "fixed"
              : fixed
                ? "fixed"
                : "percent",
        amount,
        threshold: w.type === "full_reduction" ? Number(w.threshold) : 0,
        product_ids:
          w.targetMode === "products" ? [...w.productIds].map(Number) : [],
        category_names:
          w.targetMode === "categories" ? [...w.categoryNames] : [],
        customer_scope: w.customerScope,
        allow_coupon_stack: w.allowCouponStack,
        starts_at: w.startsAt || null,
        ends_at: w.endsAt || null,
        status,
        active: status === "published",
        updated_at: new Date().toISOString(),
      };
    if (w.id) row.id = w.id;
    return row;
  }
  function couponRow(status) {
    const w = wizard,
      row = {
        code: w.code.trim().toUpperCase(),
        name: w.name.trim(),
        amount: Number(w.amount),
        min_spend: Number(w.threshold || 0),
        total_quantity: Number(w.quantity || 1),
        per_phone_limit: 1,
        customer_scope: w.customerScope,
        allow_campaign_stack: w.allowCampaignStack,
        starts_at: w.startsAt || null,
        ends_at: w.endsAt || null,
        status,
        active: status === "published",
        updated_at: new Date().toISOString(),
      };
    if (w.id) row.id = w.id;
    return row;
  }
  async function save(status) {
    collect(4);
    if (!validStep()) return toast("请先补全必填内容。");
    if (
      wizard.endsAt &&
      wizard.startsAt &&
      new Date(wizard.endsAt) <= new Date(wizard.startsAt)
    )
      return toast("结束时间需晚于开始时间。");
    const table =
        wizard.type === "coupon" ? "marketing_coupons" : "marketing_campaigns",
      row = wizard.type === "coupon" ? couponRow(status) : campaignRow(status),
      { error } = await db.from(table).upsert(row);
    toast(
      error ? error.message : status === "draft" ? "草稿已保存" : "活动已发布",
    );
    if (!error) {
      wizard = null;
      load();
    }
  }
  async function saveReferral() {
    collect(2);
    const row = {
        id: 1,
        referral_amount: Number(wizard.referralAmount),
        referral_min_spend: Number(wizard.referralMin),
        referral_valid_days: Number(wizard.referralDays),
        referral_max_uses: Number(wizard.referralUseLimit),
        reward_amount: Number(wizard.rewardAmount),
        reward_min_spend: Number(wizard.rewardMin),
        reward_valid_days: Number(wizard.rewardDays),
        // 保留旧字段，确保尚未升级的页面仍可正常读取设置。
        amount: Number(wizard.rewardAmount),
        min_spend: Number(wizard.rewardMin),
        valid_days: Number(wizard.rewardDays),
        updated_at: new Date().toISOString(),
      },
      { error } = await db.from("referral_reward_settings").upsert(row);
    toast(
      error
        ? error.message
        : wizard.type === "referral_code"
          ? "推荐码规则已保存，只用于之后生成的推荐码"
          : "推荐奖励券设置已保存",
    );
    if (!error) {
      wizard = null;
      load();
    }
  }
  function showReferralCodes() {
    let dialog = $("#referralCodesDialog");
    if (!dialog) {
      document.body.insertAdjacentHTML(
        "beforeend",
        '<dialog class="referral-codes-dialog" id="referralCodesDialog"><div class="referral-codes-head"><div><p class="eyebrow">REFERRAL CODES</p><h2>已生成的推荐码</h2></div><button class="close-wizard" type="button" data-close-referral-codes aria-label="关闭">×</button></div><div class="referral-code-list" id="referralCodeList"></div></dialog>',
      );
      dialog = $("#referralCodesDialog");
      dialog.addEventListener("click", async (event) => {
        if (
          event.target === dialog ||
          event.target.closest("[data-close-referral-codes]")
        )
          return dialog.close();
        const code = event.target.closest("[data-referral-copy]")?.dataset
          .referralCopy;
        if (!code) return;
        try {
          await navigator.clipboard.writeText(code);
          toast("推荐码已复制");
        } catch {
          toast("无法复制，请手动复制推荐码");
        }
      });
    }
    const list = $("#referralCodeList"),
      rows = [...referrals].sort(
        (a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0),
      ),
      validity = Number(rewards?.referral_valid_days ?? rewards?.valid_days ?? 0),
      maxUses = Number(rewards?.referral_max_uses ?? 0);
    list.innerHTML = rows.length
      ? rows
          .map(
            (row) => {
              const uses = orders.filter(
                  (order) => order.coupon_code === row.referral_code,
                ).length,
                rowAmount = Number(row.referral_amount ?? rewards?.referral_amount ?? rewards?.amount ?? 0),
                rowMin = Number(row.referral_min_spend ?? rewards?.referral_min_spend ?? rewards?.min_spend ?? 0),
                rowValidity = Number(row.referral_valid_days ?? validity),
                rowMaxUses = Number(row.referral_max_uses ?? maxUses),
                expiresAt =
                  rowValidity > 0 && row.created_at
                    ? new Date(row.created_at).getTime() + rowValidity * 86400000
                    : 0,
                expired = expiresAt && expiresAt <= Date.now(),
                exhausted = rowMaxUses > 0 && uses >= rowMaxUses,
                remainingDays = expiresAt
                  ? Math.ceil(Math.max(0, expiresAt - Date.now()) / 86400000)
                  : 0,
                validityLabel = expired
                  ? "已过期"
                  : exhausted
                    ? "已用完"
                    : expiresAt
                      ? `有效期：剩余 ${remainingDays} 天`
                      : "长期有效";
              return `<div class="referral-code-row"><div class="referral-code-main"><div class="referral-code-heading"><b>${esc(row.referral_code || "—")}</b><span class="referral-code-validity">${validityLabel}</span></div><small>手机号：${esc(row.phone || "—")}</small><div class="referral-code-meta"><span>已用 ${uses}${rowMaxUses > 0 ? ` / ${rowMaxUses}` : " 次（不限）"}</span><span>满 ${money(rowMin)} 减 ${money(rowAmount)}</span><span>生成：${esc(chicagoTime(row.created_at) || "—")}</span></div></div><button class="text-btn" type="button" data-referral-copy="${esc(row.referral_code || "")}">复制</button></div>`;
            },
          )
          .join("")
      : '<p class="muted">暂时还没有已生成的推荐码。</p>';
    dialog.showModal();
  }
  function showReferralRewards() {
    let dialog = $("#referralRewardsDialog");
    if (!dialog) {
      document.body.insertAdjacentHTML(
        "beforeend",
        '<dialog class="referral-codes-dialog" id="referralRewardsDialog"><div class="referral-codes-head"><div><p class="eyebrow">REFERRAL REWARD COUPONS</p><h2>有效的推荐奖励券</h2></div><button class="close-wizard" type="button" data-close-referral-rewards aria-label="关闭">×</button></div><div class="referral-code-list" id="referralRewardList"></div></dialog>',
      );
      dialog = $("#referralRewardsDialog");
      dialog.addEventListener("click", async (event) => {
        if (event.target === dialog || event.target.closest("[data-close-referral-rewards]")) dialog.close();
        const code = event.target.closest("[data-referral-reward-copy]")?.dataset
          .referralRewardCopy;
        if (!code) return;
        try {
          await navigator.clipboard.writeText(code);
          toast("推荐券已复制");
        } catch {
          toast("无法复制，请手动复制推荐券");
        }
      });
    }
    const redeemed = new Set(redemptions.map((entry) => entry.coupon_id));
    const rows = coupons.filter(
      (coupon) =>
        coupon.is_referral_reward && isRunning(coupon) && !redeemed.has(coupon.id),
    );
    $("#referralRewardList").innerHTML = rows.length
      ? rows
          .map(
            (coupon) => {
              const expiresAt = coupon.ends_at ? new Date(coupon.ends_at).getTime() : 0;
              const remainingDays = expiresAt
                ? Math.ceil(Math.max(0, expiresAt - Date.now()) / 86400000)
                : 0;
              const validityLabel = expiresAt
                ? `有效期：剩余 ${remainingDays} 天`
                : "长期有效";
              return `<div class="referral-code-row"><div class="referral-code-main"><div class="referral-code-heading"><b>${esc(coupon.code || "—")}</b><span class="referral-code-validity">${validityLabel}</span></div><small>所属手机号：${esc(coupon.recipient_phone || "—")}</small><div class="referral-code-meta"><span>满 ${money(coupon.min_spend)} 减 ${money(coupon.amount)}</span><span>限用一次</span></div></div><button class="text-btn" type="button" data-referral-reward-copy="${esc(coupon.code || "")}">复制</button></div>`;
            },
          )
          .join("")
      : '<p class="muted">暂时没有已生成且有效的推荐奖励券。</p>';
    dialog.showModal();
  }
  function edit(item, table) {
    if (table === "coupon") {
      wizard = blank("coupon");
      Object.assign(wizard, {
        id: item.id,
        name: item.name,
        code: item.code,
        amount: item.amount,
        threshold: item.min_spend,
        quantity: item.total_quantity,
        customerScope: item.customer_scope || "all",
        allowCampaignStack: item.allow_campaign_stack !== false,
        startsAt: localValue(item.starts_at),
        endsAt: localValue(item.ends_at),
        originalStatus: currentStatus(item),
      });
    } else {
      const type = campaignType(item);
      wizard = blank(type);
      Object.assign(wizard, {
        id: item.id,
        name: item.name,
        amount: item.amount,
        threshold: item.threshold,
        discountMode: item.discount_kind || "percent",
        fold:
          item.discount_kind === "percent"
            ? Number(item.amount || 0).toString()
            : "20",
        customerScope: item.customer_scope || "all",
        targetMode: asArray(item.product_ids).length
          ? "products"
          : asArray(item.category_names).length
            ? "categories"
            : "all",
        productIds: new Set(asArray(item.product_ids).map(String)),
        categoryNames: new Set(asArray(item.category_names)),
        allowCouponStack: item.allow_coupon_stack !== false,
        startsAt: localValue(item.starts_at),
        endsAt: localValue(item.ends_at),
        originalStatus: currentStatus(item),
      });
    }
    wizard.step = 2;
    render();
  }
  async function updateStatus(id, table, status) {
    const target =
        table === "coupon" ? "marketing_coupons" : "marketing_campaigns",
      { error } = await db
        .from(target)
        .update({
          status,
          active: status === "published",
          updated_at: new Date().toISOString(),
        })
        .eq("id", id);
    toast(error ? error.message : status === "stopped" ? "已停用" : "已发布");
    if (!error) load();
  }
  function bind() {
    const root = $("#marketingCenter");
    root.onclick = async (event) => {
      const target = event.target.closest("button");
      if (!target) return;
      if (target.dataset.create !== undefined) {
        wizard = blank();
        wizard.step = 1;
        render();
        return;
      }
      if (target.dataset.createReferral !== undefined) {
        wizard = blank("referral");
        wizard.step = 2;
        render();
        return;
      }
      if (target.dataset.createReferralCode !== undefined) {
        wizard = blank("referral_code");
        wizard.step = 2;
        render();
        return;
      }
      if (target.dataset.showReferralCodes !== undefined) {
        showReferralCodes();
        return;
      }
      if (target.dataset.showReferralRewards !== undefined) {
        showReferralRewards();
        return;
      }
      if (target.dataset.wizardClose !== undefined) {
        wizard = null;
        render();
        return;
      }
      if (target.dataset.wizardType) {
        wizard.type = target.dataset.wizardType;
        if (wizard.type === "product_special") wizard.targetMode = "products";
        render();
        return;
      }
      if (target.dataset.wizardBack !== undefined) {
        collect(wizard.step);
        wizard.step--;
        render();
        return;
      }
      if (target.dataset.wizardNext !== undefined) {
        collect(wizard.step);
        if (!validStep()) return toast("请先补全必填内容。");
        wizard.step++;
        render();
        return;
      }
      if (target.dataset.targetMode) {
        wizard.targetMode = target.dataset.targetMode;
        render();
        return;
      }
      if (target.dataset.customerScope) {
        wizard.customerScope = target.dataset.customerScope;
        render();
        return;
      }
      if (target.dataset.save) return save(target.dataset.save);
      if (target.dataset.saveReferral !== undefined) return saveReferral();
      if (target.dataset.edit)
        return edit(
          (target.dataset.table === "coupon" ? coupons : campaigns).find(
            (x) => x.id === target.dataset.edit,
          ),
          target.dataset.table,
        );
      if (target.dataset.stop)
        return updateStatus(
          target.dataset.stop,
          target.dataset.table,
          "stopped",
        );
      if (target.dataset.publish)
        return updateStatus(
          target.dataset.publish,
          target.dataset.table,
          "published",
        );
    };
    root.onchange = (event) => {
      const input = event.target;
      if (input.dataset.metricRange !== undefined) {
        metricRange = input.value;
        if (metricRange === "custom" && !customMetricStart) {
          const today = chicagoDate();
          customMetricStart = shiftDate(today, -6);
          customMetricEnd = today;
        }
        render();
        return;
      }
      if (input.dataset.metricStart !== undefined) {
        customMetricStart = input.value;
        render();
        return;
      }
      if (input.dataset.metricEnd !== undefined) {
        customMetricEnd = input.value;
        render();
        return;
      }
      if (input.id === "wizDiscountMode") {
        collect(2);
        render();
        return;
      }
      if (input.id === "wizStartsAt" || input.id === "wizEndsAt") {
        collect(4);
        render();
        return;
      }
      if (!input.dataset.picker) return;
      const set =
        input.dataset.picker === "products"
          ? wizard.productIds
          : wizard.categoryNames;
      input.checked ? set.add(input.value) : set.delete(input.value);
    };
  }
  function start() {
    if (!window.supabase || !window.TINGS_SUPABASE || !$("#marketingCenter"))
      return setTimeout(start, 120);
    db = window.supabase.createClient(
      TINGS_SUPABASE.url,
      TINGS_SUPABASE.anonKey,
    );
    document
      .querySelector('[data-view="marketing"]')
      ?.addEventListener("click", load);
    load();
  }
  start();
})();
