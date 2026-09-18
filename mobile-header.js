/* Mobile navigation forwards to the existing account, lookup and cart flows. */
(() => {
  'use strict';
  const toggle = document.getElementById('mobileMenuToggle');
  const menu = document.getElementById('mobileHeaderMenu');
  const mobile = window.matchMedia('(max-width:780px)');
  const search = document.getElementById('productSearch');
  const desktopSearchPlaceholder = search?.getAttribute('placeholder');
  const updateSearchPlaceholder = () => {
    if (search) search.setAttribute('placeholder', mobile.matches ? '搜索你喜欢的零食…' : desktopSearchPlaceholder);
  };
  updateSearchPlaceholder();
  mobile.addEventListener('change', updateSearchPlaceholder);
  const filters = document.getElementById('filters');
  if (filters) {
    let centerFrame;
    const centerActiveFilter = (animate = false) => {
      cancelAnimationFrame(centerFrame);
      centerFrame = requestAnimationFrame(() => {
        if (!mobile.matches) return;
        const buttons = filters.querySelectorAll('button');
        const active = filters.querySelector('button.active');
        if (!buttons.length || !active || !filters.clientWidth) return;
        const index = Array.from(buttons).indexOf(active);
        const maxScroll = Math.max(0, filters.scrollWidth - filters.clientWidth);
        const bar = filters.getBoundingClientRect();
        const selected = active.getBoundingClientRect();
        // Keep the first/last two categories at the corresponding edge, without spacers.
        const centered = filters.scrollLeft + selected.left + selected.width / 2 - bar.left - filters.clientLeft - filters.clientWidth / 2;
        const left = index < 2 ? 0 : index >= buttons.length - 2 ? maxScroll : Math.max(0, Math.min(maxScroll, centered));
        filters.scrollTo({
          left,
          behavior: animate && !window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'smooth' : 'instant',
        });
      });
    };
    // Also covers asynchronous category rendering and programmatic selection.
    new MutationObserver(() => centerActiveFilter(true)).observe(filters, {
      childList: true, subtree: true, attributes: true, attributeFilter: ['class'],
    });
    new ResizeObserver(() => centerActiveFilter()).observe(filters);
    filters.addEventListener('click', event => {
      if (event.target.closest('button')) centerActiveFilter(true);
    });
    mobile.addEventListener('change', () => centerActiveFilter());
    document.fonts?.ready.then(() => centerActiveFilter());
    centerActiveFilter();
  }
  if (!toggle || !menu) return;
  function closeMenu(restoreFocus = false) {
    menu.hidden = true;
    toggle.setAttribute('aria-expanded', 'false');
    toggle.setAttribute('aria-label', '打开导航菜单');
    if (restoreFocus) toggle.focus();
  }
  toggle.addEventListener('click', () => {
    if (!menu.hidden) { closeMenu(); return; }
    menu.hidden = false;
    toggle.setAttribute('aria-expanded', 'true');
    toggle.setAttribute('aria-label', '关闭导航菜单');
    menu.querySelector('button:not([hidden]):not(:disabled),a[href]:not([hidden])')?.focus();
  });
  menu.addEventListener('click', event => {
    if (event.target.closest('a')) closeMenu(true);
  });
  for (const [entry, target, dialogId] of [
    ['mobileLookupEntry', 'openOrderLookupMobile', 'orderLookupDialog'],
    ['mobileAccountEntry', 'openCustomerAccount', 'customerAccountDialog'],
  ]) document.getElementById(entry).addEventListener('click', () => {
    closeMenu(true);
    document.getElementById(target)?.click();
    document.getElementById(dialogId)?.addEventListener('close', () => {
      if (mobile.matches) toggle.focus();
    }, {once:true});
  });
  document.addEventListener('click', event => {
    if (!menu.hidden && !menu.contains(event.target) && !toggle.contains(event.target)) closeMenu();
  });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && !menu.hidden) { event.preventDefault(); closeMenu(true); }
  });
  document.addEventListener('focusin', event => {
    if (!menu.hidden && !menu.contains(event.target) && !toggle.contains(event.target)) closeMenu();
  });
  mobile.addEventListener('change', () => closeMenu());
  const count = document.getElementById('cartCount');
  const updateCartLabel = () => document.getElementById('openCart').setAttribute('aria-label', `打开购物篮，${count.textContent} 件商品`);
  new MutationObserver(updateCartLabel).observe(count, {childList:true,characterData:true,subtree:true});
  updateCartLabel();
})();
