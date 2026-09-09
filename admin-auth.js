(() => {
  "use strict";

  const OWNER_EMAIL = "chenghanchen1@gmail.com";
  const root = document.documentElement;
  const main = document.querySelector("main");
  const loader = document.querySelector(".admin-boot-loader");
  const toastNode = document.querySelector("#toast");
  const localStyles = [
    "admin.css?v=20260903g",
    "order-cards.css?v=20260905b",
    "order-tab.css?v=20260901a",
    "marketing-wizard.css?v=20260904o",
    "shop-status.css?v=20260901a",
  ];
  const adminScripts = [
    "image-optimizer.js?v=20260909b",
    "admin.js?v=20260909a",
    "admin-mobile-nav.js?v=20260828a",
    "order-cards.js?v=20260908c",
    "marketing.js?v=20260904d",
    "legacy-product-editor-bridge.js?v=20260828a",
    "category-product-manager.js?v=20260908a",
    "appearance-settings.js?v=20260909a",
    "store-settings.js?v=20260909a",
    "admin-order-controls.js?v=20260908c",
    "media-cleanup.js?v=20260908a",
  ];

  function setState(state) {
    root.dataset.adminState = state;
  }

  function toast(message) {
    if (!toastNode) return;
    toastNode.textContent = message;
    toastNode.classList.add("show");
    window.setTimeout(() => toastNode.classList.remove("show"), 3200);
  }

  function showAuthScreen(title, body) {
    root.classList.add("admin-auth-screen");
    if (main)
      main.innerHTML = `<header><div><p class="eyebrow">OWNER ACCESS</p><h1>${title}</h1></div></header><section class="panel narrow">${body}</section>`;
    window.finishAdminBoot?.();
  }

  function setBusy(form, busy) {
    form?.querySelectorAll("button,input").forEach((control) => {
      control.disabled = busy;
    });
  }

  function loadStyle(href) {
    return new Promise((resolve, reject) => {
      const link = document.createElement("link");
      link.rel = "stylesheet";
      link.href = href;
      link.onload = resolve;
      link.onerror = () => reject(new Error(`样式加载失败：${href}`));
      document.head.append(link);
    });
  }

  function loadFont() {
    const google = document.createElement("link");
    google.rel = "preconnect";
    google.href = "https://fonts.googleapis.com";
    document.head.append(google);
    const staticHost = document.createElement("link");
    staticHost.rel = "preconnect";
    staticHost.href = "https://fonts.gstatic.com";
    staticHost.crossOrigin = "anonymous";
    document.head.append(staticHost);
    const font = document.createElement("link");
    font.rel = "stylesheet";
    font.href =
      "https://fonts.googleapis.com/css2?family=Noto+Serif+SC:wght@600&display=swap";
    document.head.append(font);
  }

  function loadAdminScripts() {
    return Promise.all(
      adminScripts.map(
        (src) =>
          new Promise((resolve, reject) => {
            const script = document.createElement("script");
            script.src = src;
            script.async = false;
            script.onload = resolve;
            script.onerror = () =>
              reject(new Error(`管理模块加载失败：${src}`));
            document.body.append(script);
          }),
      ),
    );
  }

  async function loadAdmin() {
    setState("loading-modules");
    if (loader) loader.textContent = "正在加载店主后台…";
    window.armAdminBootFallback?.();
    loadFont();
    await Promise.all(localStyles.map(loadStyle));
    root.classList.remove("admin-auth-screen");
    await loadAdminScripts();
    if (root.dataset.adminState === "loading-modules") {
      setState("loading-data");
      if (window.adminCoreDataReady) window.finishAdminBoot?.();
    }
  }

  function renderLogin(client) {
    setState("login");
    showAuthScreen(
      "店主登录",
      `<p class="muted">仅店主账号可查看订单和管理网站。</p><form id="loginForm"><label>店主邮箱<input id="loginEmail" type="email" value="${OWNER_EMAIL}" required autocomplete="email"></label><label>密码<input id="loginPassword" type="password" required autocomplete="current-password"></label><button class="primary">登录后台</button><button class="text-btn" type="button" id="resetPassword">设置／忘记密码</button></form>`,
    );
    const form = document.querySelector("#loginForm");
    form?.addEventListener("submit", async (event) => {
      event.preventDefault();
      setBusy(form, true);
      const { data, error } = await client.auth.signInWithPassword({
        email: document.querySelector("#loginEmail").value,
        password: document.querySelector("#loginPassword").value,
      });
      if (error) {
        setBusy(form, false);
        return toast("邮箱或密码不正确");
      }
      if (data.user?.email !== OWNER_EMAIL) {
        await client.auth.signOut();
        setBusy(form, false);
        return toast("此账号没有店主权限");
      }
      location.reload();
    });
    document
      .querySelector("#resetPassword")
      ?.addEventListener("click", async () => {
        const email = document.querySelector("#loginEmail");
        if (!email?.reportValidity()) return;
        const { error } = await client.auth.resetPasswordForEmail(email.value, {
          redirectTo: location.href.split("#")[0],
        });
        toast(
          error
            ? error.message
            : "密码设置链接已发送到邮箱，请在同一设备打开。",
        );
      });
  }

  function renderRecovery(client) {
    setState("recovery");
    showAuthScreen(
      "设置新密码",
      `<form id="newPasswordForm"><label>新密码<input id="newPassword" type="password" minlength="8" required autocomplete="new-password"></label><label>再次输入新密码<input id="confirmPassword" type="password" minlength="8" required autocomplete="new-password"></label><button class="primary">保存新密码</button></form>`,
    );
    const form = document.querySelector("#newPasswordForm");
    form?.addEventListener("submit", async (event) => {
      event.preventDefault();
      const password = document.querySelector("#newPassword").value;
      if (password !== document.querySelector("#confirmPassword").value)
        return toast("两次输入的密码不一致");
      setBusy(form, true);
      const { error } = await client.auth.updateUser({ password });
      if (error) {
        setBusy(form, false);
        return toast(error.message);
      }
      history.replaceState({}, "", location.pathname);
      toast("密码已设置，请重新登录");
      await client.auth.signOut();
      window.setTimeout(() => location.reload(), 900);
    });
  }

  function renderError(message) {
    setState("error");
    showAuthScreen(
      "后台暂时无法加载",
      `<p class="muted">${message}</p><button class="primary" id="retryAdmin" type="button">重新加载</button>`,
    );
    document
      .querySelector("#retryAdmin")
      ?.addEventListener("click", () => location.reload());
  }

  async function start() {
    if (!window.supabase || !window.TINGS_SUPABASE)
      return renderError("登录服务未能加载，请检查网络后重试。");
    const client = window.supabase.createClient(
      window.TINGS_SUPABASE.url,
      window.TINGS_SUPABASE.anonKey,
    );
    if (location.hash.includes("type=recovery"))
      return renderRecovery(client);
    try {
      const {
        data: { session },
        error,
      } = await client.auth.getSession();
      if (error) throw error;
      if (session?.user?.email === OWNER_EMAIL) return await loadAdmin();
      if (session) await client.auth.signOut();
      renderLogin(client);
    } catch (error) {
      console.error("Admin authentication bootstrap failed", error);
      renderError("无法验证登录状态，请检查网络后重试。");
    }
  }

  start();
})();
