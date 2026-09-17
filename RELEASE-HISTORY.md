# 实际发布历史

规范见 [RELEASE-CHECKS.md](RELEASE-CHECKS.md)。以后每次实际发布用报告工具追加；失败或证据缺失也保留。
版本指应用提交，不是随后保存报告的文档提交。
以下是建立机制前的事实迁移，未具备完整机器报告，不能宣称所有门禁通过。

## 2026-09-16 · 85ef267 · Guest checkout hotfix

Release: **INCOMPLETE（历史证据不完整；修复已部署）**

Version: `85ef26737c3dd9e93fd0747b9b908ce692f8be5a`

Branch: `main`

| 项目 | 已有证据 / 结果 |
| --- | --- |
| GitHub | PASS：推送输出 `bf15c26..85ef267 main -> main`，本地和远程跟踪 SHA 一致 |
| Supabase | PASS（本次范围）：函数已发布，明确配置游客公钥；控制台 JWT 验证保持开启 |
| Guest checkout | PASS（身份检查）：空购物车返回 400 业务校验，伪造签名返回 401；未创建订单、扣库存或写限流计数 |
| Tests | 未全部完成：59 项通过，两个数据库测试文件因缺少 `@electric-sql/pglite` 无法运行 |
| Security / Cloudflare / Desktop / Mobile / 完整生产 Smoke Test | 未保存完整证据，不能补写 PASS |

来源：原 `RELEASE-CHECKS.md` 检查记录、本次任务的 Supabase 发布及验证输出、Git push 输出。
身份验证不等于订单写入全链路验证；此记录也不意味着生产当前故障。

## 2026-09-16 · bf15c26 · Responsive order success layout

Release: **UNVERIFIED（历史记录）**

Git 历史确认存在 `bf15c26 Polish responsive order success layout` 提交。
没有足够逐项部署和生产验证记录，不补写 Tests / Security / Cloudflare / Mobile 等 PASS，也不推断 Production HEALTHY。

<!-- release:ed882eae21b07b247dd86284e5be02da838b8c0d -->
## 2026-09-16 · ed882ea · First governed release: evidence-based release system

**INCOMPLETE**

Version: `ed882eae21b07b247dd86284e5be02da838b8c0d`

Branch: `main`

Updated: 2026-09-16T11:30:42.294Z

| Check | Result | Evidence | Checked at |
| --- | --- | --- | --- |
| Git | PASS | Clean release checkout confirmed immediately before history append | 2026-09-16T11:30:42.284Z |
| Tests | PASS | node scripts/release-check.mjs; exit=0; log=tests-1789558073379.log | 2026-09-16T11:27:53.419Z |
| Database | PASS | node scripts/release-database.mjs; exit=0; log=database-1789558078268.log | 2026-09-16T11:27:58.308Z |
| Security | PASS | node scripts/release-security.mjs; exit=0; log=security-1789558078616.log | 2026-09-16T11:27:58.652Z |
| GitHub | PASS | Read-only ls-remote verified origin/main equals the full release SHA | 2026-09-16T11:28:01.609Z |
| Cloudflare | PENDING | Missing CLOUDFLARE_API_TOKEN (Pages Read); no deployment claim made | 2026-09-16T11:29:04.746Z |
| Supabase | PENDING | Missing SUPABASE_ACCESS_TOKEN; deployed function/config/source not verified | 2026-09-16T11:29:04.964Z |
| Desktop | PASS | https://tings-snack-house.pages.dev; 1710x1180; isolated Chromium; products/cart/checkout/pickup/delivery/layout; no order submitted; desktop.json; desktop-checkout.png | 2026-09-16T11:29:09.670Z |
| Mobile | PASS | https://tings-snack-house.pages.dev; 390x844; isolated Chromium mobile emulation (not physical device); products/cart/checkout/pickup/delivery/layout; no order submitted; mobile.json; mobile-checkout.png | 2026-09-16T11:29:13.446Z |
| Guest checkout | PASS | node scripts/check-guest-checkout-live.mjs; exit=0; log=guestCheckout-1789558154912.log | 2026-09-16T11:29:14.949Z |
| Production smoke test | PENDING | Production HTML/JS/CSS (index.html, app.js, styles.css, customer-account.js, supabase-config.js) SHA256 matches committed source (CRLF normalized); required checks not PASS: cloudflare | 2026-09-16T11:29:17.171Z |
| Release Report | PASS | report.json and report.md generated and verified by read-back | 2026-09-16T11:27:43.412Z |
| Release History | PASS | RELEASE-HISTORY.md archived with version marker and exact report; read-back verified | 2026-09-16T11:30:42.294Z |

Production: **NOT VERIFIED HEALTHY**

发布未标记为成功；失败或缺失的检查必须处理，不能推断生产健康。

<!-- p1p2-closure:6b4b7b9d236b1c2b04368e175df1a75521b229ef -->
## 2026-09-17 · 6b4b7b9 · P1/P2 production closure

**P1/P2 CLOSED · 专项核验 PASS**

Frozen application: `6b4b7b9d236b1c2b04368e175df1a75521b229ef`.
Workflow/trigger commit: `b9a1d5d6a28f3b1e3b8f7d4a37a60b4b0b8e488f`.

Production evidence: submit-order v6 / admin-media-cleanup v4 MATCH; final read-only guard state and metadata fingerprint match; non-destructive smoke and non-owner 403 passed; exact temporary test objects removed; media cleanup resumed with a normal 7 scanned / 7 referenced / 0 candidates / 0 deleted / 0 errors cycle.

[Final Release Report](release-reports/p1p2-6b4b7b9/report.md) · [JSON evidence index](release-reports/p1p2-6b4b7b9/report.json).

The report is preserved as the final production-verification snapshot; its statements about local-only archival describe the time of that snapshot. This documentation commit archives only the final report and history in Git. Raw supporting evidence (including test-account identifiers) remains local and was not uploaded. It is not a new application release or authorization to redeploy. main synchronization remains a separate, deployment-risk-gated operation. No full-site RELEASE SUCCESS is claimed.
