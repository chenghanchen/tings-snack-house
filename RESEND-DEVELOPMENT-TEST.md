# Resend 测试发信：顾客验证码登录

状态（2026-09-11）：用户确认已保存 SMTP；向其 Resend 注册邮箱 chenghanchen1@gmail.com 请求登录邮件返回 200，用户确认收到 6 位数字验证码，并在本地完成登录、刷新保持会话以及打开订单／资料页面。邮件配置密钥未进入代码或聊天。
目前仅单邮箱开发验证通过，未验证所有收件人、过期码、不同邮箱隔离及完整真实下单；账户入口保持本地测试，不向顾客公开。

## 两种测试不要混淆

- **真实验证码登录测试**：使用 `onboarding@resend.dev` 发信，只发送给 Resend 账户关联的邮箱。尚未验证自有域名时，不能拿另一个普通邮箱或自行添加的邮箱别名做第二个收件人测试。
- **模拟邮件事件**：`delivered@resend.dev`、`bounced@resend.dev` 等用于模拟投递／退信。它们不是开发者能打开的收件箱，不用它们注册顾客账户，也不通过它们取码。若单独验证这些邮件事件，仅发送不含真实验证码和个人信息的测试正文。

官方限制：[测试域名收件人限制](https://resend.com/docs/knowledge-base/403-error-resend-dev-domain)、[模拟事件地址](https://resend.com/docs/dashboard/emails/send-test-emails)。测试邮件也计入发送额度。

## Supabase 后台填写

推荐先在独立测试项目操作。当前网站连接的项目是 `ragqunnuxsfwhrfqpylg`；本地打开网站不代表使用本地数据库。
切换该项目的 SMTP 会影响整个项目的 Auth 邮件，包括店主密码重置等邮件；Resend 测试域名会限制这些邮件的收件人。
保存前记录原有非敏感设置，并确保原有 SMTP 凭证可由管理员安全恢复。不要截图、导出或提交密钥。

进入 Authentication → Email／Emails → SMTP Settings：

| 字段 | 测试配置 |
| --- | --- |
| Sender email | `onboarding@resend.dev` |
| Sender name | `婷婷的零食屋（开发测试）` |
| Host | `smtp.resend.com` |
| Port | `465` |
| Username | `resend` |
| Password | 在后台直接填写 Resend API Key，不发到聊天或前端代码 |

SMTP 接法见 [Resend 官方配置](https://resend.com/docs/send-with-supabase-smtp)。正式对外发信需验证自有域名，不能保留测试发件人。
使用专门用于此测试、仅需发信权限的 API Key；不要把密钥写进 Git、浏览器脚本或截图。也不要向前台添加 Resend SDK：身份验证仍由 Supabase 负责，Resend 只传递邮件。

## 邮件内容

- 在 Supabase 的 Magic Link 邮件模板中粘贴 `supabase/templates/customer-otp.html` 的完整内容。
- 主题设为 `婷婷的零食屋 · 登录验证码（开发测试）`，不要将验证码放入邮件主题。
- 若新用户收到的是 Confirm sign up 模板，也将该模板设为验证码内容，并分别验证首次注册和已有账户登录。不要修改店主的 Reset password 模板。
- 确认邮箱 OTP 长度为 6 位，与网站输入框一致；建议有效期 10 分钟，发送间隔至少 60 秒，保留服务端限流。
- 模板中的 `{{ .Token }}` 由 Supabase 生成和替换，不是固定测试密码。不要使用链接占位符 `{{ .ConfirmationURL }}`，也不要自己生成验证码绕过 Supabase。
- 此模板文件不会自动修改托管 Supabase 项目；必须保存到后台才生效。

模板变量：[Supabase 官方说明](https://supabase.com/docs/guides/auth/auth-email-templates)。

## 实际验收清单（单邮箱基础流程已通过，其余待完成）

1. 确认测试收件人就是 Resend 注册邮箱。在本地网站点击账户，输入该邮箱，请求一次验证码。
2. 在 Resend 检查发送记录与投递结果；到自己的邮箱确认收到的是数字验证码，而不是登录链接。不要仅凭 API 返回成功判断收件箱已收到。
3. 用户在网站输入验证码完成验证，不在聊天、终端日志或截图中暴露验证码和登录 token。
4. 确认显示正确邮箱、刷新后保持登录、退出后清除账户资料。测试错误验证码和已使用验证码不会建立新会话；按配置等待过期后验证旧码失效。
5. 登录成功和账户业务数据可用是两个验收项。若尚未执行账户迁移，登录可能成功，但订单／资料会加载失败；需继续执行 `CUSTOMER-ACCOUNTS-SETUP.md`，不能用关闭权限检查掩盖错误。
6. Resend 测试域名限制下，真实双邮箱隔离验收尚不能完成。现有双账户本地模拟和数据库测试不替代以后验证自有域名后的真实双邮箱测试。

常见问题：403 先检查收件人是否为注册邮箱；429 遵守等待时间，不连续点重发；收到链接检查实际使用的邮件模板；只见 sent 没有收到则检查投递状态和垃圾邮件。测试完成后再决定是否保留测试 SMTP，不能直接当作正式上线配置。
