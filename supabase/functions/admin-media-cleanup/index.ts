import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";
import {
  STOREFRONT_IMAGE_BUCKET,
  classifyStorageFile,
  collectStorageReferences,
  deleteOrphanFilesSafely,
  normalizeStoragePath,
} from "../_shared/media-cleanup-core.mjs";

const productionOrigin = "https://tings-snack-house.pages.dev";
const ownerEmail = (
  Deno.env.get("MEDIA_CLEANUP_OWNER_EMAIL") ?? "chenghanchen1@gmail.com"
).toLowerCase();
const allowedOrigins = new Set(
  (Deno.env.get("MEDIA_CLEANUP_ALLOWED_ORIGINS") ??
    `${productionOrigin},http://127.0.0.1:4173,http://localhost:4173`)
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean),
);
const listPageSize = 1000;
const maxStorageObjects = positiveInteger(
  Deno.env.get("MEDIA_CLEANUP_MAX_OBJECTS"),
  20_000,
);
const maxReferenceRows = positiveInteger(
  Deno.env.get("MEDIA_CLEANUP_MAX_REFERENCE_ROWS"),
  50_000,
);
const graceMs =
  positiveInteger(Deno.env.get("MEDIA_CLEANUP_GRACE_HOURS"), 24) *
  60 *
  60 *
  1000;
const extraProtectedPaths = (Deno.env.get("MEDIA_CLEANUP_PROTECTED_PATHS") ?? "")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);

type ListedFile = {
  path: string;
  size: number;
  createdAt: string | null;
  updatedAt: string | null;
  contentType: string | null;
};

class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

function positiveInteger(value: string | undefined, fallback: number) {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function corsHeaders(origin: string | null) {
  return {
    "Access-Control-Allow-Origin":
      origin && allowedOrigins.has(origin) ? origin : productionOrigin,
    "Access-Control-Allow-Headers":
      "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    Vary: "Origin",
  };
}

function json(body: unknown, status: number, origin: string | null) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders(origin),
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

async function requireOwner(request: Request) {
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  if (!supabaseUrl || !anonKey)
    throw new HttpError(503, "媒体清理服务尚未完成配置");
  const authorization = request.headers.get("authorization") ?? "";
  const token = authorization.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!token) throw new HttpError(401, "请先登录店主后台");
  const authClient = createClient(supabaseUrl, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await authClient.auth.getUser(token);
  if (error || !data.user) throw new HttpError(401, "登录已过期，请重新登录");
  if (String(data.user.email ?? "").toLowerCase() !== ownerEmail)
    throw new HttpError(403, "此账号没有媒体清理权限");
}

function createAdminClient() {
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey)
    throw new HttpError(503, "媒体清理服务尚未完成配置");
  return createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function readAllRows(
  admin: SupabaseClient,
  table: string,
  columns: string,
) {
  const rows: Record<string, unknown>[] = [];
  let lastId: string | number | null = null;
  while (rows.length < maxReferenceRows) {
    let query = admin
      .from(table)
      .select(`id,${columns}`)
      .order("id", { ascending: true })
      .limit(listPageSize);
    if (lastId !== null) query = query.gt("id", lastId);
    const { data, error } = await query;
    if (error)
      throw new HttpError(
        503,
        `无法核对 ${table} 图片引用；为防止误删，本次操作已停止`,
      );
    const page = (data ?? []) as Record<string, unknown>[];
    rows.push(...page);
    if (page.length < listPageSize) return rows;
    const nextId = page.at(-1)?.id;
    if (typeof nextId !== "string" && typeof nextId !== "number")
      throw new HttpError(
        503,
        `${table} 缺少稳定主键；为防止误删，本次操作已停止`,
      );
    if (String(nextId) === String(lastId))
      throw new HttpError(
        503,
        `${table} 分页游标未前进；为防止误删，本次操作已停止`,
      );
    lastId = nextId;
  }
  throw new HttpError(
    503,
    `${table} 数据超过安全扫描上限；请调高 MEDIA_CLEANUP_MAX_REFERENCE_ROWS`,
  );
}

async function collectDatabaseReferences(admin: SupabaseClient) {
  const [products, variants, settings, orders] = await Promise.all([
    readAllRows(admin, "products", "image"),
    readAllRows(admin, "product_variants", "image"),
    readAllRows(admin, "shop_settings", "content"),
    readAllRows(admin, "orders", "items"),
  ]);
  const references = new Set<string>();
  for (const row of products) collectStorageReferences(row.image, references);
  for (const row of variants) collectStorageReferences(row.image, references);
  for (const row of settings) collectStorageReferences(row.content, references);
  // Order item snapshots are still displayed in the owner dashboard. Keep their
  // thumbnails available even after a product or variant has been retired.
  for (const row of orders) collectStorageReferences(row.items, references);
  return references;
}

async function listStorageFiles(admin: SupabaseClient) {
  const files: ListedFile[] = [];
  const folders = [""];
  const visited = new Set<string>();
  while (folders.length) {
    const folder = folders.shift()!;
    if (visited.has(folder)) continue;
    visited.add(folder);
    if (folder.split("/").filter(Boolean).length > 12)
      throw new HttpError(503, "Storage 文件夹层级超过安全扫描上限");
    for (let offset = 0; ; offset += listPageSize) {
      const { data, error } = await admin.storage
        .from(STOREFRONT_IMAGE_BUCKET)
        .list(folder, {
          limit: listPageSize,
          offset,
          sortBy: { column: "name", order: "asc" },
        });
      if (error)
        throw new HttpError(503, `无法读取图片存储：${error.message}`);
      const page = data ?? [];
      for (const item of page) {
        const path = normalizeStoragePath(
          folder ? `${folder}/${item.name}` : item.name,
        );
        if (!path) continue;
        if (item.id || item.metadata) {
          files.push({
            path,
            size: Number(item.metadata?.size ?? 0),
            createdAt: item.created_at ?? null,
            updatedAt: item.updated_at ?? null,
            contentType: item.metadata?.mimetype ?? null,
          });
          if (files.length > maxStorageObjects)
            throw new HttpError(
              503,
              "Storage 文件数量超过安全扫描上限；请调高 MEDIA_CLEANUP_MAX_OBJECTS",
            );
        } else folders.push(path);
      }
      if (page.length < listPageSize) break;
    }
  }
  return files;
}

function publicUrl(admin: SupabaseClient, path: string) {
  return admin.storage.from(STOREFRONT_IMAGE_BUCKET).getPublicUrl(path).data
    .publicUrl;
}

async function scan(admin: SupabaseClient) {
  // Any failed reference query stops the whole request. A partial reference
  // set must never be used to decide whether a file is safe to delete.
  const [references, files] = await Promise.all([
    collectDatabaseReferences(admin),
    listStorageFiles(admin),
  ]);
  const now = Date.now();
  let referencedFiles = 0;
  let protectedFiles = 0;
  const orphaned = [];
  for (const file of files) {
    const classification = classifyStorageFile(file, references, {
      now,
      graceMs,
      extraProtectedPaths,
    });
    if (classification.protectedReason === "database_reference") {
      referencedFiles += 1;
      continue;
    }
    if (classification.protectedReason === "default_asset") {
      protectedFiles += 1;
      continue;
    }
    orphaned.push({
      ...file,
      publicUrl: publicUrl(admin, file.path),
      eligible: classification.eligible,
      protectedReason: classification.protectedReason,
    });
  }
  orphaned.sort((a, b) =>
    String(a.updatedAt ?? a.createdAt ?? "").localeCompare(
      String(b.updatedAt ?? b.createdAt ?? ""),
    )
  );
  return {
    scannedAt: new Date(now).toISOString(),
    graceHours: graceMs / (60 * 60 * 1000),
    summary: {
      totalFiles: files.length,
      referencedFiles,
      protectedFiles,
      orphanFiles: orphaned.length,
      eligibleFiles: orphaned.filter((file) => file.eligible).length,
      orphanBytes: orphaned.reduce((sum, file) => sum + file.size, 0),
      eligibleBytes: orphaned
        .filter((file) => file.eligible)
        .reduce((sum, file) => sum + file.size, 0),
    },
    files: orphaned,
  };
}

async function removeSelected(
  admin: SupabaseClient,
  selectedPaths: unknown,
  confirmation: unknown,
) {
  if (confirmation !== "DELETE_ORPHAN_MEDIA")
    throw new HttpError(400, "缺少删除确认");
  if (!Array.isArray(selectedPaths) || !selectedPaths.length)
    throw new HttpError(400, "请先选择要删除的图片");
  if (selectedPaths.length > 100)
    throw new HttpError(400, "每次最多删除 100 张图片");
  const requested = [
    ...new Set(selectedPaths.map(normalizeStoragePath).filter(Boolean)),
  ] as string[];
  if (requested.length !== selectedPaths.length)
    throw new HttpError(400, "待删除图片路径无效或重复");

  return await deleteOrphanFilesSafely({
    selectedPaths: requested,
    readReferences: () => collectDatabaseReferences(admin),
    listFiles: () => listStorageFiles(admin),
    classificationOptions: { graceMs, extraProtectedPaths },
    deleteFiles: async (paths: string[]) => {
      const { error } = await admin.storage
        .from(STOREFRONT_IMAGE_BUCKET)
        .remove(paths);
      if (error) throw new HttpError(503, `图片删除失败：${error.message}`);
    },
  });
}

Deno.serve(async (request) => {
  const origin = request.headers.get("origin");
  if (request.method === "OPTIONS") {
    if (origin && !allowedOrigins.has(origin))
      return json({ error: "Origin not allowed" }, 403, origin);
    return new Response(null, { status: 204, headers: corsHeaders(origin) });
  }
  if (request.method !== "POST")
    return json({ error: "Method not allowed" }, 405, origin);
  if (origin && !allowedOrigins.has(origin))
    return json({ error: "Origin not allowed" }, 403, origin);
  try {
    await requireOwner(request);
    const contentLength = Number(request.headers.get("content-length") || 0);
    if (contentLength > 32_768)
      throw new HttpError(413, "请求内容过大");
    let body: Record<string, unknown> = {};
    try {
      body = (await request.json()) as Record<string, unknown>;
    } catch {
      throw new HttpError(400, "请求格式无效");
    }
    const admin = createAdminClient();
    if (body.action === "scan") return json(await scan(admin), 200, origin);
    if (body.action === "delete")
      return json(
        await removeSelected(admin, body.paths, body.confirmation),
        200,
        origin,
      );
    throw new HttpError(400, "未知的媒体清理操作");
  } catch (error) {
    const status = error instanceof HttpError ? error.status : 500;
    if (status >= 500) console.error("Admin media cleanup failed", error);
    return json(
      { error: error instanceof Error ? error.message : "媒体清理失败" },
      status,
      origin,
    );
  }
});
