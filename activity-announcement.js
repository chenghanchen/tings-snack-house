(() => {
  const esc = (value) =>
    String(value ?? "").replace(
      /[&<>"']/g,
      (char) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        })[char],
    );
  const money = (value) => `$${Number(value || 0).toFixed(2)}`;
  const compactMoney = (value) =>
    money(value).replace(/\.00$/, "").replace(/(\.\d)0$/, "$1");
  const date = (value) =>
    value
      ? new Intl.DateTimeFormat("en-US", {
          timeZone: "America/Chicago",
          month: "numeric",
          day: "numeric",
        }).format(new Date(value))
      : "";
  const offer = (item) =>
    item.kind === "full_reduction"
      ? `满 ${money(item.threshold)} 减 ${money(item.amount)}`
      : item.kind === "free_shipping"
        ? "配送费全免"
        : item.discount_kind === "percent"
          ? `${Number(item.amount || 0)}% Off`
          : `每件减 ${compactMoney(item.amount)}`;
  function addStyle() {
    if (document.querySelector("#activityAnnouncementStyles")) return;
    document.head.insertAdjacentHTML(
      "beforeend",
      '<style id="activityAnnouncementStyles">.activity-announcement{--activity-announcement-image:none;min-height:104px;width:100%;margin:0;padding:20px max(7vw,42px);display:flex;align-items:center;gap:28px;flex-wrap:wrap;border-block:1px solid #dfcdb0;background-color:#f8efdf;background-image:linear-gradient(90deg,#fff9efd9,#fff9efa8),var(--activity-announcement-image);background-size:cover;background-position:center;color:#3f3025}.activity-announcement__label{font-size:24px;line-height:1.35;font-weight:700;color:#d75b4b;letter-spacing:.1em;white-space:nowrap}.activity-announcement__items{display:flex;align-items:center;gap:28px;flex-wrap:wrap}.activity-announcement__item{display:grid;gap:3px;min-width:150px}.activity-announcement__name{padding:0;border:0;background:transparent;color:inherit;font:inherit;font-size:24px;line-height:1.2;font-weight:700;text-align:left;cursor:pointer}.activity-announcement__name:hover,.activity-announcement__name:focus-visible{color:#d75b4b;text-decoration:underline;text-underline-offset:3px}.activity-announcement__item span{font-size:20px;line-height:1.2;font-weight:700}.activity-announcement__item small{font-size:16px;color:#68594d}@media(max-width:780px){.activity-announcement{min-height:104px;padding:16px 7vw;gap:12px;flex-wrap:nowrap;overflow-x:auto}.activity-announcement__label{font-size:18px}.activity-announcement__items{gap:18px;flex-wrap:nowrap}.activity-announcement__item{min-width:135px}.activity-announcement__name,.activity-announcement__item span{font-size:18px}.activity-announcement__item small{font-size:13px}}</style>',
    );
  }
  function activeCampaigns(campaigns) {
    const now = new Date();
    return (campaigns || []).filter(
      (item) =>
        item.active !== false &&
        (!item.status || item.status === "published") &&
        (!item.starts_at || new Date(item.starts_at) <= now) &&
        (!item.ends_at || new Date(item.ends_at) >= now),
    );
  }
  function itemsMarkup(list) {
    return list
      .map(
        (item) =>
          `<article class="activity-announcement__item"><button class="activity-announcement__name" type="button" data-promotion-filter>${esc(item.name || "优惠活动")}</button><span>${esc(offer(item))}</span><small>${item.starts_at || item.ends_at ? `${date(item.starts_at) || "立即"} — ${date(item.ends_at) || "长期有效"}` : "长期有效"}</small></article>`,
      )
      .join("");
  }
  function keepViewportStable(hero, change) {
    const anchor = document.querySelector("#snacks"),
      anchorTop = anchor?.getBoundingClientRect?.().top,
      heroBottom = hero.getBoundingClientRect?.().bottom,
      preserve =
        Number.isFinite(anchorTop) &&
        Number.isFinite(heroBottom) &&
        heroBottom <= 0;
    change();
    if (!preserve) return;
    const nextAnchorTop = anchor.getBoundingClientRect().top,
      offset = nextAnchorTop - anchorTop;
    if (!Number.isFinite(offset) || Math.abs(offset) < 1) return;
    const root = document.documentElement,
      previousBehavior = root.style.scrollBehavior;
    root.style.scrollBehavior = "auto";
    window.scrollBy(0, offset);
    requestAnimationFrame(() => {
      if (root.style.scrollBehavior === "auto")
        root.style.scrollBehavior = previousBehavior;
    });
  }
  function bindAnnouncement(section) {
    if (section.dataset.activityAnnouncementBound) return;
    section.dataset.activityAnnouncementBound = "true";
    section.addEventListener("click", (event) => {
      if (!event.target.closest("[data-promotion-filter]")) return;
      document.querySelector('#filters [data-filter="促销"]')?.click();
      document
        .querySelector("#snacks")
        ?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }
  function render(campaigns, settings) {
    const list = activeCampaigns(campaigns),
      hero = document.querySelector(".hero");
    if (!hero) return;
    let section = document.querySelector(".activity-announcement");
    if (!list.length) {
      if (section) keepViewportStable(hero, () => section.remove());
      return;
    }
    addStyle();
    keepViewportStable(hero, () => {
      if (!section) {
        hero.insertAdjacentHTML(
          "afterend",
          '<section class="activity-announcement" aria-live="polite"></section>',
        );
        section = document.querySelector(".activity-announcement");
      }
      if (!section) return;
      const image = settings?.content?.activityAnnouncementImage || "";
      section.style.setProperty(
        "--activity-announcement-image",
        image ? `url(${JSON.stringify(String(image))})` : "none",
      );
      section.innerHTML = `<b class="activity-announcement__label">进行中活动</b><div class="activity-announcement__items">${itemsMarkup(list)}</div>`;
      bindAnnouncement(section);
    });
  }
  async function start() {
    if (
      !window.TingsStorefront?.settingsReady ||
      !window.TingsStorefront?.campaignsReady
    )
      return setTimeout(start, 160);
    const storefront = window.TingsStorefront,
      settings = storefront.settings || (await storefront.settingsReady),
      renderPublishedCampaigns = (campaigns) =>
        render(campaigns, storefront.settings || settings);
    if (typeof storefront.subscribeCampaigns === "function") {
      storefront.subscribeCampaigns(renderPublishedCampaigns);
      return;
    }
    const campaigns = storefront.campaigns || (await storefront.campaignsReady);
    renderPublishedCampaigns(campaigns);
  }
  start();
})();
