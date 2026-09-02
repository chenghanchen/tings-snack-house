/* Split public-site presentation controls from operational store settings. */
(() => {
  const $ = (selector) => document.querySelector(selector);
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
  const footerSocials = [
    ["instagram", "Instagram"],
    ["facebook", "Facebook"],
    ["xiaohongshu", "小红书"],
    ["wechat", "微信"],
  ];
  const footerDefaults = {
    showPhone: true,
    showEmail: true,
    socials: Object.fromEntries(
      footerSocials.map(([id]) => [id, { show: false, qr: "" }]),
    ),
  };
  const toast = (message) => {
    const node = $("#toast");
    if (!node) return;
    node.textContent = message;
    node.classList.add("show");
    setTimeout(() => node.classList.remove("show"), 2800);
  };
  const inputValue = (id, fallback) => $(id)?.value.trim() || fallback;

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
  }
  function extraControls() {
    const target = $("#appearanceFields");
    if (!target || $("#appearanceAnnouncement")) return;
    const socialRows = footerSocials
      .map(
        ([id, label]) =>
          `<div class="footer-social-row"><label class="rule-switch"><input id="footerSocial_${id}" type="checkbox">显示 ${label}</label><label>${label} 二维码<input id="footerQr_${id}" type="file" accept="image/*"></label><div class="footer-qr-preview" id="footerQrPreview_${id}">未上传</div></div>`,
      )
      .join("");
    target.insertAdjacentHTML(
      "beforeend",
      '<section id="appearanceAnnouncement"><h3>活动公告</h3><p class="muted">顾客网站首页首屏下方会自动显示全部进行中的活动；没有活动时自动隐藏。</p></section><section id="appearanceProducts"><h3>商品展示</h3><p class="muted">选择样式后会同步顾客网站；其余布局独立设置。</p><div class="appearance-style-picker" id="cardStylePicker"><button type="button" data-card-style="japanese"><i></i>日式简约</button><button type="button" data-card-style="cute"><i></i>可爱圆润</button><button type="button" data-card-style="clean"><i></i>清爽无框</button><button type="button" data-card-style="classic"><i></i>经典卡片</button></div><div class="two"><label>商品图片比例<select id="appearanceImageFit"><option value="contain">完整显示</option><option value="cover">铺满裁剪</option></select></label><label>电脑端每行商品数量<select id="appearanceDesktopCols"><option>3</option><option selected>4</option><option>5</option></select></label></div><div class="two"><label>手机端每行商品数量<select id="appearanceMobileCols"><option>1</option><option selected>2</option><option>3</option></select></label><label class="rule-switch"><input id="appearanceShowDescription" type="checkbox" checked>显示商品描述</label></div></section><section id="footerContactSettings"><h3>页尾联系方式与社交媒体</h3><p class="muted">电话与邮箱直接读取「店铺设置 → 店铺资料」。顾客点击社交媒体名称后才会展开二维码。</p><div class="two"><label class="rule-switch"><input id="footerShowPhone" type="checkbox" checked>显示店铺电话</label><label class="rule-switch"><input id="footerShowEmail" type="checkbox" checked>显示店铺邮箱</label></div><div class="footer-social-settings">' +
        socialRows +
        "</div></section>",
    );
    const css =
      '<style>.appearance-style-picker{display:grid;grid-template-columns:repeat(4,1fr);gap:9px;margin:12px 0}.appearance-style-picker button{padding:10px 5px;border:1px solid var(--line);background:#fffdf8;cursor:pointer;font:12px inherit}.appearance-style-picker i{display:block;height:36px;margin:0 5px 7px;background:#f1e7d5;border-radius:3px}.appearance-style-picker button[data-card-style="cute"] i{border-radius:13px}.appearance-style-picker button[data-card-style="clean"] i{background:linear-gradient(90deg,#f1e7d5 45%,transparent 45%)}.appearance-style-picker button[data-card-style="classic"] i{border:1px solid #a99f8d}.appearance-style-picker button.active{outline:2px solid var(--sage)}.footer-social-settings{display:grid;gap:8px;margin-top:12px}.footer-social-row{display:grid;grid-template-columns:150px minmax(150px,1fr) 64px;gap:10px;align-items:end;padding:8px 0;border-top:1px solid var(--line)}.footer-social-row label{margin:0}.footer-social-row input[type=file]{font-size:11px;padding:6px}.footer-qr-preview{height:50px;border:1px solid var(--line);display:grid;place-items:center;color:#79847a;font-size:10px;overflow:hidden}.footer-qr-preview img{width:100%;height:100%;object-fit:contain}@media(max-width:720px){.appearance-style-picker{grid-template-columns:1fr 1fr}.footer-social-row{grid-template-columns:1fr 70px}.footer-social-row>.rule-switch{grid-column:1/-1}}</style>';
    document.head.insertAdjacentHTML("beforeend", css);
    document.head.insertAdjacentHTML(
      "beforeend",
      '<style>#deliveryBackgroundImagePreview{width:min(500px,100%);height:100px;border-radius:15px;font-size:25px}#heroImageControl>label,#footerImageControl>label{font-size:16px}#heroBackgroundImagePreview,#storyBackgroundImagePreview{width:min(500px,100%);height:100px;aspect-ratio:auto;border-radius:15px;overflow:hidden}#heroBackgroundImagePreview img,#storyBackgroundImagePreview img{width:100%;height:100px;object-fit:cover;border-radius:inherit}#footerContactSettings>.two>.rule-switch{box-sizing:border-box;display:flex;align-items:center;height:50px;margin:5px 0;font-size:15px}#footerContactSettings .footer-social-row>.rule-switch{box-sizing:border-box;display:flex;align-items:center;height:50px;font-size:14px}#appearanceForm>.primary{margin-top:15px;border-radius:15px}</style>',
    );
  }
  async function bindAdvanced() {
    const form = $("#appearanceForm");
    if (!form || form.dataset.advanced) return;
    form.dataset.advanced = "true";
    const db = window.supabase.createClient(
        window.TINGS_SUPABASE.url,
        window.TINGS_SUPABASE.anonKey,
      ),
      { data } = await db
        .from("shop_settings")
        .select("content")
        .eq("id", 1)
        .maybeSingle(),
      c = {
        cardStyle: "japanese",
        imageFit: "contain",
        desktopCols: 4,
        mobileCols: 2,
        showDescription: true,
        ...(data?.content?.siteAppearance || {}),
      };
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
  async function bindAnnouncementImage() {
    const form = $("#appearanceForm"),
      panel = $("#appearanceAnnouncement");
    if (!form || !panel || form.dataset.announcementImage) return;
    form.dataset.announcementImage = "true";
    panel
      .querySelector("p.muted")
      ?.insertAdjacentHTML(
        "afterend",
        '<label>活动公告栏背景插图<input id="activityAnnouncementImageUpload" type="file" accept="image/*"><small>插图会铺满整条公告栏，活动文字叠加显示在上方。</small></label><div class="image-preview" id="activityAnnouncementImagePreview">默认浅米色背景</div><button class="text-btn" type="button" id="removeActivityAnnouncementImage">恢复默认背景</button>',
      );
    const db = window.supabase.createClient(
        window.TINGS_SUPABASE.url,
        window.TINGS_SUPABASE.anonKey,
      ),
      { data } = await db
        .from("shop_settings")
        .select("content")
        .eq("id", 1)
        .maybeSingle(),
      value = data?.content?.activityAnnouncementImage || "",
      upload = $("#activityAnnouncementImageUpload"),
      preview = $("#activityAnnouncementImagePreview");
    form.dataset.activityAnnouncementImage = value;
    preview.innerHTML = value
      ? `<img src="${value}" alt="活动公告栏背景">`
      : "默认浅米色背景";
    upload.onclick = () => {
      upload.value = "";
    };
    upload.onchange = async (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      if (!file.type.startsWith("image/")) return toast("请选择图片格式的插图");
      try {
        const result = await window.TingsImage?.optimizeFile(file, {
          maxDimension: 1920,
          quality: 0.84,
        });
        const image = result?.dataUrl;
        if (!image) throw new Error("插图读取失败，请重新选择图片");
        form.dataset.activityAnnouncementImage = image;
        preview.innerHTML = `<img src="${image}" alt="活动公告栏背景">`;
        toast("公告栏插图已添加，请点击“保存店铺外观”");
      } catch (error) {
        toast(error.message || "插图读取失败，请重新选择图片");
      }
    };
    panel.addEventListener("click", (event) => {
      if (event.target.id !== "removeActivityAnnouncementImage") return;
      form.dataset.activityAnnouncementImage = "";
      upload.value = "";
      preview.textContent = "默认浅米色背景";
      toast("已恢复默认背景，请点击“保存店铺外观”");
    });
  }
  async function bindFooterContacts() {
    const form = $("#appearanceForm");
    if (!form || form.dataset.footerContacts) return;
    form.dataset.footerContacts = "true";
    const db = window.supabase.createClient(
        window.TINGS_SUPABASE.url,
        window.TINGS_SUPABASE.anonKey,
      ),
      { data } = await db
        .from("shop_settings")
        .select("content")
        .eq("id", 1)
        .maybeSingle(),
      saved = data?.content?.footerAppearance || {},
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
        preview = $(`#footerQrPreview_${id}`);
      $(`#footerSocial_${id}`).checked = !!social.show;
      form.dataset[`footerQr_${id}`] = social.qr || "";
      preview.innerHTML = social.qr
        ? `<img src="${social.qr}" alt="${label} 二维码">`
        : "未上传";
      upload.onclick = () => {
        upload.value = "";
      };
      upload.onchange = (e) => {
        const file = e.target.files?.[0];
        if (!file) return;
        if (!file.type.startsWith("image/"))
          return toast("请选择图片格式的二维码");
        const reader = new FileReader();
        reader.onerror = () => toast("二维码读取失败，请重新选择图片");
        reader.onload = () => {
          form.dataset[`footerQr_${id}`] = reader.result;
          preview.innerHTML = `<img src="${reader.result}" alt="${label} 二维码">`;
          toast(`${label} 二维码已添加，请点击“保存店铺外观”`);
        };
        reader.readAsDataURL(file);
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
      if (sectionId === "heroImageControl") label.querySelector("small")?.remove();
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
    const source = $("#settingsForm");
    if (!source || !window.supabase || !window.TINGS_SUPABASE) return;
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
    const fee = Number($("#deliveryFeeInput")?.value || 5),
      free = Number($("#freeDeliveryInput")?.value || 50),
      delivery = inputValue(
        "#deliveryText",
        `配送费 $${fee.toFixed(2)}；商品小计满 $${free.toFixed(2)} 免费配送。`,
      );
    const db = window.supabase.createClient(
      window.TINGS_SUPABASE.url,
      window.TINGS_SUPABASE.anonKey,
    );
    const { data: current } = await db
      .from("shop_settings")
      .select("content")
      .eq("id", 1)
      .maybeSingle();
    content.footerAppearance = footerConfigFromForm(
      $("#appearanceForm") || source,
    );
    content.activityAnnouncementImage =
      $("#appearanceForm")?.dataset.activityAnnouncementImage || "";
    content.siteAppearance = {
      cardStyle: $("#cardStylePicker .active")?.dataset.cardStyle || "japanese",
      imageFit: $("#appearanceImageFit")?.value || "contain",
      desktopCols: +($("#appearanceDesktopCols")?.value || 4),
      mobileCols: +($("#appearanceMobileCols")?.value || 2),
      showDescription: $("#appearanceShowDescription")?.checked !== false,
    };
    const { error } = await db
      .from("shop_settings")
      .update({
        delivery,
        content: { ...(current?.content || {}), ...content },
        updated_at: new Date().toISOString(),
      })
      .eq("id", 1);
    toast(error ? error.message : "店铺外观已保存");
  }

  function bindAppearanceForm() {
    const form = $("#appearanceForm");
    if (!form || form.dataset.bound) return;
    form.dataset.bound = "true";
    form.addEventListener("submit", saveAppearance);
  }

  function setup() {
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

  window.addEventListener("load", () => setTimeout(setup, 220));
})();
