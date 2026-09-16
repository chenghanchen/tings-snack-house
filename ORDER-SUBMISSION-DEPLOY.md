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

## 游客身份配置与无订单验证

- 将 Edge Function secret `ORDER_GUEST_ANON_KEY` 设置为当前前端
  `supabase-config.js` 使用、且已与 Supabase 控制台核对的 legacy anon 公钥。
  函数优先读取此明确配置；未设置时兼容 `SUPABASE_ANON_KEY`。
  公钥轮换时须同步更新前端及此配置；不要填入 service-role 或 secret key。
- 保持 `verify_jwt = true`。只有与服务端配置完全匹配的游客公钥可进入游客路径；
  其他令牌继续调用 Supabase Auth 验证，失效登录不得自动降级成游客。
- 发布后使用有效格式的测试电话、随机 UUID v4、`p_items: []` 调用接口。
  正确游客公钥应返回 HTTP 400 `购物车为空，请先选择商品`，而不是登录失效。
  空购物车检查在身份校验后、限流和订单 RPC 前，不创建订单、不扣库存、不写限流计数。
- 伪造或过期令牌仍须返回 401；不能仅凭请求中的 `apikey` 或解码后的 JWT role 放行。
- 部署上述空购物车保护后，可运行 `node scripts/check-guest-checkout-live.mjs`
  自动验证真实游客公钥返回 400、篡改签名后的令牌返回 401。该脚本只读取前端公开配置。
