const startAdmin = () => {
  if (!window.supabase || !window.TINGS_SUPABASE)
    return setTimeout(startAdmin, 50);
  const db = window.supabase.createClient(
    TINGS_SUPABASE.url,
    TINGS_SUPABASE.anonKey,
  );
  const OWNER_EMAIL = "chenghanchen1@gmail.com",
    $ = (s) => document.querySelector(s),
    money = (n) => `$${Number(n).toFixed(2)}`;
  function toast(m) {
    $("#toast").textContent = m;
    $("#toast").classList.add("show");
    setTimeout(() => $("#toast").classList.remove("show"), 2800);
  }
  async function readOptimizedImage(file, options = {}) {
    if (!file) return "";
    if (window.TingsImage?.optimizeFile) {
      const result = await window.TingsImage.optimizeFile(file, options);
      if (result.changed)
        toast(
          `图片已优化为 WebP${result.width ? `（${result.width} × ${result.height}）` : ""}`,
        );
      return result.dataUrl;
    }
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error("图片读取失败"));
      reader.onload = () => resolve(reader.result);
      reader.readAsDataURL(file);
    });
  }
  async function data(table) {
    const column =
        table === "orders"
          ? "created_at"
          : table === "products" || table === "categories"
            ? "position"
            : "id",
      ascending = table === "orders" ? false : true;
    const { data, error } = await db
      .from(table)
      .select("*")
      .order(column, { ascending })
      .order("id", { ascending });
    if (error) toast(error.message);
    return data || [];
  }
  let orderTab = "current",
    productRows = [],
    categoryRows = [],
    isAcceptingOrders = true,
    orderPausedUntil = null;
  queueMicrotask(() => {
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
        ),
      chicago = (v) =>
        v
          ? new Intl.DateTimeFormat("zh-CN", {
              timeZone: "America/Chicago",
              dateStyle: "medium",
              timeStyle: "short",
              hour12: false,
            }).format(new Date(v))
          : "",
      head = $("#orders .panel-head");
    let alertsReady = false,
      audioContext;
    function updateAlertButton() {
      const button = $("#orderAlertToggle");
      if (!button) return;
      button.textContent = alertsReady ? "新订单提醒已开启" : "开启新订单提醒";
      button.classList.toggle("enabled", alertsReady);
    }
    async function enableAlerts() {
      if (!("Notification" in window)) return toast("当前浏览器不支持系统通知");
      if (Notification.permission === "default")
        await Notification.requestPermission();
      if (Notification.permission !== "granted")
        return toast("未获得浏览器通知权限");
      try {
        audioContext ??= new (window.AudioContext ||
          window.webkitAudioContext)();
        await audioContext.resume();
      } catch {}
      alertsReady = true;
      updateAlertButton();
      toast("新订单声音和浏览器提醒已开启");
    }
    function chime() {
      if (!audioContext || audioContext.state !== "running") return;
      const osc = audioContext.createOscillator(),
        gain = audioContext.createGain();
      osc.frequency.setValueAtTime(880, audioContext.currentTime);
      gain.gain.setValueAtTime(0.0001, audioContext.currentTime);
      gain.gain.exponentialRampToValueAtTime(
        0.11,
        audioContext.currentTime + 0.02,
      );
      gain.gain.exponentialRampToValueAtTime(
        0.0001,
        audioContext.currentTime + 0.34,
      );
      osc.connect(gain).connect(audioContext.destination);
      osc.start();
      osc.stop(audioContext.currentTime + 0.36);
    }
    function announce(order) {
      if (!alertsReady || order.status !== "待确认") return;
      chime();
      new Notification("婷婷的零食屋｜新订单", {
        body:
          (order.order_number || "") + " · " + (order.customer_name || "顾客"),
      });
    }
    if (head && !$("#orderAlertToggle"))
      head.insertAdjacentHTML(
        "beforeend",
        '<button class="text-btn" id="orderAlertToggle" type="button">开启新订单提醒</button>',
      );
    $("#orderAlertToggle")?.addEventListener("click", enableAlerts);
    updateAlertButton();
    orders = async function () {
      const all = await data("orders"),
        q = ($("#orderSearch")?.value || "").toLowerCase(),
        list = all
          .filter((x) => (orderTab === "history") === !!x.archived)
          .filter(
            (x) =>
              !q ||
              [
                x.order_number,
                x.customer_name,
                x.phone,
                new Date(x.created_at).toLocaleDateString(),
              ]
                .join(" ")
                .toLowerCase()
                .includes(q),
          );
      $("#ordersTitle").textContent =
        orderTab === "history" ? "已完成" : "进行中";
      $("#allOrders").textContent = all.filter((x) => !x.archived).length;
      $("#newOrders").textContent = all.filter(
        (x) => x.status === "待确认" && !x.archived,
      ).length;
      $("#orderBadge").textContent = all.filter(
        (x) => x.status === "待确认" && !x.archived,
      ).length;
      $("#todayAmount").textContent = money(
        all
          .filter((x) => !x.archived)
          .reduce((s, x) => s + Number(x.total_amount || x.subtotal), 0),
      );
      $("#ordersList").innerHTML =
        list
          .map((x) => {
            const delivery = x.fulfillment === "delivery",
              address =
                delivery && x.address
                  ? '<p class="order-meta address-summary">配送地址：' +
                    esc(x.address) +
                    ' <button class="text-btn" data-copy-address="' +
                    x.id +
                    '" data-address="' +
                    encodeURIComponent(x.address) +
                    '">复制地址</button></p>'
                  : "",
              note =
                '<div class="staff-note-editor"><label>店主说明<textarea data-staff-note="' +
                x.id +
                '" rows="3" placeholder="填写给顾客看的订单说明">' +
                esc(x.staff_note || "") +
                '</textarea></label><button data-save-note="' +
                x.id +
                '">保存说明</button>' +
                (x.staff_note_updated_at
                  ? "<small>更新于：" +
                    chicago(x.staff_note_updated_at) +
                    "</small>"
                  : "") +
                "</div>",
              editor = x.archived
                ? '<p class="muted">已归档</p>'
                : '<div class="order-editor"><label>订单状态<select data-status="' +
                  x.id +
                  '">' +
                  orderStatusOptions(x) +
                  '</select></label><label>取货方式<select data-fulfillment="' +
                  x.id +
                  '"><option value="pickup" ' +
                  (x.fulfillment === "pickup" ? "selected" : "") +
                  '>到店自取</option><option value="delivery" ' +
                  (delivery ? "selected" : "") +
                  '>配送</option></select></label><label>配送费（美元）<input data-fee="' +
                  x.id +
                  '" type="number" min="0" step="0.01" value="' +
                  Number(x.delivery_fee || 0).toFixed(2) +
                  '" ' +
                  (delivery ? "" : "disabled") +
                  '></label><button data-save-order="' +
                  x.id +
                  '">保存配送设置</button>' +
                  (x.cancellation_requested
                    ? '<button data-approve-cancel="' +
                      x.id +
                      '">确认取消</button><button data-reject-cancel="' +
                      x.id +
                      '">拒绝取消</button>'
                    : "") +
                  "</div>";
            return (
              '<article class="order-card"><div class="order-top"><div><h3>' +
              esc(x.order_number) +
              " · " +
              esc(x.customer_name) +
              '</h3><p class="order-meta">' +
              esc(x.phone) +
              " · 下单时间：" +
              chicago(x.created_at) +
              '</p></div><span class="status">' +
              esc(x.status) +
              "</span></div>" +
              (x.cancellation_requested
                ? '<p class="order-meta">⚠ 顾客申请取消</p>'
                : "") +
              '<p class="order-items">' +
              (x.items || [])
                .map(
                  (i) =>
                    esc(i.name) +
                    (i.variant_label ? " · " + esc(i.variant_label) : "") +
                    " × " +
                    i.qty,
                )
                .join("、") +
              "</p>" +
              (delivery ? "" : '<p class="order-meta">到店自取</p>') +
              address +
              (x.customer_note
                ? '<p class="order-meta">顾客备注：' +
                  esc(x.customer_note) +
                  "</p>"
                : "") +
              '<p class="order-meta">商品小计 ' +
              money(x.subtotal || 0) +
              " · 税 " +
              money(x.tax_amount || 0) +
              " · 配送 " +
              money(x.delivery_fee || 0) +
              " · 应付 " +
              money(x.total_amount || x.subtotal || 0) +
              "</p>" +
              note +
              editor +
              "</article>"
            );
          })
          .join("") || '<p class="muted">没有符合条件的订单。</p>';
    };
    $("#ordersList").onclick = async (e) => {
      const copy = e.target.dataset.copyAddress,
        noteId = e.target.dataset.saveNote,
        id =
          e.target.dataset.saveOrder ||
          e.target.dataset.approveCancel ||
          e.target.dataset.rejectCancel;
      if (copy) {
        try {
          await navigator.clipboard.writeText(
            decodeURIComponent(e.target.dataset.address || ""),
          );
          toast("配送地址已复制");
        } catch {
          toast("无法复制地址，请手动复制");
        }
        return;
      }
      if (noteId) {
        const input = $('[data-staff-note="' + noteId + '"]'),
          { error } = await db.rpc("owner_update_order_note", {
            p_order_id: noteId,
            p_staff_note: input?.value || "",
          });
        toast(error ? error.message : "店主说明已保存");
        if (!error) orders();
        return;
      }
      if (!id) return;
      if (e.target.dataset.rejectCancel) {
        const { error } = await db.rpc("owner_reject_cancellation", {
          p_order_id: id,
        });
        toast(error ? error.message : "已拒绝取消申请");
        return orders();
      }
      if (e.target.dataset.approveCancel) return saveOrderUpdate(id, "已取消");
      if (e.target.dataset.saveOrder) {
        const status = $('[data-status="' + id + '"]')?.value || "待确认";
        return saveOrderUpdate(id, status);
      }
    };
    boot = async function () {
      await Promise.all([orders(), products(), categories(), settings()]);
      db.channel("order-alert-v2")
        .on(
          "postgres_changes",
          { event: "INSERT", schema: "public", table: "orders" },
          (p) => {
            if (p.new?.status === "待确认") {
              toast("收到一笔新订单！");
              announce(p.new);
            }
            orders();
          },
        )
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "products" },
          products,
        )
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "categories" },
          categories,
        )
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "shop_settings" },
          settings,
        )
        .subscribe();
    };
    setTimeout(() => boot(), 0);
  });
  async function savePositions(table, rows) {
    const results = await Promise.all(
      rows.map((row, index) =>
        db.from(table).update({ position: index }).eq("id", row.id),
      ),
    );
    const failure = results.find((x) => x.error);
    if (failure) return toast(failure.error.message);
    toast("排序已同步到顾客网站");
  }
  async function saveReceivingStatus(accepting, pauseUntil = null) {
    const { error } = await db
      .from("shop_settings")
      .update({
        is_accepting_orders: accepting,
        order_paused_until: pauseUntil,
        updated_at: new Date().toISOString(),
      })
      .eq("id", 1);
    if (error) {
      toast(error.message);
      return false;
    }
    isAcceptingOrders = accepting;
    orderPausedUntil = pauseUntil;
    renderReceivingToggle();
    return true;
  }
  function localDateTimeValue(value) {
    if (!value) return "";
    const d = new Date(value),
      pad = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }
  const pauseDialog = $("#pauseOrdersDialog");
  document.querySelectorAll("[data-shop-status]").forEach((button) =>
    button.addEventListener("click", async () => {
      if (button.dataset.shopStatus === "accepting") {
        if (!isAcceptingOrders && (await saveReceivingStatus(true, null)))
          toast("已恢复接单");
        return;
      }
      $("#pauseUntilInput").value = localDateTimeValue(orderPausedUntil);
      pauseDialog?.showModal();
    }),
  );
  $("#closePauseOrders")?.addEventListener("click", () => pauseDialog?.close());
  $("#cancelPauseOrders")?.addEventListener("click", () =>
    pauseDialog?.close(),
  );
  $("#confirmPauseOrders")?.addEventListener("click", async () => {
    const value = $("#pauseUntilInput")?.value || "",
      resumeAt = value ? new Date(value) : null;
    if (
      resumeAt &&
      (!Number.isFinite(resumeAt.getTime()) || resumeAt.getTime() <= Date.now())
    )
      return toast("恢复时间需要晚于当前时间");
    if (
      await saveReceivingStatus(false, resumeAt ? resumeAt.toISOString() : null)
    ) {
      pauseDialog?.close();
      toast(
        resumeAt
          ? `已暂停接单，将在 ${resumeAt.toLocaleString("zh-CN", { dateStyle: "medium", timeStyle: "short", hour12: false })} 自动恢复`
          : "已暂停接单，请手动恢复",
      );
    }
  });
  $("#productsList").addEventListener("click", async (e) => {
    const id = e.target.dataset.delete || e.target.dataset.restore;
    if (!id) return;
    if (
      e.target.dataset.delete &&
      !confirm(
        "删除后商品不会再显示在顾客网站；历史订单会完整保留。确定删除吗？",
      )
    )
      return;
    const { error } = await db
      .from("products")
      .update({ is_active: !!e.target.dataset.restore })
      .eq("id", id);
    toast(
      error
        ? error.message
        : e.target.dataset.restore
          ? "商品已重新上架"
          : "商品已删除",
    );
    if (!error) products();
  });
  $("#productsList").addEventListener("change", async (e) => {
    const categoryId = e.target.dataset.productCategory,
      priceId = e.target.dataset.productPrice,
      unifiedPriceId = e.target.dataset.productUnifiedPrice,
      id = categoryId || priceId || unifiedPriceId;
    if (!id) return;
    const update = { updated_at: new Date().toISOString() };
    if (categoryId) update.type = e.target.value || "未分类";
    if (priceId || unifiedPriceId) {
      const price = Number(e.target.value);
      if (!Number.isFinite(price) || price < 0) {
        toast("请输入有效的商品价格");
        return products();
      }
      update.price = price;
      if (unifiedPriceId) {
        const { error: variantError } = await db
          .from("product_variants")
          .update({ price, updated_at: new Date().toISOString() })
          .eq("product_id", unifiedPriceId);
        if (variantError) {
          toast(variantError.message);
          return products();
        }
      }
    }
    const { error } = await db.from("products").update(update).eq("id", id);
    if (error) {
      toast(error.message);
      return products();
    }
    toast(
      categoryId
        ? "商品分类已保存"
        : unifiedPriceId
          ? "所有规格组合价格已统一更新"
          : "商品价格已保存",
    );
  });
  let draggingProduct = null;
  $("#productsList").addEventListener("dragstart", (e) => {
    const row = e.target.closest("[data-product-id]");
    if (!row) return;
    draggingProduct = +row.dataset.productId;
    row.classList.add("dragging");
  });
  $("#productsList").addEventListener("dragend", (e) =>
    e.target.closest("[data-product-id]")?.classList.remove("dragging"),
  );
  $("#productsList").addEventListener("dragover", (e) => {
    if (draggingProduct) e.preventDefault();
  });
  $("#productsList").addEventListener("drop", async (e) => {
    e.preventDefault();
    const row = e.target.closest("[data-product-id]"),
      target = +row?.dataset.productId;
    if (!draggingProduct || !target || target === draggingProduct) return;
    const from = productRows.findIndex((x) => x.id === draggingProduct),
      to = productRows.findIndex((x) => x.id === target);
    productRows.splice(to, 0, productRows.splice(from, 1)[0]);
    await savePositions("products", productRows);
    products();
    draggingProduct = null;
  });
  $("#categoryForm").addEventListener(
    "submit",
    (e) => {
      if ($("#categoryName").value.trim() === "未分类") {
        e.preventDefault();
        e.stopImmediatePropagation();
        toast("“未分类”是系统固定分类，不能重复添加");
      }
    },
    true,
  );
  $("#categoryList").addEventListener("click", async (e) => {
    const id = e.target.dataset.category;
    if (!id) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    const category = categoryRows.find((x) => String(x.id) === String(id));
    if (!category || category.name === "未分类" || category.is_system) return;
    if (
      !confirm(
        `删除“${category.name}”后，原分类商品会自动归入“未分类”。确定删除吗？`,
      )
    )
      return;
    const { error: productError } = await db
      .from("products")
      .update({ type: "未分类" })
      .eq("type", category.name);
    if (productError) return toast(productError.message);
    const { error } = await db.from("categories").delete().eq("id", id);
    toast(error ? error.message : "分类已删除，商品已归入未分类");
    if (!error) {
      categories();
      products();
    }
  });
  let draggingCategory = null;
  $("#categoryList").addEventListener("dragstart", (e) => {
    const item = e.target.closest("[data-category-id]");
    if (!item || item.classList.contains("system-category")) return;
    draggingCategory = +item.dataset.categoryId;
    item.classList.add("dragging");
  });
  $("#categoryList").addEventListener("dragend", (e) =>
    e.target.closest("[data-category-id]")?.classList.remove("dragging"),
  );
  $("#categoryList").addEventListener("dragover", (e) => {
    if (draggingCategory) e.preventDefault();
  });
  $("#categoryList").addEventListener("drop", async (e) => {
    e.preventDefault();
    const item = e.target.closest("[data-category-id]"),
      target = +item?.dataset.categoryId;
    if (
      !draggingCategory ||
      !target ||
      target === draggingCategory ||
      item.classList.contains("system-category")
    )
      return;
    const movable = categoryRows.filter(
        (x) => x.name !== "未分类" && !x.is_system,
      ),
      from = movable.findIndex((x) => x.id === draggingCategory),
      to = movable.findIndex((x) => x.id === target);
    if (from < 0 || to < 0) return;
    movable.splice(to, 0, movable.splice(from, 1)[0]);
    const fixed = categoryRows.filter(
      (x) => x.name === "未分类" || x.is_system,
    );
    await savePositions("categories", [...movable, ...fixed]);
    categories();
    draggingCategory = null;
  });
  function orderStatusOptions(order) {
    return (
      order.fulfillment === "delivery"
        ? ["待确认", "已确认", "配送中", "已完成", "已取消"]
        : ["待确认", "已确认", "已完成", "已取消"]
    )
      .map(
        (s) => `<option ${s === order.status ? "selected" : ""}>${s}</option>`,
      )
      .join("");
  }
  async function orders() {
    const o = await data("orders"),
      q = ($("#orderSearch")?.value || "").toLowerCase(),
      list = o
        .filter((x) => (orderTab === "history") === !!x.archived)
        .filter(
          (x) =>
            !q ||
            [
              x.order_number,
              x.customer_name,
              x.phone,
              new Date(x.created_at).toLocaleDateString(),
            ]
              .join(" ")
              .toLowerCase()
              .includes(q),
        );
    $("#ordersTitle").textContent =
      orderTab === "history" ? "已完成" : "进行中";
    $("#allOrders").textContent = o.filter((x) => !x.archived).length;
    $("#newOrders").textContent = o.filter(
      (x) => x.status === "待确认" && !x.archived,
    ).length;
    $("#orderBadge").textContent = o.filter(
      (x) => x.status === "待确认" && !x.archived,
    ).length;
    $("#todayAmount").textContent = money(
      o
        .filter((x) => !x.archived)
        .reduce((s, x) => s + Number(x.total_amount || x.subtotal), 0),
    );
    $("#ordersList").innerHTML =
      list
        .map(
          (x) =>
            `<article class="order-card"><div class="order-top"><div><h3>${x.order_number} · ${x.customer_name}</h3><p class="order-meta">${x.phone} · ${new Date(x.created_at).toLocaleString()}</p></div><span class="status">${x.status}</span></div>${x.cancellation_requested ? '<p class="order-meta">⚠ 顾客申请取消</p>' : ""}<p class="order-items">${(x.items || []).map((i) => `${i.name}${i.variant_label ? " · " + i.variant_label : ""} × ${i.qty}`).join("、")}</p>${x.customer_note ? `<p class="order-meta">顾客备注：${x.customer_note}</p>` : ""}<p class="order-meta">商品小计 ${money(x.subtotal || 0)} · 税 ${money(x.tax_amount || 0)} · 配送 ${money(x.delivery_fee || 0)} · 应付 ${money(x.total_amount || x.subtotal || 0)}</p>${x.archived ? '<p class="muted">已归档</p>' : `<div class="order-editor"><label>订单状态<select data-status="${x.id}">${orderStatusOptions(x)}</select></label><label>取货方式<select data-fulfillment="${x.id}"><option value="pickup" ${x.fulfillment === "pickup" ? "selected" : ""}>到店自取</option><option value="delivery" ${x.fulfillment === "delivery" ? "selected" : ""}>配送</option></select></label><label>配送费（美元）<input data-fee="${x.id}" type="number" min="0" step="0.01" value="${Number(x.delivery_fee || 0).toFixed(2)}" ${x.fulfillment === "pickup" ? "disabled" : ""}></label><button data-save-order="${x.id}">保存配送设置</button>${x.cancellation_requested ? `<button data-approve-cancel="${x.id}">确认取消</button><button data-reject-cancel="${x.id}">拒绝取消</button>` : ""}</div>`}</article>`,
        )
        .join("") || '<p class="muted">没有符合条件的订单。</p>';
  }
  async function products() {
    const [p, v, c] = await Promise.all([
      data("products"),
      data("product_variants"),
      data("categories"),
    ]);
    productRows = p;
    const categoryOptions = c
      .map((a) => `<option value="${a.name}">${a.name}</option>`)
      .join("");
    $("#productsList").innerHTML = p
      .map((x) => {
        const variants = v.filter((a) => a.product_id === x.id),
          count = variants.length,
          low = Number(x.stock) <= Number(window.lowStock || 5),
          deleted = x.is_active === false,
          start = count
            ? Math.min(...variants.map((a) => Number(a.price || 0)))
            : null,
          category = `<select class="product-inline-select" data-product-category="${x.id}" ${deleted ? "disabled" : ""}>${categoryOptions}</select>`,
          price = count
            ? `<label class="product-unified-price">起价<input class="product-inline-price" data-product-unified-price="${x.id}" type="number" min="0" step="0.01" value="${Number(start).toFixed(2)}" ${deleted ? "disabled" : ""} aria-label="${x.name} 的统一规格价格"></label>`
            : `<input class="product-inline-price" data-product-price="${x.id}" type="number" min="0" step="0.01" value="${Number(x.price || 0).toFixed(2)}" ${deleted ? "disabled" : ""} aria-label="${x.name} 的价格">`;
        return `<article class="product-row sortable-row ${deleted ? "is-deleted" : ""}" draggable="true" data-product-id="${x.id}"><span class="drag-handle" title="拖拽排序">⋮⋮</span><div class="product-thumb" style="background:${x.color}">${x.image ? `<img src="${x.image}" alt="">` : x.icon}</div><div><h3>${x.name}${deleted ? " <small>已下架</small>" : ""}</h3><p>${x.note} · ${count ? `${count} 个规格组合` : `库存 ${x.stock}${low ? "（库存不足）" : ""}`}</p></div>${category}${price}<button data-edit="${x.id}">编辑</button><button data-delete="${x.id}" ${deleted ? "hidden" : ""}>删除</button><button data-restore="${x.id}" ${deleted ? "" : "hidden"}>重新上架</button></article>`;
      })
      .join("");
    p.forEach((x) => {
      const select = $(`[data-product-category="${x.id}"]`);
      if (select) select.value = x.type || "未分类";
    });
  }
  async function categories() {
    const c = await data("categories");
    categoryRows = c;
    const legacyList = $("#categoryList");
    if (!legacyList) return c;
    legacyList.innerHTML = c
      .map((x) => {
        const system = x.name === "未分类" || x.is_system;
        return `<span class="category-item ${system ? "system-category" : ""}" draggable="${!system}" data-category-id="${x.id}"><i class="drag-handle">⋮⋮</i>${x.name}${system ? "<small>固定</small>" : `<button data-category="${x.id}">×</button>`}</span>`;
      })
      .join("");
    return c;
  }
  const contentDefaults = {
    heroEyebrow: "今日の小さなごほうび",
    heroTitle: "把喜欢的零食，",
    heroEmphasis: "装进日常里。",
    heroIntro:
      "从童年味道到新鲜人气款，挑一袋让心情变好的中国零食。下单即为您预留，无需在线付款。",
    heroButton: "开始挑选",
    footerHours: "营业时间：每日 10:00 – 21:00",
    footerYear: "2026",
  };
  const imageSettings = [
    ["heroBackgroundImage", "首页插画图片", "hero-snack-illustration-v1.png"],
    ["storyBackgroundImage", "页尾插画图片", "footer-composite-v1.png"],
  ];
  const deliveryContentDefaults = {
      deliveryEyebrow: "LOCAL DELIVERY",
      deliveryTitle: "把零食送到你身边",
      deliveryBackgroundColor: "#f4e9d2",
    },
    deliveryImageKeys = ["deliveryBackgroundImage"];
  const deliveryCopyDefault = (fee, free) =>
    `配送费 ${money(Number(fee || 5))}；商品小计满 ${money(Number(free || 50))} 免费配送。`;
  function resetDeliveryEditor() {
    const form = $("#settingsForm");
    Object.entries(deliveryContentDefaults).forEach(([key, value]) => {
      const input = $(`#${key}Input`);
      if (input) input.value = value;
    });
    const deliveryText = $("#deliveryText");
    if (deliveryText)
      deliveryText.value = deliveryCopyDefault(
        $("#deliveryFeeInput")?.value,
        $("#freeDeliveryInput")?.value,
      );
    deliveryImageKeys.forEach((key) => {
      form.dataset[key] = "";
      const input = $(`#${key}Upload`);
      if (input) input.value = "";
      const preview = $(`#${key}Preview`);
      if (preview) preview.textContent = "默认浅米色背景";
    });
  }
  function setupDeliverySettings(s, content) {
    const form = $("#settingsForm");
    if (!$("#deliveryContentSettings")) {
      const footer = $("#footerContentSettings");
      footer.insertAdjacentHTML(
        "beforebegin",
        `<section id="deliveryContentSettings"><h3>配送区域插画文案</h3><div id="deliveryTextSlot"></div><label>顶部小字<input id="deliveryEyebrowInput"></label><label>标题<input id="deliveryTitleInput"></label><label>背景颜色<input id="deliveryBackgroundColorInput" type="color"></label><label>配送区域背景图片<input id="deliveryBackgroundImageUpload" type="file" accept="image/*"><small>未上传时使用浅米色背景。</small></label><div class="image-preview" id="deliveryBackgroundImagePreview">默认浅米色背景</div><button class="text-btn" type="button" data-remove-delivery-image="deliveryBackgroundImage">恢复默认背景</button></section><hr>`,
      );
      const deliveryLabel = $("#deliveryText")?.closest("label");
      if (deliveryLabel) $("#deliveryTextSlot").append(deliveryLabel);
      deliveryImageKeys.forEach((key) => {
        $(`#${key}Upload`).onchange = async (e) => {
          const file = e.target.files[0];
          if (!file) return;
          try {
            const image = await readOptimizedImage(file, {
              maxDimension: 1920,
              quality: 0.84,
            });
            form.dataset[key] = image;
            $(`#${key}Preview`).innerHTML = `<img src="${image}" alt="">`;
          } catch (error) {
            toast(error.message || "图片读取失败，请重新选择");
          }
        };
      });
      $("#deliveryContentSettings").onclick = (e) => {
        const key = e.target.dataset.removeDeliveryImage;
        if (!key) return;
        form.dataset[key] = "";
        $(`#${key}Upload`).value = "";
        $(`#${key}Preview`).textContent = "默认浅米色背景";
        toast("已恢复默认图片，请点击保存店铺设置");
      };
    }
    Object.entries(deliveryContentDefaults).forEach(([key, fallback]) => {
      const input = $(`#${key}Input`);
      if (input) input.value = content[key] || fallback;
    });
    const deliveryText = $("#deliveryText");
    if (deliveryText)
      deliveryText.value =
        s.delivery?.trim() ||
        deliveryCopyDefault(s.delivery_fee, s.free_delivery_threshold);
    deliveryImageKeys.forEach((key) => {
      const value = content[key] || "";
      form.dataset[key] = value;
      $(`#${key}Preview`).innerHTML = value
        ? `<img src="${value}" alt="">`
        : "默认浅米色背景";
    });
  }
  function resetContentForm() {
    const form = $("#settingsForm");
    Object.entries(contentDefaults).forEach(([key, value]) => {
      const input = $(`#${key}Input`);
      if (input) input.value = value;
    });
    imageSettings.forEach(([key, , fallback]) => {
      form.dataset[key] = "";
      const upload = $(`#${key}Upload`);
      if (upload) upload.value = "";
      const preview = $(`#${key}Preview`);
      if (preview)
        preview.innerHTML = `<img src="${fallback}" alt="默认${key}">`;
    });
    resetDeliveryEditor();
  }
  function setupImageSettings(content) {
    const form = $("#settingsForm");
    if (!$("#imageSettings")) {
      const save = form.querySelector("button.primary");
      save.insertAdjacentHTML(
        "beforebegin",
        `<section id="imageSettings"><hr><h3>网站插画与背景图片</h3><p class="muted">下方显示的是顾客网站当前使用的图片。上传新图后点击“保存店铺设置”即可发布；删除图片会恢复默认设计。</p>${imageSettings.map(([key, label]) => `<label>${label}<input id="${key}Upload" type="file" accept="image/*"><small>建议上传清晰、体积较小的 JPG、PNG 或 WebP 图片。</small></label><div id="${key}Preview" class="image-preview"></div><button class="text-btn" type="button" data-remove-image="${key}">恢复默认图片</button>`).join("")}<button class="text-btn" type="button" id="restoreWebsiteDefaults">恢复默认内容与图片</button></section>`,
      );
      imageSettings.forEach(([key]) => {
        $(`#${key}Upload`).onchange = async (e) => {
          const file = e.target.files[0];
          if (!file) return;
          try {
            const image = await readOptimizedImage(file, {
              maxDimension: 1920,
              quality: 0.84,
            });
            form.dataset[key] = image;
            $(`#${key}Preview`).innerHTML = `<img src="${image}" alt="">`;
          } catch (error) {
            toast(error.message || "图片读取失败，请重新选择");
          }
        };
      });
      $("#imageSettings").onclick = (e) => {
        const key = e.target.dataset.removeImage;
        if (key) {
          form.dataset[key] = "";
          $(`#${key}Upload`).value = "";
          const fallback = imageSettings.find((x) => x[0] === key)[2];
          $(`#${key}Preview`).innerHTML =
            `<img src="${fallback}" alt="默认图片">`;
          toast("已恢复默认图片，请点击保存店铺设置");
          return;
        }
        if (e.target.id === "restoreWebsiteDefaults") {
          if (
            !confirm(
              "恢复默认内容和图片后，会覆盖当前未保存的网页设置。确定继续吗？",
            )
          )
            return;
          resetContentForm();
          form.requestSubmit();
        }
      };
    }
    imageSettings.forEach(([key, , fallback]) => {
      const value = content[key] || "";
      form.dataset[key] = value;
      $(`#${key}Preview`).innerHTML =
        `<img src="${value || fallback}" alt="${value ? "当前图片" : "默认图片"}">`;
    });
  }
  function renderReceivingToggle() {
    const accepting = $('[data-shop-status="accepting"]'),
      paused = $('[data-shop-status="paused"]');
    if (!accepting || !paused) return;
    accepting.classList.toggle("active", isAcceptingOrders);
    paused.classList.toggle("active", !isAcceptingOrders);
    accepting.setAttribute("aria-pressed", String(isAcceptingOrders));
    paused.setAttribute("aria-pressed", String(!isAcceptingOrders));
    paused.textContent = isAcceptingOrders ? "暂停接单" : "● 暂停接单";
    if (isAcceptingOrders) accepting.innerHTML = "<i></i>正在接单";
    if (!isAcceptingOrders && orderPausedUntil)
      paused.title = `将于 ${new Date(orderPausedUntil).toLocaleString("zh-CN", { dateStyle: "medium", timeStyle: "short", hour12: false })} 自动恢复`;
    else paused.removeAttribute("title");
  }
  async function settings() {
    const { data: s } = await db
      .from("shop_settings")
      .select("*")
      .eq("id", 1)
      .single();
    if (s) {
      isAcceptingOrders = s.is_accepting_orders !== false;
      orderPausedUntil = s.order_paused_until || null;
      if (
        !isAcceptingOrders &&
        orderPausedUntil &&
        new Date(orderPausedUntil).getTime() <= Date.now()
      ) {
        await saveReceivingStatus(true, null);
        return;
      }
      $("#shopName").value = s.name;
      $("#shopEnglish").value = s.english;
      $("#deliveryText").value = s.delivery;
      $("#deliveryFeeInput").value = s.delivery_fee ?? 5;
      $("#freeDeliveryInput").value = s.free_delivery_threshold ?? 50;
      $("#taxRateInput").value = s.tax_rate ?? 10.5;
      $("#lowStockInput").value = s.low_stock_threshold ?? 5;
      window.lowStock = s.low_stock_threshold ?? 5;
      const content = { ...contentDefaults, ...(s.content || {}) };
      Object.entries(contentDefaults).forEach(([key, fallback]) => {
        const input = $(`#${key}Input`);
        if (input) input.value = content[key] || fallback;
      });
      setupDeliverySettings(s, content);
      setupImageSettings(content);
      renderReceivingToggle();
    }
  }
  async function openProduct(p) {
    const c = await categories();
    $("#productDialogTitle").textContent = p ? "编辑商品" : "添加商品";
    $("#productId").value = p?.id || "";
    $("#productName").value = p?.name || "";
    $("#productNote").value = p?.note || "";
    $("#productPrice").value = p?.price ?? "";
    $("#productStock").value = p?.stock ?? 100;
    $("#productOut").value = String(!!p?.is_out_of_stock);
    $("#productIcon").value = p?.icon || "🍪";
    $("#productColor").value = p?.color || "#e5c68d";
    $("#productType").innerHTML = c
      .map(
        (x) =>
          `<option ${x.name === p?.type ? "selected" : ""}>${x.name}</option>`,
      )
      .join("");
    $("#imagePreview").innerHTML = p?.image
      ? `<img src="${p.image}">`
      : p?.icon || "🍪";
    $("#productImage").value = "";
    $("#productDialog").dataset.image = p?.image || "";
    await loadSpecs(p?.id);
    $("#productDialog").showModal();
  }
  function login() {
    document.querySelector("aside").style.display = "none";
    $("main").innerHTML =
      `<header><div><p class="eyebrow">OWNER ACCESS</p><h1>店主登录</h1></div></header><section class="panel narrow"><p class="muted">仅店主账号可查看订单和管理网站。</p><form id="loginForm"><label>店主邮箱<input id="loginEmail" type="email" value="${OWNER_EMAIL}" required autocomplete="email"></label><label>密码<input id="loginPassword" type="password" required autocomplete="current-password"></label><button class="primary">登录后台</button><button class="text-btn" type="button" id="resetPassword">设置／忘记密码</button></form></section>`;
    $("#loginForm").onsubmit = async (e) => {
      e.preventDefault();
      const { data, error } = await db.auth.signInWithPassword({
        email: $("#loginEmail").value,
        password: $("#loginPassword").value,
      });
      if (error) return toast("邮箱或密码不正确");
      if (data.user?.email !== OWNER_EMAIL) {
        await db.auth.signOut();
        return toast("此账号没有店主权限");
      }
      location.reload();
    };
    $("#resetPassword").onclick = async () => {
      const { error } = await db.auth.resetPasswordForEmail(
        $("#loginEmail").value,
        { redirectTo: location.href.split("#")[0] },
      );
      toast(
        error ? error.message : "密码设置链接已发送到邮箱，请在同一设备打开。",
      );
    };
  }
  function resetPassword() {
    document.querySelector("aside").style.display = "none";
    $("main").innerHTML =
      `<header><div><p class="eyebrow">OWNER ACCESS</p><h1>设置新密码</h1></div></header><section class="panel narrow"><form id="newPasswordForm"><label>新密码<input id="newPassword" type="password" minlength="8" required autocomplete="new-password"></label><label>再次输入新密码<input id="confirmPassword" type="password" minlength="8" required autocomplete="new-password"></label><button class="primary">保存新密码</button></form></section>`;
    $("#newPasswordForm").onsubmit = async (e) => {
      e.preventDefault();
      if ($("#newPassword").value !== $("#confirmPassword").value)
        return toast("两次输入的密码不一致");
      const { error } = await db.auth.updateUser({
        password: $("#newPassword").value,
      });
      if (error) return toast(error.message);
      history.replaceState({}, "", location.pathname);
      toast("密码已设置，请重新登录");
      await db.auth.signOut();
      setTimeout(() => location.reload(), 900);
    };
  }
  async function boot() {
    await Promise.all([orders(), products(), categories(), settings()]);
    db.channel("order-alert")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "orders" },
        (p) => {
          toast("收到一笔新订单！");
          orders();
        },
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "products" },
        products,
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "categories" },
        categories,
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "shop_settings" },
        settings,
      )
      .subscribe();
  }
  document.querySelectorAll("aside nav button").forEach(
    (b) =>
      (b.onclick = () => {
        document
          .querySelectorAll("aside nav button,.view")
          .forEach((x) => x.classList.remove("active"));
        b.classList.add("active");
        $(`#${b.dataset.view}`).classList.add("active");
        $("#pageTitle").textContent = b.textContent.replace(/\d+/g, "").trim();
      }),
  );
  async function saveOrderUpdate(id, status) {
    const fulfillment = $(`[data-fulfillment="${id}"]`)?.value || "pickup",
      feeInput = $(`[data-fee="${id}"]`),
      deliveryFee =
        fulfillment === "pickup" ? 0 : Math.max(0, +feeInput?.value || 0);
    if (fulfillment === "pickup" && status === "配送中")
      return toast("配送中的订单请先改为已确认，再改为到店自取");
    const { error } = await db.rpc("owner_update_order", {
      p_order_id: id,
      p_status: status,
      p_fulfillment: fulfillment,
      p_delivery_fee: deliveryFee,
    });
    toast(error ? error.message : "订单已更新");
    orders();
  }
  $("#ordersList").onclick = async (e) => {
    const id =
      e.target.dataset.saveOrder ||
      e.target.dataset.approveCancel ||
      e.target.dataset.rejectCancel;
    if (!id) return;
    if (e.target.dataset.rejectCancel) {
      const { error } = await db.rpc("owner_reject_cancellation", {
        p_order_id: id,
      });
      toast(error ? error.message : "已拒绝取消申请");
      return orders();
    }
    if (e.target.dataset.approveCancel) return saveOrderUpdate(id, "已取消");
    if (e.target.dataset.saveOrder) {
      const status = $(`[data-status="${id}"]`)?.value || "待确认";
      return saveOrderUpdate(id, status);
    }
  };
  $("#ordersList").onchange = async (e) => {
    if (e.target.dataset.fulfillment) {
      const id = e.target.dataset.fulfillment,
        fee = $(`[data-fee="${id}"]`);
      if (e.target.value === "pickup") {
        fee.value = "0.00";
        fee.disabled = true;
      } else fee.disabled = false;
      return;
    }
    if (!e.target.dataset.status) return;
    await saveOrderUpdate(e.target.dataset.status, e.target.value);
  };
  document.querySelectorAll("[data-order-tab]").forEach(
    (b) =>
      (b.onclick = () => {
        orderTab = b.dataset.orderTab;
        document
          .querySelectorAll("[data-order-tab]")
          .forEach((x) => x.classList.toggle("active-order-tab", x === b));
        orders();
      }),
  );
  $("#orderSearch").oninput = orders;
  $("#newProduct").onclick = () => openProduct();
  $("#closeProduct").onclick = () => $("#productDialog").close();
  $("#productsList").onclick = async (e) => {
    if (e.target.dataset.edit) {
      const { data: p } = await db
        .from("products")
        .select("*")
        .eq("id", e.target.dataset.edit)
        .single();
      openProduct(p);
    }
  };
  $("#productImage").onchange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const image = await readOptimizedImage(file, {
        maxDimension: 1200,
        quality: 0.82,
      });
      $("#productDialog").dataset.image = image;
      $("#imagePreview").innerHTML = `<img src="${image}">`;
    } catch (error) {
      toast(error.message || "商品图片读取失败，请重新选择");
    }
  };
  let editGroups = [],
    editVariants = {};
  const temp = () => `tmp-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  async function loadSpecs(productId) {
    editGroups = [];
    editVariants = {};
    if (productId) {
      const [g, v, vs] = await Promise.all([
        db
          .from("product_option_groups")
          .select("*")
          .eq("product_id", productId)
          .order("position"),
        db.from("product_option_values").select("*").order("position"),
        db.from("product_variants").select("*").eq("product_id", productId),
      ]);
      editGroups = (g.data || []).map((x) => ({
        ...x,
        client: String(x.id),
        values: (v.data || [])
          .filter((a) => a.group_id === x.id)
          .map((a) => ({ ...a, client: String(a.id) })),
      }));
      (vs.data || []).forEach((x) => (editVariants[x.option_key] = x));
    }
    renderSpecs();
  }
  function combos() {
    return editGroups
      .reduce(
        (a, g) =>
          a.flatMap((x) => g.values.map((v) => [...x, { group: g, value: v }])),
        [[]],
      )
      .filter((x) => x.length === editGroups.length);
  }
  function variantFor(c, key) {
    const direct = editVariants[key];
    if (direct) return direct;
    const ids = c
      .map((x) => String(x.value.id))
      .filter(Boolean)
      .sort()
      .join("|");
    return (
      Object.values(editVariants).find(
        (v) =>
          (v.option_values || [])
            .map((x) => String(x.value_id))
            .sort()
            .join("|") === ids,
      ) || {}
    );
  }
  function renderSpecs() {
    const root = $("#specGroups");
    root.innerHTML = editGroups
      .map(
        (g, gi) =>
          `<section class="spec-group" draggable="true" data-gi="${gi}"><div class="spec-drag">⋮⋮ 拖拽排序规格组</div><div class="two"><label>规格组名称<input data-gname="${gi}" value="${g.name || ""}" placeholder="例如：口味"></label><button type="button" class="text-btn" data-remove-group="${gi}">删除规格组</button></div><div class="spec-values">${g.values.map((v, vi) => `<div class="spec-value" draggable="true" data-gi="${gi}" data-vi="${vi}"><span class="spec-drag">⋮⋮</span><label>规格值<input data-vname="${gi}:${vi}" value="${v.name || ""}" placeholder="例如：橙子味"></label><button type="button" class="text-btn" data-remove-value="${gi}:${vi}">删除</button></div>`).join("")}</div><button type="button" class="text-btn" data-add-value="${gi}">+ 添加规格值</button></section>`,
      )
      .join("");
    const base = +$("#productPrice").value || 0,
      stock = +$("#productStock").value || 100;
    $("#variantsEditor").innerHTML = editGroups.length
      ? `<hr><h3>规格组合</h3><p class="muted">每个组合可设置价格、库存、缺货状态和专属图片；未上传时自动使用商品主图片。</p>${combos()
          .map((c) => {
            const key = c.map((x) => x.value.client).join("-"),
              old = variantFor(c, key),
              label = c.map((x) => x.value.name || "未命名").join(" / ");
            return `<div class="variant-row"><b>${label}</b><input data-vprice="${key}" type="number" min="0" step="0.01" value="${old.price ?? base}" placeholder="价格"><input data-vstock="${key}" type="number" min="0" value="${old.stock ?? stock}" placeholder="库存"><select data-vout="${key}"><option value="false" ${old.is_out_of_stock ? "" : "selected"}>可售</option><option value="true" ${old.is_out_of_stock ? "selected" : ""}>缺货</option></select><label class="variant-image">图片<input data-vimage="${key}" type="file" accept="image/*"><small>${old.image ? "已上传组合图片" : "使用商品主图片"}</small></label>${old.image ? `<button type="button" class="text-btn" data-remove-vimage="${key}">删除图片</button>` : ""}</div>`;
          })
          .join("")}`
      : '<p class="muted">不添加规格组时，顾客直接购买基础商品。</p>';
  }
  $("#addSpecGroup").onclick = () => {
    editGroups.push({ client: temp(), name: "", values: [] });
    renderSpecs();
  };
  $("#specGroups").oninput = (e) => {
    if (e.target.dataset.gname !== undefined)
      editGroups[+e.target.dataset.gname].name = e.target.value;
    if (e.target.dataset.vname) {
      const [g, v] = e.target.dataset.vname.split(":").map(Number);
      editGroups[g].values[v].name = e.target.value;
    }
    renderSpecs();
  };
  $("#specGroups").onclick = (e) => {
    if (e.target.dataset.addValue !== undefined) {
      editGroups[+e.target.dataset.addValue].values.push({
        client: temp(),
        name: "",
      });
      renderSpecs();
    }
    if (
      e.target.dataset.removeGroup !== undefined &&
      confirm("删除规格组会删除相关规格组合、价格、库存和图片。确定继续吗？")
    ) {
      editGroups.splice(+e.target.dataset.removeGroup, 1);
      renderSpecs();
    }
    if (
      e.target.dataset.removeValue &&
      confirm("删除规格值会删除相关规格组合、价格、库存和图片。确定继续吗？")
    ) {
      const [g, v] = e.target.dataset.removeValue.split(":").map(Number);
      editGroups[g].values.splice(v, 1);
      renderSpecs();
    }
  };
  let specDrag = null;
  $("#specGroups").ondragstart = (e) => {
    const value = e.target.closest(".spec-value"),
      group = e.target.closest(".spec-group");
    if (value) {
      specDrag = {
        kind: "value",
        group: +value.dataset.gi,
        index: +value.dataset.vi,
      };
      e.stopPropagation();
    } else if (group) specDrag = { kind: "group", index: +group.dataset.gi };
  };
  $("#specGroups").ondragover = (e) => {
    if (!specDrag) return;
    e.preventDefault();
    const target =
      specDrag.kind === "value"
        ? e.target.closest(".spec-value")
        : e.target.closest(".spec-group");
    if (target) target.classList.add("drag-over");
  };
  $("#specGroups").ondragleave = (e) =>
    e.target.closest(".spec-value,.spec-group")?.classList.remove("drag-over");
  $("#specGroups").ondragend = () => {
    specDrag = null;
    document
      .querySelectorAll(".drag-over")
      .forEach((x) => x.classList.remove("drag-over"));
  };
  $("#specGroups").ondrop = (e) => {
    if (!specDrag) return;
    e.preventDefault();
    const target =
      specDrag.kind === "value"
        ? e.target.closest(".spec-value")
        : e.target.closest(".spec-group");
    if (!target) return;
    if (specDrag.kind === "group") {
      const to = +target.dataset.gi;
      if (to !== specDrag.index) {
        const [item] = editGroups.splice(specDrag.index, 1);
        editGroups.splice(to, 0, item);
      }
    } else {
      const toGroup = +target.dataset.gi,
        to = +target.dataset.vi;
      if (toGroup === specDrag.group && to !== specDrag.index) {
        const [item] = editGroups[toGroup].values.splice(specDrag.index, 1);
        editGroups[toGroup].values.splice(to, 0, item);
      }
    }
    renderSpecs();
  };
  $("#variantsEditor").onchange = async (e) => {
    const key = e.target.dataset.vimage,
      file = e.target.files?.[0];
    if (!key || !file) return;
    try {
      const image = await readOptimizedImage(file, {
        maxDimension: 1200,
        quality: 0.82,
      });
      editVariants[key] = {
        ...(editVariants[key] || {}),
        image,
      };
      renderSpecs();
    } catch (error) {
      toast(error.message || "规格图片读取失败，请重新选择");
    }
  };
  $("#variantsEditor").onclick = (e) => {
    const key = e.target.dataset.removeVimage;
    if (key) {
      editVariants[key] = { ...(editVariants[key] || {}), image: null };
      renderSpecs();
    }
  };
  async function saveSpecs(productId) {
    const liveGroups = [];
    for (let i = 0; i < editGroups.length; i++) {
      let g = editGroups[i];
      if (!g.name.trim()) throw Error("请填写规格组名称");
      let r = g.id
        ? await db
            .from("product_option_groups")
            .update({ name: g.name, position: i })
            .eq("id", g.id)
            .select()
            .single()
        : await db
            .from("product_option_groups")
            .insert({ product_id: productId, name: g.name, position: i })
            .select()
            .single();
      if (r.error) throw r.error;
      g.id = r.data.id;
      for (let j = 0; j < g.values.length; j++) {
        let v = g.values[j];
        if (!v.name.trim()) throw Error("请填写规格值");
        let q = v.id
          ? await db
              .from("product_option_values")
              .update({ name: v.name, position: j })
              .eq("id", v.id)
              .select()
              .single()
          : await db
              .from("product_option_values")
              .insert({ group_id: g.id, name: v.name, position: j })
              .select()
              .single();
        if (q.error) throw q.error;
        v.id = q.data.id;
      }
      liveGroups.push(g);
    }
    const old =
      (
        await db
          .from("product_option_groups")
          .select("id")
          .eq("product_id", productId)
      ).data || [];
    for (const g of old)
      if (!liveGroups.some((x) => x.id === g.id))
        await db.from("product_option_groups").delete().eq("id", g.id);
    const keys = [];
    for (const c of combos()) {
      const clientKey = c.map((x) => x.value.client).join("-"),
        key = c.map((x) => x.value.id).join("-"),
        oldV = variantFor(c, clientKey),
        price = +(
          $(`[data-vprice="${clientKey}"]`)?.value ??
          oldV.price ??
          $("#productPrice").value
        ),
        stock = +(
          $(`[data-vstock="${clientKey}"]`)?.value ??
          oldV.stock ??
          $("#productStock").value
        ),
        out = $(`[data-vout="${clientKey}"]`)?.value === "true";
      keys.push(key);
      const { error } = await db.from("product_variants").upsert(
        {
          product_id: productId,
          option_key: key,
          option_values: c.map((x) => ({
            group_id: x.group.id,
            value_id: x.value.id,
            group: x.group.name,
            name: x.value.name,
          })),
          price,
          stock,
          is_out_of_stock: out,
          image: oldV.image || null,
          position: keys.length,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "product_id,option_key" },
      );
      if (error) throw error;
    }
    if (!keys.length)
      await db.from("product_variants").delete().eq("product_id", productId);
    else {
      const current =
        (
          await db
            .from("product_variants")
            .select("id,option_key")
            .eq("product_id", productId)
        ).data || [];
      for (const v of current)
        if (!keys.includes(v.option_key))
          await db.from("product_variants").delete().eq("id", v.id);
    }
  }
  $("#productForm").onsubmit = async (e) => {
    e.preventDefault();
    const id = $("#productId").value || Date.now(),
      row = {
        id: +id,
        name: $("#productName").value,
        note: $("#productNote").value,
        type: $("#productType").value,
        price: +$("#productPrice").value,
        stock: +$("#productStock").value,
        is_out_of_stock: $("#productOut").value === "true",
        icon: $("#productIcon").value,
        color: $("#productColor").value,
        image: $("#productDialog").dataset.image || null,
        is_active: true,
        updated_at: new Date().toISOString(),
      };
    const { data, error } = await db
      .from("products")
      .upsert(row)
      .select()
      .single();
    if (error) return toast(error.message);
    try {
      await saveSpecs(data.id);
    } catch (err) {
      return toast(err.message);
    }
    $("#productDialog").close();
    toast("商品、规格和库存已保存");
    products();
  };
  $("#categoryForm").onsubmit = async (e) => {
    e.preventDefault();
    const { error } = await db
      .from("categories")
      .insert({ name: $("#categoryName").value.trim() });
    if (error) return toast(error.message);
    $("#categoryName").value = "";
    categories();
  };
  $("#categoryList").onclick = async (e) => {
    if (e.target.dataset.category) {
      const { error } = await db
        .from("categories")
        .delete()
        .eq("id", e.target.dataset.category);
      toast(error ? error.message : "分类已删除");
      categories();
    }
  };
  $("#settingsForm").onsubmit = async (e) => {
    e.preventDefault();
    const form = $("#settingsForm"),
      content = {};
    Object.keys(contentDefaults).forEach((key) => {
      const input = $(`#${key}Input`);
      content[key] = input?.value.trim() || contentDefaults[key];
    });
    Object.keys(deliveryContentDefaults).forEach((key) => {
      const input = $(`#${key}Input`);
      content[key] = input?.value.trim() || deliveryContentDefaults[key];
    });
    imageSettings.forEach(([key]) => (content[key] = form.dataset[key] || ""));
    deliveryImageKeys.forEach(
      (key) => (content[key] = form.dataset[key] || ""),
    );
    const fee = +$("#deliveryFeeInput").value,
      free = +$("#freeDeliveryInput").value,
      delivery =
        $("#deliveryText").value.trim() || deliveryCopyDefault(fee, free);
    const { error } = await db
      .from("shop_settings")
      .update({
        name: $("#shopName").value,
        english: $("#shopEnglish").value,
        delivery,
        delivery_fee: fee,
        free_delivery_threshold: free,
        tax_rate: +$("#taxRateInput").value,
        low_stock_threshold: +$("#lowStockInput").value,
        content,
        updated_at: new Date().toISOString(),
      })
      .eq("id", 1);
    toast(error ? error.message : "店铺设置已保存");
  };
  (async () => {
    if (location.hash.includes("type=recovery")) return resetPassword();
    const {
      data: { session },
    } = await db.auth.getSession();
    if (session?.user?.email === OWNER_EMAIL) return boot();
    if (session) await db.auth.signOut();
    login();
  })();
  eval(
    atob(
      "LyogQ29tcGFjdCwgZXhwYW5kYWJsZSBvd25lciBvcmRlciBjYXJkcy4gKi8KKCgpPT57CiAgY29uc3Qgcm9vdD1kb2N1bWVudC5xdWVyeVNlbGVjdG9yKCcjb3JkZXJzTGlzdCcpOwogIGlmKCFyb290KXJldHVybjsKICBjb25zdCBleHBhbmRlZFN0eWxlPWRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoJ3N0eWxlJyk7CiAgZXhwYW5kZWRTdHlsZS50ZXh0Q29udGVudD0nI29yZGVyc0xpc3Qub3JkZXItY2FyZC1saXN0IC5vcmRlci1jYXJkOm5vdCguaXMtY29sbGFwc2VkKSAub3JkZXItY29tcGFjdHtkaXNwbGF5Om5vbmV9JzsKICBkb2N1bWVudC5oZWFkLmFwcGVuZChleHBhbmRlZFN0eWxlKTsKICBjb25zdCBjbGllbnQ9d2luZG93LnN1cGFiYXNlLmNyZWF0ZUNsaWVudChUSU5HU19TVVBBQkFTRS51cmwsVElOR1NfU1VQQUJBU0UuYW5vbktleSk7CiAgY29uc3QgVD17CiAgICBwZW5kaW5nOidcdTVmODVcdTc4NmVcdThiYTQnLGNvbmZpcm1lZDonXHU1ZGYyXHU3ODZlXHU4YmE0JyxkZWxpdmVyaW5nOidcdTkxNGRcdTkwMDFcdTRlMmQnLGNvbXBsZXRlOidcdTVkZjJcdTViOGNcdTYyMTAnLGNhbmNlbGxlZDonXHU1ZGYyXHU1M2Q2XHU2ZDg4JywKICAgIHByZXBhcmluZzonXHU2YjYzXHU1NzI4XHU1MWM2XHU1OTA3JyxpbkRlbGl2ZXJ5OidcdTZiNjNcdTU3MjhcdTkxNGRcdTkwMDEnLGNvbmZpcm06J1x1Nzg2ZVx1OGJhNFx1OGJhMlx1NTM1NScscGlja3VwOidcdTgxZWFcdTUzZDYnLHdhaXRpbmdQaWNrdXA6J1x1N2I0OVx1NWY4NVx1NTNkNlx1NTM1NScsZGVsaXZlcnk6J1x1OTE0ZFx1OTAwMScsZGV0YWlsczonXHU2N2U1XHU3NzBiXHU4YmU2XHU2MGM1Jyxjb2xsYXBzZTonXHU2NTM2XHU4ZDc3XHU4YmU2XHU2MGM1JywKICAgIHRpbWU6J1x1NGUwYlx1NTM1NVx1NjVmNlx1OTVmNFx1ZmYxYScsY3VzdG9tZXI6J1x1OTg3ZVx1NWJhMlx1NGZlMVx1NjA2ZicsbmFtZTonXHU1OWQzXHU1NDBkJyxwaG9uZTonXHU3NTM1XHU4YmRkJyxhZGRyZXNzOidcdTkxNGRcdTkwMDFcdTU3MzBcdTU3NDAnLGNvcHk6J1x1NTkwZFx1NTIzNlx1NTczMFx1NTc0MCcsCiAgICBpdGVtczonXHU1NTQ2XHU1NGMxXHU4YmU2XHU3ZWM2Jyx2YXJpYW50OidcdTllZDhcdThiYTRcdTg5YzRcdTY4M2MnLG5vSXRlbXM6J1x1NjY4Mlx1NjVlMFx1NTU0Nlx1NTRjMVx1NjYwZVx1N2VjNlx1MzAwMicsc3VidG90YWw6J1x1NTU0Nlx1NTRjMVx1NWMwZlx1OGJhMScsZmVlOidcdTkxNGRcdTkwMDFcdThkMzknLHdhaXZlZDonXHVmZjA4XHU1ZGYyXHU1MWNmXHU1MTRkXHVmZjA5Jyx0YXg6J1x1N2EwZScsdG90YWw6J1x1OGJhMlx1NTM1NVx1NjAzYlx1OTg5ZCcsZGlzY291bnQ6J1x1NWRmMlx1NGYxOFx1NjBlMCcsY291cG9uOidcdTRmMThcdTYwZTBcdTUyMzgnLHJlZmVycmFsOidcdTYzYThcdTgzNTBcdTc4MDEnLGNhbXBhaWduOidcdTZkM2JcdTUyYTgnLGNvbG9uOidcdWZmMWEnLAogICAgY3VzdG9tZXJOb3RlOidcdTk4N2VcdTViYTJcdTU5MDdcdTZjZTgnLG93bmVyTm90ZTonXHU1ZTk3XHU0ZTNiXHU4YmY0XHU2NjBlJyxub3RlUGxhY2Vob2xkZXI6J1x1NTg2Ylx1NTE5OVx1N2VkOVx1OTg3ZVx1NWJhMlx1NzcwYlx1NzY4NFx1OGJhMlx1NTM1NVx1OGJmNFx1NjYwZScsc2F2ZU5vdGU6J1x1NGZkZFx1NWI1OFx1OGJmNFx1NjYwZScsdXBkYXRlZDonXHU2NmY0XHU2NWIwXHU0ZThlXHVmZjFhJywKICAgIGNhbmNlbDonXHU1M2Q2XHU2ZDg4XHU4YmEyXHU1MzU1JyxhcHByb3ZlOidcdTc4NmVcdThiYTRcdTUzZDZcdTZkODgnLHJlamVjdDonXHU2MmQyXHU3ZWRkXHU1M2Q2XHU2ZDg4JyxhcmNoaXZlZDonXHU1ZGYyXHU1ZjUyXHU2ODYzJyxjYW5jZWxSZXF1ZXN0ZWQ6J1x1OTg3ZVx1NWJhMlx1NWRmMlx1NjNkMFx1NGVhNFx1NTNkNlx1NmQ4OFx1NzUzM1x1OGJmN1x1ZmYwY1x1OGJmN1x1NTcyOFx1NTNmM1x1NGUwYlx1NjViOVx1Nzg2ZVx1OGJhNFx1NjIxNlx1NjJkMlx1N2VkZFx1MzAwMicsCiAgICBjb3BpZWQ6J1x1OTE0ZFx1OTAwMVx1NTczMFx1NTc0MFx1NWRmMlx1NTkwZFx1NTIzNicsY29weUZhaWw6J1x1NjVlMFx1NmNkNVx1NTkwZFx1NTIzNlx1NTczMFx1NTc0MFx1ZmYwY1x1OGJmN1x1NjI0Ylx1NTJhOFx1NTkwZFx1NTIzNicsbm90ZVNhdmVkOidcdTVlOTdcdTRlM2JcdThiZjRcdTY2MGVcdTVkZjJcdTRmZGRcdTViNTgnLG9yZGVyVXBkYXRlZDonXHU4YmEyXHU1MzU1XHU1ZGYyXHU2NmY0XHU2NWIwJyxjYW5jZWxDb25maXJtOidcdTc4NmVcdTViOWFcdTg5ODFcdTUzZDZcdTZkODhcdThmZDlcdTdiMTRcdThiYTJcdTUzNTVcdTU0MTdcdWZmMWZcdTUzZDZcdTZkODhcdTU0MGVcdTVlOTNcdTViNThcdTRmMWFcdTgxZWFcdTUyYThcdTYwNjJcdTU5MGRcdTMwMDInLGFwcHJvdmVDb25maXJtOidcdTc4NmVcdTViOWFcdTc4NmVcdThiYTRcdTUzZDZcdTZkODhcdThmZDlcdTdiMTRcdThiYTJcdTUzNTVcdTU0MTdcdWZmMWZcdTVlOTNcdTViNThcdTRmMWFcdTgxZWFcdTUyYThcdTYwNjJcdTU5MGRcdTMwMDInLHJlamVjdERvbmU6J1x1NWRmMlx1NjJkMlx1N2VkZFx1NTNkNlx1NmQ4OFx1NzUzM1x1OGJmNycsaGlzdG9yeTonXHU1Mzg2XHU1M2YyXHU4YmEyXHU1MzU1JyxjdXJyZW50OidcdTVmNTNcdTUyNGRcdThiYTJcdTUzNTUnLGVtcHR5OidcdTZjYTFcdTY3MDlcdTdiMjZcdTU0MDhcdTY3NjFcdTRlZjZcdTc2ODRcdThiYTJcdTUzNTVcdTMwMDInCiAgfTsKICBjb25zdCBlc2M9dj0+U3RyaW5nKHY/PycnKS5yZXBsYWNlKC9bJjw+Il0vZyxjPT4oeycmJzonJmFtcDsnLCc8JzonJmx0OycsJz4nOicmZ3Q7JywnIic6JyZxdW90Oyd9W2NdKSk7CiAgY29uc3QgY2FzaD12PT4nJCcrTnVtYmVyKHZ8fDApLnRvRml4ZWQoMik7CiAgY29uc3QgdGltZT12PT52P25ldyBJbnRsLkRhdGVUaW1lRm9ybWF0KCd6aC1DTicse3RpbWVab25lOidBbWVyaWNhL0NoaWNhZ28nLGRhdGVTdHlsZTonbWVkaXVtJyx0aW1lU3R5bGU6J3Nob3J0Jyxob3VyMTI6ZmFsc2V9KS5mb3JtYXQobmV3IERhdGUodikpOicnOwogIGNvbnN0IHRhYj0oKT0+ZG9jdW1lbnQucXVlcnlTZWxlY3RvcignW2RhdGEtb3JkZXItdGFiXS5hY3RpdmUtb3JkZXItdGFiJyk/LmRhdGFzZXQub3JkZXJUYWJ8fCdjdXJyZW50JzsKICBjb25zdCBzdGFnZT14PT54LnN0YXR1cz09PVQuY29uZmlybWVkP1QucHJlcGFyaW5nOnguc3RhdHVzPT09VC53YWl0aW5nUGlja3VwP1Qud2FpdGluZ1BpY2t1cDp4LnN0YXR1cz09PVQuZGVsaXZlcmluZz9ULmluRGVsaXZlcnk6eC5zdGF0dXM7CiAgY29uc3QgbmV4dD14PT54LnN0YXR1cz09PVQucGVuZGluZz97bGFiZWw6VC5jb25maXJtLHRhcmdldDpULmNvbmZpcm1lZCxraW5kOicnfTp4LnN0YXR1cz09PVQuY29uZmlybWVkP3tsYWJlbDpULnByZXBhcmluZyx0YXJnZXQ6eC5mdWxmaWxsbWVudD09PSdkZWxpdmVyeSc/VC5kZWxpdmVyaW5nOlQud2FpdGluZ1BpY2t1cCxraW5kOidwcmVwYXJlJ306eC5zdGF0dXM9PT1ULndhaXRpbmdQaWNrdXA/e2xhYmVsOlQud2FpdGluZ1BpY2t1cCx0YXJnZXQ6VC5jb21wbGV0ZSxraW5kOidwaWNrdXAnfTp4LnN0YXR1cz09PVQuZGVsaXZlcmluZz97bGFiZWw6VC5pbkRlbGl2ZXJ5LHRhcmdldDpULmNvbXBsZXRlLGtpbmQ6J2RlbGl2ZXJpbmcnfTpudWxsOwogIGNvbnN0IGNvbG9yPXg9Pnguc3RhdHVzPT09VC5wZW5kaW5nPyh4LmZ1bGZpbGxtZW50PT09J3BpY2t1cCc/J3BlbmRpbmctcGlja3VwJzoncGVuZGluZy1kZWxpdmVyeScpOicnOwogIGNvbnN0IGl0ZW09aT0+ewogICAgY29uc3QgcXR5PU51bWJlcihpLnF0eXx8MSkscHJpY2U9TnVtYmVyKGkucHJpY2U/P2kudW5pdF9wcmljZT8/MCksdG90YWw9TnVtYmVyKGkudG90YWw/P2kuc3VidG90YWw/P3ByaWNlKnF0eSksaW1hZ2U9aS5pbWFnZXx8aS5wcm9kdWN0X2ltYWdlfHwnJzsKICAgIGNvbnN0IHRodW1iPWltYWdlPyc8aW1nIHNyYz0iJytlc2MoaW1hZ2UpKyciIGFsdD0iIj4nOicmIzEyNzg1MjsnOwogICAgcmV0dXJuICc8ZGl2IGNsYXNzPSJvcmRlci1pdGVtLWRldGFpbCI+PGRpdiBjbGFzcz0ib3JkZXItaXRlbS10aHVtYiI+Jyt0aHVtYisnPC9kaXY+PGRpdiBjbGFzcz0ib3JkZXItaXRlbS1tYWluIj48Yj4nK2VzYyhpLm5hbWV8fFQuaXRlbXMpKyc8L2I+PHNtYWxsPiAnK2VzYyhpLnZhcmlhbnRfbGFiZWx8fGkub3B0aW9uX2xhYmVsfHxULnZhcmlhbnQpKycgPHNwYW4gY2xhc3M9Im9yZGVyLWl0ZW0tcXR5Ij4mdGltZXM7ICcrcXR5Kyc8L3NwYW4+PC9zbWFsbD48L2Rpdj48c3BhbiBjbGFzcz0ib3JkZXItaXRlbS1wcmljZSI+JytjYXNoKHRvdGFsKSsnPC9zcGFuPjwvZGl2Pic7CiAgfTsKICBjb25zdCBjb21wYWN0SXRlbXM9eD0+KHguaXRlbXN8fFtdKS5tYXAoaT0+ZXNjKGkubmFtZXx8VC5pdGVtcykrKGkudmFyaWFudF9sYWJlbD8nICcrZXNjKGkudmFyaWFudF9sYWJlbCk6JycpKycgJnRpbWVzOyAnK051bWJlcihpLnF0eXx8MSkpLmpvaW4oJzsgJyl8fFQubm9JdGVtczsKICBjb25zdCBjYXJkPXg9PnsKICAgIGNvbnN0IGRlbGl2ZXJ5PXguZnVsZmlsbG1lbnQ9PT0nZGVsaXZlcnknLGFjdGlvbj1uZXh0KHgpLGN1c3RvbWVyTm90ZT1TdHJpbmcoeC5jdXN0b21lcl9ub3RlPz94Lm5vdGU/P3gub3JkZXJfbm90ZT8/JycpLnRyaW0oKSxpdGVtcz0oeC5pdGVtc3x8W10pLm1hcChpdGVtKS5qb2luKCcnKXx8JzxwIGNsYXNzPSJtdXRlZCI+JytULm5vSXRlbXMrJzwvcD4nLHNuYXBzaG90PXgucHJvbW90aW9uX3NuYXBzaG90fHx7fSxjYW1wYWlnbk5hbWU9U3RyaW5nKHNuYXBzaG90LmNhbXBhaWduX25hbWV8fCgoeC5wcm9tb3Rpb25fa2luZCYmIVsnY291cG9uJywncmVmZXJyYWwnXS5pbmNsdWRlcyh4LnByb21vdGlvbl9raW5kKSk/eC5wcm9tb3Rpb25fbmFtZTonJyl8fCcnKS50cmltKCksY29kZUtpbmQ9c25hcHNob3QuY29kZV9raW5kfHwoeC5wcm9tb3Rpb25fa2luZD09PSdyZWZlcnJhbCc/J3JlZmVycmFsJzooeC5jb3Vwb25fY29kZT8nY291cG9uJzonJykpLGNvZGU9U3RyaW5nKHguY291cG9uX2NvZGV8fHNuYXBzaG90LmNvZGV8fCcnKS50cmltKCksY29kZU5hbWU9U3RyaW5nKHNuYXBzaG90LmNvZGVfbmFtZXx8JycpLnRyaW0oKSxkaXNjb3VudEFtb3VudD1NYXRoLm1heCgwLE51bWJlcih4LmRpc2NvdW50X2Ftb3VudHx8MCkpLGZlZVJvdz1kZWxpdmVyeT8nPHA+PHNwYW4+JytULmZlZSsnPC9zcGFuPjxzcGFuIGNsYXNzPSJmZWUtdmFsdWUiPicrKE51bWJlcih4LmRlbGl2ZXJ5X2ZlZXx8MCk9PT0wPyc8c21hbGw+JytULndhaXZlZCsnPC9zbWFsbD4nOicnKSsnPGI+JytjYXNoKHguZGVsaXZlcnlfZmVlKSsnPC9iPjwvc3Bhbj48L3A+JzonJyxwcm9tb3Rpb25UYWdzPSgoY29kZXx8Y29kZU5hbWUpPyc8c3BhbiBjbGFzcz0icHJvbW90aW9uLXRhZyI+JysoY29kZUtpbmQ9PT0ncmVmZXJyYWwnP1QucmVmZXJyYWw6VC5jb3Vwb24pK1QuY29sb24rZXNjKGNvZGV8fGNvZGVOYW1lKSsnPC9zcGFuPic6JycpKyhjYW1wYWlnbk5hbWU/JzxzcGFuIGNsYXNzPSJwcm9tb3Rpb24tdGFnIj4nK1QuY2FtcGFpZ24rVC5jb2xvbitlc2MoY2FtcGFpZ25OYW1lKSsnPC9zcGFuPic6JycpOwogICAgY29uc3QgYWRkcmVzcz1kZWxpdmVyeSYmeC5hZGRyZXNzPyc8ZGl2PjxzcGFuPicrVC5hZGRyZXNzKyc8L3NwYW4+PGRpdiBjbGFzcz0iY3VzdG9tZXItYWRkcmVzcyI+PGI+Jytlc2MoeC5hZGRyZXNzKSsnPC9iPjxidXR0b24gY2xhc3M9InRleHQtYnRuIiBkYXRhLWNhcmQtY29weT0iJyt4LmlkKyciIGRhdGEtYWRkcmVzcz0iJytlbmNvZGVVUklDb21wb25lbnQoeC5hZGRyZXNzKSsnIj4nK1QuY29weSsnPC9idXR0b24+PC9kaXY+PC9kaXY+JzonJzsKICAgIGNvbnN0IHNlbGVjdD14LmFyY2hpdmVkPyc8c3BhbiBjbGFzcz0ic3RhdHVzLXN0YWdlIj4nKyhkZWxpdmVyeT8nJiMxMjg2NjM7ICc6JyYjMTI4NzE3OyAnKSsoZGVsaXZlcnk/VC5kZWxpdmVyeTpULnBpY2t1cCkrJzwvc3Bhbj4nOic8c2VsZWN0IGNsYXNzPSJmdWxmaWxsbWVudC1zZWxlY3QiIGRhdGEtY2FyZC1mdWxmaWxsbWVudD0iJyt4LmlkKyciPjxvcHRpb24gdmFsdWU9InBpY2t1cCIgJysoZGVsaXZlcnk/Jyc6J3NlbGVjdGVkJykrJz4mIzEyODcxNzsgJytULnBpY2t1cCsnPC9vcHRpb24+PG9wdGlvbiB2YWx1ZT0iZGVsaXZlcnkiICcrKGRlbGl2ZXJ5PydzZWxlY3RlZCc6JycpKyc+JiMxMjg2NjM7ICcrVC5kZWxpdmVyeSsnPC9vcHRpb24+PC9zZWxlY3Q+JzsKICAgIGNvbnN0IHN0YWZmPSc8ZGl2IGNsYXNzPSJzdGFmZi1ub3RlLWVkaXRvciI+PGxhYmVsPicrVC5vd25lck5vdGUrJzx0ZXh0YXJlYSBkYXRhLWNhcmQtbm90ZT0iJyt4LmlkKyciIHJvd3M9IjEiIHBsYWNlaG9sZGVyPSInK1Qubm90ZVBsYWNlaG9sZGVyKyciPicrZXNjKHguc3RhZmZfbm90ZXx8JycpKyc8L3RleHRhcmVhPjwvbGFiZWw+PGJ1dHRvbiBkYXRhLWNhcmQtc2F2ZS1ub3RlPSInK3guaWQrJyI+JytULnNhdmVOb3RlKyc8L2J1dHRvbj4nKyh4LnN0YWZmX25vdGVfdXBkYXRlZF9hdD8nPHNtYWxsPicrVC51cGRhdGVkK3RpbWUoeC5zdGFmZl9ub3RlX3VwZGF0ZWRfYXQpKyc8L3NtYWxsPic6JycpKyc8L2Rpdj4nOwogICAgY29uc3QgY2FuY2VsPXguYXJjaGl2ZWQ/JzxzcGFuIGNsYXNzPSJtdXRlZCI+JytULmFyY2hpdmVkKyc8L3NwYW4+Jzp4LmNhbmNlbGxhdGlvbl9yZXF1ZXN0ZWQ/JzxidXR0b24gY2xhc3M9ImFwcHJvdmUtY2FuY2VsIiBkYXRhLWNhcmQtYXBwcm92ZT0iJyt4LmlkKyciPicrVC5hcHByb3ZlKyc8L2J1dHRvbj48YnV0dG9uIGRhdGEtY2FyZC1yZWplY3Q9IicreC5pZCsnIj4nK1QucmVqZWN0Kyc8L2J1dHRvbj4nOic8YnV0dG9uIGRhdGEtY2FyZC1jYW5jZWw9IicreC5pZCsnIj4nK1QuY2FuY2VsKyc8L2J1dHRvbj4nOwogICAgY29uc3QgZGV0YWlsPSc8ZGl2IGNsYXNzPSJvcmRlci1kZXRhaWwiPjxzZWN0aW9uIGNsYXNzPSJjYXJkLXNlY3Rpb24iPjxwIGNsYXNzPSJjYXJkLWxhYmVsIj4nK1QuY3VzdG9tZXIrJzwvcD48ZGl2IGNsYXNzPSJjdXN0b21lci1kZXRhaWxzIj48ZGl2PjxzcGFuPicrVC5uYW1lKyc8L3NwYW4+PGI+Jytlc2MoeC5jdXN0b21lcl9uYW1lKSsnPC9iPjwvZGl2PjxkaXY+PHNwYW4+JytULnBob25lKyc8L3NwYW4+PGI+Jytlc2MoeC5waG9uZSkrJzwvYj48L2Rpdj4nK2FkZHJlc3MrJzwvZGl2Pjwvc2VjdGlvbj48c2VjdGlvbiBjbGFzcz0iY2FyZC1zZWN0aW9uIj48cCBjbGFzcz0iY2FyZC1sYWJlbCI+JytULml0ZW1zKyc8L3A+PGRpdiBjbGFzcz0ib3JkZXItaXRlbXMtZGV0YWlsIj4nK2l0ZW1zKyc8L2Rpdj48L3NlY3Rpb24+PHNlY3Rpb24gY2xhc3M9ImNhcmQtc2VjdGlvbiI+PGRpdiBjbGFzcz0iY2FyZC10b3RhbHMiPjxwPjxzcGFuPicrVC5zdWJ0b3RhbCsnPC9zcGFuPjxzcGFuPicrY2FzaCh4LnN1YnRvdGFsKSsnPC9zcGFuPjwvcD4nKyhkaXNjb3VudEFtb3VudD4wfHxwcm9tb3Rpb25UYWdzPyc8cCBjbGFzcz0iZGlzY291bnQtcm93Ij48c3BhbiBjbGFzcz0icHJvbW90aW9uLXRhZ3MiPicrcHJvbW90aW9uVGFncysnPC9zcGFuPjxzcGFuIGNsYXNzPSJkaXNjb3VudC1hbW91bnQiPjxzcGFuPicrVC5kaXNjb3VudCsnPC9zcGFuPjxzcGFuPi0nK2Nhc2goZGlzY291bnRBbW91bnQpKyc8L3NwYW4+PC9zcGFuPjwvcD4nOicnKSsnJytmZWVSb3crJzxwPjxzcGFuPicrVC50YXgrJzwvc3Bhbj48c3Bhbj4nK2Nhc2goeC50YXhfYW1vdW50KSsnPC9zcGFuPjwvcD48cD48c3Bhbj4nK1QudG90YWwrJzwvc3Bhbj48c3Bhbj4nK2Nhc2goeC50b3RhbF9hbW91bnQ/P3guc3VidG90YWwpKyc8L3NwYW4+PC9wPjwvZGl2Pjwvc2VjdGlvbj4nKyhjdXN0b21lck5vdGU/JzxzZWN0aW9uIGNsYXNzPSJjYXJkLXNlY3Rpb24iPjxwIGNsYXNzPSJjYXJkLWxhYmVsIj4nK1QuY3VzdG9tZXJOb3RlKyc8L3A+PHAgY2xhc3M9ImN1c3RvbWVyLW5vdGUiPicrZXNjKGN1c3RvbWVyTm90ZSkrJzwvcD48L3NlY3Rpb24+JzonJykrJzxzZWN0aW9uIGNsYXNzPSJjYXJkLXNlY3Rpb24iPicrc3RhZmYrJzwvc2VjdGlvbj48L2Rpdj4nOwogICAgcmV0dXJuICc8YXJ0aWNsZSBjbGFzcz0ib3JkZXItY2FyZCBpcy1jb2xsYXBzZWQgJytjb2xvcih4KSsnIiBkYXRhLW9yZGVyLWlkPSInK3guaWQrJyIgZGF0YS1vcmRlci1zdGF0dXM9IicrZXNjKHguc3RhdHVzKSsnIiBkYXRhLWRlbGl2ZXJ5LWZlZT0iJytOdW1iZXIoeC5kZWxpdmVyeV9mZWV8fDApKyciPjxkaXYgY2xhc3M9Im9yZGVyLXRvcCI+PGRpdj48ZGl2IGNsYXNzPSJvcmRlci10aXRsZS13cmFwIj48aDM+Jytlc2MoeC5vcmRlcl9udW1iZXIpKyc8L2gzPjxzcGFuIGNsYXNzPSJzdGF0dXMtc3RhZ2UiPicrZXNjKHN0YWdlKHgpKSsnPC9zcGFuPicrc2VsZWN0Kyc8L2Rpdj48cCBjbGFzcz0ib3JkZXItdGltZSI+JytULnRpbWUrdGltZSh4LmNyZWF0ZWRfYXQpKyc8L3A+PC9kaXY+JysoYWN0aW9uJiYheC5hcmNoaXZlZD8nPGJ1dHRvbiBjbGFzcz0iYWR2YW5jZS1vcmRlciAnK2FjdGlvbi5raW5kKyciIGRhdGEtY2FyZC1hZHZhbmNlPSInK3guaWQrJyIgZGF0YS10YXJnZXQ9IicrYWN0aW9uLnRhcmdldCsnIj4nK2FjdGlvbi5sYWJlbCsnPC9idXR0b24+JzonJykrJzwvZGl2PicrKHguY2FuY2VsbGF0aW9uX3JlcXVlc3RlZD8nPHAgY2xhc3M9ImNhbmNlbGxhdGlvbi1hbGVydCI+JytULmNhbmNlbFJlcXVlc3RlZCsnPC9wPic6JycpKyc8ZGl2IGNsYXNzPSJvcmRlci1jb21wYWN0Ij48cCBjbGFzcz0iY29tcGFjdC1pdGVtcyI+Jytjb21wYWN0SXRlbXMoeCkrJzwvcD48ZGl2IGNsYXNzPSJjb21wYWN0LW1ldGEiPjxzcGFuPicrZXNjKHguY3VzdG9tZXJfbmFtZSkrJyAnK2VzYyh4LnBob25lKSsnPC9zcGFuPjxiPicrY2FzaCh4LnRvdGFsX2Ftb3VudD8/eC5zdWJ0b3RhbCkrJzwvYj48L2Rpdj48L2Rpdj4nK2RldGFpbCsnPGRpdiBjbGFzcz0ib3JkZXItZm9vdGVyIj48YnV0dG9uIGNsYXNzPSJkZXRhaWwtdG9nZ2xlIiBkYXRhLWNhcmQtdG9nZ2xlPSInK3guaWQrJyI+JytULmRldGFpbHMrJzwvYnV0dG9uPjxkaXYgY2xhc3M9Im9yZGVyLWZvb3Rlci1yaWdodCI+JytjYW5jZWwrJzwvZGl2PjwvZGl2PjwvYXJ0aWNsZT4nOwogIH07CiAgY29uc3QgcmVuZGVyPWFzeW5jKCk9PnsKICAgIGNvbnN0IGFsbD1hd2FpdCBkYXRhKCdvcmRlcnMnKSxzZWxlY3RlZD10YWIoKSxxdWVyeT0oJCgnI29yZGVyU2VhcmNoJyk/LnZhbHVlfHwnJykudHJpbSgpLnRvTG93ZXJDYXNlKCk7CiAgICBjb25zdCBsaXN0PWFsbC5maWx0ZXIoeD0+KHNlbGVjdGVkPT09J2hpc3RvcnknKT09PSEheC5hcmNoaXZlZCkuZmlsdGVyKHg9PiFxdWVyeXx8W3gub3JkZXJfbnVtYmVyLHguY3VzdG9tZXJfbmFtZSx4LnBob25lLHRpbWUoeC5jcmVhdGVkX2F0KV0uam9pbignICcpLnRvTG93ZXJDYXNlKCkuaW5jbHVkZXMocXVlcnkpKTsKICAgICQoJyNvcmRlcnNUaXRsZScpLnRleHRDb250ZW50PXNlbGVjdGVkPT09J2hpc3RvcnknP1QuaGlzdG9yeTpULmN1cnJlbnQ7CiAgICAkKCcjYWxsT3JkZXJzJykudGV4dENvbnRlbnQ9YWxsLmZpbHRlcih4PT4heC5hcmNoaXZlZCkubGVuZ3RoOwogICAgJCgnI25ld09yZGVycycpLnRleHRDb250ZW50PWFsbC5maWx0ZXIoeD0+eC5zdGF0dXM9PT1ULnBlbmRpbmcmJiF4LmFyY2hpdmVkKS5sZW5ndGg7CiAgICAkKCcjb3JkZXJCYWRnZScpLnRleHRDb250ZW50PWFsbC5maWx0ZXIoeD0+eC5zdGF0dXM9PT1ULnBlbmRpbmcmJiF4LmFyY2hpdmVkKS5sZW5ndGg7CiAgICAkKCcjdG9kYXlBbW91bnQnKS50ZXh0Q29udGVudD1tb25leShhbGwuZmlsdGVyKHg9PiF4LmFyY2hpdmVkKS5yZWR1Y2UoKHN1bSx4KT0+c3VtK051bWJlcih4LnRvdGFsX2Ftb3VudHx8eC5zdWJ0b3RhbHx8MCksMCkpOwogICAgcm9vdC5jbGFzc0xpc3QuYWRkKCdvcmRlci1jYXJkLWxpc3QnKTsKICAgIHJvb3QuaW5uZXJIVE1MPWxpc3QubWFwKGNhcmQpLmpvaW4oJycpfHwnPHAgY2xhc3M9Im11dGVkIj4nK1QuZW1wdHkrJzwvcD4nOwogICAgcm9vdC5xdWVyeVNlbGVjdG9yQWxsKCd0ZXh0YXJlYVtkYXRhLWNhcmQtbm90ZV0nKS5mb3JFYWNoKGZpZWxkPT57ZmllbGQuc3R5bGUuaGVpZ2h0PSdhdXRvJztmaWVsZC5zdHlsZS5oZWlnaHQ9TWF0aC5tYXgoNDAsZmllbGQuc2Nyb2xsSGVpZ2h0KSsncHgnfSk7CiAgfTsKICBjb25zdCBzYXZlPWFzeW5jKG5vZGUsc3RhdHVzLGZ1bGZpbGxtZW50KT0+ewogICAgY29uc3QgZmVlPWZ1bGZpbGxtZW50PT09J3BpY2t1cCc/MDpOdW1iZXIobm9kZS5kYXRhc2V0LmRlbGl2ZXJ5RmVlfHwwKTsKICAgIGNvbnN0IHJlc3VsdD1hd2FpdCBjbGllbnQucnBjKCdvd25lcl91cGRhdGVfb3JkZXInLHtwX29yZGVyX2lkOm5vZGUuZGF0YXNldC5vcmRlcklkLHBfc3RhdHVzOnN0YXR1cyxwX2Z1bGZpbGxtZW50OmZ1bGZpbGxtZW50LHBfZGVsaXZlcnlfZmVlOmZlZX0pOwogICAgdG9hc3QocmVzdWx0LmVycm9yP3Jlc3VsdC5lcnJvci5tZXNzYWdlOlQub3JkZXJVcGRhdGVkKTsKICAgIGlmKCFyZXN1bHQuZXJyb3IpcmVuZGVyKCk7CiAgfTsKICByb290LmFkZEV2ZW50TGlzdGVuZXIoJ2lucHV0JyxlPT57aWYoZS50YXJnZXQubWF0Y2hlcygndGV4dGFyZWFbZGF0YS1jYXJkLW5vdGVdJykpe2UudGFyZ2V0LnN0eWxlLmhlaWdodD0nYXV0byc7ZS50YXJnZXQuc3R5bGUuaGVpZ2h0PU1hdGgubWF4KDQwLGUudGFyZ2V0LnNjcm9sbEhlaWdodCkrJ3B4J319KTsKICByb290LmFkZEV2ZW50TGlzdGVuZXIoJ2NoYW5nZScsZT0+e2lmKCFlLnRhcmdldC5kYXRhc2V0LmNhcmRGdWxmaWxsbWVudClyZXR1cm47Y29uc3Qgbm9kZT1lLnRhcmdldC5jbG9zZXN0KCcub3JkZXItY2FyZCcpO3NhdmUobm9kZSxub2RlLmRhdGFzZXQub3JkZXJTdGF0dXMsZS50YXJnZXQudmFsdWUpfSk7CiAgcm9vdC5hZGRFdmVudExpc3RlbmVyKCdjbGljaycsYXN5bmMgZT0+ewogICAgY29uc3Qgbm9kZT1lLnRhcmdldC5jbG9zZXN0KCcub3JkZXItY2FyZCcpO2lmKCFub2RlKXJldHVybjsKICAgIGNvbnN0IGlkPW5vZGUuZGF0YXNldC5vcmRlcklkLGZ1bGZpbGxtZW50PW5vZGUucXVlcnlTZWxlY3RvcignW2RhdGEtY2FyZC1mdWxmaWxsbWVudF0nKT8udmFsdWV8fCdwaWNrdXAnOwogICAgaWYoZS50YXJnZXQuZGF0YXNldC5jYXJkVG9nZ2xlKXtjb25zdCBjb2xsYXBzZWQ9bm9kZS5jbGFzc0xpc3QudG9nZ2xlKCdpcy1jb2xsYXBzZWQnKTtlLnRhcmdldC50ZXh0Q29udGVudD1jb2xsYXBzZWQ/VC5kZXRhaWxzOlQuY29sbGFwc2U7cmV0dXJufQogICAgaWYoZS50YXJnZXQuZGF0YXNldC5jYXJkQ29weSl7dHJ5e2F3YWl0IG5hdmlnYXRvci5jbGlwYm9hcmQud3JpdGVUZXh0KGRlY29kZVVSSUNvbXBvbmVudChlLnRhcmdldC5kYXRhc2V0LmFkZHJlc3N8fCcnKSk7dG9hc3QoVC5jb3BpZWQpfWNhdGNoe3RvYXN0KFQuY29weUZhaWwpfXJldHVybn0KICAgIGlmKGUudGFyZ2V0LmRhdGFzZXQuY2FyZFNhdmVOb3RlKXtjb25zdCBmaWVsZD1ub2RlLnF1ZXJ5U2VsZWN0b3IoJ1tkYXRhLWNhcmQtbm90ZV0nKTtjb25zdCByZXN1bHQ9YXdhaXQgY2xpZW50LnJwYygnb3duZXJfdXBkYXRlX29yZGVyX25vdGUnLHtwX29yZGVyX2lkOmlkLHBfc3RhZmZfbm90ZTpmaWVsZD8udmFsdWV8fCcnfSk7dG9hc3QocmVzdWx0LmVycm9yP3Jlc3VsdC5lcnJvci5tZXNzYWdlOlQubm90ZVNhdmVkKTtpZighcmVzdWx0LmVycm9yKXJlbmRlcigpO3JldHVybn0KICAgIGlmKGUudGFyZ2V0LmRhdGFzZXQuY2FyZEFkdmFuY2UpcmV0dXJuIHNhdmUobm9kZSxlLnRhcmdldC5kYXRhc2V0LnRhcmdldCxmdWxmaWxsbWVudCk7CiAgICBpZihlLnRhcmdldC5kYXRhc2V0LmNhcmRDYW5jZWwpe2lmKGNvbmZpcm0oVC5jYW5jZWxDb25maXJtKSlyZXR1cm4gc2F2ZShub2RlLFQuY2FuY2VsbGVkLGZ1bGZpbGxtZW50KTtyZXR1cm59CiAgICBpZihlLnRhcmdldC5kYXRhc2V0LmNhcmRBcHByb3ZlKXtpZihjb25maXJtKFQuYXBwcm92ZUNvbmZpcm0pKXJldHVybiBzYXZlKG5vZGUsVC5jYW5jZWxsZWQsZnVsZmlsbG1lbnQpO3JldHVybn0KICAgIGlmKGUudGFyZ2V0LmRhdGFzZXQuY2FyZFJlamVjdCl7Y29uc3QgcmVzdWx0PWF3YWl0IGNsaWVudC5ycGMoJ293bmVyX3JlamVjdF9jYW5jZWxsYXRpb24nLHtwX29yZGVyX2lkOmlkfSk7dG9hc3QocmVzdWx0LmVycm9yP3Jlc3VsdC5lcnJvci5tZXNzYWdlOlQucmVqZWN0RG9uZSk7aWYoIXJlc3VsdC5lcnJvcilyZW5kZXIoKX0KICB9KTsKICBzZXRUaW1lb3V0KCgpPT57b3JkZXJzPXJlbmRlcjtyZW5kZXIoKX0sMCk7Cn0pKCk7Cg==",
    ),
  );
};
startAdmin();
(() => {
  const defaults = {
    address: "天河城二楼，Archer Ave",
    note: "请到天河城二楼取货；每日 10:00–22:00",
  };
  const setup = async () => {
    if (
      !window.supabase ||
      !window.TINGS_SUPABASE ||
      !document.querySelector("#settingsForm")
    )
      return setTimeout(setup, 120);
    const form = document.querySelector("#settingsForm");
    if (document.querySelector("#pickupSettings")) return;
    const basicEnd = form.querySelector("hr");
    basicEnd.insertAdjacentHTML(
      "beforebegin",
      `<section id="pickupSettings"><h3>到店自取信息</h3><label>自取地址<input id="pickupAddressInput" required></label><label>自取说明／营业时间<textarea id="pickupNoteInput" rows="3" required></textarea></label></section>`,
    );
    const db = window.supabase.createClient(
      TINGS_SUPABASE.url,
      TINGS_SUPABASE.anonKey,
    );
    const { data } = await db
      .from("shop_settings")
      .select("pickup_address,pickup_note")
      .eq("id", 1)
      .maybeSingle();
    document.querySelector("#pickupAddressInput").value =
      data?.pickup_address || defaults.address;
    document.querySelector("#pickupNoteInput").value =
      data?.pickup_note || defaults.note;
    form.addEventListener("submit", async () => {
      const { error } = await db
        .from("shop_settings")
        .update({
          pickup_address:
            document.querySelector("#pickupAddressInput").value.trim() ||
            defaults.address,
          pickup_note:
            document.querySelector("#pickupNoteInput").value.trim() ||
            defaults.note,
          updated_at: new Date().toISOString(),
        })
        .eq("id", 1);
      if (error) console.error(error);
    });
  };
  setup();
})();
