# 最小发布流程

PR → 基础检查 + 条件高风险检查 → release-gate → 人工审核合并 main → Cloudflare 自动部署 → 简单 production smoke。

## 唯一 CI 路径

.github/workflows/release-check.yml 只有一个 job：release-gate。
名字和 GitHub Actions App 来源不变，Ruleset 不变。
所有检查是同一 job 中的普通命令；失败、异常、零测试或超时均返回非零状态。
没有汇总 API、历史报告、发布等级、Override、冻结版本、审批状态机、bootstrap 或生产 manifest。
日志和 .build/ci/ 仅为诊断输出，不参与下一次判定。

## 检查选择

scripts/ci-select.mjs 使用显式路径/职责表，不分析任意 JS 的源码语义。

| 修改 | 检查 |
| --- | --- |
| 已知展示文件 / CSS | base |
| 任意位置 SQL / schema / migration / RLS / RPC 契约 | base + database |
| 当前 Edge Functions / 直接数据库调用模块 | base + database + edge |
| Storage 删除 / 媒体引用 / 锁 | base + database + edge + media-concurrency |
| CI、依赖/配置、未知文件、rename/delete | 全部高风险检查 |

无法取得完整 diff 时选择全量，并且不得签署 CI 成功。
PR 用事件 base SHA，push main 用事件 before SHA；手动运行提供完整 base SHA。
Node/Chromium/Deno 工具安装不等于执行数据库或 Docker；只有选中专项才运行其检查。

base：Node 行为/业务契约、Stage 5 离线 Chromium、security、syntax、本地资源、Cache Version Guard。
database：原有全部 PGlite 测试。
edge：Edge 单元、frozen Deno/type/dependency 检查、6 个真实 Docker 正负向验证。
media-concurrency：4 个真实 PostgreSQL 并发验证。
普通 PR 不访问生产，不需要任何生产凭据。

## 本地命令

- npm test：非数据库 Node 测试。
- npm run test:database：完整 PGlite。
- npm run ci:check -- <完整 base SHA>：与正式 job 同一入口。
- node scripts/ci-check.mjs base <完整 base SHA>：基础检查与浏览器。
- node scripts/ci-check.mjs edge：需 Deno 2.9.6、Docker。
- node scripts/ci-check.mjs media-concurrency：需 Docker。
- npm run release:security：源代码秘密扫描，不代表完整安全审计。

先 npm ci，再 npx --no-install playwright install --with-deps chromium。
缓存检查保持原来的四个受管理资源与 content-hash query 语义；不增加 Stage 6 体系。

## 合并和生产 smoke

1. 人工检查 diff（特别是 workflow、selector、runner、测试和依赖配置），确认 release-gate 实际 success。
2. 用户批准后经 PR 合并；不得直接 push main 或使用 bypass。
3. 前端由现有 Cloudflare main 配置部署；基础设施标题保留 [CF-Pages-Skip]。
4. 应用发布后只读确认 Cloudflare production commit 是目标提交。
5. 普通刷新桌面和手机页面：商品/分类、购物车、账户入口和返回按钮正常，无明显控制台错误或横向溢出。
6. 不把 HTTP 200 当作功能通过；不自动下单、发送邮件、保存账户资料或修改后台数据。
7. 后端/数据库变更另行审核部署计划和顺序；本 CI 不负责自动部署，也不自动执行迁移。
   minimum-delivery-live-check.sql 是需单独授权的生产事务回滚诊断，不由 PR CI 自动调用。

## 已退役与回滚

删除纯框架运行代码及专属测试：L1/L2/L3、Override、Report、frozenVersion/productionApproval/productionMatch 状态机、
shadow 双执行、trusted launcher/union/API verdict。保留业务测试、历史报告、.build 归档及原工作区修改。
旧实现完整保存在 Git 历史，ci-bootstrap-v1 永远指向 573eebe0648ebff301a2be39f33bb484e13ce282；
该标签只作历史恢复点，不参与当前 CI，不移动它。
回滚通过新的 revert PR 恢复迁移提交，仍使用同一 release-gate，不改 Ruleset。
手动 Edge bundling / Supabase 只读取证工具暂保留，不参与 PR 选择，不运行生产写操作。

边界：此最小方案依赖人工审核 CI 控制文件，不声称自动防御有权限重写 workflow 的人。
