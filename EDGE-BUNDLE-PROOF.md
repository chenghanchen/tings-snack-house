# Supabase lockfile Docker proof — verification only

The original audit branch is NOT a deployable release. It includes function work
solely as bundler inputs. No migration or function is deployed by this proof.
The standalone workflow is restricted to `audit/edge-lockfile-bundling-*`; formal
Release Checks also run the same proof for their target SHA. Neither proof job
uses a production environment or production secrets.
Commits use `[CF-Pages-Skip]` to suppress Cloudflare deployments.

## Explicit transport

An actual Supabase CLI 2.117.0 source upload captured by a loopback-only receiver
showed that discovering `deno.json` does not automatically upload `deno.lock`.
The candidate is per-function `static_files = ["./functions/<slug>/deno.lock"]`:
that capture contained byte-identical locks. Missing locks were silently omitted,
so this proof also requires each lock before bundling. Transport capture does NOT
prove remote consumption. No real management API was called.

For local Docker bundling, the CLI passes static paths as `bundle --static <path>`.
This workflow reproduces this command with each lock/config beside its entrypoint;
the formal candidate config now explicitly includes these static lockfile paths,
but verification does not change any deployed function. The image is the CLI 2.117.0-associated
`supabase/edge-runtime:v1.74.3`, pinned to its Docker Hub Linux amd64 manifest:
`sha256:cc355c3d0e9c063a351cad56d1c4c52a3c4d85aff4e1fad9d91688e75f9aad09`.

Sources:
- https://github.com/supabase/cli/blob/v2.117.0/apps/cli/src/shared/functions/deploy.ts
- https://github.com/supabase/cli/blob/v2.117.0/apps/cli-go/pkg/config/templates/Dockerfile
- https://github.com/supabase/edge-runtime/blob/v1.74.3/cli/src/main.rs

## Acceptance

Each function: normal -> one modified package SHA512 integrity -> normal control.
Every case uses a new container and cache, read-only filtered public-branch source,
no host credentials/config/socket, no production requests. Containers download npm
dependencies; they only bundle modules and never serve or invoke function handlers.

PASS requires all six cases: nonempty normal/control ESZIPs, nonzero tamper exit
specifically naming the modified package and an integrity/checksum mismatch, no
tampered ESZIP, and unchanged input locks. Generic failure/timeouts are not PASS.
Artifacts retain report/logs/source hashes/image identity/bundle hashes for 30 days.
This is Docker bundler evidence, not remote API bundler or production certification.
Do not call `bundleOnly`: that endpoint changes remote function versions.

Run on fresh Linux Docker checkout: `node scripts/edge-bundle-proof.mjs`.
