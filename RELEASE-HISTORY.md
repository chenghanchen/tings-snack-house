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
