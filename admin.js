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
  let productRows = [],
    categoryRows = [],
    isAcceptingOrders = true,
    orderPausedUntil = null,
    boot = async () => {};
  // Order cards, filtering, notes, cancellation and status controls are owned
  // by order-cards.js. Keep this hook limited to alerts and shared admin data.
  queueMicrotask(() => {
    const head = $("#orders .panel-head");
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
    boot = async function () {
      await settings();
      db.channel("order-alert-v2")
        .on(
          "postgres_changes",
          { event: "INSERT", schema: "public", table: "orders" },
          (p) => {
            if (p.new?.status === "待确认") {
              toast("收到一笔新订单！");
              announce(p.new);
            }
            window.orders?.();
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
    ["heroBackgroundImage", "首页插画", "hero-snack-illustration-v1.webp"],
    ["storyBackgroundImage", "页尾插画", "footer-composite-v1.webp"],
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
        `<section id="deliveryContentSettings"><h3>配送区域文案</h3><div id="deliveryTextSlot"></div><label>顶部小字<input id="deliveryEyebrowInput"></label><label>标题<input id="deliveryTitleInput"></label><label>配送区域插画<input id="deliveryBackgroundImageUpload" type="file" accept="image/*"></label><div class="image-preview" id="deliveryBackgroundImagePreview">默认浅米色背景</div><button class="text-btn" type="button" data-remove-delivery-image="deliveryBackgroundImage">恢复默认背景</button></section><hr>`,
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
    window.finishAdminBoot?.();
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
    window.finishAdminBoot?.();
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
  const logoutButton = $("#adminLogout");
  if (logoutButton)
    logoutButton.onclick = async () => {
      logoutButton.disabled = true;
      const { error } = await db.auth.signOut();
      if (error) {
        logoutButton.disabled = false;
        return toast(error.message);
      }
      login();
    };
  document.querySelectorAll("aside nav button").forEach(
    (b) =>
      (b.onclick = () => {
        document
          .querySelectorAll("aside nav button,.view")
          .forEach((x) => x.classList.remove("active"));
        b.classList.add("active");
        $(`#${b.dataset.view}`).classList.add("active");
        $("#pageTitle").textContent = b.textContent.replace(/\d+/g, "").trim();
        if (b.dataset.view === "products") products();
        if (b.dataset.view === "categories") categories();
        if (b.dataset.view === "settings") settings();
      }),
  );
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
  function variantControls(c, className = "") {
    const key = c.map((x) => x.value.client).join("-"),
      old = variantFor(c, key),
      defaultPrice = +$("#productPrice").value || 0,
      defaultStock = +$("#productStock").value || 100;
    return `<div class="variant-controls ${className}"><label>价格<input data-vprice="${key}" type="number" min="0" step="0.01" value="${old.price ?? defaultPrice}" placeholder="价格"></label><label>库存<input data-vstock="${key}" type="number" min="0" value="${old.stock ?? defaultStock}" placeholder="库存"></label><label>状态<select data-vout="${key}"><option value="false" ${old.is_out_of_stock ? "" : "selected"}>可售</option><option value="true" ${old.is_out_of_stock ? "selected" : ""}>缺货</option></select></label><label class="variant-image">图片<input data-vimage="${key}" type="file" accept="image/*"><small>${old.image ? "已上传规格图片" : "使用商品主图片"}</small></label>${old.image ? `<button type="button" class="text-btn" data-remove-vimage="${key}">删除图片</button>` : ""}</div>`;
  }
  function renderSpecs() {
    const root = $("#specGroups"),
      inlineVariants = editGroups.length === 1;
    root.innerHTML = editGroups
      .map(
        (g, gi) =>
          `<section class="spec-group" draggable="true" data-gi="${gi}"><div class="two"><label>规格组名称<input data-gname="${gi}" value="${g.name || ""}" placeholder="例如：口味"></label><button type="button" class="text-btn" data-remove-group="${gi}">删除规格组</button></div><div class="spec-values">${g.values.map((v, vi) => `<div class="spec-value" draggable="true" data-gi="${gi}" data-vi="${vi}"><span class="spec-drag">⋮⋮</span><label><input aria-label="规格值" data-vname="${gi}:${vi}" value="${v.name || ""}" placeholder="例如：橙子味"></label><button type="button" class="text-btn" data-remove-value="${gi}:${vi}">删除</button>${inlineVariants ? variantControls([{ group: g, value: v }], "inline-variant-editor") : ""}</div>`).join("")}</div><button type="button" class="text-btn" data-add-value="${gi}">+ 添加规格值</button></section>`,
      )
      .join("");
    $("#variantsEditor").innerHTML = editGroups.length > 1 && combos().length
      ? `<hr><h3>规格组合</h3>${combos()
          .map((c) => {
            const label = c.map((x) => x.value.name || "未命名").join(" / ");
            return `<div class="variant-row"><b>${label}</b>${variantControls(c)}</div>`;
          })
          .join("")}`
      : "";
  }
  $("#addSpecGroup").onclick = () => {
    editGroups.push({
      client: temp(),
      name: "",
      values: [{ client: temp(), name: "" }],
    });
    renderSpecs();
  };
  $("#specGroups").oninput = (e) => {
    let needsRender = false;
    if (e.target.dataset.gname !== undefined)
      (editGroups[+e.target.dataset.gname].name = e.target.value),
        (needsRender = true);
    if (e.target.dataset.vname) {
      const [g, v] = e.target.dataset.vname.split(":").map(Number);
      editGroups[g].values[v].name = e.target.value;
      needsRender = true;
    }
    if (needsRender) renderSpecs();
  };
  $("#specGroups").onclick = (e) => {
    if (e.target.dataset.removeVimage) {
      removeVariantImage(e);
      return;
    }
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
  async function changeVariantImage(e) {
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
  }
  function removeVariantImage(e) {
    const key = e.target.dataset.removeVimage;
    if (key) {
      editVariants[key] = { ...(editVariants[key] || {}), image: null };
      renderSpecs();
    }
  }
  $("#specGroups").onchange = changeVariantImage;
  $("#variantsEditor").onchange = changeVariantImage;
  $("#variantsEditor").onclick = removeVariantImage;
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
      `<section id="pickupSettings"><label>自取地址<input id="pickupAddressInput" required></label><label>自取说明／营业时间<textarea id="pickupNoteInput" rows="3" required></textarea></label></section>`,
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
