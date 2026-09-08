# 订单重复提交与限流部署顺序

为避免生产环境下单中断，必须按以下顺序执行：

1. 在 Supabase SQL Editor 执行 `order-submission-protection-migration.sql`。
2. 创建 Edge Function secret：
   `ORDER_RATE_LIMIT_SALT=<至少 32 个随机字符>`。
3. 部署 `supabase/functions/submit-order`，保持 JWT 验证开启。
4. 用测试订单验证 Edge Function；相同 `p_idempotency_key` 重试只能返回同一订单。
5. 发布包含 `app.js?v=20260907a` 的前端。
6. 确认生产下单成功后，执行 `order-submission-lockdown-migration.sql`，撤销匿名用户对旧 RPC 的直接调用权限。

默认限流为同一 IP 每 10 分钟 8 次、同一电话号码每 10 分钟 4 次。
可用 `ORDER_RATE_WINDOW_SECONDS`、`ORDER_RATE_IP_MAX` 和
`ORDER_RATE_PHONE_MAX` 调整。限流表只保存加盐后的 SHA-256 标识，不保存原始 IP。

