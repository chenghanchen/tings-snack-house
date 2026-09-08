# 后台媒体清理部署

媒体清理不需要数据库迁移，也不增加浏览器依赖。它由后台页面和一个店主专用的 Supabase Edge Function 组成。

部署前运行：

```text
node scripts/release-check.mjs
```

部署顺序：

1. 部署 `supabase/functions/admin-media-cleanup`，保持 `supabase/config.toml` 中 `verify_jwt = true`。
2. 发布包含 `admin-auth.js` 与 `media-cleanup.js` 的前端。
3. 使用店主账号登录，在「媒体清理」页面先扫描、预览，再选择删除。

Supabase 托管环境会自动提供 `SUPABASE_URL`、`SUPABASE_ANON_KEY` 和 `SUPABASE_SERVICE_ROLE_KEY`。可选 secret：

- `MEDIA_CLEANUP_OWNER_EMAIL`：店主邮箱；默认 `chenghanchen1@gmail.com`。
- `MEDIA_CLEANUP_GRACE_HOURS`：新上传文件保护期；默认 24 小时。
- `MEDIA_CLEANUP_PROTECTED_PATHS`：永不删除的额外 Storage 路径，逗号分隔。
- `MEDIA_CLEANUP_ALLOWED_ORIGINS`：允许调用的站点来源，逗号分隔。
- `MEDIA_CLEANUP_MAX_OBJECTS`：一次安全扫描的最大 Storage 文件数；默认 20000。
- `MEDIA_CLEANUP_MAX_REFERENCE_ROWS`：每张引用表的最大扫描行数；默认 50000。

删除时，服务端会在读取 Storage 文件前后分别扫描 `products.image`、`product_variants.image`、`shop_settings.content` 和 `orders.items`，使用两次引用结果的并集。任一查询失败都会终止删除；默认资源、仍有数据库引用、上传未满保护期或时间未知的文件都不会删除。
