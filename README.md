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

后台新增商品图、首页背景、活动公告栏背景、配送区域背景和页尾背景时，
浏览器会按各用途限制尺寸与体积，统一转换为 WebP，再使用 UUID 唯一路径
上传。上传完成前相应保存按钮会暂时锁定，避免把旧图片地址误存回数据库。
保存店铺外观时，如发现四类背景仍是历史 Base64，系统也会先迁移为上述
Storage URL，再更新设置。

页尾社交二维码使用 `appearance/qr/<平台>/<UUID>.png`：后台自动转为 PNG，
完成二维码内容扫描验证后才上传，并提供预览与移除入口。顾客端只接受这一
受控目录下的 PNG，且在顾客点击社交平台名称后才加载二维码图片。

`Golden Wok` 目录保留为迁移前的备份与其他视频素材目录；后续网站代码以本目录为准。
