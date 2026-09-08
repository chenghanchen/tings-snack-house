/* Owner-only media cleanup UI. The Edge Function is the security boundary and
   rechecks every database reference immediately before deleting a file. */
(() => {
  "use strict";

  const OWNER_EMAIL = "chenghanchen1@gmail.com";
  const $ = (selector) => document.querySelector(selector);
  const state = { files: [], selected: new Set(), scanned: false, busy: false };
  let db;

  function toast(message) {
    const node = $("#toast");
    if (!node) return;
    node.textContent = message;
    node.classList.add("show");
    setTimeout(() => node.classList.remove("show"), 3200);
  }

  function bytes(value) {
    const size = Number(value || 0);
    if (size < 1024) return `${size} B`;
    if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
    return `${(size / 1024 / 1024).toFixed(2)} MB`;
  }

  function date(value) {
    const parsed = new Date(value || "");
    return Number.isFinite(parsed.getTime())
      ? parsed.toLocaleString("zh-CN", {
          dateStyle: "medium",
          timeStyle: "short",
          hour12: false,
        })
      : "日期未知";
  }

  async function functionError(error, fallback) {
    const response = error?.context;
    if (response?.clone) {
      try {
        const payload = await response.clone().json();
        if (payload?.error) return payload.error;
      } catch {}
    }
    return error?.message || fallback;
  }

  async function invoke(body) {
    const { data, error } = await db.functions.invoke("admin-media-cleanup", {
      body,
    });
    if (error) throw new Error(await functionError(error, "媒体清理服务暂时不可用"));
    if (!data || typeof data !== "object")
      throw new Error("媒体清理服务返回了无效结果");
    return data;
  }

  function setBusy(busy, label = "") {
    state.busy = busy;
    const scan = $("#scanOrphanMedia"),
      remove = $("#deleteOrphanMedia"),
      selectAll = $("#selectAllOrphanMedia"),
      status = $("#mediaCleanupStatus");
    if (scan) scan.disabled = busy;
    if (remove) remove.disabled = busy || state.selected.size === 0;
    if (selectAll) selectAll.disabled = busy || !state.files.some((x) => x.eligible);
    $("#mediaCleanupList")
      ?.querySelectorAll('input[type="checkbox"]')
      .forEach((input) => (input.disabled = busy || input.dataset.eligible !== "true"));
    if (status && label) status.textContent = label;
  }

  function updateSelection() {
    const eligible = state.files.filter((file) => file.eligible),
      selectedBytes = eligible
        .filter((file) => state.selected.has(file.path))
        .reduce((sum, file) => sum + Number(file.size || 0), 0),
      button = $("#deleteOrphanMedia"),
      selectAll = $("#selectAllOrphanMedia");
    if (button) {
      button.disabled = state.busy || state.selected.size === 0;
      button.textContent = state.selected.size
        ? `删除已选 ${state.selected.size} 项（${bytes(selectedBytes)}）`
        : "删除已选图片";
    }
    if (selectAll) {
      selectAll.checked =
        eligible.length > 0 && eligible.every((file) => state.selected.has(file.path));
      selectAll.indeterminate =
        state.selected.size > 0 && !selectAll.checked;
    }
  }

  function reasonText(reason, graceHours) {
    if (reason === "recent_upload") return `上传未满 ${graceHours} 小时，暂不允许删除`;
    if (reason === "unknown_age") return "无法确认上传时间，已安全保护";
    if (reason === "invalid_path") return "文件路径异常，已安全保护";
    return "当前不可删除";
  }

  function render(data) {
    const summary = data.summary || {},
      files = Array.isArray(data.files) ? data.files : [],
      list = $("#mediaCleanupList"),
      summaryNode = $("#mediaCleanupSummary"),
      status = $("#mediaCleanupStatus");
    state.files = files;
    state.selected.clear();
    state.scanned = true;
    if (summaryNode)
      summaryNode.textContent =
        `已检查 ${summary.totalFiles || 0} 个文件；` +
        `${summary.referencedFiles || 0} 个正在使用，` +
        `${summary.eligibleFiles || 0} 个可安全删除（${bytes(summary.eligibleBytes)}）。`;
    if (status)
      status.textContent = files.length
        ? `扫描时间：${date(data.scannedAt)}`
        : "没有发现孤立图片。";
    if (!list) return;
    list.replaceChildren();
    if (!files.length) {
      const empty = document.createElement("p");
      empty.className = "muted media-cleanup-empty";
      empty.textContent = "Storage 中的图片都有数据库引用，当前无需清理。";
      list.append(empty);
      updateSelection();
      return;
    }
    const fragment = document.createDocumentFragment();
    for (const file of files) {
      const row = document.createElement("article");
      row.className = `media-cleanup-row${file.eligible ? "" : " is-protected"}`;
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.dataset.mediaPath = file.path;
      checkbox.dataset.eligible = String(!!file.eligible);
      checkbox.disabled = !file.eligible;
      checkbox.setAttribute("aria-label", `选择 ${file.path}`);
      checkbox.addEventListener("change", () => {
        if (checkbox.checked && state.selected.size >= 100) {
          checkbox.checked = false;
          toast("每次最多选择 100 张图片，请分批清理");
        } else if (checkbox.checked) state.selected.add(file.path);
        else state.selected.delete(file.path);
        updateSelection();
      });
      const preview = document.createElement("a");
      preview.className = "media-cleanup-preview";
      preview.href = file.publicUrl;
      preview.target = "_blank";
      preview.rel = "noopener noreferrer";
      preview.setAttribute("aria-label", `预览 ${file.path}`);
      const image = document.createElement("img");
      image.src = file.publicUrl;
      image.alt = "";
      image.loading = "lazy";
      image.addEventListener("error", () => {
        image.hidden = true;
        preview.classList.add("preview-error");
      });
      preview.append(image);
      const details = document.createElement("div");
      const path = document.createElement("strong");
      path.textContent = file.path;
      const metadata = document.createElement("small");
      metadata.textContent = `${bytes(file.size)} · ${date(file.updatedAt || file.createdAt)}`;
      details.append(path, metadata);
      if (!file.eligible) {
        const protection = document.createElement("em");
        protection.textContent = reasonText(file.protectedReason, data.graceHours || 24);
        details.append(protection);
      }
      row.append(checkbox, preview, details);
      fragment.append(row);
    }
    list.append(fragment);
    updateSelection();
  }

  async function scan(force = false) {
    if (state.busy && !force) return;
    setBusy(true, "正在核对数据库引用与 Storage 文件…");
    try {
      render(await invoke({ action: "scan" }));
    } catch (error) {
      $("#mediaCleanupStatus").textContent = error.message;
      toast(error.message);
    } finally {
      setBusy(false);
      updateSelection();
    }
  }

  async function removeSelected() {
    if (state.busy || !state.selected.size) return;
    const paths = [...state.selected],
      selectedBytes = state.files
        .filter((file) => state.selected.has(file.path))
        .reduce((sum, file) => sum + Number(file.size || 0), 0);
    if (
      !confirm(
        `确定永久删除 ${paths.length} 张孤立图片（${bytes(selectedBytes)}）？\n\n删除后无法恢复；服务端会再次核对引用。`,
      )
    )
      return;
    setBusy(true, "正在重新核对并删除已选图片…");
    try {
      const result = await invoke({
        action: "delete",
        paths,
        confirmation: "DELETE_ORPHAN_MEDIA",
      });
      const deleted = result.deleted?.length || 0,
        skipped = result.skipped?.length || 0;
      toast(
        skipped
          ? `已删除 ${deleted} 项；${skipped} 项因引用变化或安全保护而跳过`
          : `已删除 ${deleted} 项孤立图片`,
      );
      await scan(true);
    } catch (error) {
      $("#mediaCleanupStatus").textContent = error.message;
      toast(error.message);
    } finally {
      setBusy(false);
      updateSelection();
    }
  }

  function injectStyles() {
    if ($("#mediaCleanupStyles")) return;
    const style = document.createElement("style");
    style.id = "mediaCleanupStyles";
    style.textContent = `
      .media-cleanup-panel{max-width:850px}.media-cleanup-actions{display:flex;align-items:center;gap:12px;flex-wrap:wrap;margin:18px 0}.media-cleanup-actions label{display:flex;align-items:center;gap:7px;margin:0}.media-cleanup-actions input{width:auto;margin:0}.media-cleanup-status{min-height:1.5em;color:#6f7c73;font-size:13px}.media-cleanup-list{display:grid;gap:8px;margin-top:14px}.media-cleanup-row{display:grid;grid-template-columns:auto 74px minmax(0,1fr);gap:12px;align-items:center;padding:9px;border:1px solid var(--line);background:#fffdf8}.media-cleanup-row>input{width:auto;margin:0}.media-cleanup-preview{display:grid;place-items:center;width:74px;height:58px;overflow:hidden;border-radius:7px;background:#eee8dc;color:#867c70;text-decoration:none}.media-cleanup-preview img{width:100%;height:100%;object-fit:cover}.media-cleanup-preview.preview-error::after{content:'无法预览';font-size:11px}.media-cleanup-row strong,.media-cleanup-row small,.media-cleanup-row em{display:block;overflow-wrap:anywhere}.media-cleanup-row strong{font-size:13px}.media-cleanup-row small{margin-top:4px;color:#748078}.media-cleanup-row em{margin-top:4px;color:#966d34;font-size:11px;font-style:normal}.media-cleanup-row.is-protected{opacity:.72}.media-cleanup-empty{padding:20px;text-align:center}@media(max-width:720px){.media-cleanup-row{grid-template-columns:auto 60px minmax(0,1fr)}.media-cleanup-preview{width:60px;height:52px}.media-cleanup-actions .primary{width:100%}}
    `;
    document.head.append(style);
  }

  function build() {
    const nav = $("aside nav"),
      main = $("main");
    if (!nav || !main || $("#mediaCleanup")) return !!$("#mediaCleanup");
    injectStyles();
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.view = "mediaCleanup";
    button.textContent = "媒体清理";
    button.addEventListener("click", () => {
      document
        .querySelectorAll("aside nav button,.view")
        .forEach((node) => node.classList.remove("active"));
      button.classList.add("active");
      $("#mediaCleanup")?.classList.add("active");
      if ($("#pageTitle")) $("#pageTitle").textContent = "媒体清理";
      if (!state.scanned) scan();
    });
    nav.append(button);

    const section = document.createElement("section");
    section.className = "view";
    section.id = "mediaCleanup";
    section.innerHTML = `
      <div class="panel media-cleanup-panel">
        <div class="panel-head"><div><h2>孤立图片</h2><p class="muted">只显示未被商品、规格、店铺设置或历史订单引用的 Storage 图片。新上传图片会保护 24 小时。</p></div><button class="text-btn" id="scanOrphanMedia" type="button">重新扫描</button></div>
        <p id="mediaCleanupSummary" class="muted">进入本页后检查媒体文件。</p>
        <div class="media-cleanup-actions"><label><input id="selectAllOrphanMedia" type="checkbox" disabled> 全选可安全删除项</label><button class="primary" id="deleteOrphanMedia" type="button" disabled>删除已选图片</button></div>
        <p class="media-cleanup-status" id="mediaCleanupStatus" role="status" aria-live="polite"></p>
        <div class="media-cleanup-list" id="mediaCleanupList"></div>
      </div>`;
    main.append(section);
    $("#scanOrphanMedia")?.addEventListener("click", scan);
    $("#deleteOrphanMedia")?.addEventListener("click", removeSelected);
    $("#selectAllOrphanMedia")?.addEventListener("change", (event) => {
      state.selected.clear();
      if (event.currentTarget.checked)
        state.files
          .filter((file) => file.eligible)
          .slice(0, 100)
          .forEach((file) => state.selected.add(file.path));
      $("#mediaCleanupList")
        ?.querySelectorAll('input[data-eligible="true"]')
        .forEach((input) => (input.checked = state.selected.has(input.dataset.mediaPath)));
      updateSelection();
    });
    return true;
  }

  async function start() {
    if ($("#loginForm, #newPasswordForm")) return;
    if (!window.supabase || !window.TINGS_SUPABASE) return;
    db = window.TingsDb ||
      window.supabase.createClient(
        window.TINGS_SUPABASE.url,
        window.TINGS_SUPABASE.anonKey,
      );
    const { data, error } = await db.auth.getSession();
    if (error || data.session?.user?.email !== OWNER_EMAIL) return;
    if (!build()) return;
    window.TingsMediaCleanup = { scan };
  }

  if (document.readyState === "complete") start();
  else window.addEventListener("load", start, { once: true });
})();
