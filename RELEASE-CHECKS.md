# 自动化测试与发布检查

运行完整检查：

```text
node scripts/release-check.mjs
```

检查会验证所有 HTML 与后台动态模块引用的本地资源、浏览器 JavaScript 与 Edge Function TypeScript 语法、本地模块路径，并运行零依赖测试。测试至少覆盖：

- 下单请求与提交中锁定；
- 幂等键与原子防重复提交；
- 顾客订单查询 RPC；
- 店铺设置合并与保存；
- 未登录后台启动无脚本报错；
- 媒体引用识别、保护期、默认资源保护和店主权限。

仅运行测试可使用：

```text
node --test tests/*.test.mjs
```

这套快速检查不会连接生产数据库，也不会创建测试订单。涉及 Supabase migration 或 Edge Function 的变更，在发布前仍应使用测试项目完成一次真实下单与相同幂等键重放。

## 此批性能优化的上线顺序

1. 在 Supabase SQL Editor 执行 `storefront-snapshot-migration.sql`。
2. 按 `MEDIA-CLEANUP-DEPLOY.md` 部署 `admin-media-cleanup` Edge Function。
3. 再次运行 `node scripts/release-check.mjs`。
4. 最后发布前端静态文件。

快照 RPC 尚未部署时，顾客端会自动退回原有公开请求，不会阻止页面加载；媒体清理入口则应在对应 Edge Function 部署后再交付店主使用。

仓库中的 `.github/workflows/release-check.yml` 会在 `main` 推送和 Pull Request 时自动运行同一套检查。
