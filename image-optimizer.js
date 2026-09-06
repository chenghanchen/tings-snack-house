/* Shared admin image processing for product photos and storefront artwork.
   Images are resized and encoded before upload to Supabase Storage; table
   fields retain only their public CDN URLs. */
(() => {
  const STORAGE_BUCKET = "storefront-images";
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

  async function optimizeBlob(
    blob,
    { maxDimension = 1200, quality = 0.82 } = {},
  ) {
    if (!blob?.type?.startsWith("image/"))
      throw new Error("请选择图片格式的文件");
    if (blob.type === "image/svg+xml")
      throw new Error("请先将 SVG 图片转换为 PNG、JPEG 或 WebP");
    // Do not flatten animations into a static raster image.
    if (blob.type === "image/gif")
      return { blob, changed: false, skipped: true };
    const image = await loadImage(blob);
    const scale = Math.min(
      1,
      maxDimension / Math.max(image.naturalWidth || image.width, image.naturalHeight || image.height),
    );
    const width = Math.max(1, Math.round((image.naturalWidth || image.width) * scale));
    const height = Math.max(1, Math.round((image.naturalHeight || image.height) * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d", { alpha: true });
    context.drawImage(image, 0, 0, width, height);
    const webp = await canvasToBlob(canvas, quality);
    if (!webp) return { blob, changed: false, skipped: true };
    // Keep a tiny original only when WebP would increase its payload notably.
    if (webp.size > blob.size * 1.02)
      return { blob, changed: false, skipped: true };
    return { blob: webp, changed: true, skipped: false, width, height };
  }

  async function optimizeFile(file, options) {
    const originalBytes = file?.size || 0;
    const result = await optimizeBlob(file, options);
    const dataUrl = await blobToDataUrl(result.blob);
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
    const result = await optimizeFile(file, options),
      uploaded = await uploadBlob(db, result.blob, options);
    return { ...result, ...uploaded };
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
    optimizeFile,
    optimizeDataUrl,
    uploadBlob,
    uploadOptimizedFile,
    migrateCatalogImages,
  };
})();
