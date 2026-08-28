/* Compact navigation for the owner dashboard on phones. */
(() => {
  const aside = document.querySelector("aside");
  const toggle = document.querySelector("#mobileNavToggle");
  const backdrop = document.querySelector("#mobileNavBackdrop");
  const title = document.querySelector("#mobileNavTitle");
  if (!aside || !toggle || !backdrop || !title) return;
  /* Keep the drawer above its dimming backdrop on small screens. */
  aside.style.zIndex = "42";
  const close = () => {
    document.body.classList.remove("mobile-nav-open");
    toggle.setAttribute("aria-expanded", "false");
    toggle.setAttribute("aria-label", "打开后台导航");
  };
  const open = () => {
    document.body.classList.add("mobile-nav-open");
    toggle.setAttribute("aria-expanded", "true");
    toggle.setAttribute("aria-label", "关闭后台导航");
  };
  toggle.addEventListener("click", () =>
    document.body.classList.contains("mobile-nav-open") ? close() : open(),
  );
  backdrop.addEventListener("click", close);
  aside.querySelector("nav")?.addEventListener(
    "click",
    (event) => {
      const subsection = event.target.closest(
        "[data-store-section],[data-appearance-pane]",
      );
      if (subsection) {
        title.textContent = subsection.hasAttribute("data-store-section")
          ? "店铺设置"
          : "店铺外观";
        close();
        return;
      }
      const button = event.target.closest("[data-view]");
      if (!button) return;
      if (
        button.dataset.view === "settings" ||
        button.dataset.view === "appearance"
      ) {
        event.preventDefault();
        event.stopImmediatePropagation();
        /* The old view switcher stays responsible for opening the page. */
        if (typeof button.onclick === "function")
          button.onclick.call(button, event);
        const menu = document.querySelector(
          button.dataset.view === "settings"
            ? "#storeSettingsSubmenu"
            : "#appearanceSubmenu",
        );
        const open = !!menu && !menu.classList.contains("open");
        menu?.classList.toggle("open", open);
        button.classList.toggle("expanded", open);
        button.setAttribute("aria-expanded", String(open));
        title.textContent = button.textContent.replace(/\d+/g, "").trim();
        return;
      }
      title.textContent = button.textContent.replace(/\d+/g, "").trim();
      close();
    },
    true,
  );
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") close();
  });
})();
