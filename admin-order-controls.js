/* Settings-level new-order notification controls and order date-range filter. */
(() => {
  const $ = (s) => document.querySelector(s),
    toast = (message) => {
      const node = $("#toast");
      if (!node) return;
      node.textContent = message;
      node.classList.add("show");
      setTimeout(() => node.classList.remove("show"), 2800);
    };
  let alertEnabled = localStorage.getItem("tings-new-order-alerts") === "on",
    audioContext,
    alertDb,
    filterDb,
    filterTimer;
  const css = `
    #orderDateControls{display:flex;align-items:end;gap:9px;margin:14px 0 0;flex-wrap:wrap}.order-date-field{margin:0;font-size:11px;font-weight:700;color:#68746c}.order-date-field select,.order-date-field input{margin-top:4px;padding:7px 8px;font-size:12px;min-width:126px}.order-date-range{display:flex;gap:8px;align-items:end;flex-wrap:wrap}.order-date-range[hidden]{display:none!important}.order-date-empty{margin:16px 0 0;color:#758077;font-size:12px}.new-order-alert-settings{border-bottom:1px solid var(--line);padding:0 0 20px;margin:0 0 20px}.new-order-alert-settings h3{margin:0 0 12px;font-family:"Noto Serif SC";font-size:18px}.new-order-alert-settings .text-btn{border:1px solid var(--line);background:#fffdf8;padding:8px 10px}.new-order-alert-settings .text-btn.enabled{background:#6caa70;border-color:#6caa70;color:white}.new-order-alert-settings label{margin:14px 0 0}@media(max-width:720px){#orderDateControls{display:grid;grid-template-columns:1fr}.order-date-range{display:grid;grid-template-columns:1fr}.order-date-field select,.order-date-field input{width:100%}}
  `;
  document.head.insertAdjacentHTML("beforeend", `<style>${css}</style>`);
  document.head.insertAdjacentHTML(
    "beforeend",
    "<style>#orderDateControls{margin:0 0 0 16px;align-items:center}.order-tab{padding:10px 15px;font-size:14px}.shop-status-option{padding:10px 15px;font-size:14px}@media(max-width:720px){#orderDateControls{margin:12px 0 0}.order-tab{padding:9px 12px;font-size:13px}.shop-status-option{padding:9px 12px;font-size:13px}}</style>",
  );
  document.head.insertAdjacentHTML(
    "beforeend",
    "<style>#orders .panel{padding:18px 24px}#orders .panel-head{min-height:0;padding:0 0 8px;margin-bottom:0}.order-tab-heading{min-height:0}.order-tab{width:130px;height:50px;padding:5px;font-size:25px}.order-tabs{gap:8px}#orderDateControls{gap:10px;margin-left:14px}.order-date-field{font-size:13px}.order-date-field select,.order-date-field input{margin-top:3px;min-width:170px;padding:10px 12px;font-size:14px}.order-date-range{gap:7px}.order-search{margin:11px 0}@media(max-width:720px){#orders .panel{padding:16px}.order-tab{width:auto;height:auto;padding:10px 13px;font-size:14px}.order-date-field select,.order-date-field input{min-width:0;padding:9px 10px;font-size:13px}}</style>",
  );
  document.head.insertAdjacentHTML(
    "beforeend",
    "<style>#orderDatePreset{border-radius:10px}@media(min-width:721px){#orderDateControls{flex-wrap:nowrap}.order-date-range{flex-wrap:nowrap}.order-date-field select{width:185px;min-width:185px}.order-date-range .order-date-field{width:185px}.order-date-range .order-date-field input{width:100%;min-width:0}#orderDatePreset{margin-left:3px}}</style>",
  );
  document.head.insertAdjacentHTML(
    "beforeend",
    '<style>#orderDateControls{display:flex;align-items:center;gap:18px;margin:0 0 0 14px;flex-wrap:nowrap}.order-date-label{white-space:nowrap;color:#000;font:700 15px "Noto Serif SC",serif}.order-date-filter{position:relative;display:flex;align-items:center;gap:8px;flex-wrap:nowrap}#orderDatePreset{width:170px;min-width:170px;height:35px;margin:0;padding:7px 28px 7px 9px;border-radius:15px;font-size:15px}.order-date-range{display:flex;align-items:center;gap:6px;flex-wrap:nowrap;font-size:15px;color:#758077}.order-date-range input{width:130px;min-width:130px;margin:0;padding:6px 8px;font-size:15px}.order-date-range[hidden]{display:none!important}@media(min-width:721px){#orderDatePreset{margin-left:-10px}}@media(max-width:720px){.order-tab-heading{flex-wrap:wrap}#orderDateControls{position:relative;width:100%;gap:8px;margin:12px 0 0;align-items:center}.order-date-label{font:700 16px "Noto Serif SC",serif}.order-date-filter{position:static}#orderDatePreset{width:150px;min-width:150px;height:36px;font-size:16px}.order-date-range{position:absolute;z-index:2;top:50%;left:50%;transform:translateX(-50%);white-space:nowrap;background:var(--paper);font-size:15px}.order-date-range input{width:126px;min-width:0;padding:6px 8px;font-size:16px}#orderDateControls:has(.order-date-range:not([hidden])){padding-bottom:72px}}</style>',
  );
  document.head.insertAdjacentHTML(
    "beforeend",
    '<style>@media(max-width:720px){#orderDateControls{flex-wrap:wrap}.order-date-filter{display:contents}.order-date-range{position:static;z-index:auto;flex-basis:100%;justify-content:center;margin:5px 0;transform:none;background:transparent}#orderDateControls:has(.order-date-range:not([hidden])){padding-bottom:0}}</style>',
  );
  const dateValue = (date) => {
    const p = (n) => String(n).padStart(2, "0");
    return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}`;
  };
  const dayStart = (date) =>
    new Date(date.getFullYear(), date.getMonth(), date.getDate());
  function orderRange() {
    const preset = $("#orderDatePreset")?.value || "30d",
      now = new Date();
    if (preset === "custom") {
      const fromValue = $("#orderDateFrom")?.value,
        toValue = $("#orderDateTo")?.value,
        from = fromValue ? new Date(`${fromValue}T00:00:00`) : null,
        to = toValue ? new Date(`${toValue}T00:00:00`) : null;
      if (to) to.setDate(to.getDate() + 1);
      return {
        from,
        to,
      };
    }
    let from = dayStart(now),
      to = null;
    if (preset === "7d") from.setDate(from.getDate() - 6);
    if (preset === "30d") from.setDate(from.getDate() - 29);
    if (preset === "month")
      from = new Date(now.getFullYear(), now.getMonth(), 1);
    if (preset === "today")
      to = new Date(from.getFullYear(), from.getMonth(), from.getDate() + 1);
    return { from, to };
  }
  async function applyOrderDateFilter() {
    const root = $("#ordersList");
    if (!root) return;
    const range = orderRange();
    filterDb ??= window.supabase?.createClient(
      window.TINGS_SUPABASE?.url,
      window.TINGS_SUPABASE?.anonKey,
    );
    if (!filterDb) return;
    const { data, error } = await filterDb
      .from("orders")
      .select("id,created_at");
    if (error) return;
    const allowed = new Set(
      (data || [])
        .filter((order) => {
          const time = new Date(order.created_at);
          return (
            (!range.from || time >= range.from) &&
            (!range.to || time < range.to)
          );
        })
        .map((order) => String(order.id)),
    );
    let visible = 0;
    root.querySelectorAll(".order-card[data-order-id]").forEach((card) => {
      const show = allowed.has(String(card.dataset.orderId));
      card.hidden = !show;
      if (show) visible++;
    });
    let empty = $("#orderDateEmpty");
    if (!empty) {
      empty = document.createElement("p");
      empty.id = "orderDateEmpty";
      empty.className = "order-date-empty";
      root.insertAdjacentElement("afterend", empty);
    }
    empty.hidden = visible > 0 || !root.querySelector(".order-card");
    empty.textContent = "所选时间内没有符合条件的订单。";
  }
  function queueDateFilter() {
    clearTimeout(filterTimer);
    filterTimer = setTimeout(() => window.orders?.(), 0);
  }
  function setupDateControls() {
    const search = $("#orderSearch");
    if (!search || $("#orderDateControls")) return;
    if (search.parentElement?.classList.contains("order-search"))
      search.parentElement.insertAdjacentHTML(
        "beforebegin",
        `<div id="orderDateControls" aria-label="订单时间筛选"><span class="order-date-label">订单时间</span><div class="order-date-filter"><select id="orderDatePreset" aria-label="订单时间范围"><option value="today">今日</option><option value="7d">近 7 天</option><option value="30d" selected>近 30 天</option><option value="month">本月</option><option value="custom">自定义日期</option></select><div class="order-date-range" id="orderDateRange" hidden><input id="orderDateFrom" aria-label="开始日期" type="date"><span>至</span><input id="orderDateTo" aria-label="结束日期" type="date"></div></div></div>`,
      );
    const preset = $("#orderDatePreset"),
      range = $("#orderDateRange");
    preset.addEventListener("change", () => {
      range.hidden = preset.value !== "custom";
      if (preset.value === "custom") {
        if (!$("#orderDateFrom").value || !$("#orderDateTo").value) {
          const end = dayStart(new Date()),
            start = new Date(end);
          start.setDate(start.getDate() - 6);
          $("#orderDateFrom").value = dateValue(start);
          $("#orderDateTo").value = dateValue(end);
        }
      } else {
        const current = orderRange();
        $("#orderDateFrom").value = current.from
          ? dateValue(current.from)
          : "";
        if (current.to) {
          const end = new Date(current.to);
          end.setDate(end.getDate() - 1);
          $("#orderDateTo").value = dateValue(end);
        } else $("#orderDateTo").value = "";
      }
      queueDateFilter();
    });
    $("#orderDateFrom").addEventListener("change", queueDateFilter);
    $("#orderDateTo").addEventListener("change", queueDateFilter);
    setTimeout(queueDateFilter, 160);
  }
  function syncAlertButton(button) {
    if (button.type === "checkbox") {
      button.checked = alertEnabled;
      return;
    }
    button.textContent = alertEnabled ? "关闭新订单提醒" : "开启新订单提醒";
    button.classList.toggle("enabled", alertEnabled);
  }
  function playAlert() {
    if (
      window.storeNotificationSoundEnabled === false ||
      !audioContext ||
      audioContext.state !== "running"
    )
      return;
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
  async function subscribeAlerts() {
    if (alertDb) return;
    alertDb = window.supabase.createClient(
      window.TINGS_SUPABASE.url,
      window.TINGS_SUPABASE.anonKey,
    );
    alertDb
      .channel("settings-new-order-alerts")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "orders" },
        (payload) => {
          const order = payload.new;
          if (!alertEnabled || order?.status !== "待确认") return;
          playAlert();
          if (Notification.permission === "granted")
            new Notification("婷婷的零食屋｜新订单", {
              body: `${order.order_number || ""} · ${order.customer_name || "顾客"}`,
            });
        },
      )
      .subscribe();
  }
  async function toggleAlerts(button) {
    if (alertEnabled) {
      alertEnabled = false;
      localStorage.setItem("tings-new-order-alerts", "off");
      syncAlertButton(button);
      toast("新订单提醒已关闭");
      return;
    }
    if (!("Notification" in window)) {
      syncAlertButton(button);
      return toast("当前浏览器不支持系统通知");
    }
    if (Notification.permission === "default")
      await Notification.requestPermission();
    if (Notification.permission !== "granted") {
      syncAlertButton(button);
      return toast("未获得浏览器通知权限");
    }
    try {
      audioContext ??= new (window.AudioContext || window.webkitAudioContext)();
      await audioContext.resume();
    } catch {}
    alertEnabled = true;
    localStorage.setItem("tings-new-order-alerts", "on");
    syncAlertButton(button);
    await subscribeAlerts();
    toast("新订单提醒已开启");
  }
  async function setupAlertSettings() {
    const pickup = $("#pickupSettings"),
      oldButton = $("#orderAlertToggle");
    if (!pickup || !oldButton) return false;
    let section = $("#newOrderAlertSettings");
    if (!section) {
      pickup.insertAdjacentHTML(
        "beforebegin",
        `<section class="new-order-alert-settings" id="newOrderAlertSettings"><div id="newOrderAlertSlot"></div><label>接收新订单邮箱<input id="newOrderEmailInput" type="email" placeholder="例如：name@example.com"></label></section>`,
      );
      section = $("#newOrderAlertSettings");
    }
    let button = $("#orderAlertToggle");
    if (button && !button.closest("[data-settings-button]")) {
      const replacement = document.createElement("label");
      replacement.className = "rule-switch notification-alert-toggle";
      replacement.dataset.settingsButton = "true";
      replacement.innerHTML = '<input id="orderAlertToggle" type="checkbox">开启新订单提醒';
      button.replaceWith(replacement);
      button = replacement.querySelector("input");
      button.addEventListener("change", () => {
        toggleAlerts(button);
      });
    }
    const alertControl = button?.closest(".notification-alert-toggle") || button;
    if (alertControl && alertControl.parentElement !== $("#newOrderAlertSlot"))
      $("#newOrderAlertSlot").append(alertControl);
    syncAlertButton(button);
    const form = $("#settingsForm"),
      email = $("#newOrderEmailInput");
    filterDb ??= window.supabase?.createClient(
      window.TINGS_SUPABASE?.url,
      window.TINGS_SUPABASE?.anonKey,
    );
    if (filterDb && email && !email.dataset.loaded) {
      const { data } = await filterDb
        .from("shop_settings")
        .select("new_order_email")
        .eq("id", 1)
        .maybeSingle();
      email.value = data?.new_order_email || "chenghanchen1@gmail.com";
      email.dataset.loaded = "true";
    }
    if (form && !form.dataset.orderEmailBound) {
      form.dataset.orderEmailBound = "true";
      form.addEventListener("submit", () =>
        setTimeout(async () => {
          const value = email?.value.trim() || null;
          const { error } = await filterDb
            .from("shop_settings")
            .update({
              new_order_email: value,
              updated_at: new Date().toISOString(),
            })
            .eq("id", 1);
          if (error) toast(error.message);
        }, 0),
      );
    }
    if (alertEnabled) subscribeAlerts();
    return true;
  }
  function moveDateControlsBesideTabs() {
    const controls = $("#orderDateControls"),
      heading = $(".order-tab-heading");
    if (controls && heading && controls.parentElement !== heading)
      heading.append(controls);
  }
  function start() {
    setupDateControls();
    moveDateControlsBesideTabs();
    if (!setupAlertSettings()) setTimeout(start, 150);
  }
  window.addEventListener("load", () => setTimeout(start, 80));
})();
