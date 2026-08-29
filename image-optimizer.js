/* Shared image processing for product photos and storefront illustrations.
   Images remain in the existing database fields, but are resized and encoded
   before they ever become a Base64 value in Supabase. */
(() => {
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
    // Do not flatten animations or vector artwork into a static raster image.
    if (blob.type === "image/gif" || blob.type === "image/svg+xml")
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

  async function optimizeCatalogImages(db, { onProgress } = {}) {
    const [productsResult, variantsResult] = await Promise.all([
      db.from("products").select("id, image"),
      db.from("product_variants").select("id, image"),
    ]);
    if (productsResult.error || variantsResult.error)
      throw productsResult.error || variantsResult.error;
    const jobs = [
      ...(productsResult.data || []).map((row) => ({ ...row, table: "products" })),
      ...(variantsResult.data || []).map((row) => ({ ...row, table: "product_variants" })),
    ].filter((row) => /^data:image\//i.test(String(row.image || "")));
    const summary = { total: jobs.length, done: 0, converted: 0, skipped: 0, failed: 0, savedBytes: 0 };
    for (const job of jobs) {
      try {
        const result = await optimizeDataUrl(job.image, {
          maxDimension: 1200,
          quality: 0.82,
        });
        if (result.changed) {
          const update = { image: result.dataUrl };
          if (job.table === "products") update.updated_at = new Date().toISOString();
          const { error } = await db.from(job.table).update(update).eq("id", job.id);
          if (error) throw error;
          summary.converted += 1;
          summary.savedBytes += Math.max(0, result.originalBytes - result.optimizedBytes);
        } else summary.skipped += 1;
      } catch (error) {
        console.warn("图片优化失败", job.table, job.id, error);
        summary.failed += 1;
      }
      summary.done += 1;
      onProgress?.({ ...summary, job });
    }
    return summary;
  }

  window.TingsImage = {
    optimizeFile,
    optimizeDataUrl,
    optimizeCatalogImages,
  };
})();
