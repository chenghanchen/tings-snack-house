/* Discovery navigation only: coupon eligibility and amounts still come from the account wallet. */
(() => {
  'use strict';
  const section = document.querySelector('.activity-announcement');
  if (!section) return;
  const status = document.getElementById('activityAnnouncementStatus');
  section.addEventListener('click', async event => {
    const account = event.target.closest('[data-promotion-account]');
    const product = event.target.closest('[data-promotion-filter]');
    if (!account && !product) return;
    status.hidden = true;
    if (account) {
      if (window.TingsAccount?.open) await window.TingsAccount.open('coupons', account);
      else { status.textContent = '账户入口仍在加载，请稍后重试。'; status.hidden = false; }
      return;
    }
    const filter = [...document.querySelectorAll('#filters [data-filter]')].find(button => button.dataset.filter === product.dataset.promotionFilter);
    if (!filter) { status.textContent = '商品仍在加载，请稍后重试。'; status.hidden = false; return; }
    const search = document.getElementById('productSearch');
    if (search) search.value = '';
    filter.click();
    const catalog = document.getElementById('snacks');
    const heading = catalog?.querySelector('h2');
    heading?.setAttribute('tabindex', '-1');
    heading?.focus({preventScroll:true});
    catalog?.scrollIntoView({behavior:window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',block:'start'});
  });
  window.addEventListener('tings:wallet-summary', event => {
    const coupon = event.detail;
    const amount = Number(coupon?.amount), minimum = Number(coupon?.min_spend);
    const valid = coupon && amount > 0 && Number.isFinite(amount) && minimum >= 0 && Number.isFinite(minimum);
    const money = number => `$${number.toFixed(2).replace(/\.00$/, '')}`;
    document.getElementById('activityWelcomeOffer').textContent = valid
      ? `满 ${money(minimum)} ${coupon.discount_kind === 'percent' ? `享 ${amount}% OFF` : `减 ${money(amount)}`}`
      : '查看新人专属优惠';
  });
})();
