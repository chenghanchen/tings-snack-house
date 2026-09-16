# 后台媒体清理部署

媒体清理由后台页面、店主专用的 Supabase Edge Function 和数据库并发保护组成，不增加浏览器依赖。新版必须先应用 `media-deletion-guard-migration.sql`；缺少保护 RPC 时删除返回 503，不退回旧的直接删除逻辑。

部署前运行：

```text
node scripts/release-check.mjs
```

部署顺序：

1. 先在测试 Supabase 项目验证迁移、Storage 上传和订单写入。迁移需要能为业务表和 `storage.objects` 创建触发器的数据库管理员权限；权限不足不得忽略错误继续部署。PGlite 测试不等于托管 Storage 集成验证。
   **托管平台兼容性门禁**：Supabase 官方建议不修改 `storage` schema，以免未来升级冲突（https://supabase.com/docs/guides/storage/schema/design）。本迁移添加 Storage 触发器，必须先在托管测试项目核验权限、正常上传/覆盖/复制/移动行为，并确认接受升级兼容性风险；不得通过更改系统表所有者、扩大平台角色权限来绕过限制。未取得证据时生产迁移保持 PENDING。
2. 经发布授权后暂停媒体清理操作并等待旧删除请求结束，在生产应用 `media-deletion-guard-migration.sql`。迁移不删除文件或业务数据，但会增加引用写入约束，必须记录迁移证据。
3. 部署 `supabase/functions/admin-media-cleanup`（包含 `../_shared/request-body.mjs`），保持 `supabase/config.toml` 中 `verify_jwt = true`。本批正文读取修复也修改了 `submit-order`，需一起发布该函数及共享模块。
4. 按正式发布规则核验实际函数源码、配置及数据库触发器；更新审核基线后再恢复清理操作。不得用旧版本的生产证据签署新函数。
5. 使用店主账号登录，先扫描、预览。真实删除另行授权；不要为验收删除生产素材。

Supabase 托管环境会自动提供 `SUPABASE_URL`、`SUPABASE_ANON_KEY` 和 `SUPABASE_SERVICE_ROLE_KEY`。可选 secret：

- `MEDIA_CLEANUP_OWNER_EMAIL`：店主邮箱；默认 `chenghanchen1@gmail.com`。
- `MEDIA_CLEANUP_GRACE_HOURS`：新上传文件保护期；默认 24 小时。
- `MEDIA_CLEANUP_PROTECTED_PATHS`：永不删除的额外 Storage 路径，逗号分隔。
- `MEDIA_CLEANUP_ALLOWED_ORIGINS`：允许调用的站点来源，逗号分隔。
- `MEDIA_CLEANUP_MAX_OBJECTS`：一次安全扫描的最大 Storage 文件数；默认 20000。
- `MEDIA_CLEANUP_MAX_REFERENCE_ROWS`：每张引用表的最大扫描行数；默认 50000。

删除时，服务端会在读取 Storage 文件前后分别扫描 `products.image`、`product_variants.image`、`shop_settings.content` 和 `orders.items`，使用两次引用结果的并集。任一查询失败都会终止删除；默认资源、仍有数据库引用、上传未满保护期或时间未知的文件都不会删除。这两次扫描只负责筛选，不是并发安全保证。

真正的删除授权由仅限 `service_role` 的 `reserve_orphan_media` 完成：在同一事务锁内重新检查上述四处引用，登记无引用路径到 `media_retired_paths`，提交成功后 Edge Function 才调用 Storage 删除。四张表的写入触发器使用同一把锁；先提交的引用会阻止删除登记，先登记的路径会阻止后来的引用写入。Storage 写入触发器也禁止复用已登记路径。浏览器角色不能操作登记表或调用此 RPC。

保护登记永久保留，包括 Storage 删除失败、超时或响应丢失的情况。重试不会再次删除已经登记的路径，也不会自动解除保护，避免仍在执行的旧删除请求误删复用路径。受保护路径应重新上传为全新路径；遗留文件可待人工确认所有旧请求结束后另行处理，不得通过清空登记表恢复使用。回滚函数时不得回退到未使用登记保护的旧删除实现。

此实现要求 READ COMMITTED，其他事务隔离级别拒绝相关写入。四张引用表的 INSERT/UPDATE 使用一把事务级互斥锁，可能增加写入等待；超时或死锁应终止操作，不可绕过锁。测试环境还应以两个独立 PostgreSQL 连接分别验证“引用先取得锁”和“删除登记先取得锁”两种交错，再测试 Storage 新路径上传、已退役路径覆盖拒绝，以及正常游客/账户订单流程。

CI 的 `media-concurrency` job 使用固定摘要的隔离 PostgreSQL 17.6，真实独立连接及 `pg_locks` 确认锁等待，再验证两种提交顺序与 Storage 元数据写入拒绝。该容器无外部网络、不连接生产，结果不冒充托管 Storage API 或生产并发证据。执行入口为 `node scripts/check-media-concurrency.mjs`。

生产阶段需要经授权的数据库管理员连接（迁移）和两个独立 READ COMMITTED 会话（并发验证），不能用仅有 `edge_functions_read` 的管理令牌代替。凭据只放进程环境或审批保护的 CI Environment，禁止发到聊天。开始前确认已暂停清理、旧删除请求排空、迁移 SHA256 与已通过 CI 的提交一致。迁移设置 5 秒锁等待、60 秒语句超时，失败整笔回滚，不自动解除安全约束。生产测试数据范围、维护窗口和清理方案确认前，不插入生产订单或删除真实素材。

`media-deletion-guard-preflight.sql` 可在目标项目 SQL Editor 先执行只读权限/结构检查；不读取客户记录或真实素材。结果用于判断迁移条件，不是迁移成功或真实并发 PASS 的证据。测试项目验证完成后，再在生产执行同一预检并确认维护窗口。

两个函数的 JSON 正文均按流读取，原始字节上限为 32768；无 Content-Length 或长度虚报也不能绕过。收到第一个累计超限的数据块即取消读取并返回 413，不再读取后续块。此限制约束应用层读取，不声称能限制网关预缓冲或运行时单个数据块的分配。
