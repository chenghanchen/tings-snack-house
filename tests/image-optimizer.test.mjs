import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import vm from "node:vm";
import { Blob } from "node:buffer";
import { webcrypto } from "node:crypto";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = await readFile(path.join(root, "image-optimizer.js"), "utf8");

function createRuntime(
  detectedCodes,
  { nativeDetector = true, fallbackValue = "", zxingValue = "" } = {},
) {
  const uploads = [];
  const canvas = {
    width: 0,
    height: 0,
    getContext() {
      return {
        clearRect() {},
        drawImage() {},
        fillRect() {},
        getImageData() {
          return { data: new Uint8ClampedArray(4) };
        },
        set fillStyle(_value) {},
        set imageSmoothingEnabled(_value) {},
        set imageSmoothingQuality(_value) {},
      };
    },
    toBlob(resolve, type) {
      resolve(new Blob(["optimized-qr"], { type }));
    },
  };
  class MockImage {
    naturalWidth = 600;
    naturalHeight = 600;
    width = 600;
    height = 600;
    set src(_value) {
      queueMicrotask(() => this.onload?.());
    }
  }
  class MockBarcodeDetector {
    static async getSupportedFormats() {
      return ["qr_code"];
    }
    async detect() {
      return detectedCodes;
    }
  }
  const window = {};
  vm.runInNewContext(
    source,
    {
      window,
      document: {
        querySelector() {
          return null;
        },
        createElement(name) {
          assert.equal(name, "canvas");
          return canvas;
        },
      },
      Image: MockImage,
      URL: {
        createObjectURL: () => "blob:test",
        revokeObjectURL() {},
      },
      Blob,
      BarcodeDetector: nativeDetector ? MockBarcodeDetector : undefined,
      jsQR: () => (fallbackValue ? { data: fallbackValue } : null),
      ZXing: {
        RGBLuminanceSource: class {},
        HybridBinarizer: class {},
        BinaryBitmap: class {},
        QRCodeReader: class {
          decode() {
            if (zxingValue) return { getText: () => zxingValue };
            const error = new Error("No QR found");
            error.name = "NotFoundException";
            throw error;
          }
        },
      },
      createImageBitmap: async () => ({ close() {} }),
      crypto: {
        getRandomValues: webcrypto.getRandomValues.bind(webcrypto),
      },
      queueMicrotask,
      console,
      Uint8Array,
    },
    { filename: "image-optimizer.js" },
  );
  const bucket = {
      async upload(storagePath, blob, options) {
        uploads.push({ storagePath, blob, options });
        return { error: null };
      },
      getPublicUrl(storagePath) {
        return {
          data: {
            publicUrl:
              "https://ragqunnuxsfwhrfqpylg.supabase.co/storage/v1/object/public/storefront-images/" +
              storagePath,
          },
        };
      },
    },
    db = {
      storage: {
        from(name) {
          assert.equal(name, "storefront-images");
          return bucket;
        },
      },
    };
  return { api: window.TingsImage, db, uploads };
}

test("二维码上传：压缩成 PNG、扫描通过后才写入平台 UUID 路径", async () => {
  const { api, db, uploads } = createRuntime([
    { rawValue: "https://example.test/social" },
  ]);
  const result = await api.uploadQrPng(
    db,
    new Blob(["source"], { type: "image/jpeg" }),
    "wechat",
  );

  assert.equal(result.blob.type, "image/png");
  assert.equal(result.qrValue, "https://example.test/social");
  assert.equal(result.verified, true);
  assert.equal(uploads.length, 1);
  assert.match(
    uploads[0].storagePath,
    /^appearance\/qr\/wechat\/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.png$/i,
  );
  assert.equal(uploads[0].blob.type, "image/png");
  assert.equal(uploads[0].options.contentType, "image/png");
  assert.equal(uploads[0].options.cacheControl, "31536000");
  assert.equal(uploads[0].options.upsert, false);
});

test("背景图上传：四类预设均输出 WebP 与各自的 UUID 路径", async () => {
  const { api, db, uploads } = createRuntime([]),
    profiles = new Map([
      ["hero", "hero"],
      ["announcement", "appearance/announcement"],
      ["delivery", "appearance/delivery"],
      ["footer", "footer"],
    ]);
  for (const [profile, folder] of profiles) {
    const result = await api.uploadPreset(
      db,
      new Blob([profile], { type: "image/jpeg" }),
      profile,
    );
    assert.equal(result.blob.type, "image/webp");
    assert.match(
      result.path,
      new RegExp(
        `^${folder}/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\\.webp$`,
        "i",
      ),
    );
  }
  assert.equal(uploads.length, 4);
  uploads.forEach(({ blob, options }) => {
    assert.equal(blob.type, "image/webp");
    assert.equal(options.contentType, "image/webp");
    assert.equal(options.upsert, false);
  });
});

test("二维码上传：无法扫描时失败关闭且不产生 Storage 文件", async () => {
  const { api, db, uploads } = createRuntime([]);
  await assert.rejects(
    api.uploadQrPng(
      db,
      new Blob(["not-a-qr"], { type: "image/png" }),
      "instagram",
    ),
    /没有识别到有效二维码/,
  );
  assert.deepEqual(uploads, []);
});

test("二维码上传：浏览器没有 BarcodeDetector 时使用兼容扫描器", async () => {
  const { api, db, uploads } = createRuntime([], {
    nativeDetector: false,
    fallbackValue: "wechat://verified",
  });
  const result = await api.uploadQrPng(
    db,
    new Blob(["source"], { type: "image/png" }),
    "wechat",
  );
  assert.equal(result.qrValue, "wechat://verified");
  assert.equal(result.verified, true);
  assert.equal(uploads.length, 1);
});

test("二维码上传：快速扫描失败后由备用算法验证成功才上传", async () => {
  const { api, db, uploads } = createRuntime([], {
    nativeDetector: false,
    zxingValue: "https://u.wechat.com/test-verified",
  });
  const result = await api.uploadQrPng(
    db, new Blob(["rounded-qr"], { type: "image/jpeg" }), "wechat",
  );
  assert.equal(result.qrValue, "https://u.wechat.com/test-verified");
  assert.equal(result.blob.type, "image/png");
  assert.equal(uploads.length, 1);
});

test("设置保存：店铺资料与店铺外观共享同一互斥锁", async () => {
  const { api } = createRuntime([]);
  let finishFirst;
  const first = api.withSettingsSaveLock(
    () => new Promise((resolve) => (finishFirst = resolve)),
  );
  await Promise.resolve();

  assert.equal(api.isSettingsSavePending(), true);
  await assert.rejects(
    api.withSettingsSaveLock(async () => {}),
    /另一项店铺设置正在保存/,
  );

  finishFirst("saved");
  assert.equal(await first, "saved");
  assert.equal(api.isSettingsSavePending(), false);
  await assert.doesNotReject(api.withSettingsSaveLock(async () => "next"));
});
