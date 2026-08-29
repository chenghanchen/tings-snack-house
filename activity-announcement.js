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
          : `每件减 ${money(item.amount)}`;
  function addStyle() {
    if (document.querySelector("#activityAnnouncementStyles")) return;
    document.head.insertAdjacentHTML(
      "beforeend",
      '<style id="activityAnnouncementStyles">.activity-announcement{--activity-announcement-image:none;min-height:104px;width:100%;margin:0;padding:20px max(7vw,42px);display:flex;align-items:center;gap:28px;flex-wrap:wrap;border-block:1px solid #dfcdb0;background-color:#f8efdf;background-image:linear-gradient(90deg,#fff9efd9,#fff9efa8),var(--activity-announcement-image);background-size:cover;background-position:center;color:#3f3025}.activity-announcement__label{font-size:24px;line-height:1.35;font-weight:700;color:#d75b4b;letter-spacing:.1em;white-space:nowrap}.activity-announcement__items{display:flex;align-items:center;gap:28px;flex-wrap:wrap}.activity-announcement__item{display:grid;gap:3px;min-width:150px}.activity-announcement__name{padding:0;border:0;background:transparent;color:inherit;font:inherit;font-size:24px;line-height:1.2;font-weight:700;text-align:left;cursor:pointer}.activity-announcement__name:hover,.activity-announcement__name:focus-visible{color:#d75b4b;text-decoration:underline;text-underline-offset:3px}.activity-announcement__item span{font-size:24px;line-height:1.2;font-weight:700}.activity-announcement__item small{font-size:16px;color:#68594d}@media(max-width:780px){.activity-announcement{min-height:104px;padding:16px 7vw;gap:12px;flex-wrap:nowrap;overflow-x:auto}.activity-announcement__label{font-size:18px}.activity-announcement__items{gap:18px;flex-wrap:nowrap}.activity-announcement__item{min-width:135px}.activity-announcement__name,.activity-announcement__item span{font-size:18px}.activity-announcement__item small{font-size:13px}}</style>',
    );
  }
  async function start() {
    if (!window.supabase || !window.TINGS_SUPABASE)
      return setTimeout(start, 160);
    const db = window.supabase.createClient(
        window.TINGS_SUPABASE.url,
        window.TINGS_SUPABASE.anonKey,
      ),
      now = new Date(),
      [campaigns, settings] = await Promise.all([
        db.from("marketing_campaigns").select("*").eq("active", true),
        db.from("shop_settings").select("content").eq("id", 1).maybeSingle(),
      ]);
    if (campaigns.error) return;
    const list = (campaigns.data || []).filter(
      (item) =>
        (!item.status || item.status === "published") &&
        (!item.starts_at || new Date(item.starts_at) <= now) &&
        (!item.ends_at || new Date(item.ends_at) >= now),
    );
    if (!list.length) return;
    addStyle();
    const hero = document.querySelector(".hero");
    if (!hero || document.querySelector(".activity-announcement")) return;
    const image = settings.data?.content?.activityAnnouncementImage || "",
      style = image
        ? ` style="--activity-announcement-image:url('${esc(image)}')"`
        : "";
    hero.insertAdjacentHTML(
      "afterend",
      `<section class="activity-announcement"${style}><b class="activity-announcement__label">进行中活动</b><div class="activity-announcement__items">${list.map((item) => `<article class="activity-announcement__item"><button class="activity-announcement__name" type="button" data-promotion-filter>${esc(item.name || "优惠活动")}</button><span>${esc(offer(item))}</span><small>${item.starts_at || item.ends_at ? `${date(item.starts_at) || "立即"} — ${date(item.ends_at) || "长期有效"}` : "长期有效"}</small></article>`).join("")}</div></section>`,
    );
    document
      .querySelector(".activity-announcement")
      ?.addEventListener("click", (event) => {
        if (!event.target.closest("[data-promotion-filter]")) return;
        document.querySelector('#filters [data-filter="促销"]')?.click();
        document
          .querySelector("#snacks")
          ?.scrollIntoView({ behavior: "smooth", block: "start" });
      });
  }
  window.addEventListener("load", () => setTimeout(start, 250));
})();
