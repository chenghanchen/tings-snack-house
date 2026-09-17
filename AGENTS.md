# 项目发布规则

用户要求“发布”时必须完整阅读 `RELEASE-CHECKS.md`，按其门禁执行。

发布先按 `scripts/release-level.mjs` 对完整 base..head 分级，并按新版 schemaVersion 3 的 requiredGates 执行；L1/L2/L3 细则优先于下文旧版全量说明。L1 不因无关数据库、Edge Functions、Supabase baseline 未核验而 INCOMPLETE；相关项为 NOT_REQUIRED 而非 PASS。L2 按实际业务/数据库/后端依赖验证。L3 保留全部原高风险安全要求。多类变更取最高，未知范围/文件/依赖关系默认 L3，不得手工降低等级。旧报告保持不变。本地及 CI 只分类/测试不代表已获生产部署或人工审批。

“发布”表示执行完整生产发布流程，不是只 git push：本地修改完成 → 自动测试 → PGlite 数据库测试 → Secret / Security 扫描 → 版本号 / Git Commit → GitHub main → Cloudflare Pages 前端部署 → Supabase Edge Functions 发布 → Cloudflare 平台核验 → Supabase 平台核验 → 生产桌面测试 → 生产手机测试 → 游客下单 Smoke Test → Release Report → RELEASE-HISTORY.md → 最终判定。

固定目标：GitHub `chenghanchen/tings-snack-house` 的 `main`；Cloudflare Pages `tings-snack-house`；Supabase 项目 `ragqunnuxsfwhrfqpylg`。用户明确要求“发布”即按此范围执行正常提交、推送、部署和核验；缺少凭据、平台权限或必须的审核证据时停止相关写入并记录 INCOMPLETE，不绕过权限。不 force push，不自动执行破坏性数据库迁移。

- 每次实际发布生成绑定完整 SHA 的 Release Report，用报告工具写入 `RELEASE-HISTORY.md`。
- `RELEASE-CHECKS.md` 只存规范，具体版本结果存历史及报告。
- 不把 Git push、平台部署或 HTTP 200 等同于全流程成功。
- 核心结果仅 `RELEASE SUCCESS`、`RELEASE FAILED`、`INCOMPLETE`。任何关键项明确失败为 RELEASE FAILED；无失败但缺证据为 INCOMPLETE；全部通过且报告与历史实际落盘并回读一致，才是 RELEASE SUCCESS / Production HEALTHY。
- L3 的 Database 必须单独执行并报告；Tests PASS 不代替 Database PASS。L3 的 Git、Tests、Database、Security、GitHub、Cloudflare、Supabase、Desktop、Mobile、Guest checkout、Release Report、Release History 均为必需项；冻结/人工审批/依赖完整性/生产 MATCH 不因分级而放宽。L1/L2 按上述分级规则选择相关 gate；生产资源一致性验证仍保留。
- 缺依赖、跳过、超时、部分测试不能记 Tests PASS；mock 不能替代生产验证。
- 不伪造旧版本结果，不用另一个 SHA 的证据签署当前版本。
- 保留失败报告，最终回复列出失败 / 未验证项；不创建生产测试订单、不发送测试邮件，除非单独授权。
- 平台和浏览器门禁必须通过 `check` 自动采集；禁止手写 PASS。凭据或已审核的后端部署基线缺失记 PENDING。
- 日志不得含 Secret 或客户资料；Security PASS 只表示规定扫描范围，不是全面安全审计。
- 报告归档用单独 `docs(release):` 提交，引用被验证应用 SHA，避免无限发布循环。
- 沿用 GitHub / Cloudflare Pages / Supabase，不换托管服务，不修改安全权限绕过失败。

**推送 GitHub 不等于发布成功；只有生产环境验证完成并生成 Release Report、写入 RELEASE-HISTORY.md，才算发布完成。**
