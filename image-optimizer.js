/* Shared admin image processing for product photos and storefront artwork.
   Images are resized and encoded before upload to Supabase Storage; table
   fields retain only their public CDN URLs. */
(() => {
  const STORAGE_BUCKET = "storefront-images";
  const UPLOAD_PROFILES = Object.freeze({
    product: Object.freeze({
      folder: "products",
      maxDimension: 1200,
      quality: 0.82,
      forceWebp: true,
      maxBytes: 240 * 1024,
    }),
    variant: Object.freeze({
      folder: "variants",
      maxDimension: 1200,
      quality: 0.82,
      forceWebp: true,
      maxBytes: 240 * 1024,
    }),
    hero: Object.freeze({
      folder: "hero",
      maxDimension: 1920,
      quality: 0.84,
      forceWebp: true,
      maxBytes: 256 * 1024,
    }),
    announcement: Object.freeze({
      folder: "appearance/announcement",
      maxDimension: 1920,
      quality: 0.84,
      forceWebp: true,
      maxBytes: 180 * 1024,
    }),
    delivery: Object.freeze({
      folder: "appearance/delivery",
      maxDimension: 1920,
      quality: 0.84,
      forceWebp: true,
      maxBytes: 220 * 1024,
    }),
    footer: Object.freeze({
      folder: "footer",
      maxDimension: 2048,
      quality: 0.84,
      forceWebp: true,
      maxBytes: 180 * 1024,
    }),
  });
  const uploadCounts = new WeakMap(),
    uploadLockedControls = new WeakMap(),
    uploadCancelHandlers = new WeakMap();
  const dataUrlBytes = (value) => {
    const encoded = String(value || "").split(",")[1] || "";
    return Math.floor((encoded.length * 3) / 4);
  };

  const blobToDataUrl = (blob) =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error("图片读取失败"));
      reader.onload = () => resolve(reader.result);
      reader.readAsDataURL(blob);
    });

  const loadImage = (blob) =>
    new Promise((resolve, reject) => {
      const url = URL.createObjectURL(blob);
      const image = new Image();
      image.onload = () => {
        URL.revokeObjectURL(url);
        resolve(image);
      };
      image.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error("图片无法解码"));
      };
      image.src = url;
    });

  const canvasToBlob = (canvas, quality) =>
    new Promise((resolve) => canvas.toBlob(resolve, "image/webp", quality));

  function profileOptions(name, overrides = {}) {
    const profile = UPLOAD_PROFILES[name];
    if (!profile) throw new Error(`未知的图片上传类型：${name}`);
    return { ...profile, ...overrides, forceWebp: true };
  }

  function setUploadBusy(form, busy) {
    if (!form) return;
    const current = uploadCounts.get(form) || 0,
      next = Math.max(0, current + (busy ? 1 : -1));
    uploadCounts.set(form, next);
    if (busy && current === 0) {
      const dialog = form.closest?.("dialog"),
        scope = dialog || form;
      const controls = [
        ...scope.querySelectorAll("button, input, select, textarea"),
      ].filter((control) => !control.disabled);
      controls.forEach((control) => {
        control.disabled = true;
        control.dataset.imageUploadLock = "true";
      });
      uploadLockedControls.set(form, controls);
      form.setAttribute("aria-busy", "true");
      if (dialog) {
        const preventCancel = (event) => event.preventDefault();
        dialog.addEventListener("cancel", preventCancel);
        uploadCancelHandlers.set(form, { dialog, preventCancel });
      }
    }
    if (!busy && next === 0) {
      (uploadLockedControls.get(form) || []).forEach((control) => {
        if (control.dataset.imageUploadLock === "true") {
          control.disabled = false;
          delete control.dataset.imageUploadLock;
        }
      });
      uploadLockedControls.delete(form);
      const cancelHandler = uploadCancelHandlers.get(form);
      if (cancelHandler) {
        cancelHandler.dialog.removeEventListener(
          "cancel",
          cancelHandler.preventCancel,
        );
        uploadCancelHandlers.delete(form);
      }
      form.removeAttribute("aria-busy");
    }
  }

  async function withUploadLock(input, task) {
    const form = input?.closest?.("form");
    setUploadBusy(form, true);
    try {
      return await task();
    } finally {
      setUploadBusy(form, false);
    }
  }

  async function optimizeBlob(
    blob,
    {
      maxDimension = 1200,
      quality = 0.82,
      forceWebp = false,
      maxBytes = 0,
      minQuality = 0.58,
    } = {},
  ) {
    if (!blob?.type?.startsWith("image/"))
      throw new Error("请选择图片格式的文件");
    if (blob.type === "image/svg+xml")
      throw new Error("请先将 SVG 图片转换为 PNG、JPEG 或 WebP");
    // Do not silently flatten animations into a static storefront image.
    if (blob.type === "image/gif" && forceWebp)
      throw new Error("此处不支持 GIF，请上传 PNG、JPEG 或 WebP 图片");
    if (blob.type === "image/gif")
      return { blob, changed: false, skipped: true };
    const image = await loadImage(blob);
    const naturalWidth = image.naturalWidth || image.width,
      naturalHeight = image.naturalHeight || image.height,
      scale = Math.min(
      1,
      maxDimension / Math.max(naturalWidth, naturalHeight),
    );
    let width = Math.max(1, Math.round(naturalWidth * scale)),
      height = Math.max(1, Math.round(naturalHeight * scale)),
      currentQuality = quality,
      webp = null;
    const canvas = document.createElement("canvas");
    for (let attempt = 0; attempt < 12; attempt += 1) {
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext("2d", { alpha: true });
      context.clearRect(0, 0, width, height);
      context.drawImage(image, 0, 0, width, height);
      webp = await canvasToBlob(canvas, currentQuality);
      if (!webp || !maxBytes || webp.size <= maxBytes) break;
      if (currentQuality > minQuality) {
        currentQuality = Math.max(minQuality, currentQuality - 0.07);
      } else {
        const sizeRatio = Math.sqrt(maxBytes / webp.size),
          dimensionScale = Math.min(0.88, Math.max(0.65, sizeRatio * 0.94));
        width = Math.max(1, Math.round(width * dimensionScale));
        height = Math.max(1, Math.round(height * dimensionScale));
      }
    }
    if (!webp || webp.type !== "image/webp") {
      if (forceWebp)
        throw new Error(
          "当前浏览器无法将图片转换为 WebP，请更新浏览器后重试",
        );
      return { blob, changed: false, skipped: true };
    }
    if (maxBytes && webp.size > maxBytes)
      throw new Error(
        `图片优化后仍超过 ${Math.ceil(maxBytes / 1024)} KB，请选择构图更简单或尺寸更小的图片`,
      );
    // Keep a tiny original only when WebP would increase its payload notably.
    if (!forceWebp && webp.size > blob.size * 1.02)
      return { blob, changed: false, skipped: true };
    return {
      blob: webp,
      changed: blob.type !== "image/webp" || webp.size !== blob.size,
      skipped: false,
      width,
      height,
      quality: currentQuality,
    };
  }

  async function optimizeFile(file, options = {}) {
    const originalBytes = file?.size || 0;
    const { includeDataUrl = true, ...optimizeOptions } = options,
      result = await optimizeBlob(file, optimizeOptions),
      dataUrl = includeDataUrl ? await blobToDataUrl(result.blob) : undefined;
    return {
      ...result,
      dataUrl,
      originalBytes,
      optimizedBytes: result.blob.size,
    };
  }

  const extensionForType = (type) =>
    ({
      "image/jpeg": "jpg",
      "image/png": "png",
      "image/webp": "webp",
      "image/gif": "gif",
    })[type] || "bin";

  async function uploadBlob(
    db,
    blob,
    { folder = "uploads", cacheControl = "31536000" } = {},
  ) {
    const safeFolder = String(folder || "uploads")
        .replace(/[^a-z0-9/_-]+/gi, "-")
        .replace(/^\/+|\/+$/g, ""),
      token = globalThis.crypto?.randomUUID?.() ||
        `${Date.now()}-${Math.random().toString(16).slice(2)}`,
      path = `${safeFolder}/${token}.${extensionForType(blob.type)}`,
      { error } = await db.storage.from(STORAGE_BUCKET).upload(path, blob, {
        cacheControl,
        contentType: blob.type || "application/octet-stream",
        upsert: false,
      });
    if (error) {
      const setupHint = /bucket|row-level security|unauthorized/i.test(
        error.message || "",
      )
        ? "请先执行 supabase-storage-migration.sql 配置图片云存储。"
        : "";
      throw new Error(`${error.message || "图片上传失败"}${setupHint}`);
    }
    const { data } = db.storage.from(STORAGE_BUCKET).getPublicUrl(path);
    if (!data?.publicUrl) throw new Error("无法生成图片公开地址");
    return { path, publicUrl: data.publicUrl };
  }

  async function uploadOptimizedFile(db, file, options = {}) {
    const result = await optimizeFile(file, {
        ...options,
        includeDataUrl: false,
      }),
      uploaded = await uploadBlob(db, result.blob, options);
    return { ...result, ...uploaded };
  }

  async function uploadPreset(db, file, profile, overrides = {}) {
    const result = await uploadOptimizedFile(
      db,
      file,
      profileOptions(profile, overrides),
    );
    if (result.blob?.type !== "image/webp" || !/\.webp$/i.test(result.path || ""))
      throw new Error("图片未能以 WebP 格式上传，请重新选择图片");
    return result;
  }

  async function optimizeDataUrl(value, options) {
    if (!/^data:image\//i.test(String(value || "")))
      return { dataUrl: value, changed: false, skipped: true, originalBytes: 0, optimizedBytes: 0 };
    const originalBytes = dataUrlBytes(value);
    const blob = await fetch(value).then((response) => response.blob());
    const result = await optimizeBlob(blob, options);
    const dataUrl = result.changed ? await blobToDataUrl(result.blob) : value;
    return {
      ...result,
      dataUrl,
      originalBytes,
      optimizedBytes: result.changed ? result.blob.size : originalBytes,
    };
  }

  async function migrateCatalogImages(db, { onProgress } = {}) {
    const [productsResult, variantsResult] = await Promise.all([
      db.from("products").select("id, image"),
      db.from("product_variants").select("id, image"),
    ]);
    if (productsResult.error || variantsResult.error)
      throw productsResult.error || variantsResult.error;
    const jobs = [
      ...(productsResult.data || []).map((row) => ({
        ...row,
        table: "products",
        folder: "products",
      })),
      ...(variantsResult.data || []).map((row) => ({
        ...row,
        table: "product_variants",
        folder: "variants",
      })),
    ].filter((row) => /^data:image\//i.test(String(row.image || "")));
    const summary = {
      total: jobs.length,
      done: 0,
      migrated: 0,
      failed: 0,
      removedBytes: 0,
    };
    for (const job of jobs) {
      let uploaded;
      try {
        const optimized = await optimizeDataUrl(job.image, {
            maxDimension: 1200,
            quality: 0.82,
          }),
          blob = await fetch(optimized.dataUrl).then((response) =>
            response.blob(),
          );
        uploaded = await uploadBlob(db, blob, { folder: job.folder });
        const update = { image: uploaded.publicUrl };
        if (job.table === "products")
          update.updated_at = new Date().toISOString();
        const { error } = await db
          .from(job.table)
          .update(update)
          .eq("id", job.id);
        if (error) {
          await db.storage.from(STORAGE_BUCKET).remove([uploaded.path]);
          throw error;
        }
        summary.migrated += 1;
        summary.removedBytes += Math.max(
          0,
          String(job.image).length - uploaded.publicUrl.length,
        );
      } catch (error) {
        console.warn("图片云存储迁移失败", job.table, job.id, error);
        summary.failed += 1;
        if (/bucket|row-level security|unauthorized/i.test(error.message || ""))
          throw error;
      } finally {
        summary.done += 1;
        onProgress?.({ ...summary, job });
      }
    }
    return summary;
  }

  window.TingsImage = {
    UPLOAD_PROFILES,
    optimizeFile,
    optimizeDataUrl,
    uploadBlob,
    uploadOptimizedFile,
    uploadPreset,
    withUploadLock,
    migrateCatalogImages,
  };
})();
