/* Compact, expandable owner order cards. */
(() => {
  const root = document.querySelector("#ordersList");
  if (!root) return;
  const client = window.supabase.createClient(
    TINGS_SUPABASE.url,
    TINGS_SUPABASE.anonKey,
  );
  const $ = (selector) => document.querySelector(selector);
  const T = {
    pending: "\u5f85\u786e\u8ba4",
    confirmed: "\u5df2\u786e\u8ba4",
    delivering: "\u914d\u9001\u4e2d",
    complete: "\u5df2\u5b8c\u6210",
    cancelled: "\u5df2\u53d6\u6d88",
    preparing: "\u6b63\u5728\u51c6\u5907",
    inDelivery: "\u6b63\u5728\u914d\u9001",
    confirm: "\u786e\u8ba4\u8ba2\u5355",
    pickup: "\u81ea\u53d6",
    delivery: "\u914d\u9001",
    details: "\u67e5\u770b\u8be6\u60c5",
    collapse: "\u6536\u8d77\u8be6\u60c5",
    time: "\u4e0b\u5355\u65f6\u95f4\uff1a",
    customer: "\u987e\u5ba2\u4fe1\u606f",
    name: "\u59d3\u540d",
    phone: "\u7535\u8bdd",
    address: "\u914d\u9001\u5730\u5740",
    copy: "\u590d\u5236\u5730\u5740",
    items: "\u5546\u54c1\u8be6\u7ec6",
    variant: "\u9ed8\u8ba4\u89c4\u683c",
    noItems: "\u6682\u65e0\u5546\u54c1\u660e\u7ec6\u3002",
    subtotal: "\u5546\u54c1\u5c0f\u8ba1",
    fee: "\u914d\u9001\u8d39",
    tax: "\u7a0e",
    total: "\u8ba2\u5355\u603b\u989d",
    customerNote: "\u987e\u5ba2\u5907\u6ce8",
    ownerNote: "\u5e97\u4e3b\u8bf4\u660e",
    notePlaceholder:
      "\u586b\u5199\u7ed9\u987e\u5ba2\u770b\u7684\u8ba2\u5355\u8bf4\u660e",
    saveNote: "\u4fdd\u5b58\u8bf4\u660e",
    updated: "\u66f4\u65b0\u4e8e\uff1a",
    cancel: "\u53d6\u6d88\u8ba2\u5355",
    approve: "\u901a\u8fc7\u53d6\u6d88\u7533\u8bf7",
    reject: "\u62d2\u7edd\u53d6\u6d88\u7533\u8bf7",
    archived: "\u5df2\u5f52\u6863",
    cancelRequested:
      "\u987e\u5ba2\u5df2\u63d0\u4ea4\u53d6\u6d88\u7533\u8bf7\uff0c\u8bf7\u5728\u53f3\u4e0b\u65b9\u786e\u8ba4\u6216\u62d2\u7edd\u3002",
    coupon: "\u4f18\u60e0\u5238\uff1a",
    referral: "\u63a8\u8350\u7801\uff1a",
    activity: "\u6d3b\u52a8\uff1a",
    discount: "\u5df2\u4f18\u60e0",
    waived: "\uff08\u5df2\u51cf\u514d\uff09",
    copied: "\u914d\u9001\u5730\u5740\u5df2\u590d\u5236",
    copyFail:
      "\u65e0\u6cd5\u590d\u5236\u5730\u5740\uff0c\u8bf7\u624b\u52a8\u590d\u5236",
    noteSaved: "\u5e97\u4e3b\u8bf4\u660e\u5df2\u4fdd\u5b58",
    orderUpdated: "\u8ba2\u5355\u5df2\u66f4\u65b0",
    cancelConfirm:
      "\u786e\u5b9a\u8981\u53d6\u6d88\u8fd9\u7b14\u8ba2\u5355\u5417\uff1f\u53d6\u6d88\u540e\u5e93\u5b58\u4f1a\u81ea\u52a8\u6062\u590d\u3002",
    approveConfirm:
      "\u786e\u5b9a\u786e\u8ba4\u53d6\u6d88\u8fd9\u7b14\u8ba2\u5355\u5417\uff1f\u5e93\u5b58\u4f1a\u81ea\u52a8\u6062\u590d\u3002",
    rejectDone: "\u5df2\u62d2\u7edd\u53d6\u6d88\u7533\u8bf7",
    history: "\u5386\u53f2\u8ba2\u5355",
    current: "\u5f53\u524d\u8ba2\u5355",
    empty: "\u6ca1\u6709\u7b26\u5408\u6761\u4ef6\u7684\u8ba2\u5355\u3002",
  };
  const esc = (v) =>
    String(v ?? "").replace(
      /[&<>"]/g,
      (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c],
    );
  const cash = (v) => "$" + Number(v || 0).toFixed(2);
  const time = (v) =>
    v
      ? new Intl.DateTimeFormat("zh-CN", {
          timeZone: "America/Chicago",
          dateStyle: "medium",
          timeStyle: "short",
          hour12: false,
        }).format(new Date(v))
      : "";
  const tab = () =>
    document.querySelector("[data-order-tab].active-order-tab")?.dataset
      .orderTab || "current";
  const stage = (x) =>
    x.cancellation_requested
      ? "取消申请中"
      : x.status === T.confirmed
        ? T.preparing
        : x.status === T.delivering
          ? T.inDelivery
          : x.status;
  const next = (x) =>
    x.cancellation_requested
      ? null
      : x.status === T.pending
        ? { label: T.confirm, target: T.confirmed, kind: "" }
        : x.status === T.confirmed
          ? {
              label: T.preparing,
              target: x.fulfillment === "delivery" ? T.delivering : "等待取单",
              kind: "prepare",
            }
          : x.status === "等待取单"
            ? { label: "等待取单", target: T.complete, kind: "delivering" }
            : x.status === T.delivering
              ? { label: T.inDelivery, target: T.complete, kind: "delivering" }
              : null;
  const color = (x) =>
    x.status === T.pending
      ? x.fulfillment === "pickup"
        ? "pending-pickup"
        : "pending-delivery"
      : "";
  const item = (i) => {
    const qty = Number(i.qty || 1),
      price = Number(i.price ?? i.unit_price ?? 0),
      total = Number(i.total ?? i.subtotal ?? price * qty),
      image = i.image || i.product_image || "";
    const thumb = image ? '<img src="' + esc(image) + '" alt="">' : "&#127852;";
    return (
      '<div class="order-item-detail"><div class="order-item-thumb">' +
      thumb +
      '</div><div class="order-item-main"><b>' +
      esc(i.name || T.items) +
      "</b><small> &middot; " +
      esc(i.variant_label || i.option_label || T.variant) +
      '</small></div><span class="order-item-qty">&times; ' +
      qty +
      '</span><span class="order-item-price">' +
      cash(total) +
      "</span></div>"
    );
  };
  const compactItems = (x) =>
    (x.items || [])
      .map(
        (i) =>
          esc(i.name || T.items) +
          (i.variant_label ? " &middot; " + esc(i.variant_label) : "") +
          " &times; " +
          Number(i.qty || 1),
      )
      .join("&#65307; ") || T.noItems;
  const card = (x) => {
    const delivery = x.fulfillment === "delivery",
      action = next(x),
      items =
        (x.items || []).map(item).join("") ||
        '<p class="muted">' + T.noItems + "</p>";
    const address =
      delivery && x.address
        ? "<div><span>" +
          T.address +
          '</span><div class="customer-address"><b>' +
          esc(x.address) +
          '</b><button class="text-btn" data-card-copy="' +
          x.id +
          '" data-address="' +
          encodeURIComponent(x.address) +
          '">' +
          T.copy +
          "</button></div></div>"
        : "";
    const select = x.archived
      ? '<span class="status-stage">' +
        (delivery ? "&#128663; " : "&#128717; ") +
        (delivery ? T.delivery : T.pickup) +
        "</span>"
      : '<select class="fulfillment-select" data-card-fulfillment="' +
        x.id +
        '"><option value="pickup" ' +
        (delivery ? "" : "selected") +
        ">&#128717; " +
        T.pickup +
        '</option><option value="delivery" ' +
        (delivery ? "selected" : "") +
        ">&#128663; " +
        T.delivery +
        "</option></select>";
    const staff =
      '<div class="staff-note-editor"><label>' +
      T.ownerNote +
      '<textarea data-card-note="' +
      x.id +
      '" rows="1" placeholder="' +
      T.notePlaceholder +
      '">' +
      esc(x.staff_note || "") +
      '</textarea></label><button data-card-save-note="' +
      x.id +
      '">' +
      T.saveNote +
      "</button>" +
      (x.staff_note_updated_at
        ? "<small>" + T.updated + time(x.staff_note_updated_at) + "</small>"
        : "") +
      "</div>";
    const cancel = x.archived
      ? '<span class="muted">' + T.archived + "</span>"
      : x.cancellation_requested
        ? '<button class="approve-cancel" data-card-approve="' +
          x.id +
          '">' +
          T.approve +
          '</button><button data-card-reject="' +
          x.id +
          '">' +
          T.reject +
          "</button>"
        : "";
    const snapshot = x.promotion_snapshot || {},
      tags = [];
    if (x.coupon_code)
      tags.push(
        '<span class="promotion-tag">' +
          (snapshot.code_kind === "referral" ? T.referral : T.coupon) +
          esc(x.coupon_code) +
          "</span>",
      );
    if (snapshot.campaign_name || (x.promotion_name && !x.coupon_code))
      tags.push(
        '<span class="promotion-tag">' +
          T.activity +
          esc(snapshot.campaign_name || x.promotion_name) +
          "</span>",
      );
    const discount = Number(x.discount_amount || 0);
    const discountRow =
      discount > 0
        ? '<p class="discount-row"><span>' +
          T.discount +
          '</span><span class="discount-amount"><span class="promotion-tags">' +
          tags.join("") +
          "</span><span>−" +
          cash(discount) +
          "</span></span></p>"
        : "";
    const feeRow = delivery
      ? "<p><span>" +
        T.fee +
        '</span><span class="fee-value">' +
        (Number(x.delivery_fee || 0) === 0
          ? "<small>" + T.waived + "</small>"
          : "") +
        "<b>" +
        cash(x.delivery_fee) +
        "</b></span></p>"
      : "";
    const detail =
      '<div class="order-detail"><section class="card-section"><p class="card-label">' +
      T.customer +
      '</p><div class="customer-details"><div><span>' +
      T.name +
      "</span><b>" +
      esc(x.customer_name) +
      "</b></div><div><span>" +
      T.phone +
      "</span><b>" +
      esc(x.phone) +
      "</b></div>" +
      address +
      '</div></section><section class="card-section"><p class="card-label">' +
      T.items +
      '</p><div class="order-items-detail">' +
      items +
      '</div></section><section class="card-section"><div class="card-totals"><p><span>' +
      T.subtotal +
      "</span><span>" +
      cash(x.subtotal) +
      "</span></p>" +
      discountRow +
      feeRow +
      "<p><span>" +
      T.tax +
      "</span><span>" +
      cash(x.tax_amount) +
      "</span></p><p><span>" +
      T.total +
      "</span><span>" +
      cash(x.total_amount ?? x.subtotal) +
      "</span></p></div></section>" +
      (x.customer_note && x.customer_note.trim()
        ? '<section class="card-section"><p class="card-label">' +
          T.customerNote +
          '</p><p class="customer-note">' +
          esc(x.customer_note) +
          "</p></section>"
        : "") +
      '<section class="card-section"><p class="card-label">' +
      T.ownerNote +
      "</p>" +
      staff +
      "</section></div>";
    return (
      '<article class="order-card is-collapsed ' +
      color(x) +
      '" data-order-id="' +
      x.id +
      '" data-order-status="' +
      esc(x.status) +
      '" data-delivery-fee="' +
      Number(x.delivery_fee || 0) +
      '"><div class="order-top"><div><div class="order-title-wrap"><h3>' +
      esc(x.order_number) +
      '</h3><span class="status-stage">' +
      esc(stage(x)) +
      "</span>" +
      select +
      '</div><p class="order-time">' +
      T.time +
      time(x.created_at) +
      "</p></div>" +
      (action && !x.archived
        ? '<button class="advance-order ' +
          action.kind +
          '" data-card-advance="' +
          x.id +
          '" data-target="' +
          action.target +
          '">' +
          action.label +
          "</button>"
        : "") +
      "</div>" +
      (x.cancellation_requested
        ? '<p class="cancellation-alert">' +
          T.cancelRequested +
          (x.cancellation_reason
            ? "<br><b>取消原因：</b>" + esc(x.cancellation_reason)
            : "") +
          "</p>"
        : "") +
      '<div class="order-compact"><p class="compact-items">' +
      compactItems(x) +
      '</p><div class="compact-meta"><span>' +
      esc(x.customer_name) +
      " &middot; " +
      esc(x.phone) +
      "</span><b>" +
      cash(x.total_amount ?? x.subtotal) +
      "</b></div></div>" +
      detail +
      '<div class="order-footer"><button class="detail-toggle" data-card-toggle="' +
      x.id +
      '">' +
      T.details +
      '</button><div class="order-footer-right">' +
      cancel +
      "</div></div></article>"
    );
  };
  const render = async () => {
    /* This module is isolated from admin.js, so it must not rely on its private data() helper. */
    const { data: orders, error } = await client
      .from("orders")
      .select("*")
      .order("created_at", { ascending: false })
      .order("id", { ascending: true });
    if (error) {
      toast(error.message);
      return;
    }
    const all = orders || [],
      selected = tab(),
      query = ($("#orderSearch")?.value || "").trim().toLowerCase();
    const list = all
      .filter((x) => (selected === "history") === !!x.archived)
      .filter(
        (x) =>
          !query ||
          [x.order_number, x.customer_name, x.phone, time(x.created_at)]
            .join(" ")
            .toLowerCase()
            .includes(query),
      );
    $("#ordersTitle").textContent =
      selected === "history" ? T.history : T.current;
    $("#allOrders").textContent = all.filter((x) => !x.archived).length;
    $("#newOrders").textContent = all.filter(
      (x) => x.status === T.pending && !x.archived,
    ).length;
    $("#orderBadge").textContent = all.filter(
      (x) => x.status === T.pending && !x.archived,
    ).length;
    $("#todayAmount").textContent = cash(
      all
        .filter((x) => !x.archived)
        .reduce((sum, x) => sum + Number(x.total_amount || x.subtotal || 0), 0),
    );
    root.classList.add("order-card-list");
    root.innerHTML =
      list.map(card).join("") || '<p class="muted">' + T.empty + "</p>";
    root.querySelectorAll("textarea[data-card-note]").forEach((field) => {
      field.style.height = "auto";
      field.style.height = Math.max(40, field.scrollHeight) + "px";
    });
  };
  const save = async (node, status, fulfillment) => {
    const fee =
      fulfillment === "pickup" ? 0 : Number(node.dataset.deliveryFee || 0);
    const result = await client.rpc("owner_update_order", {
      p_order_id: node.dataset.orderId,
      p_status: status,
      p_fulfillment: fulfillment,
      p_delivery_fee: fee,
    });
    toast(result.error ? result.error.message : T.orderUpdated);
    if (!result.error) render();
  };
  const toggleDetails = (button) => {
    const node = button.closest(".order-card");
    if (!node) return;
    const collapsed = node.classList.toggle("is-collapsed");
    button.textContent = collapsed ? T.details : T.collapse;
  };
  /* This runs before legacy order handlers, so the compact-card toggle only fires once. */
  root.addEventListener(
    "click",
    (event) => {
      const button = event.target.closest("[data-card-toggle]");
      if (!button) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      toggleDetails(button);
    },
    true,
  );
  root.addEventListener("input", (e) => {
    if (e.target.matches("textarea[data-card-note]")) {
      e.target.style.height = "auto";
      e.target.style.height = Math.max(40, e.target.scrollHeight) + "px";
    }
  });
  root.addEventListener("change", (e) => {
    if (!e.target.dataset.cardFulfillment) return;
    const node = e.target.closest(".order-card");
    save(node, node.dataset.orderStatus, e.target.value);
  });
  root.addEventListener("click", async (e) => {
    const node = e.target.closest(".order-card");
    if (!node) return;
    const id = node.dataset.orderId,
      fulfillment =
        node.querySelector("[data-card-fulfillment]")?.value || "pickup";
    if (e.target.dataset.cardCopy) {
      try {
        await navigator.clipboard.writeText(
          decodeURIComponent(e.target.dataset.address || ""),
        );
        toast(T.copied);
      } catch {
        toast(T.copyFail);
      }
      return;
    }
    if (e.target.dataset.cardSaveNote) {
      const field = node.querySelector("[data-card-note]");
      const result = await client.rpc("owner_update_order_note", {
        p_order_id: id,
        p_staff_note: field?.value || "",
      });
      toast(result.error ? result.error.message : T.noteSaved);
      if (!result.error) render();
      return;
    }
    if (e.target.dataset.cardAdvance)
      return save(node, e.target.dataset.target, fulfillment);
    if (e.target.dataset.cardCancel) {
      if (confirm(T.cancelConfirm)) return save(node, T.cancelled, fulfillment);
      return;
    }
    if (e.target.dataset.cardApprove) {
      if (confirm(T.approveConfirm))
        return save(node, T.cancelled, fulfillment);
      return;
    }
    if (e.target.dataset.cardReject) {
      const result = await client.rpc("owner_reject_cancellation", {
        p_order_id: id,
      });
      toast(result.error ? result.error.message : T.rejectDone);
      if (!result.error) render();
    }
  });
  client
    .channel("cancellation-request-alerts")
    .on(
      "postgres_changes",
      { event: "UPDATE", schema: "public", table: "orders" },
      (payload) => {
        if (payload.new?.cancellation_requested)
          toast("收到取消申请：" + (payload.new.order_number || ""));
        render();
      },
    )
    .subscribe();
  setTimeout(async () => {
    orders = render;
    try {
      await render();
    } finally {
      requestAnimationFrame(() => window.finishAdminBoot?.());
    }
  }, 0);
})();
