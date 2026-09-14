/* Mobile navigation forwards to the existing account, lookup and cart flows. */
(() => {
  'use strict';
  const toggle = document.getElementById('mobileMenuToggle');
  const menu = document.getElementById('mobileHeaderMenu');
  const mobile = window.matchMedia('(max-width:780px)');
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
    menu.querySelector('a').focus();
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
