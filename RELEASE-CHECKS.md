# 发布规则与检查规范

本文件只定义发布规则；实际结果写入 [RELEASE-HISTORY.md](RELEASE-HISTORY.md)。
**以后每次“发布”必须生成绑定完整 Git SHA 的 Release Report 并记录结果。**

## 必需门禁

- [ ] Git working tree：发布源码已提交，工作区干净，报告 SHA 等于 HEAD。
- [ ] Security：源码 Secret 扫描通过，并人工检查 diff，不含服务器密钥、访问令牌或客户资料。
- [ ] Tests：自动测试、资源和语法检查全部通过；缺依赖、超时或部分通过不能记 PASS。
- [ ] Database：单独运行全部 PGlite `*-db.test.mjs`，必须包含账户与钱包数据库测试；缺依赖、跳过或超时记 FAIL。
- [ ] GitHub：远程 `chenghanchen/tings-snack-house` 的 `main` 精确等于发布 SHA。
- [ ] Cloudflare：生产部署成功并对应同一 SHA，记录 deployment ID / URL；仅 push 或 HTTP 200 不算。
- [ ] Supabase：核对本次函数 / 迁移的实际状态、配置、源码版本。未变更也要记录沿用版本与检查结果，不必无意义重部署。
- [ ] Desktop：生产桌面检查此次变更与关键路径，记录视口、场景、结果和截图或记录位置。
- [ ] Mobile：独立完成生产手机视口检查；桌面或离线 mock 不能替代。
- [ ] Guest checkout：真实接口空购物车认证检查，游客进入业务校验，伪造令牌被拒绝。
- [ ] Production smoke test：生产首页、商品、购物车、结算入口及此次变更；不创建真实订单、不发送测试邮件。
- [ ] Release Report：版本绑定的 JSON 与 Markdown 已生成且回读一致。
- [ ] Release History：同一版本的最终报告已写入 `RELEASE-HISTORY.md` 且回读一致；历史保留失败 / 未完成记录，不能写成成功。

核心结果固定为三种：任何关键项 FAIL → **RELEASE FAILED**；无 FAIL 但存在 PENDING 或尚未封存 → **INCOMPLETE**；全部门禁有真实证据、报告和历史已落盘并回读一致 → **RELEASE SUCCESS**。仅 RELEASE SUCCESS 输出 Production HEALTHY。无法取得核验权限属于证据不足；已取得的明确版本不匹配、页面错误或测试失败不能降格为 INCOMPLETE。
PASS 仅代表已列明的验证范围，不是全面安全审计或真实下单写入全链路保证。
Secret 扫描覆盖 Git 跟踪及未忽略的源码 / 配置，不覆盖忽略文件、二进制资产或 Git 历史，不能替代人工审查。

## 每次发布顺序

```text
本地修改完成
  ↓ 自动测试
  ↓ 数据库测试
  ↓ Secret / Security 扫描
  ↓ 生成版本号 / Git Commit
  ↓ Push 到 GitHub main
  ↓ Cloudflare Pages 自动部署前端
  ↓ Supabase Edge Functions 发布
  ↓ Cloudflare 平台核验
  ↓ Supabase 平台核验
  ↓ 生产环境桌面端测试
  ↓ 生产环境手机端测试
  ↓ 游客下单 Smoke Test
  ↓ 生成 Release Report
  ↓ 写入 RELEASE-HISTORY.md
  ↓ 最终判定
```

1. 本地修改完成后检查 diff，不夹带无关改动；按顺序执行 `npm run test:unit` → `npm run test:database` → `npm run release:security`。预检失败不推进提交/部署；保留失败日志。尚无目标提交时不能伪造版本号或借用旧 SHA 证明新版本。
2. 提交确定的发布源码，以完整 Commit SHA 为报告版本、短 SHA 为展示版本。初始化报告后重新运行并记录 Git / Tests / Database / Security，保证证据对应已提交源码；预检日志不能冒充提交后的证据。
3. 推送固定仓库 `chenghanchen/tings-snack-house` 的 main，核对远端目标 SHA；等待 Cloudflare Pages 前端部署。Push 成功不代表发布成功。
4. 执行 Supabase Edge Functions 发布步骤，保存部署来源、函数版本及审核凭证；后端未变更时可沿用已审核版本，但该步骤及其核验不能省略。禁止为了完成清单重复部署未知源码。若有必须先部署的非兼容后端或数据库迁移，暂停本次发布并先提出兼容性处理方案，不擅自打乱流程或让前后端短暂不兼容。
5. 依次执行 Cloudflare 平台核验 → Supabase 平台核验 → 生产桌面测试 → 生产手机测试 → 游客流程与无副作用认证 Smoke Test，并核对生产资源与目标提交一致。任何明确故障必须记 FAIL，凭据 / 审核证据缺失记 PENDING。发现部署失败后不继续依赖该部署的写操作，但继续安全的证据采集与失败报告归档。
6. 日志可从流程开始增量保存，最终报告必须在核验后生成。无论成功、失败还是未验证完整，都封存报告并追加历史；报告生成或历史写入失败亦阻止成功。最后才输出三种核心结果之一。
7. 历史用单独 `docs(release):` 提交归档，引用被验证的应用 SHA；CI 的归档文件先作为产物保存，再由发布负责人提交到仓库。报告中的 History PASS 证明历史文件内容落盘，不宣称已完成该后续文档 push。若平台部署文档提交，确认仅文档变化，不冒充新的应用版本，避免无限报告循环。
8. 用户以后只说“发布”，按上述固定范围完成流程，而不是只 push。凭据或权限不足不等于授权绕过限制；报告列明阻塞项，不能回复已发布成功。

GitHub 是源码版本中心；Cloudflare Pages 承载生产前端；Supabase 承载数据库及 Edge Functions；Release Report 证明目标源码、生产前端、审核后的后端版本和验证结果一致。

**推送 GitHub 不等于发布成功；只有生产环境验证完成并生成 Release Report、写入 RELEASE-HISTORY.md，才算发布完成。**

## 自动报告命令

Node.js 22.13+。先运行 `npm ci --ignore-scripts --no-audit --no-fund`，按锁文件安装开发依赖（含固定版本 `@electric-sql/pglite`）。数据库测试在本地真实 PostgreSQL/PGlite 中执行，不是 mock，也不是生产数据库。
`--version HEAD` 会保存完整 SHA，后续必须检出同一版本、源码干净。
JSON / Markdown / 日志位于忽略目录 `.build/releases/<完整 SHA>/`；已有报告不会被初始化覆盖。

```text
npm run release:report -- init --version HEAD --title "Guest checkout hotfix"
npm run release:report -- check --version HEAD --gate workingTree
npm run release:report -- check --version HEAD --gate tests
npm run release:report -- check --version HEAD --gate database
npm run release:report -- check --version HEAD --gate security
npm run release:report -- check --version HEAD --gate github
```

安装测试浏览器 `npx --no-install playwright install chromium`，配置下文所列凭据后直接采集生产证据：

```text
npm run release:report -- check --version HEAD --gate cloudflare
npm run release:report -- check --version HEAD --gate supabase
npm run release:report -- check --version HEAD --gate desktop
npm run release:report -- check --version HEAD --gate mobile
npm run release:report -- check --version HEAD --gate guestCheckout
npm run release:report -- check --version HEAD --gate production
npm run release:report -- render --version HEAD
npm run release:report -- finalize --version HEAD
```

`check` 根据真实退出码、管理 API 和浏览器断言记结果；所有门禁禁止通过 `record` 手写 PASS。工具不执行部署。
证据不放密码、令牌、客户资料，只使用无敏感参数的日志 / 截图位置或链接。
未封存报告可重跑，旧结果保存在 JSON `events`；`finalize` 封存并追加历史。
RELEASE FAILED / INCOMPLETE 封存返回非零，同一 SHA 重复封存不重复追加。封存后不改旧结果，修复版本建立新报告。`render` 会核对已封存历史与报告是否一致；丢失归档不能再次显示成功。新报告使用 schemaVersion 2；旧 schemaVersion 1 报告保留为旧证据，不自动补齐新门禁或升级成成功。
工具不自动授权 push、创建订单或更改平台权限。

## CI 自动报告边界

PR / main push 按自动测试 → PGlite 数据库测试 → Secret 扫描的顺序独立记分，即使失败也尝试生成 Job Summary、上传 JSON / Markdown / 日志。
PR 预检不持有平台凭据，不自动认定生产验证通过。
因此 CI 预检报告通常是 INCOMPLETE，不是发布成功报告；发布负责人取得生产证据后封存历史。
下载的 CI 报告可放入同一 SHA 的报告目录继续记录，保留原日志，不混用其他 SHA 的证据。

## 自动生产验证配置与范围

手动触发的 `Verify production release` 工作流，仅允许 main，使用 `production-verification` Environment；建议为这个 Environment 配置审批人。它是上述完整流程中的核验/报告工具，不是部署工具，不会代替 Git Commit、Push 或 Supabase 发布。它逐项自动采集门禁，即使失败也封存报告、生成 Job Summary，并将更新后的 `RELEASE-HISTORY.md` 与截图/日志一并上传。仓库权限仅 `contents: read`，不会自动 push；发布负责人下载历史产物并做单独的归档提交。

在上述 Environment Secrets 或本机环境变量中配置，**不要将值写入代码、报告或聊天**：

- `CLOUDFLARE_API_TOKEN`：限定本项目账户的 Pages Read。读取 canonical production deployment，必须成功、main、非 dirty，完整 SHA 一致。响应中的 env_vars 不写日志。
- `SUPABASE_ACCESS_TOKEN`：可读取项目 Edge Functions 的管理 API 凭据。核对 `submit-order` 的 ACTIVE、JWT 开启、实际版本、bundle 指纹。只读使用令牌，不部署、不修改配置。

Supabase 还需要仓库内已审核的 `release-supabase-baseline.json`，覆盖 `submit-order` 和 `admin-media-cleanup` 两个生产函数。结构、审核流程、最小权限与凭据配置位置见 [RELEASE-ACCESS.md](RELEASE-ACCESS.md)。必须关联已审核源码、每个函数的生产版本/指纹及生产验证记录，不能直接抄下未知指纹当作审核。每次比较 `supabase/` 与 SQL 相对于审核提交的差异，发生变化则 PENDING，要求确认发布与更新基线。报告明确分开 deployment required 与 verification required：无变更不必重复部署，但管理核验始终必须完成。没有可靠生产代码证据时不生成正式基线文件。

桌面视口为 1710×1180，手机视口为 390×844，分别启动独立、未登录的真实生产浏览器会话，检查商品、加入购物车、结算入口、自取/配送地址控件和横向溢出。手机是 Chromium 移动模拟，不冒充实体手机或 Safari 测试。保存截图与场景 JSON。只允许 GET/HEAD/OPTIONS 以及明确列出的只读商品 RPC；禁止订单/OTP/优惠券领取等写请求，绝不点击提交订单。成功页等变更专项验收仍需另外执行，不能把本基础 Smoke Test 当成全部变更覆盖。

Production 门禁比较生产 HTML/JS/CSS 与所检出的提交内容（SHA256，规范化换行），且要求 Cloudflare、双端和游客检查全部 PASS。HTTP 200 本身不算通过。

本机可设置 `RELEASE_BROWSER_CHANNEL=msedge` 使用已安装 Edge 的隔离 headless 会话，不使用个人浏览器配置。开发时运行 `npm run release:report -- diagnose --version HEAD` 可在脏工作区采集真实平台/双端结果；报告存于独立的 `diagnostic-*` 目录，明确标注 DIAGNOSTIC ONLY，不写发布历史，也不能据此签署发布成功。正式 `init/check/finalize` 仍要求源码干净。

接口依据：[Cloudflare Project API](https://developers.cloudflare.com/api/resources/pages/subresources/projects/methods/get/)、[Supabase Function API](https://supabase.com/docs/reference/api/v1-get-a-function)。

## 已有专项检查

运行完整检查：

```text
node scripts/release-check.mjs
```

检查会验证本地资源引用、JavaScript / TypeScript 语法、模块路径及自动测试（数据库测试需要开发依赖）。测试至少覆盖：

- 下单请求与提交中锁定；
- 幂等键与原子防重复提交；
- 顾客订单查询 RPC；
- 店铺设置合并与保存；
- 未登录后台启动无脚本报错；
- 媒体引用识别、保护期、默认资源保护和店主权限。

仅运行测试可使用：

```text
node --test tests/*.test.mjs
```

这套快速检查不会连接生产数据库，也不会创建测试订单。涉及 Supabase migration 或 Edge Function 的变更，在发布前仍应使用测试项目完成一次真实下单与相同幂等键重放。

## 真实 Supabase 最低配送保护检查

在 Supabase SQL Editor 执行 `minimum-delivery-live-check.sql`，可验证生产数据库中的订单函数仍会拒绝低于配送门槛的订单。检查使用真实商品和真实店铺设置，但会捕获预期异常、核对订单／幂等记录／库存均未变化，并在最后显式回滚整个事务，不会留下测试订单。

成功时 SQL Editor 会显示以 `PASS:` 开头的 notice；任何服务端校验缺失、错误类型变化或数据残留都会使脚本失败。

## 真实 Supabase 游客身份检查

发布含空购物车前置保护的 `submit-order` 后，运行
`node scripts/check-guest-checkout-live.mjs`。脚本使用前端公开配置发送空购物车：
真实游客公钥须进入购物车校验并返回 400，篡改签名的令牌须返回 401。
两种请求都在限流及订单 RPC 前结束，不创建订单、扣库存或消耗限流计数。

这只验证身份与拒绝路径，不代表执行了真实订单写入；实际结果写入历史，不留在规范。

## 有依赖的专项部署顺序

以下为历史专项的兼容性准备步骤，不覆盖上方正式发布顺序。遇到同类依赖时先暂停正式发布，完成经确认的前置准备，再从正式流程开始。

1. 在 Supabase SQL Editor 执行 `storefront-snapshot-migration.sql`。
2. 按 `MEDIA-CLEANUP-DEPLOY.md` 部署 `admin-media-cleanup` Edge Function。
3. 再次运行 `node scripts/release-check.mjs`。
4. 最后发布前端静态文件。

快照 RPC 尚未部署时，顾客端会自动退回原有公开请求，不会阻止页面加载；媒体清理入口则应在对应 Edge Function 部署后再交付店主使用。

仓库中的 `.github/workflows/release-check.yml` 会在 `main` 推送和 Pull Request 时自动运行同一套检查。
