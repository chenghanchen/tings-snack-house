# 项目发布规则

用户要求“发布”时必须完整阅读 `RELEASE-CHECKS.md`，按其门禁执行。

“发布”表示执行完整生产发布流程，不是只 git push：本地修改完成 → 自动测试 → PGlite 数据库测试 → Secret / Security 扫描 → 版本号 / Git Commit → GitHub main → Cloudflare Pages 前端部署 → Supabase Edge Functions 发布 → Cloudflare 平台核验 → Supabase 平台核验 → 生产桌面测试 → 生产手机测试 → 游客下单 Smoke Test → Release Report → RELEASE-HISTORY.md → 最终判定。

固定目标：GitHub `chenghanchen/tings-snack-house` 的 `main`；Cloudflare Pages `tings-snack-house`；Supabase 项目 `ragqunnuxsfwhrfqpylg`。用户明确要求“发布”即按此范围执行正常提交、推送、部署和核验；缺少凭据、平台权限或必须的审核证据时停止相关写入并记录 INCOMPLETE，不绕过权限。不 force push，不自动执行破坏性数据库迁移。

- 每次实际发布生成绑定完整 SHA 的 Release Report，用报告工具写入 `RELEASE-HISTORY.md`。
- `RELEASE-CHECKS.md` 只存规范，具体版本结果存历史及报告。
- 不把 Git push、平台部署或 HTTP 200 等同于全流程成功。
- 核心结果仅 `RELEASE SUCCESS`、`RELEASE FAILED`、`INCOMPLETE`。任何关键项明确失败为 RELEASE FAILED；无失败但缺证据为 INCOMPLETE；全部通过且报告与历史实际落盘并回读一致，才是 RELEASE SUCCESS / Production HEALTHY。
- Database 必须单独执行并报告；Tests PASS 不代替 Database PASS。Git、Tests、Database、Security、GitHub、Cloudflare、Supabase、Desktop、Mobile、Guest checkout、Release Report、Release History 均为必需项；生产资源一致性 Smoke Test 也不得省略。
- 缺依赖、跳过、超时、部分测试不能记 Tests PASS；mock 不能替代生产验证。
- 不伪造旧版本结果，不用另一个 SHA 的证据签署当前版本。
- 保留失败报告，最终回复列出失败 / 未验证项；不创建生产测试订单、不发送测试邮件，除非单独授权。
- 平台和浏览器门禁必须通过 `check` 自动采集；禁止手写 PASS。凭据或已审核的后端部署基线缺失记 PENDING。
- 日志不得含 Secret 或客户资料；Security PASS 只表示规定扫描范围，不是全面安全审计。
- 报告归档用单独 `docs(release):` 提交，引用被验证应用 SHA，避免无限发布循环。
- 沿用 GitHub / Cloudflare Pages / Supabase，不换托管服务，不修改安全权限绕过失败。

**推送 GitHub 不等于发布成功；只有生产环境验证完成并生成 Release Report、写入 RELEASE-HISTORY.md，才算发布完成。**
