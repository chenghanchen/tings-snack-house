# 发布规则与检查规范

本文件只定义发布规则；实际结果写入 [RELEASE-HISTORY.md](RELEASE-HISTORY.md)。
**以后每次“发布”必须生成绑定完整 Git SHA 的 Release Report 并记录结果。**

## L1 / L2 / L3 分级（优先于下文旧版全量流程）

发布范围是明确的完整 `base..head`，不是默认 `HEAD^`。分类器 `scripts/release-level.mjs` 只读 Git 对象，不部署、不开生产连接；多种修改取最高级，无法确认范围/路径/依赖关系则 L3。不得用提交标题、`[CF-Pages-Skip]` 或手工 `--level L1` 降级。

| 等级 | 必需验证 |
| --- | --- |
| L1 纯 UI/样式/文案/被动静态资源 | 前端资源/语法/UI 测试、安全扫描、Cloudflare 精确版本、独立 Desktop/Mobile Smoke Test、生产前端资源一致性 |
| L2 已明确识别的普通业务逻辑 | 完整非数据库自动测试、安全扫描、Desktop/Mobile 与业务/游客拒绝路径 Smoke Test、前端生产版本；数据库测试和 Supabase 核验按实际依赖要求 |
| L3 高风险或不确定修改 | 下文全部原有门禁，加上明确保留的冻结版本、Docker 正常/篡改/恢复证明、人工 production approval、冻结源码生产 MATCH |

所有等级仍需干净且已提交的 Git、main 同步、Release Report 与 Release History。`NOT_REQUIRED` 仅表示与本等级无关，**不是 PASS**；L1 不运行数据库/Edge/Supabase gate，缺 Supabase baseline 不会使 L1 INCOMPLETE。已观察到的明确 FAIL 不会被隐藏。L2 没有数据库依赖时 database 为 NOT_REQUIRED；目前所有 SQL、RLS、Edge Function 修改都直接属于 L3，相关性不明确也升级 L3，不猜测一个过小的数据库测试集合。

当前规则为保守白名单：根目录 CSS、指定被动 assets/images/fonts 格式、无脚本且结构不变的 HTML 文案/展示属性、普通文档，以及已审查的 UI 辅助测试可为 L1。少量普通客户端模块可为 L2；若其中含金额、认证、权限或后端操作则升级 L3。`app.js`/管理员/账户/钱包/订单/营销金额/Storage 删除、所有 SQL 与 `supabase/`、依赖锁、发布工具、工作流和发布规则均 L3。未知 JS、可执行/结构变化的 HTML、CSS 活跃导入、删除、符号链接、子模块、改名的旧路径都不会被低等级白名单掩盖。

操作示例（以下分类命令均只读）：

```text
node scripts/release-level.mjs --base <完整的上次发布或同步前main SHA> --head HEAD
node scripts/release-report.mjs init --version HEAD --base <同一完整base SHA>
node scripts/release-level.mjs --base fc29a0d1448bf4f834e93913a4596b37875fb6e0 --head bc6f03dec64e898da40fa252d2e5e82db71ef45b
```

`bc6f03d` 对上述真实前置 main 的 diff 只有 `styles.css` 和 `scripts/check-success-hero.cjs`，应判 **L1**。UI 验证脚本只允许两个精确路径：`scripts/check-success-hero.cjs`（已审核的历史 350.01px 与当前 300px 版本）、`scripts/check-success-dialog.cjs`（已审核的离线布局/关闭按钮验证版本）。新增时目标内容须命中固定 SHA-256；修改时前后内容均须命中该路径的已审核指纹，且文件模式不得改变。仅规范化 CRLF/LF，不忽略其他内容变化。删除、未知内容、同名替身、其他测试/部署/安全脚本均保持 L3，绝不放宽整个 scripts 目录。历史报告不改写，也不将旧 INCOMPLETE 追认成 SUCCESS。

三项 UI 修改单独组成的范围（上述两脚本及 `styles.css`）按已审核内容判 L1；分类器、指纹白名单、分类回归测试与发布规则的变更本身仍为 L3。CI 仍使用已审核 base 策略作最低门禁，因此规则修正必须先独立审核进入可信基线，后续 UI 发布才可使用新规则，不能用候选策略给自身降级。

### 手机端 UI 误分类修正（独立 L3 基础设施候选）

- HTML 包含既有脚本不等于本次修改了脚本。新增的窄规则只允许 `<style>` 内独占一行的数值尺寸/间距/字号声明变化：height/width（含 min/max）、padding/margin、gap、font-size、line-height。HTML 结构、标签属性、文案、脚本及其配置必须逐字一致（只统一 CRLF/LF）；选择器、URL、字符串、注释、外部导入和无法解释的 CSS 变化不由此规则放行。脚本、模板、SVG/MathML、原始文本区域按不透明内容比较，不能把其中的 `<style>` 字符串当作真实样式。这是保守识别器，不是完整 HTML/CSS 解析器；无法确认时保持 L3。
- `mobile-header.js` 的 L1 资格基于精确路径、前后已审阅的完整源码 SHA-256 和不变文件模式，仅允许已有文件修改。已审阅职责为：现有菜单/账户/订单查询/购物车入口事件转发、可访问性标签、手机搜索 placeholder、分类栏 DOM 测量与滚动。`Array.from(buttons)` 是 DOM 列表转换，不是 Supabase 数据表访问；代码没有新增网络调用、数据库写入、凭据读取、金额计算或 Storage 操作。
- 此次 JS 审核基线（统一换行后）：旧版 `b108952a2a59c4580027182ec8234e7f83afb5e78ff8135f91e62091f1c935aa`；手机分类滚动版 `902f8028e24f807bc808063aa320158619aa2ace602e40a8577427a9cd1b976a`。这不是整个文件未来修改的永久豁免。任意新调用、别名/计算属性 API、未知内容、添加/删除/改名或模式变化均回到 L3，必须重新审核，不能仅删除风险关键词后降级。
- 回归快照为 `tests/fixtures/release-level/mobile-catalog.patch.txt`，相对 `d0efe8d4ac43d17ce4c104388df96a0b05b2bbfa`，只在临时测试仓库应用。它覆盖目前未提交的 `index.html`、`mobile-header.js`、`styles.css` 三项 UI 修改，预期整体 L1；不把这些应用改动混入基础设施提交。
- 分类器、测试夹具、回归测试与本规范的修正仍是 L3，须独立审核；本地测试通过不表示 CI、production approval 或 Production MATCH 已通过。可信 base gate floor、未知范围最高等级、冻结版本和人工审批门禁保持不变，不能用本次候选规则给自身降级。本修正不授权生产发布。

CI push 自动使用 `github.event.before`；PR 使用基分支 SHA 对 checkout 的合并树做完整 diff。手动核验工作流要求输入前一发布完整 SHA；本地用 `--base` 或 `RELEASE_BASE_SHA`。缺历史、全零 base、非祖先、同一 SHA/空 diff、未知变更均回退 L3；未知范围仍阻止成功封存。操作人不能把未发布的中间提交随意指定为 base 来缩小范围，生产阶段必须沿用准备阶段的同一 base/head。

新报告为 schemaVersion 3，记录等级、每文件理由、base/head、diff 指纹和必需 gate；check/render/finalize 均重算分类以拒绝被篡改或过期的计划。旧 schemaVersion 2 只允许读取已提交历史中的一致封存报告，不能作为新报告继续检查/封存，也不自动迁移。L1 的 `tests` 使用 `--frontend-only`，L2 使用 `--business-only`，L3 保留原 Deno frozen + 完整 unit 检查及单独全部 PGlite suites。CI 仅明确 L1/L2 时才免除高风险 Docker/concurrency job；分类失败不会跳过这些 job。

CI 从已审核 base 的 Git 对象提取分类器，以显式 `--root` 检查候选树，不执行候选分类器来决定是否跳过 Docker/concurrency。base 分类器缺失、执行异常或输出未知值时，最低门禁为 L3；`RELEASE_GATE_FLOOR` 只可提高候选分类等级，不能降低。报告加载还核对 CI base/floor。可信边界依赖 base 的审核与工作流代码审查，不防御有权限恶意重写整个工作流的仓库管理员。此次基础设施变更自身属于 L3；专用 `tooling/release-levels` 分支 push 只运行无生产凭据的 Release checks，不调用生产核验或部署工作流。

**L3 安全边界：**分级器不授予 production approval，也不将通用 Tests/Supabase baseline PASS 等同于冻结版本生产 MATCH。通用报告新增 frozenVersion、edgeBundler、productionApproval、productionMatch 必需项；这些项需既有已审核冻结部署工作流的同版本证据。通用 runner 尚未有已审核的专用工作流证据导入器，因此会保持 PENDING，并拒绝将这些项手工改成 PASS 的 schemaVersion 3 报告，而不是凭环境变量或旧版本报告自动 PASS。故本次 CI 全绿不等于 L3 生产 RELEASE SUCCESS；未来接入证据导入需另行审核，不得删除门禁。高风险发布仍必须走原人工审批/冻结部署流程；分级工作不改动该流程或生产设置。

### 受管理资源引用与缓存版本门禁

以下新门禁优先于前述历史 UI 示例的可发布判断。文件职责为 L1 不等于缓存检查通过；`bc6f03d` 的两个文件仍属 L1，但旧提交没有同步内容版本，使用新策略重新验证该历史范围会得到 L3 + 缓存 FAIL，不能重新签署发布成功。历史报告保持原样。

当前明确管理的生产引用只有两项，扩充关系表属于 L3 基础设施审核，不自动信任新的文件名或消费者：

| 生产资源 | 唯一 HTML 消费者 | 允许的引用 |
| --- | --- | --- |
| `styles.css` | `index.html` | `link rel="stylesheet" href="styles.css?v=<SHA-256>"` |
| `mobile-header.js` | `index.html` | `script src="mobile-header.js?v=<SHA-256>"`，其他属性不变 |

- 版本为目标 Git blob 内容统一 CRLF → LF 后的完整小写 64 位 SHA-256，不使用手写日期。该规则只涉及上述受管理资源，不宣称其他 CSS/JS 已有内容版本保护；未知脚本和关系仍需 L3 审核。
- 完整 `base..head` 中任一受管理资源或任一 HTML 改动，都会检查候选 Git 树的**全部已跟踪 HTML**，包含未修改的消费者。两项引用均须各出现一次且匹配目标资源指纹。缺失、重复、其他消费者、非规范 URL/编码、符号链接、无法解释的 HTML 或不匹配指纹均 fail-closed。资源内容变化时，缓存键还必须相对 base 改变。旧缓存键恰好等于新内容指纹也不能作为重用 URL 的理由。
- 仅改变这两项引用的版本，可从旧日期键迁移到正确内容指纹，归 L1；可同时包含既有白名单认可的内联数值布局变化。路径、执行属性、脚本正文和其余结构不得因此被掩盖。SQL、Auth/RLS、Storage 删除、Edge Functions、部署/安全/分类脚本等混合变化仍取最高 L3。
- `detectRelease` 生成 `resourceVersions` 证据。失败时返回 L3、明确的 FAIL 与阻断原因；分类 CLI 返回非零，报告初始化/校验拒绝失败证据。即使提高 L3 gate floor 也不能绕过缓存失败。报告 check/render/finalize 继续从同一 base/head 重算，不能手改为 PASS/NOT_REQUIRED。仅调用 `classifyChanges` 的文件职责测试不是发布凭证。
- **分阶段边界：**纯分类器/测试/文档提交没有资源或 HTML 变化，缓存项为 NOT_REQUIRED，并仍执行完整 L3 CI。它不证明现有旧缓存已修复。本步骤不修改实际页面、CSS/JS 或版本；之后必须单独更新实际引用，再作为新 L1 发布范围验证。混合资源变化不能利用此豁免。
- 本门禁不改变可信 base 策略、L3 冻结版本、人工 production approval 或 Production MATCH。CI PASS 不代表生产部署获准，也不替代之后保留旧浏览器缓存的 Desktop/Mobile 验证。

## L3 原有完整必需门禁（L1/L2 以分级表裁剪）

- [ ] Git working tree：发布源码已提交，工作区干净，报告 SHA 等于 HEAD。
- [ ] Security：源码 Secret 扫描通过，并人工检查 diff，不含服务器密钥、访问令牌或客户资料。
- [ ] Tests：自动测试、资源和语法检查全部通过；缺依赖、超时或部分通过不能记 PASS。
- [ ] Edge dependencies（纳入 Tests）：用固定 Deno 对两个函数执行冻结依赖完整性与类型检查；配置/锁文件与源码一起审核，禁止解锁绕过。操作与生产兼容性要求见 `EDGE-DEPENDENCIES.md`。
- [ ] Edge bundler：CI 对同一目标 SHA 使用固定摘要的 Supabase Docker 镜像重跑两函数正常/篡改/恢复六项测试；不复用旧提交结果，不将 Docker 证据冒充远端 API 打包器证据。
- [ ] Database：单独运行全部 PGlite `*-db.test.mjs`，必须包含账户、钱包与媒体删除保护数据库测试；缺依赖、跳过或超时记 FAIL。
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

## 原完整发布顺序（按上述等级选择适用步骤）

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
RELEASE FAILED / INCOMPLETE 封存返回非零，同一 SHA 重复封存不重复追加。封存后不改旧结果，修复版本建立新报告。`render` 会核对已封存历史与报告是否一致；丢失归档不能再次显示成功。新报告使用 schemaVersion 3；旧版报告保留为旧证据，不自动补齐新门禁或升级成成功。
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
2. 按 `MEDIA-CLEANUP-DEPLOY.md` 验证并应用媒体删除保护迁移，再部署 `admin-media-cleanup` Edge Function；共享正文模块变更同时发布 `submit-order`。迁移权限或托管 Storage 验证缺失时暂停，不沿用旧审核基线。
3. 再次运行 `node scripts/release-check.mjs`。
4. 最后发布前端静态文件。

快照 RPC 尚未部署时，顾客端会自动退回原有公开请求，不会阻止页面加载；媒体清理入口则应在对应 Edge Function 部署后再交付店主使用。

仓库中的 `.github/workflows/release-check.yml` 会在 `main`、正式修复分支 `fix/media-guard-body-limits-locks`、分级基础设施分支 `tooling/release-levels` 推送和 Pull Request 时自动运行对应分级检查，也支持手动触发。基础设施分支使用 `[CF-Pages-Skip]` 提交前缀，沿用现有 Cloudflare 跳过机制；CI 预检通过不等于生产发布成功。
