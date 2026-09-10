/* Split public-site presentation controls from operational store settings. */
(() => {
  const $ = (selector) => document.querySelector(selector);
  const isAuthView = () => !!$("#loginForm, #newPasswordForm");
  const isCurrentAppearanceForm = (form) =>
    !!form &&
    form.isConnected &&
    $("#appearanceForm") === form &&
    !isAuthView();
  const contentDefaults = {
    heroEyebrow: "今日の小さなごほうび",
    heroTitle: "把喜欢的零食",
    heroEmphasis: "装进日常里",
    heroIntro:
      "从童年味道到新鲜人气款，挑一袋让心情变好的中国零食。下单即为您预留，无需在线付款。",
    heroButton: "开始挑选",
    footerHours: "营业时间：每日 10:00 – 21:00",
    footerYear: "2026",
  };
  const deliveryDefaults = {
    deliveryEyebrow: "LOCAL DELIVERY",
    deliveryTitle: "把零食送到你身边",
    deliveryBackgroundColor: "#f4e9d2",
  };
  const imageKeys = [
    "heroBackgroundImage",
    "storyBackgroundImage",
    "deliveryBackgroundImage",
  ];
  const backgroundUploadProfiles = Object.freeze({
    heroBackgroundImage: "hero",
    activityAnnouncementImage: "announcement",
    deliveryBackgroundImage: "delivery",
    storyBackgroundImage: "footer",
  });
  const imageDefaults = {
    heroBackgroundImage: "hero-snack-illustration-v1.webp",
    storyBackgroundImage: "footer-design-v2.webp",
  };
  const footerSocials = [
    ["wechat", "微信"],
    ["xiaohongshu", "小红书"],
    ["douyin", "抖音"],
    ["facebook", "Facebook"],
    ["instagram", "Instagram"],
  ];
  const footerDefaults = {
    showPhone: true,
    showEmail: true,
    socials: Object.fromEntries(
      footerSocials.map(([id]) => [id, { show: false, qr: "" }]),
    ),
  };
  let appearanceSavePending = false;
  const toast = (message) => {
    const node = $("#toast");
    if (!node) return;
    node.textContent = message;
    node.classList.add("show");
    setTimeout(() => node.classList.remove("show"), 2800);
  };
  const inputValue = (id, fallback) => $(id)?.value.trim() || fallback;
  const qrUuidPattern =
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.png$/i;

  function isManagedQrUrl(value, platform) {
    try {
      const url = new URL(value),
        projectOrigin = new URL(window.TINGS_SUPABASE.url).origin,
        prefix = `/storage/v1/object/public/storefront-images/appearance/qr/${platform}/`;
      return (
        url.protocol === "https:" &&
        url.origin === projectOrigin &&
        url.pathname.startsWith(prefix) &&
        qrUuidPattern.test(url.pathname.slice(prefix.length))
      );
    } catch {
      return false;
    }
  }

  function renderQrPreview(preview, value, label) {
    preview.replaceChildren();
    if (!value) {
      preview.textContent = "未上传";
      return;
    }
    const image = document.createElement("img");
    image.src = value;
    image.alt = `${label} 二维码预览`;
    image.loading = "lazy";
    image.decoding = "async";
    preview.append(image);
  }

  function ensureShell() {
    const nav = $("aside nav"),
      settingsButton = $('[data-view="settings"]'),
      settings = $("#settings");
    if (!nav || !settingsButton || !settings) return false;
    settingsButton.textContent = "店铺设置";
    if (!$('[data-view="appearance"]')) {
      settingsButton.insertAdjacentHTML(
        "afterend",
        '<button data-view="appearance">店铺外观</button>',
      );
      settings.insertAdjacentHTML(
        "afterend",
        '<section class="view" id="appearance"><div class="panel narrow appearance-panel"><form id="appearanceForm"><div id="appearanceFields"></div><button class="primary" type="submit">保存店铺外观</button></form></div></section>',
      );
      $('[data-view="appearance"]').addEventListener("click", () => {
        document
          .querySelectorAll("aside nav button,.view")
          .forEach((node) => node.classList.remove("active"));
        $('[data-view="appearance"]').classList.add("active");
        $("#appearance")?.classList.add("active");
        $("#pageTitle").textContent = "店铺外观";
      });
    }
    return true;
  }

  function setupAppearanceMenu() {
    const nav = $("aside nav"),
      button = $('[data-view="appearance"]');
    if (!nav || !button || $("#appearanceSubmenu")) return;
    button.classList.add("settings-parent-toggle");
    button.setAttribute("aria-expanded", "false");
    button.insertAdjacentHTML(
      "afterend",
      '<div class="store-settings-submenu" id="appearanceSubmenu"><button type="button" data-appearance-pane="hero">首页装修</button><button type="button" data-appearance-pane="announcement">活动公告</button><button type="button" data-appearance-pane="products">商品展示</button><button type="button" data-appearance-pane="delivery">配送区域</button><button type="button" data-appearance-pane="footer">页尾设置</button></div>',
    );
    const menu = $("#appearanceSubmenu");
    button.addEventListener("click", () => {
      const open = !menu.classList.contains("open");
      menu.classList.toggle("open", open);
      button.classList.toggle("expanded", open);
      button.setAttribute("aria-expanded", String(open));
    });
    menu.addEventListener("click", (e) => {
      const item = e.target.closest("[data-appearance-pane]");
      if (!item) return;
      document
        .querySelectorAll("aside nav button,.view")
        .forEach((x) => x.classList.remove("active"));
      button.classList.add("active");
      $("#appearance").classList.add("active");
      $("#pageTitle").textContent = "店铺外观";
      showPane(item.dataset.appearancePane);
      menu
        .querySelectorAll("button")
        .forEach((x) => x.classList.toggle("active", x === item));
    });
  }
  function showPane(name) {
    const map = {
      hero: ["heroContentSettings", "heroImageControl"],
      delivery: ["deliveryContentSettings"],
      footer: [
        "footerContentSettings",
        "footerImageControl",
        "footerContactSettings",
      ],
      announcement: ["appearanceAnnouncement"],
      products: ["appearanceProducts"],
    };
    Object.values(map)
      .flat()
      .forEach((id) => {
        const el = $("#" + id);
        if (el) el.hidden = true;
      });
    (map[name] || []).forEach((id) => {
      const el = $("#" + id);
      if (el) el.hidden = false;
    });
    $("#appearance")?.setAttribute("data-appearance-pane", name);
  }
  function extraControls() {
    const target = $("#appearanceFields");
    if (!target || $("#appearanceAnnouncement")) return;
    const socialRows = footerSocials
      .map(
        ([id, label]) =>
          `<div class="footer-social-row"><label class="rule-switch"><input id="footerSocial_${id}" type="checkbox">显示 ${label}</label><label>${label} 二维码<input id="footerQr_${id}" type="file" accept="image/png,image/jpeg,image/webp"><small>自动压缩为 PNG、上传云存储并扫描验证</small></label><div class="footer-qr-media"><div class="footer-qr-preview" id="footerQrPreview_${id}">未上传</div><div><small class="footer-qr-status" id="footerQrStatus_${id}">等待上传</small><button class="text-btn footer-qr-remove" type="button" data-remove-footer-qr="${id}">移除二维码</button></div></div></div>`,
      )
      .join("");
    target.insertAdjacentHTML(
      "beforeend",
      '<section id="appearanceAnnouncement"><h3>活动公告</h3><p class="muted">顾客网站首页首屏下方会自动显示全部进行中的活动；没有活动时自动隐藏。</p></section><section id="appearanceProducts"><h3>商品展示</h3><p class="muted">选择样式后会同步顾客网站；其余布局独立设置。</p><div class="appearance-style-picker" id="cardStylePicker"><button type="button" data-card-style="japanese"><i></i>日式简约</button><button type="button" data-card-style="cute"><i></i>可爱圆润</button><button type="button" data-card-style="clean"><i></i>清爽无框</button><button type="button" data-card-style="classic"><i></i>经典卡片</button></div><div class="two"><label>商品图片比例<select id="appearanceImageFit"><option value="contain">完整显示</option><option value="cover">铺满裁剪</option></select></label><label>电脑端每行商品数量<select id="appearanceDesktopCols"><option>3</option><option selected>4</option><option>5</option></select></label></div><div class="two"><label>手机端每行商品数量<select id="appearanceMobileCols"><option>1</option><option selected>2</option><option>3</option></select></label><label class="rule-switch"><input id="appearanceShowDescription" type="checkbox" checked>显示商品描述</label></div></section><section id="footerContactSettings"><h3>页尾联系方式与社交媒体</h3><p class="muted">电话与邮箱直接读取「店铺设置 → 店铺资料」。顾客点击社交媒体名称后才会展开二维码。</p><div class="two"><label class="rule-switch"><input id="footerShowPhone" type="checkbox" checked>显示店铺电话</label><label class="rule-switch"><input id="footerShowEmail" type="checkbox" checked>显示店铺邮箱</label></div><div class="footer-social-settings">' +
        socialRows +
        "</div></section>",
    );
    const css =
      '<style>.appearance-style-picker{display:grid;grid-template-columns:repeat(4,1fr);gap:9px;margin:12px 0}.appearance-style-picker button{padding:10px 5px;border:1px solid var(--line);background:#fffdf8;cursor:pointer;font:12px Arial, sans-serif}.appearance-style-picker i{display:block;height:36px;margin:0 5px 7px;background:#f1e7d5;border-radius:3px}.appearance-style-picker button[data-card-style="cute"] i{border-radius:13px}.appearance-style-picker button[data-card-style="clean"] i{background:linear-gradient(90deg,#f1e7d5 45%,transparent 45%)}.appearance-style-picker button[data-card-style="classic"] i{border:1px solid #a99f8d}.appearance-style-picker button.active{outline:2px solid var(--sage)}.footer-social-settings{display:grid;gap:8px;margin-top:12px}.footer-social-row{display:grid;grid-template-columns:150px minmax(170px,1fr) minmax(180px,220px);gap:10px;align-items:end;padding:8px 0;border-top:1px solid var(--line)}.footer-social-row label{margin:0}.footer-social-row input[type=file]{font-size:11px;padding:6px}.footer-qr-media{display:grid;grid-template-columns:64px 1fr;gap:8px;align-items:center}.footer-qr-preview{height:58px;border:1px solid var(--line);display:grid;place-items:center;color:#79847a;font-size:10px;overflow:hidden;background:#fff}.footer-qr-preview img{width:100%;height:100%;object-fit:contain}.footer-qr-status{display:block;line-height:1.35}.footer-qr-remove{margin-top:4px;padding:3px 7px;font-size:11px}@media(max-width:720px){.appearance-style-picker{grid-template-columns:1fr 1fr}.footer-social-row{grid-template-columns:1fr}.footer-social-row>.rule-switch{grid-column:auto}.footer-qr-media{max-width:260px}}</style>';
    document.head.insertAdjacentHTML("beforeend", css);
    document.head.insertAdjacentHTML(
      "beforeend",
      '<style>#deliveryBackgroundImagePreview{width:min(500px,100%);height:100px;border-radius:15px;font-size:25px}#heroImageControl>label,#footerImageControl>label{font-size:16px}#heroBackgroundImagePreview,#storyBackgroundImagePreview{width:min(500px,100%);height:100px;aspect-ratio:auto;border-radius:15px;overflow:hidden}#heroBackgroundImagePreview img,#storyBackgroundImagePreview img{width:100%;height:100px;object-fit:cover;border-radius:inherit}#footerContactSettings>.two>.rule-switch{box-sizing:border-box;display:flex;align-items:center;height:50px;margin:5px 0;font-size:15px}#footerContactSettings .footer-social-row>.rule-switch{box-sizing:border-box;display:flex;align-items:center;height:50px;font-size:14px}#appearanceForm>.primary{margin-top:15px;border-radius:15px}</style>',
    );
    document.head.insertAdjacentHTML(
      "beforeend",
      '<style>#appearanceAnnouncement>label{font-size:16px}#activityAnnouncementImagePreview{width:min(500px,100%);height:100px;border-radius:15px;font-size:25px;overflow:hidden}#activityAnnouncementImagePreview img{width:100%;height:100%;object-fit:cover;border-radius:inherit}</style>',
    );
    document.head.insertAdjacentHTML(
      "beforeend",
      '<style>#footerContentSettings>h3,#footerContactSettings>h3{font-size:17.38px}#footerContactSettings>p.muted{margin:-15px 0 10px}</style>',
    );
    document.head.insertAdjacentHTML(
      "beforeend",
      '<style>#deliveryContentSettings>h3{font-size:17.38px}#deliveryContentSettings>label:nth-of-type(1),#deliveryContentSettings>label:nth-of-type(2){font-size:12px}#deliveryContentSettings>label:nth-of-type(3){font-size:16px}#deliveryText{height:42.25px;min-height:0}</style>',
    );
    document.head.insertAdjacentHTML(
      "beforeend",
      '<style>#appearance[data-appearance-pane] .appearance-panel{padding-top:0;padding-bottom:15px}</style>',
    );
  }
  async function bindAdvanced() {
    const form = $("#appearanceForm");
    if (!form || form.dataset.advanced) return;
    form.dataset.advanced = "true";
    const c = {
        cardStyle: "japanese",
        imageFit: "contain",
        desktopCols: 4,
        mobileCols: 2,
        showDescription: true,
        ...(window.TingsAdminSettings?.content?.siteAppearance || {}),
      };
    if (!isCurrentAppearanceForm(form)) return;
    const pick = (v) => {
      $("#cardStylePicker")
        ?.querySelectorAll("button")
        .forEach((x) =>
          x.classList.toggle("active", x.dataset.cardStyle === v),
        );
    };
    pick(c.cardStyle);
    $("#appearanceImageFit").value = c.imageFit;
    $("#appearanceDesktopCols").value = c.desktopCols;
    $("#appearanceMobileCols").value = c.mobileCols;
    $("#appearanceShowDescription").checked = c.showDescription !== false;
    $("#cardStylePicker").onclick = (e) => {
      const b = e.target.closest("[data-card-style]");
      if (b) {
        c.cardStyle = b.dataset.cardStyle;
        pick(c.cardStyle);
      }
    };
  }

  const footerConfigFromForm = (source) => ({
    showPhone: $("#footerShowPhone")?.checked !== false,
    showEmail: $("#footerShowEmail")?.checked !== false,
    socials: Object.fromEntries(
      footerSocials.map(([id]) => [
        id,
        {
          show: !!$(`#footerSocial_${id}`)?.checked,
          qr: source.dataset[`footerQr_${id}`] || "",
        },
      ]),
    ),
  });

  function validateFooterSocials(config) {
    for (const [id, label] of footerSocials) {
      const social = config.socials[id];
      if (social.qr && !isManagedQrUrl(social.qr, id))
        throw new Error(
          `${label} 二维码仍是旧格式，请重新上传或移除后再保存`,
        );
      if (social.show && !social.qr)
        throw new Error(`请先上传并验证 ${label} 二维码，再开启显示`);
    }
  }

  async function migrateLegacyBackgrounds(db, form, source, content) {
    const legacy = Object.entries(backgroundUploadProfiles).filter(([key]) =>
      /^data:image\//i.test(String(content[key] || "")),
    );
    if (!legacy.length) return;
    if (!window.TingsImage?.uploadPreset)
      throw new Error("图片云存储工具尚未加载");
    toast(`正在把 ${legacy.length} 张旧背景图迁移到云存储…`);
    const task = async () => {
        const migrated = [];
        for (const [key, profile] of legacy) {
          const blob = await fetch(content[key]).then((response) =>
              response.blob(),
            ),
            result = await window.TingsImage.uploadPreset(db, blob, profile);
          migrated.push([key, result.publicUrl]);
        }
        return migrated;
      },
      migrated = window.TingsImage.withUploadLock
        ? await window.TingsImage.withUploadLock(form, task)
        : await task();
    migrated.forEach(([key, publicUrl]) => {
      content[key] = publicUrl;
      source.dataset[`${key}Dirty`] = "true";
      if (key === "activityAnnouncementImage") {
        form.dataset.activityAnnouncementImage = publicUrl;
        source.dataset.activityAnnouncementImage = publicUrl;
      } else source.dataset[key] = publicUrl;
    });
  }
  async function bindAnnouncementImage() {
    const form = $("#appearanceForm"),
      panel = $("#appearanceAnnouncement"),
      source = $("#settingsForm");
    if (!form || !panel || !source || form.dataset.announcementImage) return;
    form.dataset.announcementImage = "true";
    panel
      .querySelector("p.muted")
      ?.insertAdjacentHTML(
        "afterend",
        '<label>活动公告栏背景插画<input id="activityAnnouncementImageUpload" type="file" accept="image/png,image/jpeg,image/webp"><small>系统会自动压缩、转为 WebP 并上传云存储。</small></label><div class="image-preview" id="activityAnnouncementImagePreview">默认浅米色背景</div><button class="text-btn" type="button" id="removeActivityAnnouncementImage">恢复默认背景</button>',
      );
    if (!isCurrentAppearanceForm(form)) return;
    const db = window.supabase.createClient(
        window.TINGS_SUPABASE.url,
        window.TINGS_SUPABASE.anonKey,
      ),
      value = source.dataset.activityAnnouncementImage || "",
      upload = $("#activityAnnouncementImageUpload"),
      preview = $("#activityAnnouncementImagePreview");
    if (!upload || !preview) return;
    form.dataset.activityAnnouncementImage = value;
    preview.innerHTML = value
      ? `<img src="${value}" alt="活动公告栏背景">`
      : "默认浅米色背景";
    upload.onclick = () => {
      upload.value = "";
    };
    upload.onchange = async (e) => {
      const input = e.currentTarget,
        file = input.files?.[0];
      if (!file) return;
      if (!file.type.startsWith("image/")) return toast("请选择图片格式的插图");
      try {
        if (!window.TingsImage?.uploadPreset)
          throw new Error("图片云存储工具尚未加载");
        toast("正在压缩为 WebP 并上传云存储…");
        const task = () =>
            window.TingsImage.uploadPreset(db, file, "announcement"),
          result = window.TingsImage.withUploadLock
            ? await window.TingsImage.withUploadLock(input, task)
            : await task();
        if (!isCurrentAppearanceForm(form) || !input.isConnected) return;
        const image = result?.publicUrl;
        if (!image) throw new Error("插图读取失败，请重新选择图片");
        form.dataset.activityAnnouncementImage = image;
        source.dataset.activityAnnouncementImage = image;
        source.dataset.activityAnnouncementImageDirty = "true";
        preview.innerHTML = `<img src="${image}" alt="活动公告栏背景">`;
        toast(
          `公告栏插图已压缩为 WebP 并上传${result.optimizedBytes ? `（${Math.ceil(result.optimizedBytes / 1024)} KB）` : ""}，请点击“保存店铺外观”`,
        );
      } catch (error) {
        toast(error.message || "插图读取失败，请重新选择图片");
      }
    };
    panel.addEventListener("click", (event) => {
      if (event.target.id !== "removeActivityAnnouncementImage") return;
      form.dataset.activityAnnouncementImage = "";
      source.dataset.activityAnnouncementImage = "";
      source.dataset.activityAnnouncementImageDirty = "true";
      upload.value = "";
      preview.textContent = "默认浅米色背景";
      toast("已恢复默认背景，请点击“保存店铺外观”");
    });
  }
  async function bindFooterContacts() {
    const form = $("#appearanceForm");
    if (!form || form.dataset.footerContacts) return;
    form.dataset.footerContacts = "true";
    if (!isCurrentAppearanceForm(form)) return;
    const db = window.supabase.createClient(
        window.TINGS_SUPABASE.url,
        window.TINGS_SUPABASE.anonKey,
      ),
      saved = window.TingsAdminSettings?.content?.footerAppearance || {},
      config = {
        ...footerDefaults,
        ...saved,
        socials: { ...footerDefaults.socials, ...(saved.socials || {}) },
      };
    $("#footerShowPhone").checked = config.showPhone !== false;
    $("#footerShowEmail").checked = config.showEmail !== false;
    footerSocials.forEach(([id, label]) => {
      const social = {
          ...footerDefaults.socials[id],
          ...(config.socials[id] || {}),
        },
        upload = $(`#footerQr_${id}`),
        preview = $(`#footerQrPreview_${id}`),
        status = $(`#footerQrStatus_${id}`),
        remove = $(`[data-remove-footer-qr="${id}"]`),
        toggle = $(`#footerSocial_${id}`);
      if (!upload || !preview || !status || !remove || !toggle) return;
      toggle.checked = !!social.show;
      form.dataset[`footerQr_${id}`] = social.qr || "";
      renderQrPreview(preview, social.qr, label);
      status.textContent = social.qr
        ? isManagedQrUrl(social.qr, id)
          ? "已保存 · PNG"
          : "旧格式，请重新上传以完成扫描验证"
        : "等待上传";
      remove.hidden = !social.qr;
      upload.onclick = () => {
        upload.value = "";
      };
      upload.onchange = async (e) => {
        const input = e.currentTarget,
          file = input.files?.[0];
        if (!file) return;
        if (!["image/png", "image/jpeg", "image/webp"].includes(file.type))
          return toast("二维码仅支持 PNG、JPEG 或 WebP 图片");
        try {
          if (!window.TingsImage?.uploadQrPng)
            throw new Error("二维码云存储工具尚未加载");
          toast(`正在压缩 ${label} 二维码并扫描验证…`);
          const task = () => window.TingsImage.uploadQrPng(db, file, id),
            result = window.TingsImage.withUploadLock
              ? await window.TingsImage.withUploadLock(input, task)
              : await task();
          if (!isCurrentAppearanceForm(form) || !input.isConnected) return;
          if (!result?.publicUrl) throw new Error("二维码上传失败");
          form.dataset[`footerQr_${id}`] = result.publicUrl;
          renderQrPreview(preview, result.publicUrl, label);
          status.textContent = `扫描验证通过 · PNG${result.optimizedBytes ? ` · ${Math.ceil(result.optimizedBytes / 1024)} KB` : ""}`;
          status.title = result.qrValue || "";
          remove.hidden = false;
          toast(`${label} 二维码扫描验证通过，请点击“保存店铺外观”`);
        } catch (error) {
          toast(error.message || "二维码上传失败，请重新选择图片");
        }
      };
      remove.onclick = () => {
        form.dataset[`footerQr_${id}`] = "";
        upload.value = "";
        renderQrPreview(preview, "", label);
        status.textContent = "保存后移除；旧文件可在媒体清理中回收";
        status.removeAttribute("title");
        remove.hidden = true;
        toast(`${label} 二维码已移除，请点击“保存店铺外观”`);
      };
    });
  }

  function moveAppearanceFields() {
    const source = $("#settingsForm"),
      target = $("#appearanceFields");
    const sections = [
      "heroContentSettings",
      "deliveryContentSettings",
      "footerContentSettings",
      "imageSettings",
    ].map((id) => $("#" + id));
    if (!source || !target || sections.some((section) => !section))
      return false;
    if (!target.dataset.moved) {
      sections.forEach((section) => target.append(section));
      source.querySelectorAll(":scope > hr").forEach((rule) => rule.remove());
      target.dataset.moved = "true";
    }
    return true;
  }

  function splitImageControls() {
    const target = $("#appearanceFields"),
      images = $("#imageSettings");
    if (!target || !images || $("#heroImageControl")) return;
    const take = (inputId, sectionId, title) => {
      const input = $("#" + inputId),
        label = input?.closest("label");
      if (!label) return;
      const preview = label.nextElementSibling,
        reset = preview?.nextElementSibling,
        section = document.createElement("section");
      section.id = sectionId;
      section.innerHTML = title ? `<h3>${title}</h3>` : "";
      section.append(label);
      if (preview) section.append(preview);
      if (reset?.matches("button")) section.append(reset);
      target.append(section);
    };
    take("heroBackgroundImageUpload", "heroImageControl", "");
    take("storyBackgroundImageUpload", "footerImageControl", "");
    images.remove();
  }

  function guardLateLegacyImageSettings() {
    const source = $("#settingsForm");
    if (!source || source.dataset.appearanceImageGuard) return;
    source.dataset.appearanceImageGuard = "true";
    new MutationObserver(() => {
      // admin.js may add its retired image settings block after the new
      // appearance controls have already been created.  The controls above
      // are the single source of truth, so discard that duplicate block.
      source.querySelector(":scope > #imageSettings")?.remove();
    }).observe(source, { childList: true });
  }

  async function saveAppearance(event) {
    event.preventDefault();
    const form = $("#appearanceForm"),
      source = $("#settingsForm");
    if (
      appearanceSavePending ||
      window.TingsImage?.isSettingsSavePending?.()
    )
      return toast("店铺外观正在保存，请稍候");
    if (form?.getAttribute("aria-busy") === "true")
      return toast("图片仍在上传，请稍候再保存店铺外观");
    if (
      !isCurrentAppearanceForm(form) ||
      !source ||
      !window.supabase ||
      !window.TINGS_SUPABASE
    )
      return;
    if (!window.TingsImage?.withSettingsSaveLock)
      return toast("图片云存储工具尚未加载，请刷新后台后重试");
    appearanceSavePending = true;
    try {
      await window.TingsImage.withSettingsSaveLock(async () => {
        const content = {};
        Object.entries(contentDefaults).forEach(([key, fallback]) => {
          content[key] = inputValue("#" + key + "Input", fallback);
        });
        Object.entries(deliveryDefaults).forEach(([key, fallback]) => {
          content[key] = inputValue("#" + key + "Input", fallback);
        });
        imageKeys.forEach((key) => {
          content[key] = source.dataset[key] || "";
        });
        content.activityAnnouncementImage =
          source.dataset.activityAnnouncementImage || "";
        const fee = Number($("#deliveryFeeInput")?.value || 5),
          free = Number($("#freeDeliveryInput")?.value || 50),
          delivery = inputValue(
            "#deliveryText",
            `配送费 $${fee.toFixed(2)}；商品小计满 $${free.toFixed(2)} 免费配送。`,
          ),
          db = window.supabase.createClient(
            window.TINGS_SUPABASE.url,
            window.TINGS_SUPABASE.anonKey,
          ),
          { data: current, error: readError } = await db
            .from("shop_settings")
            .select("content")
            .eq("id", 1)
            .maybeSingle();
        if (
          !isCurrentAppearanceForm(form) ||
          !source.isConnected ||
          $("#settingsForm") !== source
        )
          return;
        if (readError) return toast(readError.message);
        content.deliveryBackgroundColor =
          current?.content?.deliveryBackgroundColor ||
          deliveryDefaults.deliveryBackgroundColor;
        const footerForm = footerConfigFromForm(form);
        content.footerAppearance = {
          ...(current?.content?.footerAppearance || {}),
          ...footerForm,
          socials: { ...(current?.content?.footerAppearance?.socials || {}), ...footerForm.socials },
        };
        try {
          validateFooterSocials(content.footerAppearance);
        } catch (error) {
          return toast(error.message);
        }
        content.siteAppearance = {
          cardStyle:
            $("#cardStylePicker .active")?.dataset.cardStyle || "japanese",
          imageFit: $("#appearanceImageFit")?.value || "contain",
          desktopCols: +($("#appearanceDesktopCols")?.value || 4),
          mobileCols: +($("#appearanceMobileCols")?.value || 2),
          showDescription:
            $("#appearanceShowDescription")?.checked !== false,
        };
        try {
          await migrateLegacyBackgrounds(db, form, source, content);
        } catch (error) {
          return toast(error.message || "旧背景图迁移失败，请重新上传后再保存");
        }
        if (
          !isCurrentAppearanceForm(form) ||
          !source.isConnected ||
          $("#settingsForm") !== source
        )
          return;
        const mergedContent = { ...(current?.content || {}), ...content },
          { error } = await db
            .from("shop_settings")
            .update({
              delivery,
              content: mergedContent,
              updated_at: new Date().toISOString(),
            })
            .eq("id", 1);
        if (!error) {
          Object.keys(backgroundUploadProfiles).forEach((key) => {
            if (
              String(source.dataset[key] || "") ===
              String(mergedContent[key] || "")
            )
              delete source.dataset[`${key}Dirty`];
          });
          window.TingsAdminSettings = {
            ...(window.TingsAdminSettings || {}),
            delivery,
            content: mergedContent,
          };
        }
        toast(error ? error.message : "店铺外观已保存");
      });
    } catch (error) {
      toast(error?.message || "店铺外观保存失败，请稍后重试");
    } finally {
      appearanceSavePending = false;
    }
  }

  function bindAppearanceForm() {
    const form = $("#appearanceForm");
    if (!form || form.dataset.bound) return;
    form.dataset.bound = "true";
    form.addEventListener("submit", saveAppearance);
    form.addEventListener("click", (event) => {
      const button = event.target.closest?.("[data-remove-image]"),
        key = button?.dataset.removeImage,
        source = $("#settingsForm");
      if (!key || !imageDefaults[key] || !source) return;
      source.dataset[key] = "";
      source.dataset[`${key}Dirty`] = "true";
      const upload = $(`#${key}Upload`),
        preview = $(`#${key}Preview`);
      if (upload) upload.value = "";
      if (preview)
        preview.innerHTML = `<img src="${imageDefaults[key]}" alt="默认图片">`;
      toast("已恢复默认图片，请点击“保存店铺外观”");
    });
  }

  function setup() {
    if (isAuthView()) return;
    if (!ensureShell()) return setTimeout(setup, 150);
    if (!moveAppearanceFields()) return setTimeout(setup, 180);
    splitImageControls();
    guardLateLegacyImageSettings();
    extraControls();
    setupAppearanceMenu();
    bindAppearanceForm();
    bindAdvanced();
    bindAnnouncementImage();
    bindFooterContacts();
  }

  const start = () => setTimeout(setup, 220);
  if (document.readyState === "complete") start();
  else window.addEventListener("load", start, { once: true });
})();
