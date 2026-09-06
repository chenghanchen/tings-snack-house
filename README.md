# Snack House

这是零食小店网站的主项目目录，包含顾客端、管理端、样式、Supabase migration 和本地预览脚本。

- 顾客端入口：`index.html`
- 管理端入口：`admin.html`
- 本地预览：`node local-server.mjs` 或运行 `start-local-server.ps1`
- 发布仓库：`https://github.com/chenghanchen/tings-snack-house.git`

## Supabase 图片存储

首次启用图片 CDN 时，在 Supabase SQL Editor 执行
`supabase-storage-migration.sql`，然后在后台「商品管理」点击
「迁移商品图到云存储」并再次确认。此后新上传的网站和商品图片会直接
保存到 `storefront-images` Storage 桶，数据库只保留公开 URL。

`Golden Wok` 目录保留为迁移前的备份与其他视频素材目录；后续网站代码以本目录为准。
