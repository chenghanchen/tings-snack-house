const db = window.supabase.createClient(
    TINGS_SUPABASE.url,
    TINGS_SUPABASE.anonKey,
  ),
  $ = (s) => document.querySelector(s),
  dollars = (n) => `$${Number(n || 0).toFixed(2)}`,
  escapeHtml = (v) =>
    String(v ?? "").replace(
      /[&<>"']/g,
      (c) =>
        ({
          "&": "&amp;",
          "<": "&gt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        })[c],
    );
let products = [],
  categories = [],
  groups = [],
  values = [],
  variants = [],
  cart = [],
  settings = {},
  selected = {},
  productSales = {},
  cardCampaigns = [],
  shopLoadVersion = 0,
  catalogDetailsReady = false;
/* This is also read by the separately-loaded checkout rules script. */
window.settings = settings;
const sortByPopularity = (list) =>
  [...list].sort(
    (a, b) =>
      Number(productSales[b.id] || 0) - Number(productSales[a.id] || 0) ||
      (a.position ?? 0) - (b.position ?? 0) ||
      a.id - b.id,
  );
const optionGroups = (id) =>
  groups
    .filter((g) => g.product_id === id)
    .sort((a, b) => a.position - b.position)
    .map((g) => ({
      ...g,
      values: values
        .filter((v) => v.group_id === g.id)
        .sort((a, b) => a.position - b.position),
    }));
const optionKey = (id) =>
  optionGroups(id)
    .map((g) => selected[id]?.[g.id])
    .join("-");
const variantFor = (p) =>
  variants.find(
    (v) => v.product_id === p.id && v.option_key === optionKey(p.id),
  );
const itemFor = (p) => {
  const gs = optionGroups(p.id),
    v = gs.length ? variantFor(p) : null;
  if (gs.length && !v) return null;
  const stock = Number(v ? v.stock : p.stock) || 0;
  return {
    key: gs.length ? `v-${v.id}` : `p-${p.id}`,
    product: p,
    variant: v,
    price: v ? v.price : p.price,
    stock,
    out: stock <= 0 || !!(v ? v.is_out_of_stock : p.is_out_of_stock),
    image: v?.image || p.image,
    label: v?.option_values?.map((x) => x.name).join(" / ") || "",
  };
};
const cartItem = (p) => {
  const i = itemFor(p);
  return i && cart.find((x) => x.key === i.key);
};
function renderFilters() {
  const ordinary = categories.filter((x) => x.name !== "未分类");
  const hasUncategorized = products.some(
    (p) => p.type === "未分类" || !ordinary.some((c) => c.name === p.type),
  );
  const names = [
    "全部",
    ...ordinary.map((x) => x.name),
    "促销",
    ...(hasUncategorized ? ["未分类"] : []),
  ];
  $("#filters").innerHTML = names
    .map(
      (x, i) =>
        `<button class="${i ? "" : "active"}" data-filter="${escapeHtml(x)}">${escapeHtml(x)}</button>`,
    )
    .join("");
}
function qtyControl(p, item) {
  if (!catalogDetailsReady)
    return '<button class="add" disabled>正在准备…</button>';
  const c = cart.find((x) => x.key === item.key);
  if (!c)
    return `<button class="add" data-add="${p.id}" ${item.out ? "disabled" : ""}>${item.out ? "缺货" : "加入购物车"}</button>`;
  return `<div class="card-quantity"><button data-card-change="-1" data-id="${p.id}">−</button><b>${c.qty}</b><button data-card-change="1" data-id="${p.id}" ${c.qty >= item.stock ? "disabled" : ""}>+</button></div>`;
}
function totals() {
  const pricing = cart.map((item) => ({ item, ...cartPriceInfo(item) })),
    rawSubtotal = pricing.reduce(
      (sum, row) => sum + row.rawPrice * row.item.qty,
      0,
    ),
    autoDiscount = pricing.reduce(
      (sum, row) => sum + row.saving * row.item.qty,
      0,
    ),
    subtotal = +pricing
      .reduce((sum, row) => sum + row.unitPrice * row.item.qty, 0)
      .toFixed(2),
    delivery =
      $("#fulfillment")?.value === "pickup"
        ? 0
        : subtotal >= Number(settings.free_delivery_threshold || 50)
          ? 0
          : Number(settings.delivery_fee || 5),
    tax = +((subtotal * Number(settings.tax_rate || 10.5)) / 100).toFixed(2);
  return {
    count: cart.reduce((s, x) => s + x.qty, 0),
    rawSubtotal: +rawSubtotal.toFixed(2),
    autoDiscount: +autoDiscount.toFixed(2),
    subtotal,
    delivery,
    tax,
    total: +(subtotal + delivery + tax).toFixed(2),
  };
}
function updateCartSavings(autoDiscount) {
  const savings = $("#cartSavings");
  if (savings)
    savings.textContent = `本单已优惠 ${dollars(Math.max(0, autoDiscount))}`;
}
function updateCartProgressNotice(subtotal, count) {
  const notice = $("#cartProgressNotice");
  if (!notice) return;
  const storeRules = settings?.content?.storeSettings || {};
  const minOrder = Number(storeRules.order?.minOrder ?? 20);
  const minDelivery = Math.max(
    minOrder,
    Number(storeRules.delivery?.minDelivery ?? 30),
  );
  const freeDelivery = Math.max(
    minDelivery,
    Number(settings.free_delivery_threshold ?? 50),
  );
  notice.hidden = !count;
  if (!count) return;
  if (subtotal < minOrder)
    notice.textContent = `⚠️ 再购买${dollars(minOrder - subtotal)}即可下单`;
  else if (subtotal < minDelivery)
    notice.textContent = `🚗 再购买${dollars(minDelivery - subtotal)}即可配送`;
  else if (subtotal < freeDelivery)
    notice.textContent = `🚗 再购买${dollars(freeDelivery - subtotal)}即可免费配送`;
  else notice.textContent = "🚗 您已达到免配送门槛";
}
function renderCart() {
  const t = totals(),
    accepting = settings.is_accepting_orders !== false,
    checkout = $("#checkout"),
    paused = $("#orderPausedMessage");
  $("#cartCount").textContent = t.count;
  $("#totalCount").textContent = `${t.count} 件`;
  $("#cartSubtotal").textContent = dollars(t.subtotal);
  updateCartSavings(t.autoDiscount);
  updateCartProgressNotice(t.subtotal, t.count);
  $("#cartItems").innerHTML = cart
    .map(
      (x) =>
        `<div class="cart-item"><div class="cart-thumb" style="background:${x.product.color}">${x.image ? `<img src="${x.image}" alt="">` : escapeHtml(x.product.icon)}</div><div><h3>${escapeHtml(x.product.name)}${x.label ? ` · ${escapeHtml(x.label)}` : ""}</h3><p>${dollars(cartPriceInfo(x).unitPrice)} × ${x.qty}</p></div><div class="quantity"><button data-change="-1" data-key="${x.key}">−</button><b>${x.qty}</b><button data-change="1" data-key="${x.key}" ${x.qty >= x.stock ? "disabled" : ""}>+</button></div></div>`,
    )
    .join("");
  checkout.disabled = !t.count || !accepting;
  checkout.innerHTML = accepting ? "我挑好啦！ <span>→</span>" : "店铺暂不接单";
  if (paused) paused.hidden = accepting;
  $("#cartItems").insertAdjacentHTML(
    "beforeend",
    cart.length
      ? `<p class="cart-encouragement">篮子还很空呢！<br>再挑多一份小快乐吧！</p>`
      : "",
  );
  const pickup = $("#fulfillment")?.value === "pickup",
    feeRow = pickup
      ? ""
      : `<div><span>配送费</span><span class="fee-value">${t.delivery === 0 ? "<small>（已减免）</small>" : ""}<b>${dollars(t.delivery)}</b></span></div>`;
  $("#orderSummary").innerHTML =
    cart
      .map(
        (x) =>
          `${escapeHtml(x.product.name)}${x.label ? ` · ${escapeHtml(x.label)}` : ""} × ${x.qty}　${dollars(x.price * x.qty)}`,
      )
      .join("<br>") +
    `<hr><div class="order-amounts"><div><span>商品小计</span><span>${dollars(t.subtotal)}</span></div>${feeRow}<div><span>税（${Number(settings.tax_rate || 10.5)}%）</span><span>${dollars(t.tax)}</span></div><div><b>最终应付金额</b><b>${dollars(t.total)}</b></div></div>`;
}
function applySettings(s) {
  settings = s || {};
  const c = s.content || {},
    deliveryCopy = `配送费 ${dollars(s.delivery_fee || 5)}；商品小计满 ${dollars(s.free_delivery_threshold || 50)} 免费配送。`;
  document.title = `${s.name}｜${s.english}`;
  $("#brandName").textContent = s.name?.replace("的零食屋", "") || "婷婷";
  $("#brandEnglish").textContent = s.english || "";
  $("#footerName").textContent = s.name || "";
  $("#deliveryDescription").textContent = s.delivery?.trim() || deliveryCopy;
  $("#deliveryNote").textContent = deliveryCopy;
  for (const [id, key] of Object.entries({
    heroEyebrow: "heroEyebrow",
    heroTitle: "heroTitle",
    heroEmphasis: "heroEmphasis",
    heroIntro: "heroIntro",
    heroButton: "heroButton",
    deliveryEyebrow: "deliveryEyebrow",
    deliveryTitle: "deliveryTitle",
    deliveryStampTop: "deliveryStampTop",
    deliveryStampBottom: "deliveryStampBottom",
    footerHours: "footerHours",
    footerYear: "footerYear",
  }))
    if (c[key]) $("#" + id).textContent = c[key];
  const deliveryInfo = $("#deliveryInfo"),
    deliveryStamp = $("#deliveryStamp"),
    deliveryImage = $("#deliveryStampImage");
  deliveryInfo.style.backgroundColor = c.deliveryBackgroundColor || "#f4e9d2";
  if (c.deliveryBackgroundImage)
    deliveryInfo.style.backgroundImage = `url("${c.deliveryBackgroundImage}")`;
  else deliveryInfo.style.removeProperty("background-image");
  if (c.deliveryStampImage) {
    deliveryImage.src = c.deliveryStampImage;
    deliveryImage.hidden = false;
    deliveryStamp.classList.add("has-image");
  } else {
    deliveryImage.hidden = true;
    deliveryImage.removeAttribute("src");
    deliveryStamp.classList.remove("has-image");
  }
  const heroArt = $("#heroArt"),
    heroImage = $("#heroIllustration"),
    story = $("#story");
  if (c.heroBackgroundImage) {
    const preload = new Image();
    preload.fetchPriority = "high";
    preload.src = c.heroBackgroundImage;
    heroArt.style.backgroundImage = `url("${c.heroBackgroundImage}")`;
  } else heroArt.style.removeProperty("background-image");
  heroImage.hidden = true;
  heroImage.removeAttribute("src");
  story.classList.add("footer-composite");
  if (c.storyBackgroundImage)
    story.style.setProperty(
      "background-image",
      `url("${c.storyBackgroundImage}")`,
      "important",
    );
  else story.style.removeProperty("background-image");
}
$("#filters").onclick = (e) => {
  if (!e.target.dataset.filter) return;
  document
    .querySelectorAll("#filters button")
    .forEach((b) => b.classList.toggle("active", b === e.target));
  renderProducts(e.target.dataset.filter);
};
$("#productGrid").onclick = (e) => {
  if (e.target.dataset.choice) {
    const p = +e.target.dataset.choice;
    selected[p] ??= {};
    selected[p][+e.target.dataset.group] = +e.target.dataset.value;
    renderProducts(
      document.querySelector("#filters .active")?.dataset.filter || "全部",
    );
    return;
  }
  if (e.target.dataset.cardChange) {
    const p = products.find((x) => x.id === +e.target.dataset.id),
      i = itemFor(p);
    if (i) change(i.key, +e.target.dataset.cardChange);
    return;
  }
  const id = +e.target.dataset.add;
  if (id) {
    const p = products.find((x) => x.id === id),
      item = itemFor(p);
    if (item && !item.out)
      cartItem(p)
        ? change(item.key, 1)
        : (cart.push({ ...item, qty: 1 }),
          renderProducts(
            document.querySelector("#filters .active")?.dataset.filter ||
              "全部",
          ),
          renderCart());
  }
};
$("#cartItems").onclick = (e) => {
  if (e.target.dataset.change)
    change(e.target.dataset.key, +e.target.dataset.change);
};
function toggleCart(show) {
  $("#cart").classList.toggle("open", show);
  $("#overlay").classList.toggle("visible", show);
}
const noteField = $('textarea[name="note"]')?.closest("label");
if (noteField) $("#addressField").insertAdjacentElement("afterend", noteField);
const promotionChoice = $("#promotionChoice");
if (noteField && promotionChoice)
  noteField.insertAdjacentElement("afterend", promotionChoice);
const fulfillmentLabel = $("#fulfillment").closest("label");
if (fulfillmentLabel && !$("#pickupInfo"))
  fulfillmentLabel.insertAdjacentHTML(
    "afterend",
    '<p class="pickup-info" id="pickupInfo" hidden></p>',
  );
const cartFooter = $(".cart-footer");
if (cartFooter && !$("#orderPausedMessage"))
  cartFooter.insertAdjacentHTML(
    "afterbegin",
    '<p class="order-paused" id="orderPausedMessage" hidden>店铺暂不接单</p>',
  );
function syncFulfillment() {
  const delivery = $("#fulfillment").value === "delivery",
    address = $("#address"),
    pickup = $("#pickupInfo");
  $("#addressField").hidden = !delivery;
  address.required = delivery;
  if (!delivery) address.value = "";
  $("#deliveryNote").hidden = !delivery;
  if (pickup) {
    pickup.hidden = delivery;
    pickup.textContent = `自取地址：${settings.pickup_address || "天河城二楼，Archer Ave"}\n自取说明：${settings.pickup_note || "请到天河城二楼取货；每日 10:00–22:00"}`;
  }
  renderCart();
}
$("#openCart").onclick = () => toggleCart(true);
$("#closeCart").onclick = () => toggleCart(false);
$("#continueShopping").onclick = () => {
  toggleCart(false);
  $("#snacks").scrollIntoView({ behavior: "smooth", block: "start" });
};
$("#overlay").onclick = () => toggleCart(false);
$("#checkout").onclick = () => {
  if (settings.is_accepting_orders === false) return;
  if (
    typeof window.validateCartBeforeCheckout === "function" &&
    !window.validateCartBeforeCheckout()
  )
    return;
  syncFulfillment();
  toggleCart(false);
  $("#orderDialog").showModal();
  renderCart();
};
$("#closeDialog").onclick = () => $("#orderDialog").close();
$("#fulfillment").onchange = syncFulfillment;
syncFulfillment();
$("#orderForm").onsubmit = async (e) => {
  e.preventDefault();
  const f = new FormData(e.target);
  const payload = cart.map((x) => ({
    product_id: x.product.id,
    variant_id: x.variant?.id || null,
    qty: x.qty,
  }));
  const { data, error } = await db.rpc("submit_shop_order", {
    p_customer_name: f.get("name"),
    p_phone: f.get("phone"),
    p_email: f.get("email") || null,
    p_fulfillment: f.get("fulfillment"),
    p_address: f.get("address") || null,
    p_note: f.get("note") || null,
    p_items: payload,
    p_promotion_id: null,
    p_coupon_code: f.get("coupon_code") || null,
    p_referral_value: null,
  });
  if (error) return alert(error.message || "订单暂时无法提交");
  $("#submittedOrderNumber").textContent = data.order_number;
  $("#orderFormWrap").hidden = true;
  $("#successMessage").hidden = false;
  cart = [];
  renderCart();
  loadShop();
};
$("#done").onclick = () => {
  $("#orderDialog").close();
  $("#orderForm").reset();
  $("#orderFormWrap").hidden = false;
  $("#successMessage").hidden = true;
};
function openOrderLookup() {
  $("#orderLookupFormWrap").hidden = false;
  $("#lookupResult").hidden = true;
  $("#orderLookupDialog").showModal();
}
$("#openOrderLookup").onclick = (e) => {
  e.preventDefault();
  openOrderLookup();
};
$("#closeOrderLookup").onclick = () => $("#orderLookupDialog").close();
db.channel("shop-live-v2")
  .on(
    "postgres_changes",
    { event: "*", schema: "public", table: "products" },
    () => loadShop(),
  )
  .on(
    "postgres_changes",
    { event: "*", schema: "public", table: "product_variants" },
    () => loadShop(),
  )
  .on(
    "postgres_changes",
    { event: "*", schema: "public", table: "product_option_groups" },
    () => loadShop(),
  )
  .on(
    "postgres_changes",
    { event: "*", schema: "public", table: "product_option_values" },
    () => loadShop(),
  )
  .on(
    "postgres_changes",
    { event: "*", schema: "public", table: "shop_settings" },
    () => loadShop(),
  )
  .subscribe();
if (!$("#imagePreviewDialog"))
  document.body.insertAdjacentHTML(
    "beforeend",
    '<dialog id="imagePreviewDialog" class="image-preview-dialog" aria-label="商品图片预览"><button class="dialog-close" id="closeImagePreview" aria-label="关闭图片预览">×</button><img id="imagePreviewLarge" alt="" hidden><span id="imagePreviewEmoji" class="image-preview-emoji" hidden></span><p id="imagePreviewName"></p></dialog>',
  );
function openImagePreview(p) {
  const item = itemFor(p),
    image = item?.image || p.image,
    emoji = $("#imagePreviewEmoji"),
    large = $("#imagePreviewLarge");
  $("#imagePreviewName").textContent =
    `${p.name}${item?.label ? ` · ${item.label}` : ""}`;
  if (image) {
    large.src = image;
    large.alt = p.name;
    large.hidden = false;
    emoji.hidden = true;
  } else {
    large.hidden = true;
    large.removeAttribute("src");
    emoji.textContent = p.icon || "🍬";
    emoji.hidden = false;
  }
  $("#imagePreviewDialog").showModal();
}
$("#closeImagePreview").onclick = () => $("#imagePreviewDialog").close();
$("#imagePreviewDialog").onclick = (e) => {
  if (e.target === e.currentTarget) e.currentTarget.close();
};
$("#productGrid").addEventListener(
  "click",
  (e) => {
    const preview = e.target.closest?.("[data-preview]");
    if (!preview) return;
    if (
      window.matchMedia("(max-width:780px)").matches &&
      !e.target.closest(".image-zoom-hint")
    )
      return;
    const p = products.find((x) => x.id === +preview.dataset.preview);
    if (!p) return;
    e.stopImmediatePropagation();
    openImagePreview(p);
  },
  true,
);
$("#productGrid").addEventListener("keydown", (e) => {
  if ((e.key === "Enter" || e.key === " ") && e.target.dataset.preview) {
    e.preventDefault();
    const p = products.find((x) => x.id === +e.target.dataset.preview);
    if (p) openImagePreview(p);
  }
});
renderProducts = function (filter = "全部") {
  const query = $("#productSearch")?.value.trim().toLowerCase() || "",
    base =
      filter === "全部"
        ? sortByPopularity(products)
        : filter === "促销"
          ? products.filter(isPromotedProduct)
          : filter === "未分类"
            ? products.filter(
                (p) =>
                  p.type === "未分类" ||
                  !categories.some(
                    (c) => c.name === p.type && c.name !== "未分类",
                  ),
              )
            : products.filter((p) => p.type === filter),
    list = query
      ? base.filter((p) =>
          [
            p.name,
            p.type,
            ...optionGroups(p.id).flatMap((g) => [
              g.name,
              ...g.values.map((v) => v.name),
            ]),
          ]
            .join(" ")
            .toLowerCase()
            .includes(query),
        )
      : base;
  $("#productGrid").innerHTML =
    list
      .map((p, index) => {
        const gs = optionGroups(p.id),
          item = itemFor(p),
          all = gs.every((g) => selected[p.id]?.[g.id]),
          img = item?.image || p.image,
          imageAttrs =
            index < 4
              ? 'loading="eager" fetchpriority="high" decoding="async"'
              : 'loading="lazy" decoding="async"',
          opts = gs.length
            ? `<div class="product-options">${gs.map((g) => `<div class="option-group"><strong>${escapeHtml(g.name)}</strong>${g.values.map((v) => `<button class="option-choice ${selected[p.id]?.[g.id] === v.id ? "selected" : ""}" data-choice="${p.id}" data-group="${g.id}" data-value="${v.id}">${escapeHtml(v.name)}</button>`).join("")}</div>`).join("")}</div>`
            : "";
        const price = item ? dollars(item.price) : dollars(p.price),
          action =
            gs.length && !all
              ? '<button class="add" disabled>请选择规格</button>'
              : item
                ? qtyControl(p, item)
                : '<button class="add" disabled>缺货</button>';
        return `<article class="product"><div class="product-image" data-preview="${p.id}" role="button" tabindex="0" aria-label="查看 ${escapeHtml(p.name)} 大图" style="background:${p.color}">${img ? `<img src="${img}" alt="${escapeHtml(p.name)}" width="400" height="400" ${imageAttrs}>` : `<span class="product-icon">${escapeHtml(p.icon)}</span>`}<span class="product-tag">${escapeHtml(p.type)}</span><span class="image-zoom-hint" aria-hidden="true">⌕</span></div><h3>${escapeHtml(p.name)}</h3>${p.note ? `<p>${escapeHtml(p.note)}</p>` : ""}${opts}${item && item.out ? '<p class="stock-warning">该规格已缺货</p>' : ""}<div class="product-bottom"><b>${price}</b>${action}</div></article>`;
      })
      .join("") || '<p class="no-products">没有匹配的商品。</p>';
};
$("#productSearch").oninput = () =>
  renderProducts(
    document.querySelector("#filters .active")?.dataset.filter || "全部",
  );
const formatChicagoTime = (v) =>
  v
    ? new Intl.DateTimeFormat("zh-CN", {
        timeZone: "America/Chicago",
        dateStyle: "medium",
        timeStyle: "short",
        hour12: false,
      }).format(new Date(v))
    : "";

/* Live offer preview: the server repeats the same checks when the order is submitted. */
let offerPreview = {
    campaignDiscount: 0,
    campaignName: "",
    codeDiscount: 0,
    codeName: "",
    freeShipping: false,
    message: "",
    valid: false,
  },
  previewTimer;
function drawOfferPreview() {
  const t = totals(),
    pickup = $("#fulfillment")?.value === "pickup",
    campaign = Math.min(Number(offerPreview.campaignDiscount || 0), t.subtotal),
    code = Math.min(
      Number(offerPreview.codeDiscount || 0),
      Math.max(0, t.subtotal - campaign),
    ),
    discount = campaign + code,
    fee = pickup ? 0 : offerPreview.freeShipping ? 0 : t.delivery,
    tax = +(
      (Math.max(0, t.subtotal - discount) * Number(settings.tax_rate || 10.5)) /
      100
    ).toFixed(2),
    total = +(Math.max(0, t.subtotal - discount) + fee + tax).toFixed(2),
    rows = $("#orderSummary .order-amounts");
  if (!rows) return;
  const hint = offerPreview.message
    ? `<div class="offer-preview ${offerPreview.valid ? "valid" : ""}">${escapeHtml(offerPreview.message)}</div>`
    : "";
  rows.innerHTML = `<div><span>商品小计</span><span>${dollars(t.subtotal)}</span></div>${hint}${campaign ? `<div><span>${escapeHtml(offerPreview.campaignName || "活动优惠")}</span><span>−${dollars(campaign)}</span></div>` : ""}${code ? `<div><span>${escapeHtml(offerPreview.codeName || "优惠券／推荐码优惠")}</span><span>−${dollars(code)}</span></div>` : ""}${pickup ? "" : `<div><span>配送费</span><span class="fee-value">${fee === 0 ? "<small>（已减免）</small>" : ""}<b>${dollars(fee)}</b></span></div>`}<div><span>税（${Number(settings.tax_rate || 10.5)}%）</span><span>${dollars(tax)}</span></div><div><b>最终应付金额</b><b>${dollars(total)}</b></div>`;
}

/* Keep checkout preview aligned with the marketing wizard's publish, audience and stack rules. */
function previewOffer() {
  if (previewTimer) clearTimeout(previewTimer);
  previewTimer = setTimeout(async () => {
    const code = $("#couponCodeInput")?.value.trim().toUpperCase() || "",
      phone = $('[name="phone"]')?.value.trim() || "",
      t = totals(),
      now = new Date();
    if (!cart.length) {
      offerPreview = {
        campaignDiscount: 0,
        campaignName: "",
        codeDiscount: 0,
        codeName: "",
        freeShipping: false,
        message: "",
        valid: false,
      };
      drawOfferPreview();
      return;
    }
    offerPreview = {
      campaignDiscount: 0,
      campaignName: "",
      codeDiscount: 0,
      codeName: "",
      freeShipping: false,
      message: "正在核算活动优惠…",
      valid: false,
    };
    drawOfferPreview();
    try {
      const [
        { data: campaigns },
        { data: coupons },
        { data: refs },
        { data: reward },
        orderCheck,
      ] = await Promise.all([
        db.from("marketing_campaigns").select("*"),
        db.from("marketing_coupons").select("*"),
        db.from("customer_referrals").select("referral_code"),
        db
          .from("referral_reward_settings")
          .select("*")
          .eq("id", 1)
          .maybeSingle(),
        phone
          ? db
              .from("orders")
              .select("id", { count: "exact", head: true })
              .eq("phone", phone)
          : Promise.resolve({ count: 1 }),
      ]);
      const isNew = !!phone && Number(orderCheck.count || 0) === 0;
      let bestBenefit = 0,
        campaignDiscount = 0,
        campaignName = "",
        freeShipping = false,
        allowCouponStack = true;
      for (const c of campaigns || []) {
        if (
          !c.active ||
          (c.status && c.status !== "published") ||
          (c.starts_at && new Date(c.starts_at) > now) ||
          (c.ends_at && new Date(c.ends_at) < now) ||
          (c.customer_scope === "new" && !isNew)
        )
          continue;
        /* Direct product/category reductions already feed into cartPriceInfo(). */
        if (["product_discount", "category_discount"].includes(c.kind))
          continue;
        const eligible =
          !c.product_ids?.length && !c.category_names?.length
            ? cart
            : cart.filter(
                (x) =>
                  c.product_ids?.includes(x.product.id) ||
                  c.category_names?.includes(x.product.type),
              );
        const eligibleSubtotal = eligible.reduce(
          (sum, x) => sum + x.price * x.qty,
          0,
        );
        let discount = 0,
          benefit = 0;
        if (
          c.kind === "full_reduction" &&
          eligibleSubtotal >= Number(c.threshold || 0)
        ) {
          discount = Math.min(eligibleSubtotal, Number(c.amount || 0));
          benefit = discount;
        } else if (c.kind === "free_shipping" && t.delivery > 0) {
          benefit = t.delivery;
        } else if (
          ["product_discount", "category_discount"].includes(c.kind) &&
          eligible.length
        ) {
          discount =
            c.discount_kind === "percent"
              ? (eligibleSubtotal * Number(c.amount || 0)) / 100
              : eligible.reduce(
                  (sum, x) =>
                    sum + Math.min(x.price, Number(c.amount || 0)) * x.qty,
                  0,
                );
          discount = +discount.toFixed(2);
          benefit = discount;
        }
        if (benefit > bestBenefit) {
          bestBenefit = benefit;
          campaignDiscount = discount;
          campaignName = c.name || "活动优惠";
          freeShipping = c.kind === "free_shipping";
          allowCouponStack = c.allow_coupon_stack !== false;
        }
      }
      let codeDiscount = 0,
        codeName = "",
        message = campaignName ? `已自动享受${campaignName}。` : "";
      if (code) {
        if (campaignName && !allowCouponStack) {
          message = `${message} 当前活动不可与优惠券或推荐码叠加。`;
        } else {
          const referral = (refs || []).find((x) => x.referral_code === code);
          if (referral) {
            const r = reward || { amount: 5, min_spend: 35 };
            if (isNew && t.subtotal >= Number(r.min_spend || 0)) {
              codeDiscount = Math.min(
                Number(r.amount || 0),
                Math.max(0, t.subtotal - campaignDiscount),
              );
              codeName = "推荐码优惠";
            }
          } else {
            const coupon = (coupons || []).find(
              (x) =>
                x.code === code &&
                x.active &&
                (!x.status || x.status === "published") &&
                (!x.starts_at || new Date(x.starts_at) <= now) &&
                (!x.ends_at || new Date(x.ends_at) >= now) &&
                (!x.recipient_phone || x.recipient_phone === phone) &&
                (!(x.customer_scope === "new") || isNew),
            );
            if (coupon && t.subtotal >= Number(coupon.min_spend || 0)) {
              codeDiscount = Math.min(
                Number(coupon.amount || 0),
                Math.max(0, t.subtotal - campaignDiscount),
              );
              codeName = coupon.name || "优惠券优惠";
            }
          }
          message = codeDiscount
            ? `${message}${message ? " " : " "}已使用${codeName}，立减 ${dollars(codeDiscount)}。`
            : `${message}${message ? " " : " "}兑换码无效或暂不符合使用条件。`;
        }
      }
      offerPreview = {
        campaignDiscount,
        campaignName,
        codeDiscount,
        codeName,
        freeShipping,
        message,
        valid: !!codeDiscount,
      };
      drawOfferPreview();
    } catch {
      offerPreview = {
        campaignDiscount: 0,
        campaignName: "",
        codeDiscount: 0,
        codeName: "",
        freeShipping: false,
        message: "优惠将在提交订单时由系统核算。",
        valid: false,
      };
      drawOfferPreview();
    }
  }, 250);
}

/* Show the best active item/category price reduction directly on product cards. */
function isActiveDirectDiscount(c, now = new Date()) {
  return !!(
    c?.active &&
    (!c.status || c.status === "published") &&
    (!c.starts_at || new Date(c.starts_at) <= now) &&
    (!c.ends_at || new Date(c.ends_at) >= now) &&
    ["product_discount", "category_discount"].includes(c.kind)
  );
}
function campaignMatchesProduct(c, p) {
  return (
    (!c.product_ids?.length && !c.category_names?.length) ||
    c.product_ids?.map(String).includes(String(p.id)) ||
    c.category_names?.includes(p.type)
  );
}
function isPromotedProduct(p) {
  const now = new Date();
  return cardCampaigns.some(
    (c) => isActiveDirectDiscount(c, now) && campaignMatchesProduct(c, p),
  );
}
function bestCardDiscount(p, item) {
  const now = new Date();
  let best = null,
    saving = 0;
  for (const campaign of cardCampaigns) {
    if (!isActiveDirectDiscount(campaign, now) || !campaignMatchesProduct(campaign, p))
      continue;
    const value =
      campaign.discount_kind === "percent"
        ? (Number(item.price || 0) * Number(campaign.amount || 0)) / 100
        : Math.min(Number(item.price || 0), Number(campaign.amount || 0));
    if (value > saving) {
      saving = value;
      best = campaign;
    }
  }
  return { campaign: best, saving };
}
function cartPriceInfo(item) {
  const rawPrice = Number(item?.price || 0),
    { saving, campaign } = bestCardDiscount(item?.product, item || {}),
    safeSaving = Math.min(rawPrice, Math.max(0, Number(saving || 0)));
  return {
    rawPrice,
    saving: safeSaving,
    unitPrice: Math.max(0, rawPrice - safeSaving),
    campaign,
  };
}
function updateProductCardOffer(card, product, item, action) {
  const bottom = card.querySelector(".product-bottom");
  if (!bottom) return;
  card.querySelector(".stock-warning")?.remove();
  const displayItem = item || { price: product.price },
    { campaign, saving } = bestCardDiscount(product, displayItem),
    price = saving
      ? `<s>${dollars(displayItem.price)}</s> <span class="sale-price">${dollars(Math.max(0, Number(displayItem.price) - saving))}</span>`
      : dollars(displayItem.price),
    offer = campaign
      ? campaign.discount_kind === "percent"
        ? `${Number(campaign.amount || 0)}% Off`
        : `每件减 ${dollars(campaign.amount)}`
      : "",
    lowThreshold = Math.max(0, Number(settings.low_stock_threshold ?? 5)),
    cartQuantity = item
      ? Number(cart.find((row) => row.key === item.key)?.qty || 0)
      : 0,
    remainingStock = item
      ? Math.max(0, Number(item.stock) - cartQuantity)
      : 0,
    stockNotice = item?.out
      ? `该${item.variant ? "规格" : "商品"}已缺货`
      : item && remainingStock <= lowThreshold
        ? `⚠️ 仅剩 ${remainingStock} 件`
        : "";
  bottom.classList.toggle("has-promotion", !!offer);
  bottom.classList.toggle("has-stock-notice", !!stockNotice);
  bottom.innerHTML = `<div class="product-price-wrap">${offer ? `<span class="promotion-badge">🔥限时优惠：${escapeHtml(offer)}</span>` : ""}<b>${price}</b></div><div class="product-action-wrap">${action}${stockNotice ? `<p class="stock-warning">${stockNotice}</p>` : ""}</div>`;
}
const baseProductRender = renderProducts;
renderProducts = function (filter) {
  baseProductRender(filter);
  document.querySelectorAll("#productGrid .product").forEach((card) => {
    const p = products.find(
      (row) => row.name === card.querySelector("h3")?.textContent,
    );
    if (!p) return;
    const groupsForProduct = optionGroups(p.id),
      item = itemFor(p),
      allSelected = groupsForProduct.every(
        (group) => selected[p.id]?.[group.id],
      ),
      action =
        groupsForProduct.length && !allSelected
          ? '<button class="add" disabled>请选择规格</button>'
          : item
            ? qtyControl(p, item)
            : '<button class="add" disabled>缺货</button>';
    updateProductCardOffer(card, p, item, action);
  });
};
function reloadCardCampaigns() {
  return db
    .from("marketing_campaigns")
    .select("*")
    .then(({ data }) => {
      cardCampaigns = data || [];
      renderProducts(
        document.querySelector("#filters .active")?.dataset.filter || "全部",
      );
      refreshCartLocally();
    });
}
reloadCardCampaigns();
db.channel("marketing-catalog-live")
  .on(
    "postgres_changes",
    { event: "*", schema: "public", table: "marketing_campaigns" },
    reloadCardCampaigns,
  )
  .subscribe();

const orderNoteInput = $('textarea[name="note"]'),
  orderNoteCount = $("#orderNoteCount");
function updateOrderNoteCount() {
  if (orderNoteInput && orderNoteCount)
    orderNoteCount.textContent = `${orderNoteInput.value.length} / ${orderNoteInput.maxLength || 300}`;
}
orderNoteInput?.addEventListener("input", updateOrderNoteCount);
updateOrderNoteCount();

/* A timed pause is reopened by the database when its deadline arrives. */
async function refreshScheduledOrderAvailability() {
  if (
    settings.is_accepting_orders !== false ||
    !settings.order_paused_until ||
    new Date(settings.order_paused_until).getTime() > Date.now()
  )
    return;
  const { data, error } = await db.rpc("refresh_shop_order_availability");
  if (!error && data) {
    settings.is_accepting_orders = true;
    settings.order_paused_until = null;
    renderCart();
  }
}
setInterval(refreshScheduledOrderAvailability, 30000);
setTimeout(refreshScheduledOrderAvailability, 500);

/* Keep customer interactions local: only the changed card and cart row are updated. */
function partialProductPrice(p, item) {
  let saving = 0,
    now = new Date();
  for (const campaign of cardCampaigns || []) {
    if (
      !isActiveDirectDiscount(campaign, now) ||
      !campaignMatchesProduct(campaign, p)
    )
      continue;
    const discount =
      campaign.discount_kind === "percent"
        ? (Number(item.price || 0) * Number(campaign.amount || 0)) / 100
        : Math.min(Number(item.price || 0), Number(campaign.amount || 0));
    saving = Math.max(saving, discount);
  }
  if (!saving) return dollars(item.price);
  return `<s>${dollars(item.price)}</s> <span class="sale-price">${dollars(Math.max(0, Number(item.price) - saving))}</span>`;
}
function refreshProductCard(productId) {
  const product = products.find((row) => row.id === Number(productId));
  const card = document
    .querySelector('#productGrid [data-preview="' + productId + '"]')
    ?.closest(".product");
  if (!product || !card) return;
  const groupsForProduct = optionGroups(product.id),
    item = itemFor(product),
    allSelected = groupsForProduct.every(
      (group) => selected[product.id]?.[group.id],
    );
  card
    .querySelectorAll("[data-choice]")
    .forEach((button) =>
      button.classList.toggle(
        "selected",
        Number(button.dataset.value) ===
          Number(selected[product.id]?.[button.dataset.group]),
      ),
    );
  const visual = card.querySelector(".product-image"),
    image = item?.image || product.image,
    currentImage = visual?.querySelector("img"),
    currentIcon = visual?.querySelector(".product-icon");
  if (visual) {
    if (image) {
      if (currentImage) {
        currentImage.src = image;
        currentImage.alt = product.name;
      } else if (currentIcon)
        currentIcon.outerHTML = `<img src="${image}" alt="${escapeHtml(product.name)}">`;
      visual.querySelectorAll(".product-icon").forEach((icon) => icon.remove());
    } else if (!currentIcon && currentImage)
      currentImage.outerHTML = `<span class="product-icon">${escapeHtml(product.icon)}</span>`;
  }
  const action =
    groupsForProduct.length && !allSelected
      ? '<button class="add" disabled>请选择规格</button>'
      : item
        ? qtyControl(product, item)
        : '<button class="add" disabled>缺货</button>';
  updateProductCardOffer(card, product, item, action);
}
let revealedCartKey = null;
function cartRowMarkup(item) {
  const isRevealed = item.key === revealedCartKey;
  return `<div class="cart-item${isRevealed ? " remove-revealed" : ""}" data-cart-key="${escapeHtml(item.key)}"><div class="cart-thumb" style="background:${item.product.color}">${item.image ? `<img src="${item.image}" alt="">` : escapeHtml(item.product.icon)}</div><div><h3>${escapeHtml(item.product.name)}${item.label ? ` · ${escapeHtml(item.label)}` : ""}</h3><p class="cart-line">${dollars(cartPriceInfo(item).unitPrice)} × ${item.qty}</p></div><div class="cart-quantity-wrap"><div class="quantity"><button data-change="-1" data-key="${escapeHtml(item.key)}">−</button><b class="cart-qty">${item.qty}</b><button data-change="1" data-key="${escapeHtml(item.key)}" ${item.qty >= item.stock ? "disabled" : ""}>+</button></div><button class="cart-remove" type="button" data-remove-key="${escapeHtml(item.key)}">移除</button></div></div>`;
}
function refreshCartLocally() {
  const totalsNow = totals(),
    accepting = settings.is_accepting_orders !== false,
    checkout = $("#checkout"),
    paused = $("#orderPausedMessage"),
    list = $("#cartItems");
  $("#cartCount").textContent = totalsNow.count;
  $("#totalCount").textContent = `${totalsNow.count} 件`;
  $("#cartSubtotal").textContent = dollars(totalsNow.subtotal);
  updateCartSavings(totalsNow.autoDiscount);
  updateCartProgressNotice(totalsNow.subtotal, totalsNow.count);
  const beforeScroll = list.scrollTop,
    liveKeys = new Set(cart.map((item) => item.key));
  list.querySelectorAll(".cart-item").forEach((node) => {
    if (!liveKeys.has(node.dataset.cartKey)) node.remove();
  });
  if (revealedCartKey && !liveKeys.has(revealedCartKey)) revealedCartKey = null;
  for (const item of cart) {
    let node = Array.from(list.querySelectorAll(".cart-item")).find(
      (row) => row.dataset.cartKey === item.key,
    );
    if (!node) {
      list.insertAdjacentHTML("beforeend", cartRowMarkup(item));
      node = Array.from(list.querySelectorAll(".cart-item")).find(
        (row) => row.dataset.cartKey === item.key,
      );
    }
    if (!node) continue;
    node.querySelector(".cart-line").textContent =
      `${dollars(cartPriceInfo(item).unitPrice)} × ${item.qty}`;
    node.querySelector(".cart-qty").textContent = item.qty;
    node.querySelector('[data-change="1"]').disabled = item.qty >= item.stock;
    node.classList.toggle("remove-revealed", item.key === revealedCartKey);
  }
  let encouragement = list.querySelector(".cart-encouragement");
  if (cart.length) {
    if (!encouragement) {
      list.insertAdjacentHTML(
        "beforeend",
        '<p class="cart-encouragement">篮子还很空呢！<br>再挑多一份小快乐吧！</p>',
      );
      encouragement = list.querySelector(".cart-encouragement");
    }
    list.append(encouragement);
  } else encouragement?.remove();
  list.scrollTop = beforeScroll;
  checkout.disabled = !totalsNow.count || !accepting;
  checkout.innerHTML = accepting ? "我挑好啦！ <span>→</span>" : "店铺暂不接单";
  if (paused) paused.hidden = accepting;
  const pickup = $("#fulfillment")?.value === "pickup",
    feeRow = pickup
      ? ""
      : `<div><span>配送费</span><span class="fee-value">${totalsNow.delivery === 0 ? "<small>（已减免）</small>" : ""}<b>${dollars(totalsNow.delivery)}</b></span></div>`;
  $("#orderSummary").innerHTML =
    cart
      .map(
        (item) =>
          `${escapeHtml(item.product.name)}${item.label ? ` · ${escapeHtml(item.label)}` : ""} × ${item.qty}　${dollars(cartPriceInfo(item).unitPrice * item.qty)}`,
      )
      .join("<br>") +
    `<hr><div class="order-amounts"><div><span>商品小计</span><span>${dollars(totalsNow.subtotal)}</span></div>${feeRow}<div><span>税（${Number(settings.tax_rate || 10.5)}%）</span><span>${dollars(totalsNow.tax)}</span></div><div><b>最终应付金额</b><b>${dollars(totalsNow.total)}</b></div></div>`;
  drawOfferPreview();
  previewOffer();
}
change = function (key, delta) {
  const item = cart.find((row) => row.key === key);
  if (!item) return;
  if (delta > 0 && item.qty >= item.stock) return alert("库存不足");
  item.qty += delta;
  if (item.qty < 1) cart = cart.filter((row) => row !== item);
  refreshProductCard(item.product.id);
  refreshCartLocally();
};
$("#productGrid").onclick = (event) => {
  if (event.target.dataset.choice) {
    const productId = Number(event.target.dataset.choice);
    selected[productId] ??= {};
    selected[productId][Number(event.target.dataset.group)] = Number(
      event.target.dataset.value,
    );
    refreshProductCard(productId);
    return;
  }
  if (event.target.dataset.cardChange) {
    const product = products.find(
        (row) => row.id === Number(event.target.dataset.id),
      ),
      item = product && itemFor(product);
    if (item) change(item.key, Number(event.target.dataset.cardChange));
    return;
  }
  const productId = Number(event.target.dataset.add);
  if (productId) {
    const product = products.find((row) => row.id === productId),
      item = product && itemFor(product);
    if (item && !item.out) {
      const existing = cartItem(product);
      if (existing) change(item.key, 1);
      else {
        cart.push({ ...item, qty: 1 });
        refreshProductCard(product.id);
        refreshCartLocally();
      }
    }
  }
};

/* Short taps keep the existing one-step behavior. A hold starts repeating only
   after a brief delay, and the synthetic click after a hold is ignored. */
let quantityHold = null;
let ignoreQuantityClickUntil = 0;
function stopQuantityHold() {
  if (!quantityHold) return;
  clearTimeout(quantityHold.delay);
  clearInterval(quantityHold.repeat);
  if (quantityHold.didRepeat)
    ignoreQuantityClickUntil = Date.now() + 350;
  quantityHold = null;
}
function changeWhileHeld(key, delta) {
  const item = cart.find((row) => row.key === key);
  if (!item || (delta > 0 && item.qty >= item.stock) || (delta < 0 && item.qty <= 1)) {
    stopQuantityHold();
    return;
  }
  change(key, delta);
}
function beginQuantityHold(event, button, key, delta) {
  if (button.disabled || (event.pointerType === "mouse" && event.button !== 0)) return;
  stopQuantityHold();
  quantityHold = {
    delay: setTimeout(() => {
      if (!quantityHold) return;
      quantityHold.didRepeat = true;
      changeWhileHeld(key, delta);
      if (quantityHold)
        quantityHold.repeat = setInterval(() => changeWhileHeld(key, delta), 120);
    }, 400),
    repeat: null,
    didRepeat: false,
    bounds: button.getBoundingClientRect(),
  };
}
function hideCartRemove() {
  if (!revealedCartKey) return;
  revealedCartKey = null;
  document
    .querySelectorAll("#cartItems .cart-item.remove-revealed")
    .forEach((row) => row.classList.remove("remove-revealed"));
}
function revealCartRemove(key) {
  if (revealedCartKey === key) {
    hideCartRemove();
    return;
  }
  if (revealedCartKey) {
    hideCartRemove();
    return;
  }
  revealedCartKey = key;
  document.querySelectorAll("#cartItems .cart-item").forEach((row) =>
    row.classList.toggle("remove-revealed", row.dataset.cartKey === key),
  );
}

$("#productGrid").addEventListener("pointerdown", (event) => {
  const button = event.target.closest("[data-card-change]");
  if (!button) return;
  const product = products.find((row) => row.id === Number(button.dataset.id));
  const item = product && itemFor(product);
  if (item) beginQuantityHold(event, button, item.key, Number(button.dataset.cardChange));
});
$("#cartItems").addEventListener("pointerdown", (event) => {
  const button = event.target.closest("[data-change]");
  if (!button) return;
  hideCartRemove();
  beginQuantityHold(event, button, button.dataset.key, Number(button.dataset.change));
});
document.addEventListener("pointerup", stopQuantityHold);
document.addEventListener("pointercancel", stopQuantityHold);
document.addEventListener("lostpointercapture", stopQuantityHold);
document.addEventListener("pointermove", (event) => {
  if (!quantityHold?.didRepeat) return;
  const { left, right, top, bottom } = quantityHold.bounds;
  const padding = 12;
  if (
    event.clientX < left - padding ||
    event.clientX > right + padding ||
    event.clientY < top - padding ||
    event.clientY > bottom + padding
  )
    stopQuantityHold();
});
document.addEventListener(
  "click",
  (event) => {
    if (
      Date.now() < ignoreQuantityClickUntil &&
      event.target.closest("[data-card-change], [data-change]")
    ) {
      event.preventDefault();
      event.stopImmediatePropagation();
    }
  },
  true,
);

/* This overrides the legacy cart handler so rows can reveal their own remove
   control without affecting the rest of the cart. */
$("#cartItems").onclick = (event) => {
  if (Date.now() < ignoreQuantityClickUntil) {
    event.preventDefault();
    return;
  }
  const removeButton = event.target.closest("[data-remove-key]");
  if (removeButton) {
    const item = cart.find((row) => row.key === removeButton.dataset.removeKey);
    if (!item) return;
    cart = cart.filter((row) => row.key !== item.key);
    revealedCartKey = null;
    refreshProductCard(item.product.id);
    refreshCartLocally();
    return;
  }
  const quantityButton = event.target.closest("[data-change]");
  if (quantityButton) {
    hideCartRemove();
    change(quantityButton.dataset.key, Number(quantityButton.dataset.change));
    return;
  }
  const row = event.target.closest(".cart-item");
  if (row) revealCartRemove(row.dataset.cartKey);
};
document.addEventListener("click", (event) => {
  if (!event.target.closest("#cartItems .cart-item")) hideCartRemove();
});
renderCart = refreshCartLocally;
$("#productGrid").addEventListener("click", (event) => {
  if (event.target.closest("[data-retry-catalog]")) loadShop();
});

/* Keep the empty-cart message local so it does not recreate the product list. */
const renderCartWithEmptyMessage = renderCart;
renderCart = function () {
  renderCartWithEmptyMessage();
  const list = $("#cartItems");
  if (!list) return;
  const empty = list.querySelector(".cart-empty-message");
  if (cart.length) {
    empty?.remove();
    return;
  }
  if (!empty)
    list.insertAdjacentHTML(
      "afterbegin",
      '<p class="cart-empty-message">把你喜欢的零食放进来吧！</p>',
    );
};
refreshCartLocally = renderCart;
/* First paint only waits for the product list; supporting catalog data follows without blocking it. */
loadShop = async function () {
  const version = ++shopLoadVersion,
    grid = $("#productGrid"),
    settingsRequest = db
      .from("shop_settings")
      .select("*")
      .eq("id", 1)
      .maybeSingle();
  // Storefront copy and the hero art are independent of the catalogue. Start
  // them immediately so they are not delayed behind all product-related data.
  settingsRequest.then((result) => {
    if (version === shopLoadVersion && result.data) applySettings(result.data);
  });
  const { data: productRows, error: productError } = await db
    .from("products")
    .select("*")
    .eq("is_active", true)
    .order("position")
    .order("id");
  if (version !== shopLoadVersion) return;
  if (productError) {
    console.error(productError);
    if (!products.length)
      grid.innerHTML =
        '<p class="catalog-load-error">商品暂时无法加载。<button type="button" data-retry-catalog>重新加载</button></p>';
    return;
  }
  products = productRows || [];
  grid.classList.remove("product-grid-loading");
  renderProducts(
    document.querySelector("#filters .active")?.dataset.filter || "全部",
  );
  const [c, s, g, v, vr, sales] = await Promise.all([
    db.from("categories").select("*").order("position").order("id"),
    settingsRequest,
    db.from("product_option_groups").select("*").order("position"),
    db.from("product_option_values").select("*").order("position"),
    db.from("product_variants").select("*").order("position"),
    db.rpc("get_public_product_sales"),
  ]);
  if (version !== shopLoadVersion) return;
  categories = c.data || [];
  groups = g.data || [];
  values = v.data || [];
  variants = vr.data || [];
  productSales = Object.fromEntries(
    (sales.data || []).map((row) => [
      String(row.product_id),
      Number(row.units_sold || 0),
    ]),
  );
  catalogDetailsReady = !(g.error || v.error || vr.error);
  if (c.error || s.error || g.error || v.error || vr.error || sales.error)
    console.warn(
      "部分店铺数据加载较慢，商品已优先展示。",
      c.error || s.error || g.error || v.error || vr.error || sales.error,
    );
  if (s.data) applySettings(s.data);
  renderFilters();
  renderProducts(
    document.querySelector("#filters .active")?.dataset.filter || "全部",
  );
  renderCart();
  if (!catalogDetailsReady && version === shopLoadVersion)
    setTimeout(() => loadShop(), 3000);
};
loadShop();

/* On phones, the open cart owns the swipe gesture instead of the page behind it. */
let cartPageScrollY = 0,
  cartTouchStartY = 0,
  cartPageLocked = false;
function lockPageForCart() {
  if (cartPageLocked) return;
  cartPageLocked = true;
  cartPageScrollY = window.scrollY;
  document.body.style.position = "fixed";
  document.body.style.top = `-${cartPageScrollY}px`;
  document.body.style.width = "100%";
  document.body.style.overflow = "hidden";
}
function unlockPageFromCart() {
  if (!cartPageLocked) return;
  cartPageLocked = false;
  document.body.style.position = "";
  document.body.style.top = "";
  document.body.style.width = "";
  document.body.style.overflow = "";
  /* The site normally uses smooth scrolling; restoring the page after the cart closes must be instant. */
  const root = document.documentElement,
    previousBehavior = root.style.scrollBehavior;
  root.style.scrollBehavior = "auto";
  window.scrollTo(0, cartPageScrollY);
  requestAnimationFrame(() => {
    root.style.scrollBehavior = previousBehavior;
  });
}
toggleCart = (show) => {
  $("#cart").classList.toggle("open", show);
  $("#overlay").classList.toggle("visible", show);
  if (window.matchMedia("(max-width:780px)").matches) {
    if (show) lockPageForCart();
    else unlockPageFromCart();
  }
};
const cartScrollArea = $("#cartItems");
cartScrollArea.addEventListener(
  "touchstart",
  (event) => {
    cartTouchStartY = event.touches[0]?.clientY || 0;
  },
  { passive: true },
);
cartScrollArea.addEventListener(
  "touchmove",
  (event) => {
    const fingerY = event.touches[0]?.clientY || cartTouchStartY,
      delta = cartTouchStartY - fingerY;
    const atTop = cartScrollArea.scrollTop <= 0,
      atBottom =
        cartScrollArea.scrollTop + cartScrollArea.clientHeight >=
        cartScrollArea.scrollHeight - 1;
    event.stopPropagation();
    if ((atTop && delta < 0) || (atBottom && delta > 0)) event.preventDefault();
  },
  { passive: false },
);
$("#openOrderLookupMobile").onclick = (event) => {
  event.preventDefault();
  openOrderLookup();
};
/* Keep the browser's native momentum scrolling for lookup results.  The page
   behind the dialog is locked below, so Safari cannot pass an edge swipe on. */
let lookupPageScrollY = 0,
  lookupPageLocked = false;
function lockPageForLookup() {
  if (lookupPageLocked || !window.matchMedia("(max-width:780px)").matches)
    return;
  lookupPageLocked = true;
  lookupPageScrollY = window.scrollY;
  document.body.style.position = "fixed";
  document.body.style.top = `-${lookupPageScrollY}px`;
  document.body.style.width = "100%";
  document.body.style.overflow = "hidden";
}
function unlockPageFromLookup() {
  if (!lookupPageLocked) return;
  lookupPageLocked = false;
  document.body.style.position = "";
  document.body.style.top = "";
  document.body.style.width = "";
  document.body.style.overflow = "";
  /* Restore the page instantly when the lookup window closes.  The global
     smooth-scroll setting otherwise turns this into a visible downward slide
     on mobile Safari. */
  const root = document.documentElement,
    previousBehavior = root.style.scrollBehavior;
  root.style.scrollBehavior = "auto";
  window.scrollTo(0, lookupPageScrollY);
  requestAnimationFrame(() => {
    root.style.scrollBehavior = previousBehavior;
  });
}
function fitLookupFormToContent() {
  if (!window.matchMedia("(max-width:780px)").matches) return;
  const dialog = $("#orderLookupDialog"),
    toolbar = $("#lookupResultToolbar"),
    form = $("#orderLookupFormWrap");
  dialog.style.height = "fit-content";
  requestAnimationFrame(() => {
    if (!dialog.open || !$("#lookupResult").hidden) return;
    const style = getComputedStyle(dialog),
      padding = parseFloat(style.paddingTop) + parseFloat(style.paddingBottom),
      content =
        (toolbar?.getBoundingClientRect().height || 0) +
        form.getBoundingClientRect().height +
        padding;
    dialog.style.height = `${Math.min(Math.ceil(content), window.innerHeight - 32)}px`;
  });
}
function placeLookupCloseButton(inResult) {
  const close = $("#closeOrderLookup"),
    dialog = $("#orderLookupDialog");
  if (!close) return;
  let toolbar = $("#lookupResultToolbar");
  if (!toolbar) {
    toolbar = document.createElement("div");
    toolbar.id = "lookupResultToolbar";
    toolbar.innerHTML =
      '<button type="button" class="lookup-retry" data-new-lookup>重新查询</button>';
    toolbar.append(close);
    dialog.prepend(toolbar);
    toolbar.addEventListener("click", (event) => {
      if (!event.target.closest("[data-new-lookup]")) return;
      placeLookupCloseButton(false);
      $("#lookupResult").hidden = true;
      $("#orderLookupFormWrap").hidden = false;
      fitLookupFormToContent();
      $("#lookupQuery").focus();
    });
  }
  toolbar.querySelector("[data-new-lookup]").hidden = !inResult;
  dialog.classList.toggle("has-lookup-results", inResult);
  dialog.classList.toggle("lookup-form-mode", !inResult);
  dialog.style.height = inResult ? "" : "fit-content";
  dialog.style.minHeight = "0";
}
const openOrderLookupNative = openOrderLookup;
openOrderLookup = () => {
  const dialog = $("#orderLookupDialog");
  dialog.classList.remove("has-lookup-results");
  dialog.classList.add("lookup-form-mode");
  dialog.style.height = "fit-content";
  dialog.style.minHeight = "0";
  placeLookupCloseButton(false);
  openOrderLookupNative();
  lockPageForLookup();
  fitLookupFormToContent();
};
$("#orderLookupDialog").addEventListener("close", unlockPageFromLookup);

/* Customer order lookup: compact tracking cards, with the full receipt available on demand. */
/* Customer order tracking and the customer-confirmed cancellation workflow. */
function lookupItemPreview(item) {
  return item.image
    ? `<img src="${escapeHtml(item.image)}" alt="${escapeHtml(item.name || "商品")}">`
    : `<span>${escapeHtml(item.icon || "🍬")}</span>`;
}
function lookupStageIndex(status) {
  return status === "待确认"
    ? 0
    : status === "已确认"
      ? 1
      : status === "配送中" || status === "等待取单"
        ? 2
        : 2;
}
function lookupTimeline(order) {
  const pickup = order.fulfillment === "pickup",
    status = order.status || "待确认",
    finalLabel = pickup ? "等待取单" : "正在配送",
    finishedLabel = pickup ? "订单已取" : "配送完成";
  const index = lookupStageIndex(status);
  const steps = [
    {
      label: status === "待确认" ? "待确认" : "订单确认",
      state: status === "待确认" ? "current" : "done",
    },
    {
      label: index < 1 ? "正在准备" : index === 1 ? "正在准备" : "准备完成",
      state: index < 1 ? "future" : index === 1 ? "current" : "done",
    },
    {
      label:
        index < 2
          ? finalLabel
          : status === "已完成"
            ? finishedLabel
            : finalLabel,
      state: index < 2 ? "future" : status === "已完成" ? "done" : "current",
    },
  ];
  const requested = order.cancellation_requested === true,
    wasRejected = !!order.cancellation_rejected_at,
    cancelIndex = lookupStageIndex(order.cancellation_stage || status),
    rejectedIndex = lookupStageIndex(
      order.cancellation_rejected_stage || order.cancellation_stage || status,
    );
  if (requested || status === "已取消") {
    const visible = steps.slice(0, cancelIndex + 1);
    visible.forEach((step, i) => {
      if (i < cancelIndex) step.state = "done";
    });
    visible[visible.length - 1] = {
      label: status === "已取消" ? "已取消" : "取消申请中",
      state: "cancelled",
    };
    return {
      pickup,
      steps: visible,
      title: status === "已取消" ? "已取消" : "取消申请中",
      cancelled: true,
      requested,
    };
  }
  /* Keep the rejection marker immediately before the live order step. */
  if (wasRejected)
    steps.splice(Math.min(rejectedIndex, steps.length), 0, {
      label: "申请未通过",
      state: "rejected",
    });
  const title = wasRejected
    ? "申请未通过"
    : status === "待确认"
      ? "待确认"
      : status === "已确认"
        ? "正在准备"
        : status === "配送中"
          ? "正在配送"
          : status === "等待取单"
            ? "等待取单"
            : status === "已完成"
              ? pickup
                ? "订单已取"
                : "配送完成"
              : status;
  return { pickup, steps, title, cancelled: wasRejected, requested: false };
}
function lookupProgress(order) {
  const meta = lookupTimeline(order);
  return `<div class="lookup-progress lookup-progress-v2" style="--lookup-steps:${meta.steps.length}">${meta.steps.map((step) => `<div class="lookup-step ${step.state}"><span>${step.state === "done" ? "✓" : step.state === "cancelled" || step.state === "rejected" ? "×" : step.state === "current" ? "●" : "○"}</span><b>${step.label}</b></div>`).join("")}</div>`;
}
function lookupOrderCard(order) {
  const items = Array.isArray(order.items) ? order.items : [],
    meta = lookupTimeline(order),
    canCancel =
      ["待确认", "已确认"].includes(order.status) &&
      !order.cancellation_requested &&
      !order.cancellation_rejected_at;
  const itemLines = items
    .slice(0, 3)
    .map(
      (item) =>
        `<li>${escapeHtml(item.name || "商品")}${item.variant_label ? ` · ${escapeHtml(item.variant_label)}` : ""} × ${Number(item.qty || 0)}</li>`,
    )
    .join("");
  const thumbs = items
    .slice(0, 3)
    .map(
      (item) =>
        `<div class="lookup-item-thumb">${lookupItemPreview(item)}</div>`,
    )
    .join("");
  const pickupAddress = String(
    settings.pickup_address || "天河城二楼，Archer Ave",
  ).trim();
  const address = meta.pickup
    ? `<span>🛍</span><span>到店自取 · ${escapeHtml(pickupAddress)}</span>`
    : `<span>📍</span><span>送至 ${escapeHtml(order.address || "配送地址待确认")}</span>`;
  const discount = Number(order.discount_amount || 0),
    fee = Number(order.delivery_fee || 0),
    feeRow = meta.pickup
      ? ""
      : `<div><span>配送费${fee === 0 ? "（已减免）" : ""}</span><b>${dollars(fee)}</b></div>`;
  const detailRows = items
    .map(
      (item) =>
        `<div class="lookup-detail-item"><div class="lookup-item-thumb">${lookupItemPreview(item)}</div><p><b>${escapeHtml(item.name || "商品")}</b>${item.variant_label ? `<small>${escapeHtml(item.variant_label)}</small>` : ""}</p><span>× ${Number(item.qty || 0)}</span><b>${dollars(item.line_total ?? Number(item.price || 0) * Number(item.qty || 0))}</b></div>`,
    )
    .join("");
  const promo = order.promotion_name
    ? `<p class="lookup-promo">已享受：${escapeHtml(order.promotion_name)}</p>`
    : "";
  const rejectionNote =
    order.cancellation_rejected_at && order.staff_note
      ? `<p class="lookup-note staff lookup-rejection-note"><b>店主说明</b>${escapeHtml(order.staff_note)}<small>更新于 ${formatChicagoTime(order.staff_note_updated_at)}</small></p>`
      : "";
  const notes = `${order.customer_note ? `<p class="lookup-note"><b>订单备注</b>${escapeHtml(order.customer_note)}</p>` : ""}${order.cancellation_reason ? `<p class="lookup-note cancellation-reason"><b>取消原因</b>${escapeHtml(order.cancellation_reason)}</p>` : ""}`;
  const cancelForm = canCancel
    ? `<form class="lookup-cancel-form" data-cancel-form hidden><label>再次输入手机号码<input name="cancelPhone" inputmode="numeric" pattern="[0-9]{10}" minlength="10" maxlength="10" required placeholder="请输入10位手机号码"></label><label>取消原因<textarea name="cancelReason" required maxlength="100" placeholder="请说明取消原因（最多100字）"></textarea><small class="lookup-cancel-count">0 / 100</small></label><button type="submit" class="lookup-cancel-submit">提交取消申请</button></form>`
    : "";
  const actions = `<div class="lookup-actions"><button type="button" class="lookup-detail-button" data-lookup-details>查看详情</button>${canCancel ? `<button type="button" class="lookup-cancel-button" data-show-cancel>申请取消订单</button>` : ""}</div>`;
  return `<article class="lookup-order-card" data-lookup-order="${escapeHtml(order.order_number)}"><header><div><span class="lookup-order-label">订单号</span><b>${escapeHtml(order.order_number)}</b><small>下单时间：${formatChicagoTime(order.created_at)}</small></div><strong class="lookup-status ${meta.cancelled ? "cancelled" : ""}">${escapeHtml(meta.title)}</strong></header>${lookupProgress(order)}${rejectionNote}<p class="lookup-address">${address}<i>›</i></p>${order.cancellation_requested ? `<p class="lookup-cancel-requested">取消申请中：${escapeHtml(order.cancellation_reason || "等待店主确认")}</p>` : ""}<section class="lookup-items-preview"><div class="lookup-thumbs">${thumbs || '<div class="lookup-item-thumb">🍬</div>'}</div><div><ul>${itemLines}</ul><small>共 ${items.reduce((sum, item) => sum + Number(item.qty || 0), 0)} 件商品</small></div></section><div class="lookup-total"><span>合计</span><b>${dollars(order.total_amount)}</b></div><section class="lookup-details" hidden><div class="lookup-detail-list">${detailRows}</div>${promo}<div class="lookup-amounts"><div><span>商品小计</span><b>${dollars(order.subtotal)}</b></div>${discount ? `<div><span>已优惠</span><b>−${dollars(discount)}</b></div>` : ""}${feeRow}<div><span>税</span><b>${dollars(order.tax_amount)}</b></div><div class="lookup-final"><span>订单总额</span><b>${dollars(order.total_amount)}</b></div></div>${notes}</section>${cancelForm}${actions}</article>`;
}
var lastLookupQuery = "";
async function loadLookupResults(query) {
  const result = $("#lookupResult");
  result.innerHTML = '<p class="dialog-note">正在查询订单…</p>';
  result.hidden = false;
  placeLookupCloseButton(true);
  const response = await db.rpc("lookup_customer_orders", { p_query: query });
  if (response.error || !response.data?.length) {
    result.innerHTML =
      '<p class="dialog-note">没有找到对应订单，请检查订单号或电话号码。</p>';
    placeLookupCloseButton(true);
    return;
  }
  result.innerHTML = response.data.map(lookupOrderCard).join("");
  placeLookupCloseButton(true);
}
$("#orderLookupForm").onsubmit = async (event) => {
  event.preventDefault();
  const query = $("#lookupQuery").value.trim();
  if (!query) return;
  lastLookupQuery = query;
  $("#orderLookupFormWrap").hidden = true;
  await loadLookupResults(query);
};
$("#lookupResult").onclick = async (clickEvent) => {
  const retry = clickEvent.target.closest("[data-new-lookup]");
  if (retry) {
    placeLookupCloseButton(false);
    $("#lookupResult").hidden = true;
    $("#orderLookupFormWrap").hidden = false;
    $("#lookupQuery").focus();
    return;
  }
  const detailButton = clickEvent.target.closest("[data-lookup-details]");
  if (detailButton) {
    const card = detailButton.closest(".lookup-order-card"),
      details = card.querySelector(".lookup-details"),
      open = details.hidden;
    details.hidden = !open;
    card.classList.toggle("is-expanded", open);
    detailButton.textContent = open ? "收起详情" : "查看详情";
    return;
  }
  const showCancel = clickEvent.target.closest("[data-show-cancel]");
  if (showCancel) {
    const card = showCancel.closest(".lookup-order-card"),
      form = card.querySelector("[data-cancel-form]");
    form.hidden = false;
    showCancel.hidden = true;
    form.querySelector('[name="cancelPhone"]').focus();
  }
};
$("#lookupResult").oninput = (event) => {
  if (event.target.name !== "cancelReason") return;
  const count = event.target
    .closest("[data-cancel-form]")
    ?.querySelector(".lookup-cancel-count");
  if (count) count.textContent = `${event.target.value.length} / 100`;
};
$("#lookupResult").onsubmit = async (event) => {
  const form = event.target.closest("[data-cancel-form]");
  if (!form) return;
  event.preventDefault();
  const card = form.closest(".lookup-order-card"),
    phone = form.elements.cancelPhone.value.trim(),
    reason = form.elements.cancelReason.value.trim(),
    submit = form.querySelector('button[type="submit"]');
  if (!/^\d{10}$/.test(phone) || !reason || reason.length > 100) return;
  submit.disabled = true;
  submit.textContent = "正在提交…";
  const response = await db.rpc("request_order_cancellation_v2", {
    p_order_number: card.dataset.lookupOrder,
    p_phone: phone,
    p_reason: reason,
  });
  if (response.error || !response.data) {
    submit.disabled = false;
    submit.textContent = "提交取消申请";
    alert(
      response.error?.message || "无法提交取消申请，请确认手机号码和订单状态。",
    );
    return;
  }
  await loadLookupResults(lastLookupQuery);
};

/* Keep the global settings reference current for separately-loaded modules. */
const applySettingsWithSharedState = applySettings;
applySettings = function (data) {
  window.settings = data || {};
  return applySettingsWithSharedState(data);
};
