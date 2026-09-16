# Snack House

这是零食小店网站的主项目目录，包含顾客端、管理端、样式、Supabase migration 和本地预览脚本。

- 顾客端入口：`index.html`
- 管理端入口：`admin.html`
- 本地预览：`node local-server.mjs` 或运行 `start-local-server.ps1`
- 发布仓库：`https://github.com/chenghanchen/tings-snack-house.git`

## 发布管理

- [发布规则](RELEASE-CHECKS.md)：每次发布必需的检查与报告命令。
- [实际发布历史](RELEASE-HISTORY.md)：保存成功、失败和未完整验证的结果。
- `npm run release:security` 扫描源码 Secret；`npm run release:report -- init --version HEAD`
  初始化版本绑定报告。CI 自动上传预检报告；`Verify production release` 独立工作流自动采集平台、桌面/手机视口证据并上传完整报告与历史文件。
- 每次实际发布必须封存报告到历史，不能把“已推送”当成“全部验证通过”。
- 正式流程固定在 `RELEASE-CHECKS.md`：自动测试 → 独立 PGlite Database → Security → Commit / main Push → Cloudflare 前端部署 → Supabase 发布 → 双平台核验 → 生产桌面/手机/游客 Smoke Test → 报告与历史 → 最终判定。仅允许 `RELEASE SUCCESS`、`RELEASE FAILED`、`INCOMPLETE`；缺证据不能成功。

2026-09-13 内部测试版：账户、默认地址、订单、优惠券和邮箱账户推荐奖励入口统一开放。邮箱验证仍受 Resend 测试发件限制；游客可以不登录下单。内部测试标注不限制公开链接的访问，正式推广前需完成自有发信域名配置与多账户真实验收。

## Supabase 图片存储

顾客登录、账户订单和常用地址的开发／上线步骤见 [顾客账户启用清单](CUSTOMER-ACCOUNTS-SETUP.md)。上线前必须完成数据库权限、订单后端及验证码邮件配置，不能只发布前端。

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
