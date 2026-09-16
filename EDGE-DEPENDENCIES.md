# Edge Function 依赖锁定

范围：`submit-order` 与 `admin-media-cleanup`；不修改浏览器端 SDK。

- Supabase JS 固定为 `2.116.0`，不是 `@2` / `latest`。这是本次候选源码依赖版本，不冒充已审核的生产依赖版本。
- 本地与 CI 的 Deno CLI 固定为 `2.9.6`，统一清单位于 `supabase/edge-toolchain.json`。这不是 Supabase 托管 Edge Runtime 的版本声明。
- 每个函数有独立 `deno.json` 与 Deno 实际生成的 `deno.lock`（格式 v5），冻结解析结果和 9 个 npm 包的 SHA-512 完整性。禁止 `node_modules` 回退，不启用安装生命周期脚本。
- 初始版本来自 npm 官方注册表；Supabase JS 2.116.0 发布时间为 2026-09-07。生成锁文件是信任初始依赖的步骤，不是对第三方源码的全面审计，也不证明无漏洞。

## 正常检查（不得更新锁文件）

安装官方 Deno 2.9.6 并加入 PATH，或将 `DENO_BIN` 环境变量设为其绝对路径，然后运行：

```text
node scripts/check-edge-dependencies.mjs
node scripts/release-check.mjs --unit-only
```

检查使用每个函数自己的配置运行 `deno check --frozen`，验证依赖解析与类型并确认锁文件字节未变。缺 Deno、版本不符、依赖漂移、完整性不符或类型错误均失败，不跳过。正式 Release Report 的 Tests gate 自动包含此检查，两个发布检查工作流安装同一精确 Deno 版本。

CI 不复用 Deno 缓存，下载包时验证锁文件完整性；本地若需重验下载内容，将 `DENO_DIR` 指向新的空目录再检查。检查不启动函数、不需要平台令牌、不创建订单或删除媒体。

## 有意升级

1. 审核版本、变更日志与安全公告，修改两个入口的精确版本及工具链清单。
2. 仅在升级操作中生成锁文件，例如：

   ```text
   deno install --entrypoint --config supabase/functions/submit-order/deno.json --frozen=false supabase/functions/submit-order/index.ts
   deno install --entrypoint --config supabase/functions/admin-media-cleanup/deno.json --frozen=false supabase/functions/admin-media-cleanup/index.ts
   ```

3. 审核全部传递依赖和 integrity diff，再执行正常冻结检查、数据库测试与 Secret 扫描。Deno 版本变化还需同步两个工作流。
4. 同一提交保存函数、配置与锁文件。不能手工捏造 integrity、删锁文件重试，或在 CI / 发布时使用 `--no-lock`、`--frozen=false`、`--no-check` 绕过失败。

## 生产边界

已验证的构建路径是 Supabase CLI 2.117.0 对应的 Docker Edge Runtime 1.74.3，固定镜像摘要与六项正常/篡改/恢复测试见 `EDGE-BUNDLE-PROOF.md`。首次真实证据为 Actions run 35153275615，源码提交 `2b9cda0bfbc1c3c3fe5ac679d74b7cbc5c950347`。正式 CI 会对当前提交重新执行，不复用旧 SHA 的 PASS。

`supabase/config.toml` 通过每个函数的 `static_files` 显式传送 `deno.lock`。CLI 自动发现 `deno.json` 不代表自动携带锁文件；生产构建不得省略这项配置。当前仅 Docker bundler 已取得正常成功、篡改明确被完整性检查拒绝的证据；`--use-api` 远端打包器仍未验证，不能将本结果用于批准该路径。采用不同 CLI / Runtime 或远端构建路径时必须重新验证。

Supabase 部署应从完整 Git 检出目录进行，保留函数级配置及锁文件，不从 Dashboard 单独粘贴 `index.ts`。部署前必须验证所用 Supabase CLI / Edge Runtime 支持并使用该锁文件格式；本地 Deno 校验不能证明远程打包器遵循锁文件。不支持时阻止发布并调整经审核的工具链，不能关闭锁校验。

两函数依赖已变更，因此需要重新部署和采集管理 API 源码/配置及 bundle 指纹证据；新锁文件和配置也属于源码比较范围。若管理 API 不返回这些文件，需要补充可验证的构建/部署证据，否则基线保持 PENDING。不要用旧生产版本的核验结果认定本次成功。

参考：[Supabase 函数依赖管理](https://supabase.com/docs/guides/functions/dependencies)、[Deno 冻结锁文件](https://docs.deno.com/examples/dependency_lockfile_tutorial/)。
