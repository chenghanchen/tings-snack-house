(() => {
  const names = {
    full_reduction: "满减活动",
    product_discount: "商品折扣",
    category_discount: "分类折扣",
    holiday: "节日活动",
    free_shipping: "免费配送",
  };
  const money = (n) => `$${Number(n || 0).toFixed(2)}`;
  function describe(x) {
    if (x.kind === "free_shipping") return "免费配送";
    if (x.kind === "full_reduction")
      return `满 ${money(x.threshold)} 减 ${money(x.amount)}`;
    return x.discount_kind === "percent"
      ? `指定商品 ${Number(x.amount || 0)}% Off`
      : `指定商品减 ${money(x.amount)}`;
  }
  async function start() {
    if (
      !window.supabase ||
      !window.TINGS_SUPABASE ||
      !document.querySelector("#promotionSelect")
    )
      return setTimeout(start, 120);
    const db = window.supabase.createClient(
        TINGS_SUPABASE.url,
        TINGS_SUPABASE.anonKey,
      ),
      select = document.querySelector("#promotionSelect"),
      coupon = document.querySelector("#couponCodeInput");
    const { data } = await db
      .from("marketing_campaigns")
      .select("*")
      .order("created_at", { ascending: false });
    (data || []).forEach((x) =>
      select.insertAdjacentHTML(
        "beforeend",
        `<option value="${x.id}">${names[x.kind] || "活动"}｜${x.name}（${describe(x)}）</option>`,
      ),
    );
    select.onchange = () => {
      if (select.value) {
        coupon.value = "";
        coupon.disabled = true;
      } else coupon.disabled = false;
    };
    coupon.oninput = () => {
      if (coupon.value.trim()) {
        select.value = "";
        select.disabled = true;
      } else select.disabled = false;
    };
  }
  start();
})();
