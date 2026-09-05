/* Apply store-configured checkout rules on the customer site. */
(() => {
  const $ = (s) => document.querySelector(s),
    cash = (n) => `$${Number(n || 0).toFixed(2)}`;
  const defaults = {
    delivery: { minDelivery: 30 },
    order: {
      minOrder: 20,
      required: { name: true, phone: true, address: true, email: false },
      allowNotes: true,
      allowSchedule: true,
      maxAdvance: 7,
    },
  };
  const merge = (base, extra) =>
    Object.fromEntries(
      Object.entries(base).map(([key, value]) => [
        key,
        value && typeof value === "object" && !Array.isArray(value)
          ? merge(value, extra?.[key] || {})
          : (extra?.[key] ?? value),
      ]),
    );
  let rules = merge(defaults, {}),
    baseSubmit,
    baseApply,
    noticeTimer;
  const form = $("#orderForm");
  document.head.insertAdjacentHTML(
    "beforeend",
    '<style id="storeOrderRuleStyles">.schedule-hint{display:block;margin-top:6px;color:#758077;font-size:11px;font-weight:400}.order-note-field[hidden]{display:none!important}.order-rule-toast{position:fixed;z-index:40;left:50%;top:50%;width:min(330px,calc(100vw - 42px));transform:translate(-50%,-44%);padding:16px 20px;border:1px solid #d75b4b;background:#fffdf8;color:#293730;box-shadow:0 16px 40px #28362e38;text-align:center;font:700 14px "Zen Maru Gothic","Microsoft YaHei",sans-serif;line-height:1.7;opacity:0;pointer-events:none;transition:opacity .18s,transform .18s;cursor:pointer}.order-rule-toast.show{opacity:1;pointer-events:auto;transform:translate(-50%,-50%)}</style>',
  );
  function labelFor(name) {
    return form?.elements[name]?.closest("label");
  }
  function decorateLabel(name, required) {
    const label = labelFor(name);
    if (!label) return;
    const input = form.elements[name],
      title = {
        name: "您的姓名",
        phone: "手机号码",
        email: "电子邮箱",
        address: "配送地址",
      }[name];
    if (!title) return;
    const suffix = required ? "" : "（选填）";
    label.firstChild.textContent = title + suffix;
    input.required = required;
  }
  function ensureSchedule() {
    if ($("#scheduleField") || !form) return;
    const fulfillment = $("#fulfillment")?.closest("label");
    if (!fulfillment) return;
    fulfillment.insertAdjacentHTML(
      "afterend",
      '<label id="scheduleField">预约日期和时间（选填）<input id="scheduledFor" name="scheduled_for" type="datetime-local"><small class="schedule-hint" id="scheduleHint"></small></label>',
    );
  }
  function hideNotice() {
    const notice = $("#orderRuleToast");
    if (!notice) return;
    notice.classList.remove("show");
    setTimeout(() => {
      if (!notice.classList.contains("show")) notice.hidden = true;
    }, 180);
  }
  function showNotice(message) {
    let notice = $("#orderRuleToast");
    if (!notice) {
      document.body.insertAdjacentHTML(
        "beforeend",
        '<button type="button" class="order-rule-toast" id="orderRuleToast" hidden></button>',
      );
      notice = $("#orderRuleToast");
      notice.addEventListener("click", hideNotice);
      document.addEventListener("click", (event) => {
        if (!event.target.closest("#orderRuleToast")) hideNotice();
      });
    }
    notice.textContent = message;
    notice.hidden = false;
    requestAnimationFrame(() => notice.classList.add("show"));
    clearTimeout(noticeTimer);
    noticeTimer = setTimeout(hideNotice, 5000);
  }
  function applyRules() {
    const config = merge(defaults, settings?.content?.storeSettings || {});
    rules = config;
    const delivery = $("#fulfillment")?.value === "delivery",
      required = config.order.required || {};
    decorateLabel("name", required.name !== false);
    decorateLabel("email", !!required.email);
    decorateLabel("phone", true);
    decorateLabel("address", delivery);
    const note = labelFor("note");
    if (note) note.hidden = config.order.allowNotes === false;
    let schedule = $("#scheduleField"),
      scheduleInput = $("#scheduledFor");
    if (config.order.allowSchedule === false) {
      schedule?.remove();
      schedule = null;
      scheduleInput = null;
    } else {
      ensureSchedule();
      schedule = $("#scheduleField");
      scheduleInput = $("#scheduledFor");
      if (schedule && scheduleInput) {
        const now = new Date(),
          pad = (n) => String(n).padStart(2, "0"),
          local = (d) =>
            `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`,
          max = new Date(
            now.getTime() + Number(config.order.maxAdvance || 0) * 86400000,
          );
        scheduleInput.min = local(now);
        scheduleInput.max = local(max);
        $("#scheduleHint").textContent =
          `可预约未来 ${Number(config.order.maxAdvance || 0)} 天内的${delivery ? "配送" : "自取"}时间。`;
      }
    }
    $("#orderRuleNotice")?.remove();
  }
  function validMinimum(delivery) {
    const subtotal = totals().subtotal,
      minOrder = Number(rules.order.minOrder || 0),
      minDelivery = Math.max(
        minOrder,
        Number(rules.delivery.minDelivery || 0),
      );
    if (subtotal < minOrder) {
      showNotice(`没有达到最低消费${cash(minOrder)}哦！请再挑一些吧！`);
      return false;
    }
    if (delivery && subtotal < minDelivery) {
      showNotice(`没有达到最低配送${cash(minDelivery)}哦！请再挑一些吧！`);
      return false;
    }
    return true;
  }
  function validBusinessHours() {
    const availability = window.getStoreOrderAvailability?.();
    if (!availability || availability.accepting) return true;
    showNotice(availability.message || "当前不在营业时间，请在营业时间内下单");
    return false;
  }
  function validOrder() {
    if (!validBusinessHours()) return false;
    const delivery = $("#fulfillment")?.value === "delivery";
    if (!validMinimum(delivery)) return false;
    const scheduled = $("#scheduledFor")?.value;
    if (scheduled) {
      const date = new Date(scheduled),
        max = new Date(
          Date.now() + Number(rules.order.maxAdvance || 0) * 86400000,
        );
      if (
        !Number.isFinite(date.getTime()) ||
        date <= new Date() ||
        date > max
      ) {
        alert(
          `请选择未来 ${Number(rules.order.maxAdvance || 0)} 天内的预约时间。`,
        );
        return false;
      }
    }
    return true;
  }
  window.validateCartBeforeCheckout = () => {
    applyRules();
    return validBusinessHours() && validMinimum(false);
  };
  function wrapSubmit() {
    if (!form || form.dataset.rulesBound) return;
    form.dataset.rulesBound = "true";
    baseSubmit = form.onsubmit;
    form.onsubmit = async (event) => {
      event.preventDefault();
      if (!validOrder()) return;
      const name = form.elements.name,
        note = form.elements.note,
        scheduled = $("#scheduledFor")?.value,
        originalName = name.value,
        originalNote = note.value;
      if (!name.value.trim() && rules.order.required.name === false)
        name.value = "顾客";
      if (scheduled) {
        const prefix = `预约时间：${scheduled.replace("T", " ")}\n`;
        note.value = prefix + originalNote.replace(/^预约时间：[^\n]*\n?/, "");
      }
      await baseSubmit.call(form, event);
      name.value = originalName;
      note.value = originalNote;
    };
  }
  function hook() {
    if (typeof applySettings === "function" && !baseApply) {
      baseApply = applySettings;
      applySettings = function (data) {
        baseApply(data);
        setTimeout(applyRules, 0);
      };
    }
    applyRules();
    wrapSubmit();
    $("#fulfillment")?.addEventListener("change", () =>
      setTimeout(applyRules, 0),
    );
  }
  window.addEventListener("load", () => setTimeout(hook, 180));
})();
