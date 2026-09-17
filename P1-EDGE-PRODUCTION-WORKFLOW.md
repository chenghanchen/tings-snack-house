# Frozen P1 Edge deployment (not a complete storefront release)

Only application commit `6b4b7b9d236b1c2b04368e175df1a75521b229ef` may be deployed.
The separate orchestration commit adds only this document, workflow, adapter and tests.
Do not merge it into main, change the frozen source or regenerate its lockfiles.

## Prerequisites and approval

- Maintain the manual media-cleanup maintenance window throughout this operation.
- The P1 production database migration/post-migration were completed in the preceding operation. This workflow neither runs SQL nor connects to the database.
- GitHub Environment `production` (ID `22115045546`) requires human reviewer `chenghanchen`, disables administrator bypass, and allows only branch `deploy/p1-frozen-6b4b7b9`.
- Prevent self-review is not enabled: the repository owner can approve a run they triggered. Approval is still a separate human action; the agent must not perform it.
- The user must personally configure `SUPABASE_ACCESS_TOKEN` **only** under this Environment's secrets. Use a project-restricted management token with Edge Functions read and write for `ragqunnuxsfwhrfqpylg`. Do not use a service-role key, database password, other Environment, repository secret, local `.env` or chat.
- Before clicking Approve, check the frozen SHA, successful preparation, exact bundle fingerprints, current maintenance window and presence of the Environment secret. Never enable debug logging.
- The adapter independently requires an approval in this run's GitHub review history for this exact Environment ID by the human reviewer. Missing/inaccessible evidence stops before any Supabase request. Only first-attempt push runs are accepted; an old run's approval cannot be reused by rerun.

## Execution and evidence chain

The branch push starts a no-production-secrets preparation job. It checks the exact frozen checkout and Git blobs against the reviewed SHA-256 manifest, runs local Release Checks, independent PGlite checks, security checks and the existing frozen Deno dependency check. It runs the existing frozen six-case Docker proof (normal/tampered/control for both functions). Tampering is confined to disposable proof fixtures; the checked-in lockfiles are never changed.

The Linux amd64 bundler is the previously verified official runtime 1.74.3 image:
`supabase/edge-runtime@sha256:cc355c3d0e9c063a351cad56d1c4c52a3c4d85aff4e1fad9d91688e75f9aad09`.
Its cold-cache command discovers the frozen `deno.json`/`deno.lock`; the lock is also included as a static file. This proof is for this Docker bundler, not the remote API source bundler.

Normal-case ESZIPs are encoded as `EZBR` + Brotli quality 6, exactly the prebundled transport used by Supabase CLI 2.117.0. Artifacts contain only local public-source bundles and a hash manifest created before any production secret is available. The manifest is additionally bound to the run ID/workflow SHA and a job-output SHA-256.

After human approval, a fresh job rechecks frozen fingerprints and Deno dependencies. Only the upload step receives the production token. It uses Management API `PATCH /v1/projects/{ref}/functions/{slug}` with `Content-Type: application/vnd.denoland.eszip`, explicit JWT true, frozen entrypoint, no import map, and `ezbr_sha256`. It does not submit raw sources to a remote bundler or run a CLI command that could synchronize other project configuration.

The allowlist contains only `submit-order` followed by `admin-media-cleanup`. Both must exist/ACTIVE/JWT true before any write. Each upload is followed immediately by GET metadata → GET raw body → GET metadata. The API version must advance, the capture must be stable, JWT/entrypoint/import-map configuration must match, and both compressed bundle metadata fingerprint and downloaded raw ESZIP SHA-256 must match the locally prepared bundle. Both metadata records are rechecked after the second upload.

Source/config/lock identity is proven by the frozen per-file manifest → verified Docker bundle → exact deployed bundle chain. This is not a claim that the platform's transpiled JavaScript is byte-identical to original TypeScript. Unsupported body representation, absent fingerprint, unstable version or unavailable approval/API evidence cannot be declared MATCH.

## Stop behavior

No automatic retry of a PATCH, rollback, function invocation, database operation, media deletion, secret/config synchronization, main merge or maintenance-window release exists in the workflow. A first-function failure prevents the second upload. A second-function failure leaves the first reported independently. An ambiguous network outcome is INCOMPLETE and must be investigated read-only before retrying; never blindly rerun a partially completed deployment.

Reports contain only fixed identifiers, typed version/config evidence and hashes; no token, response/error body, production source, authorization header or customer data. `MATCH` means both functions passed this scoped gate; it is not `RELEASE SUCCESS` for the whole website. Any explicit mismatch is `RELEASE FAILED`; missing evidence is `INCOMPLETE`. Always keep media cleanup paused after completion.

Official transport reference: https://supabase.com/docs/reference/api/v1-update-a-function
Official approval evidence: https://docs.github.com/en/rest/actions/workflow-runs#get-the-review-history-for-a-workflow-run
