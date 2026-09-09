/* Footer presentation only: reuse the public snapshot; never request settings twice. */
(() => {
  const root = document.querySelector("#story.snack-footer");
  const dialog = document.querySelector("#footerInfoDialog");
  if (!root || !dialog) return;
  const socialNames = {
    wechat: "微信", xiaohongshu: "小红书", douyin: "抖音",
    facebook: "Facebook", instagram: "Instagram",
  };
  const qrUuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.png$/i;
  function trustedQrUrl(value, platform) {
    try {
      const projectOrigin = new URL(window.TINGS_SUPABASE?.url || "").origin;
      const url = new URL(value);
      const prefix = `/storage/v1/object/public/storefront-images/appearance/qr/${platform}/`;
      return url.protocol === "https:" && url.origin === projectOrigin &&
        url.pathname.startsWith(prefix) && qrUuidPattern.test(url.pathname.slice(prefix.length)) &&
        !url.username && !url.password ? url.href : "";
    } catch { return ""; }
  }
  let settings = {}, config = {}, profile = {}, trigger = null, imageRequest = 0;
  let loadedQr = null, selectedLabel = "", qrDialogOpen = false;
  const mobileLayout = window.matchMedia("(max-width:1100px)");
  const qrPanel = dialog.querySelector("#footerDialogQr");
  const qrPreview = dialog.querySelector("#footerDialogQrImage");
  const qrMessage = dialog.querySelector("#footerDialogQrStatus");
  const qrSlot = root.querySelector("#footerInlineQr");
  const qrStatus = root.querySelector(".ft-qr-status");
  const title = dialog.querySelector("#footerDialogTitle");
  const text = dialog.querySelector("#footerDialogText");
  function render(value) {
    settings = value || {};
    config = settings.content?.footerAppearance || {};
    profile = settings.content?.storeSettings?.profile || {};
    const phone = root.querySelector("#footerPhone");
    const email = root.querySelector("#footerEmail");
    phone.hidden = config.showPhone === false || !profile.phone;
    phone.textContent = String(profile.phone || "");
    phone.href = `tel:${String(profile.phone || "").replace(/[^+\d(). -]/g, "")}`;
    root.querySelector("#footerEmailSection").hidden = config.showEmail === false || !profile.email;
    email.textContent = String(profile.email || "");
    email.href = `mailto:${encodeURIComponent(String(profile.email || ""))}`;
    let visible = 0;
    for (const [platform] of Object.entries(socialNames)) {
      const social = config.socials?.[platform];
      const show = !!social?.show;
      root.querySelectorAll(`[data-footer-social="${platform}"]`).forEach(button => { button.hidden = !show; });
      if (show) visible++;
    }
    root.querySelector(".ft-social-empty").hidden = visible > 0;
    root.querySelector(".ft-scan").hidden = visible === 0;
    imageRequest++;
    loadedQr = null;
    qrSlot.disabled = true;
    if (qrDialogOpen) dialog.close();
    qrSlot.textContent = "二维码";
    qrSlot.setAttribute("aria-label", "点击社交图标显示二维码");
    qrStatus.textContent = "";
    root.querySelectorAll("[data-footer-social]").forEach(button => button.setAttribute("aria-pressed", "false"));
  }
  function contactText() {
    return [config.showPhone !== false && profile.phone ? `电话：${profile.phone}` : "",
      config.showEmail !== false && profile.email ? `邮箱：${profile.email}` : ""]
      .filter(Boolean).join("\n") || "请通过已开放的社交二维码联系店铺。";
  }
  function info(label) {
    const contact = contactText();
    const answers = {
      "购物流程": "挑选商品与规格，加入购物篮，填写联系方式并选择配送或自取，核对金额后提交订单。请保存订单号，方便查询进度。",
      "常见问题": "商品库存与可选规格以商品卡展示为准。配送说明见首页配送区域，提交后的进度可在「订单查询」查看。其他问题请联系店铺。\n\n" + contact,
      "支付方式": "网站提交订单时无需在线付款。可用支付方式与付款安排，请在下单后向店铺确认。\n\n" + contact,
      "关于婷婷的零食屋": `${settings.name || "婷婷的零食屋"}\n从童年味道到新鲜人气款，认真挑选每一份日常的小快乐。`,
      "联系我们": contact,
      "加入我们": "如有加入店铺的意向，请联系店铺了解当前安排。\n\n" + contact,
      "合作洽谈": "商品、配送与其他合作事宜，请联系店铺。\n\n" + contact,
      "网站地图": "逛零食：浏览与选择商品。\n配送区域：查看配送说明。\n查询订单：使用页面顶部「查询订单」入口。\n页尾：购物指南、售后服务及联系方式。",
      "隐私政策": "下单需要填写姓名、联系方式及配送所需信息，用于处理和联系你的订单。有关个人信息的使用、保留或删除问题，请联系店铺确认。\n\n" + contact,
      "服务协议": "请核对商品、规格、联系方式和配送方式后再提交订单。履约安排、支付方式及售后事宜请与店铺确认。\n\n" + contact,
    };
    return answers[label] || "如有商品、退换货、退款或其他售后问题，请准备订单号及相关说明并联系店铺，具体处理方式由店铺核实后告知。\n\n" + contact;
  }
  function open(label, message) {
    qrDialogOpen = false;
    qrPanel.hidden = true;
    text.hidden = false;
    trigger = document.activeElement;
    title.textContent = label;
    text.textContent = message;
    if (!dialog.open) dialog.showModal();
  }
  function openQr(button) {
    trigger = button;
    qrDialogOpen = true;
    title.textContent = `${selectedLabel}二维码`;
    text.hidden = true;
    qrPanel.hidden = false;
    qrPreview.replaceChildren(...(loadedQr ? [loadedQr.cloneNode(true)] : []));
    qrMessage.textContent = qrStatus.textContent;
    if (!dialog.open) dialog.showModal();
  }
  function updateSocialControls() {
    root.querySelectorAll("[data-footer-social]").forEach(button => {
      button.setAttribute("aria-controls", mobileLayout.matches ? "footerInfoDialog" : "footerInlineQr");
      if (mobileLayout.matches) button.setAttribute("aria-haspopup", "dialog");
      else button.removeAttribute("aria-haspopup");
    });
  }
  mobileLayout.addEventListener("change", updateSocialControls);
  updateSocialControls();
  root.addEventListener("click", event => {
    const button = event.target.closest("button");
    if (!button || !root.contains(button)) return;
    if (button === qrSlot) {
      if (loadedQr) openQr(button);
      return;
    }
    if (button.hasAttribute("data-footer-lookup")) {
      document.querySelector("#openOrderLookup")?.click();
      return;
    }
    const platform = button.dataset.footerSocial;
    if (platform && socialNames[platform]) {
      if (!config.socials?.[platform]?.show) return;
      const version = ++imageRequest;
      const label = socialNames[platform];
      selectedLabel = label;
      loadedQr = null;
      qrSlot.disabled = true;
      const url = trustedQrUrl(config.socials?.[platform]?.qr, platform);
      root.querySelectorAll("[data-footer-social]").forEach(node => node.setAttribute("aria-pressed", String(node === button)));
      qrSlot.textContent = url ? "加载中…" : "暂未设置";
      qrSlot.setAttribute("aria-label", `${label}二维码${url ? "加载中" : "暂未设置"}`);
      qrStatus.textContent = url ? `正在加载${label}二维码` : `${label}暂未设置有效二维码，请选择其他联系方式。`;
      if (mobileLayout.matches) openQr(button);
      if (url) {
        // Use a separate image for each selection so slow responses cannot
        // replace the most recently selected platform's QR code.
        const qrImage = new Image();
        qrImage.className = "footer-qr-image";
        qrImage.alt = `${label}二维码`;
        qrImage.decoding = "async";
        qrImage.setAttribute("data-footer-qr-src", url);
        qrImage.onload = () => {
          if (version !== imageRequest) return;
          loadedQr = qrImage;
          qrSlot.disabled = false;
          qrSlot.replaceChildren(qrImage);
          qrSlot.setAttribute("aria-label", `放大${label}二维码`);
          qrStatus.textContent = `已显示${label}二维码，可使用${label}扫一扫。`;
          if (qrDialogOpen) {
            qrPreview.replaceChildren(qrImage.cloneNode(true));
            qrMessage.textContent = qrStatus.textContent;
          }
        };
        qrImage.onerror = () => {
          if (version !== imageRequest) return;
          qrSlot.textContent = "加载失败";
          qrSlot.setAttribute("aria-label", `${label}二维码加载失败，点击图标重试`);
          qrStatus.textContent = "二维码暂时加载失败，请再次点击图标重试。";
          if (qrDialogOpen) qrMessage.textContent = qrStatus.textContent;
        };
        qrImage.src = url;
      }
      return;
    }
    if (button.dataset.footerInfo) open(button.dataset.footerInfo, info(button.dataset.footerInfo));
  });
  dialog.querySelector(".dialog-close").addEventListener("click", () => dialog.close());
  dialog.addEventListener("click", event => {
    if (event.target !== dialog) return;
    const rect = dialog.getBoundingClientRect();
    if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) dialog.close();
  });
  dialog.addEventListener("close", () => {
    qrDialogOpen = false;
    qrPreview.replaceChildren();
    trigger?.focus();
  });
  async function start(attempt = 0) {
    if (!window.TingsStorefront?.settingsReady) {
      if (attempt < 100) setTimeout(() => start(attempt + 1), 150);
      return;
    }
    try { render(window.TingsStorefront.settings || await window.TingsStorefront.settingsReady); }
    catch { render({}); }
  }
  render({});
  start();
})();
