# P1/P2 最终 Release Report

**P1/P2 CLOSED · 专项核验 PASS**

此报告只关闭用户指定的 P1/P2 生产修复及恢复事项，不重新判定全站 RELEASE SUCCESS，不新增审核项目。

- 冻结应用：`6b4b7b9d236b1c2b04368e175df1a75521b229ef`
- 部署工作流：`b9a1d5d6a28f3b1e3b8f7d4a37a60b4b0b8e488f`（不是应用版本）
- 生产项目：`ragqunnuxsfwhrfqpylg`
- 本轮 deployment required：否；verification required：是。

## 最终证据

| 核验项 | 结果与依据 |
| --- | --- |
| 冻结版本 | 本地 HEAD 为冻结 SHA、工作区干净；冻结迁移 Git blob、工作区字节与回归 SHA-256 相同 |
| 数据库 guard | 08:02:08 UTC 独立只读核验：6 个函数正文/权限、9 个 Trigger、保护表 RLS/权限全部与既有证据一致 |
| submit-order | v6 ACTIVE / JWT true / MATCH；重新回读现有生产部署 artifact；当前 Settings JWT 仍开启 |
| admin-media-cleanup | v4 ACTIVE / JWT true / MATCH；同上 |
| 冻结依赖与打包 | 既有部署日志确认两个函数 frozen integrity PASS；artifact 精确 ESZIP、源码/配置/lock manifest MATCH |
| 生产 Smoke Test | 18/18 PASS；包含 >32 KiB、无 Content-Length 分块、多字节 413；无真实订单创建 |
| 非店主权限 | 真实有效会话、owner=false、scan 403、logout 204；临时账号及其推荐码已清理并验证不存在 |
| 媒体清理恢复 | 人工维护窗口已解除，首周期扫描 7 / 引用 7 / 孤儿 0 / 删除 0 / 错误 0 |
| 当前生产数据 | 订单 43、Storage 7、退役记录 0；媒体元数据指纹 `0102563faf03a2fd9b050c1b89d1769f` 保持一致 |

[最终只读数据库结果](https://supabase.com/dashboard/project/ragqunnuxsfwhrfqpylg/sql/c54b6f8d-e171-4c0a-896a-95bca4bb293d) · [冻结部署运行](https://github.com/chenghanchen/tings-snack-house/actions/runs/35187125500) · artifact `10482930570`。

迁移 SHA-256：`11c606789374080b086beffbbbdcb579e954c2c7911a60ef7fefcfeebee101ad`。生产只应用了已含安全重试的完整 guard migration，未另行执行 retry migration。

## 指纹与时效边界

两函数的源码、配置、lockfile 指纹见 [report.json](./report.json)。本次重新读取的是 06:02:28 UTC 管理 API 产出的原始部署报告，并非重新采集生产 bundle；当前 Settings UI 仅确认 JWT 开启和更新时间没有显示新部署，不将其冒充新 bundle/数字版本核验。

恢复记录证明首个正常扫描无候选、无需删除，并不声称本轮执行了生产删除/RPC 重试分支。媒体指纹仅覆盖对象 ID/name/updated_at 元数据，不能与早期不同算法的迁移指纹直接比较，也不是媒体内容或全业务行校验。

## 归档与停止边界

- [JSON 报告](./report.json) 与 [专项发布历史](./RELEASE-HISTORY.md) 同目录归档；保留此前阶段报告，不改写历史状态。
- 原始证据保留在上级目录，具体文件见 JSON evidenceFiles。
- 本轮无部署、Migration、数据库写入、媒体删除、源码/lockfile 修改、main 合并或 push。
- 此归档未修改仓库 RELEASE-HISTORY.md，未提交或推送 Git；不混同于全站发布归档。
- **P1/P2 CLOSED。媒体清理保持已恢复，停止追加检查。**
