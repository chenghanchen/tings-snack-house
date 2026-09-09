/* Shared admin image processing for product photos and storefront artwork.
   Images are resized and encoded before upload to Supabase Storage; table
   fields retain only their public CDN URLs. */
(() => {
  const STORAGE_BUCKET = "storefront-images";
  const QR_DECODER_URL =
      "https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.js",
    QR_DECODER_INTEGRITY =
      "sha384-b5Ya4Bq3qCyz39m2ISh+4DxjAIljdeFwK/BsXLuj9gugaNwAcj/ia15fxNZL9Nlx";
  let qrDecoderPromise = null;
  const ZXING_DECODER_URL =
      "https://cdn.jsdelivr.net/npm/@zxing/library@0.21.3/umd/index.min.js",
    ZXING_DECODER_INTEGRITY =
      "sha384-BzBxP10ZE72aitqj5UMmUsbKFliP/DZqA8Wq+BNNhlIJDGoEd1tpkMYXOg9+n6sB";
  let zxingDecoderPromise = null;
  const UPLOAD_PROFILES = Object.freeze({
    product: Object.freeze({
      folder: "products",
      maxDimension: 1200,
      quality: 0.82,
      outputType: "image/webp",
      forceWebp: true,
      maxBytes: 240 * 1024,
    }),
    variant: Object.freeze({
      folder: "variants",
      maxDimension: 1200,
      quality: 0.82,
      outputType: "image/webp",
      forceWebp: true,
      maxBytes: 240 * 1024,
    }),
    hero: Object.freeze({
      folder: "hero",
      maxDimension: 1920,
      quality: 0.84,
      outputType: "image/webp",
      forceWebp: true,
      maxBytes: 256 * 1024,
    }),
    announcement: Object.freeze({
      folder: "appearance/announcement",
      maxDimension: 1920,
      quality: 0.84,
      outputType: "image/webp",
      forceWebp: true,
      maxBytes: 180 * 1024,
    }),
    delivery: Object.freeze({
      folder: "appearance/delivery",
      maxDimension: 1920,
      quality: 0.84,
      outputType: "image/webp",
      forceWebp: true,
      maxBytes: 220 * 1024,
    }),
    footer: Object.freeze({
      folder: "footer",
      maxDimension: 2048,
      quality: 0.84,
      outputType: "image/webp",
      forceWebp: true,
      maxBytes: 180 * 1024,
    }),
    qr: Object.freeze({
      folder: "appearance/qr",
      maxDimension: 1024,
      minDimension: 320,
      outputType: "image/png",
      backgroundColor: "#ffffff",
      imageSmoothing: false,
      maxBytes: 512 * 1024,
    }),
  });
  const uploadCounts = new WeakMap(),
    uploadLockedControls = new WeakMap(),
    uploadCancelHandlers = new WeakMap();
  let settingsSavePending = false;
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

  function loadQrDecoder() {
    if (globalThis.jsQR) return Promise.resolve(globalThis.jsQR);
    if (qrDecoderPromise) return qrDecoderPromise;
    qrDecoderPromise = new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = QR_DECODER_URL;
      script.integrity = QR_DECODER_INTEGRITY;
      script.crossOrigin = "anonymous";
      script.referrerPolicy = "no-referrer";
      script.dataset.tingsQrDecoder = "true";
      script.onload = () => {
        if (globalThis.jsQR) resolve(globalThis.jsQR);
        else {
          script.remove();
          qrDecoderPromise = null;
          reject(new Error("二维码扫描工具加载失败，请刷新后台后重试"));
        }
      };
      script.onerror = () => {
        script.remove();
        qrDecoderPromise = null;
        reject(new Error("二维码扫描工具加载失败，请检查网络后重试"));
      };
      document.head.append(script);
    });
    return qrDecoderPromise;
  }

  function loadZxingDecoder() {
    if (globalThis.ZXing?.QRCodeReader)
      return Promise.resolve(globalThis.ZXing);
    if (zxingDecoderPromise) return zxingDecoderPromise;
    zxingDecoderPromise = new Promise((resolve, reject) => {
      const script = document.createElement("script");
      const fail = () => {
        clearTimeout(timeout);
        script.remove();
        zxingDecoderPromise = null;
        reject(new Error("二维码兼容扫描工具加载失败，请检查网络后重试"));
      };
      const timeout = setTimeout(fail, 15000);
      script.src = ZXING_DECODER_URL;
      script.integrity = ZXING_DECODER_INTEGRITY;
      script.crossOrigin = "anonymous";
      script.referrerPolicy = "no-referrer";
      script.onload = () => {
        if (!globalThis.ZXing?.QRCodeReader) return fail();
        clearTimeout(timeout);
        resolve(globalThis.ZXing);
      };
      script.onerror = fail;
      document.head.append(script);
    });
    return zxingDecoderPromise;
  }

  const canvasToBlob = (canvas, type, quality) =>
    new Promise((resolve) => canvas.toBlob(resolve, type, quality));

  function profileOptions(name, overrides = {}) {
    const profile = UPLOAD_PROFILES[name];
    if (!profile) throw new Error(`未知的图片上传类型：${name}`);
    return { ...profile, ...overrides };
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

  async function withSettingsSaveLock(task) {
    if (settingsSavePending)
      throw new Error("另一项店铺设置正在保存，请稍候");
    settingsSavePending = true;
    const forms = [
      document.querySelector("#settingsForm"),
      document.querySelector("#appearanceForm"),
    ].filter((form, index, values) => form && values.indexOf(form) === index);
    forms.forEach((form) => setUploadBusy(form, true));
    try {
      return await task();
    } finally {
      forms.reverse().forEach((form) => setUploadBusy(form, false));
      settingsSavePending = false;
    }
  }

  const isSettingsSavePending = () => settingsSavePending;

  async function optimizeBlob(
    blob,
    {
      maxDimension = 1200,
      quality = 0.82,
      forceWebp = false,
      outputType = "image/webp",
      maxBytes = 0,
      minQuality = 0.58,
      minDimension = 1,
      backgroundColor = "",
      imageSmoothing = true,
    } = {},
  ) {
    if (!blob?.type?.startsWith("image/"))
      throw new Error("请选择图片格式的文件");
    if (blob.type === "image/svg+xml")
      throw new Error("请先将 SVG 图片转换为 PNG、JPEG 或 WebP");
    // Do not silently flatten animations into a static storefront image.
    if (blob.type === "image/gif" && (forceWebp || outputType !== blob.type))
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
      optimized = null;
    const canvas = document.createElement("canvas");
    for (let attempt = 0; attempt < 12; attempt += 1) {
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext("2d", { alpha: true });
      context.imageSmoothingEnabled = imageSmoothing;
      context.imageSmoothingQuality = "high";
      if (backgroundColor) {
        context.fillStyle = backgroundColor;
        context.fillRect(0, 0, width, height);
      } else context.clearRect(0, 0, width, height);
      context.drawImage(image, 0, 0, width, height);
      optimized = await canvasToBlob(canvas, outputType, currentQuality);
      if (!optimized || !maxBytes || optimized.size <= maxBytes) break;
      if (outputType === "image/webp" && currentQuality > minQuality) {
        currentQuality = Math.max(minQuality, currentQuality - 0.07);
      } else {
        const sizeRatio = Math.sqrt(maxBytes / optimized.size),
          dimensionScale = Math.min(0.88, Math.max(0.65, sizeRatio * 0.94));
        const nextWidth = Math.max(1, Math.round(width * dimensionScale)),
          nextHeight = Math.max(1, Math.round(height * dimensionScale));
        if (Math.max(nextWidth, nextHeight) < minDimension) break;
        width = nextWidth;
        height = nextHeight;
      }
    }
    if (!optimized || optimized.type !== outputType) {
      if (forceWebp || outputType !== "image/webp")
        throw new Error(
          `当前浏览器无法将图片转换为 ${outputType === "image/png" ? "PNG" : "WebP"}，请更新浏览器后重试`,
        );
      return { blob, changed: false, skipped: true };
    }
    if (maxBytes && optimized.size > maxBytes)
      throw new Error(
        `图片优化后仍超过 ${Math.ceil(maxBytes / 1024)} KB，请选择构图更简单或尺寸更小的图片`,
      );
    // Keep a tiny original only when WebP would increase its payload notably.
    if (
      !forceWebp &&
      outputType === "image/webp" &&
      optimized.size > blob.size * 1.02
    )
      return { blob, changed: false, skipped: true };
    return {
      blob: optimized,
      changed: blob.type !== outputType || optimized.size !== blob.size,
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

  function uuidV4() {
    const cryptoApi = globalThis.crypto;
    if (cryptoApi?.randomUUID) return cryptoApi.randomUUID();
    if (!cryptoApi?.getRandomValues)
      throw new Error("当前浏览器无法生成安全的图片文件名，请更新浏览器后重试");
    const bytes = cryptoApi.getRandomValues(new Uint8Array(16));
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = [...bytes].map((value) => value.toString(16).padStart(2, "0"));
    return `${hex.slice(0, 4).join("")}-${hex.slice(4, 6).join("")}-${hex.slice(6, 8).join("")}-${hex.slice(8, 10).join("")}-${hex.slice(10).join("")}`;
  }

  async function uploadBlob(
    db,
    blob,
    { folder = "uploads", cacheControl = "31536000" } = {},
  ) {
    const safeFolder = String(folder || "uploads")
        .replace(/[^a-z0-9/_-]+/gi, "-")
        .replace(/^\/+|\/+$/g, "") || "uploads",
      token = uuidV4(),
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
    const options = profileOptions(profile, overrides),
      result = await uploadOptimizedFile(
      db,
      file,
      options,
    ),
      expectedType = options.outputType || "image/webp",
      expectedExtension = extensionForType(expectedType);
    if (
      result.blob?.type !== expectedType ||
      !new RegExp(`\\.${expectedExtension}$`, "i").test(result.path || "")
    )
      throw new Error(
        `图片未能以 ${expectedType === "image/png" ? "PNG" : "WebP"} 格式上传，请重新选择图片`,
      );
    return result;
  }

  async function validateQrCode(blob) {
    const Detector = globalThis.BarcodeDetector;
    let source;
    if (Detector) {
      try {
        const formats = Detector.getSupportedFormats
          ? await Detector.getSupportedFormats()
          : ["qr_code"];
        if (formats.includes("qr_code")) {
          source = globalThis.createImageBitmap
            ? await globalThis.createImageBitmap(blob)
            : await loadImage(blob);
          const codes = await new Detector({ formats: ["qr_code"] }).detect(
              source,
            ),
            value = codes.find((code) => code?.rawValue)?.rawValue?.trim();
          if (value) return value;
        }
      } catch (error) {
        console.warn("原生二维码扫描不可用，改用兼容扫描器", error);
      } finally {
        source?.close?.();
      }
    }
    const image = await loadImage(blob),
      canvas = document.createElement("canvas"),
      width = image.naturalWidth || image.width,
      height = image.naturalHeight || image.height;
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    context.drawImage(image, 0, 0, width, height);
    const pixels = context.getImageData(0, 0, width, height);
    try {
      const decoder = await loadQrDecoder(),
        result = decoder(pixels.data, width, height, {
          inversionAttempts: "attemptBoth",
        }),
        value = result?.data?.trim();
      if (value) return value;
    } catch (error) {
      console.warn("快速二维码扫描不可用，改用兼容扫描器", error);
    }
    // Rounded WeChat modules can defeat jsQR despite containing valid data.
    // Decode the final PNG with a second algorithm before rejecting it.
    const zxing = await loadZxingDecoder(),
      luminance = new Uint8ClampedArray(width * height);
    for (let i = 0; i < luminance.length; i += 1) {
      const offset = i * 4;
      luminance[i] = (pixels.data[offset] + 2 * pixels.data[offset + 1] +
        pixels.data[offset + 2]) / 4;
    }
    try {
      const bitmap = new zxing.BinaryBitmap(new zxing.HybridBinarizer(
          new zxing.RGBLuminanceSource(luminance, width, height),
        )),
        value = new zxing.QRCodeReader().decode(bitmap)?.getText()?.trim();
      if (value) return value;
    } catch (error) {
      if (!["NotFoundException", "ChecksumException", "FormatException"]
        .includes(error?.getKind?.() || error?.name)) throw error;
    }
    throw new Error("没有识别到有效二维码，请上传清晰、完整并留有白边的二维码");
  }

  async function uploadQrPng(db, file, platform) {
    const allowedPlatforms = new Set([
      "wechat",
      "xiaohongshu",
      "douyin",
      "facebook",
      "instagram",
    ]);
    if (!allowedPlatforms.has(platform)) throw new Error("未知的社交媒体类型");
    const options = profileOptions("qr", {
        folder: `appearance/qr/${platform}`,
      }),
      result = await optimizeFile(file, {
        ...options,
        includeDataUrl: false,
      });
    if (result.blob?.type !== "image/png")
      throw new Error("二维码未能转换为 PNG，请重新选择图片");
    const qrValue = await validateQrCode(result.blob),
      uploaded = await uploadBlob(db, result.blob, options);
    if (!/\.png$/i.test(uploaded.path || ""))
      throw new Error("二维码未能以 PNG 格式上传，请重新选择图片");
    return { ...result, ...uploaded, qrValue, verified: true };
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
    uploadQrPng,
    validateQrCode,
    withUploadLock,
    withSettingsSaveLock,
    isSettingsSavePending,
    migrateCatalogImages,
  };
})();
