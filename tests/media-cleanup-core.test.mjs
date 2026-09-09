import test from "node:test";
import assert from "node:assert/strict";
import {
  classifyStorageFile,
  collectStorageReferences,
  deleteOrphanFilesSafely,
  isDefaultProtectedPath,
  normalizeStoragePath,
  storagePathFromUrl,
} from "../supabase/functions/admin-media-cleanup/media-cleanup-core.mjs";

const publicBase =
  "https://ragqunnuxsfwhrfqpylg.supabase.co/storage/v1/object/public/storefront-images/";

test("媒体清理：从嵌套设置、商品与订单快照 URL 中收集 Storage 路径", () => {
  const references = collectStorageReferences({
    hero: `${publicBase}hero/one.webp`,
    nested: [
      { image: `${publicBase}products/%E9%BA%BB%E8%BE%A3.webp?download=1` },
      "footer-composite-v1.webp",
      "https://example.com/not-our-storage.webp",
    ],
  });
  assert.deepEqual([...references].sort(), [
    "hero/one.webp",
    "products/麻辣.webp",
  ]);
});

test("媒体清理：社交平台二维码作为嵌套 footerAppearance 引用受到保护", () => {
  const qrId = "550e8400-e29b-41d4-a716-446655440000";
  const qrPath = `appearance/qr/wechat/${qrId}.png`;
  const references = collectStorageReferences({
    footerAppearance: {
      socials: {
        wechat: { show: true, qr: `${publicBase}${qrPath}` },
        xiaohongshu: { show: false, qr: "" },
        facebook: {
          show: true,
          qr: "https://example.com/not-our-qr.png",
        },
      },
    },
  });

  assert.deepEqual([...references], [qrPath]);
  assert.equal(
    classifyStorageFile(
      { path: qrPath, updatedAt: "2026-08-01T00:00:00Z" },
      references,
      { now: Date.parse("2026-09-09T00:00:00Z") },
    ).protectedReason,
    "database_reference",
  );
});

test("媒体清理：支持 Supabase 图片转换 URL，拒绝其他桶与路径穿越", () => {
  assert.equal(
    storagePathFromUrl(
      "https://ragqunnuxsfwhrfqpylg.supabase.co/storage/v1/render/image/public/storefront-images/products/a.webp?width=400",
    ),
    "products/a.webp",
  );
  assert.equal(
    storagePathFromUrl(
      "https://ragqunnuxsfwhrfqpylg.supabase.co/storage/v1/object/public/private/a.webp",
    ),
    null,
  );
  assert.equal(normalizeStoragePath("products/../secret.webp"), null);
  assert.equal(normalizeStoragePath("products\\secret.webp"), null);
});

test("媒体清理：数据库引用、默认资源与新上传文件都不可删除", () => {
  const now = Date.parse("2026-09-08T20:00:00Z");
  const old = "2026-09-01T20:00:00Z";
  const recent = "2026-09-08T19:30:00Z";
  const references = new Set(["products/live.webp"]);
  assert.deepEqual(
    classifyStorageFile(
      { path: "products/live.webp", updatedAt: old },
      references,
      { now },
    ).protectedReason,
    "database_reference",
  );
  assert.equal(isDefaultProtectedPath("defaults/brand.webp"), true);
  assert.equal(
    classifyStorageFile(
      { path: "products/recent.webp", updatedAt: recent },
      references,
      { now },
    ).protectedReason,
    "recent_upload",
  );
  assert.equal(
    classifyStorageFile(
      { path: "products/orphan.webp", updatedAt: old },
      references,
      { now },
    ).eligible,
    true,
  );
});

test("媒体清理：时间未知时默认保护，额外保护名单生效", () => {
  const references = new Set();
  assert.equal(
    classifyStorageFile({ path: "products/no-date.webp" }, references)
      .protectedReason,
    "unknown_age",
  );
  assert.equal(
    classifyStorageFile(
      { path: "brand/never-delete.webp", updatedAt: "2020-01-01T00:00:00Z" },
      references,
      { extraProtectedPaths: ["brand/never-delete.webp"] },
    ).protectedReason,
    "default_asset",
  );
});

test("媒体删除：第二次扫描中新出现的引用会阻止删除", async () => {
  let referenceReads = 0;
  const removed = [];
  const result = await deleteOrphanFilesSafely({
    selectedPaths: ["products/referenced-during-delete.webp"],
    readReferences: async () => {
      referenceReads += 1;
      return referenceReads === 1
        ? new Set()
        : new Set(["products/referenced-during-delete.webp"]);
    },
    listFiles: async () => [
      {
        path: "products/referenced-during-delete.webp",
        updatedAt: "2026-09-01T00:00:00Z",
      },
    ],
    deleteFiles: async (paths) => removed.push(...paths),
    classificationOptions: {
      now: Date.parse("2026-09-08T00:00:00Z"),
      graceMs: 24 * 60 * 60 * 1000,
    },
  });
  assert.equal(referenceReads, 2);
  assert.deepEqual(removed, []);
  assert.deepEqual(result.deleted, []);
  assert.deepEqual(result.skipped, [
    {
      path: "products/referenced-during-delete.webp",
      reason: "database_reference",
    },
  ]);
});

test("媒体删除：第二次引用扫描失败时保持失败关闭且绝不删除", async () => {
  let referenceReads = 0;
  let deleteCalled = false;
  await assert.rejects(
    deleteOrphanFilesSafely({
      selectedPaths: ["products/orphan.webp"],
      readReferences: async () => {
        referenceReads += 1;
        if (referenceReads === 2) throw new Error("reference scan failed");
        return new Set();
      },
      listFiles: async () => [
        {
          path: "products/orphan.webp",
          updatedAt: "2026-09-01T00:00:00Z",
        },
      ],
      deleteFiles: async () => {
        deleteCalled = true;
      },
    }),
    /reference scan failed/,
  );
  assert.equal(referenceReads, 2);
  assert.equal(deleteCalled, false);
});
