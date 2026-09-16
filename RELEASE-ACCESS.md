# 生产核验授权与基线审核

此文件不含令牌，也不是已审核生产基线。只有取得生产源码/指纹、审核记录和生产验证证据后，才建立并提交 `release-supabase-baseline.json`。缺证据保持 PENDING。

## 凭据配置

优先使用 GitHub 仓库 Settings → Environments → `production-verification` → Environment secrets。本地核验可将同名变量配置到运行 Node 的进程环境；当前脚本不会读取用户浏览器会话、个人凭据缓存或自动加载 `.env`。不要把令牌粘贴到聊天、命令参数、Git 文件、日志或报告里。不要开启 shell tracing。

- `CLOUDFLARE_API_TOKEN`：自定义 API Token，仅 Account → Cloudflare Pages → Read，Account Resources 限定 `8f7628a2d1456e6230e13d10a056c473`。不需要 Edit、DNS 或全部账户权限。使用短有效期；Pages Read 是账户级，不能宣称已限定到单一 Pages 项目。
- `SUPABASE_ACCESS_TOKEN`：优先使用 fine-grained 管理令牌，限定项目 `ragqunnuxsfwhrfqpylg`，仅 `edge_functions_read`；通过 OAuth 时对应 `edge_functions:read`。不需要 service-role key、函数写入、Secrets 读取或数据库写入权限。若当前账户界面不提供细粒度令牌，应先确认可用授权方式，不以宽权限个人令牌冒充只读令牌。

GitHub Secrets 无法回读；本机变量不存在不代表 CI Secrets 未配置。在 CI 中运行 `Verify production release` 才能检验那里的授权。本地执行需要另行提供进程环境变量，不能从 CI 或浏览器中提取 Secret。

## 核验与 baseline 建立流程

1. Cloudflare 读取项目 canonical production deployment，核对成功部署、main、非 dirty、完整目标 SHA。归档提交与目标 release SHA 不同不能默默放宽为匹配；旧报告已封存，不覆盖旧结论。需针对当前目标版本生成新报告。
2. Supabase 分别读取 `submit-order`、`admin-media-cleanup` 的元数据，核对 ACTIVE、JWT 验证开启、版本以及 `ezbr_sha256`。不把 API 的完整响应写入日志。
3. 使用只读函数 body/download 能力取得实际部署代码，或取得可信部署系统保存的构建产物及其源码映射凭证。逐一对照审核提交中的入口文件、共享模块、导入配置和依赖。原始部署包保留在忽略目录中，先审查是否含硬编码 Secret；不直接提交原始下载。
4. 元数据中的未知 hash 本身不证明代码经过审核。无法将生产 bundle 与已审核 Git 源码可靠关联时停止，不创建“看起来已审核”的基线。PGlite 测试也不证明生产迁移已执行。
5. 核对生产迁移记录（仅已有审核记录或另行授权的只读核验），补齐无副作用生产验证证据。对媒体清理函数不发删除请求；不可用删除操作来做 Smoke Test。
6. 审核完成后创建基线：顶层 `schemaVersion: 1`、`project`、`sourceCommit`（完整 SHA）、`migrationEvidence`；`functions` 中必须完整列出上述两个函数，每项包含 `slug`、`functionVersion`、`bundleSha256`、`verifyJwt: true`、`sourceEvidence`、`productionEvidence`、`reviewedBy`、`reviewedAt`（ISO 日期）。证据字段填写无敏感信息的实际记录引用；不得使用示例值。
7. Secret 扫描与本地测试通过后提交真实基线，再运行管理核验。核验只读，后端未变更时不重新部署。

报告对平台分别输出 `deploymentRequired`（true / false / UNKNOWN）与 `verificationRequired: true`。当前部署已经核验符合目标时不需要再次部署；无法可靠确定时为 UNKNOWN，而不是 false。是否需要部署不能代替核验 gate 的 PASS / FAIL / PENDING。

官方权限依据：[Cloudflare 项目 API](https://developers.cloudflare.com/api/resources/pages/subresources/projects/methods/get/)、[Supabase 函数元数据 API](https://supabase.com/docs/reference/api/v1-get-a-function)、[Supabase 函数 body API](https://supabase.com/docs/reference/api/v1-get-a-function-body)。
