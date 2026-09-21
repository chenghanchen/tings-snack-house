# 发布与 CI 规则

以 RELEASE-CHECKS.md 的最小流程为准：PR → release-gate → 用户批准合并 → Cloudflare → 简单生产 smoke。
只有现有 GitHub Ruleset 的 release-gate 是 required check，不绕过 PR，不直接 push main。
CI 使用 scripts/ci-select.mjs 的显式路径表和 scripts/ci-check.mjs，不使用发布等级、Override、Report 或 trust anchor。
CI/workflow/依赖表变更必须人工 diff 审核；未知路径、重命名、删除或 CI 变更选择全部高风险检查。
保留订单、权限、数据库、Edge、Storage 安全测试；不以删测试或放宽断言使 CI 通过。
应用发布、数据库迁移、Supabase Auth/Edge 部署各需明确授权；不会因“发布前端”自动部署后端。
不自动创建生产订单或发送测试邮件。CI PASS 不等于生产已部署。
基础设施提交使用 [CF-Pages-Skip]；未经明确批准不得合并或部署。
ci-bootstrap-v1 是历史保留标签，永不移动；当前 CI 不加载它。
