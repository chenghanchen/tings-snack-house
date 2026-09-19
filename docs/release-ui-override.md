# Exact UI manual override (independent L3 infrastructure)

## Trust and scope

This is a narrow exception mechanism, not a manual `--level L1` switch. `classifyFile` and the ordinary automatic rules are unchanged. `detectRelease` first classifies the complete ancestor diff and runs Cache Version Guard, then considers `release-ui-overrides.json` **only from the immutable base Git tree**. There is no environment-variable JSON, working-tree file or candidate approval input. CI still executes the base classifier, and an explicit trusted L3 gate floor cannot be reduced. The override support, manifest, eligibility registry, tests and workflow changes themselves are L3.

The threat model is an untrusted candidate, not an administrator maliciously replacing the audited base or workflow. Maintainers must review approval/eligibility changes through the existing independent L3 process; a JSON `review` string alone is not a human signature. No new approval is taken from the application candidate. This branch does not deploy or authorize production.

## Minimal supported eligibility

Only two exact path + before/after LF-normalized SHA-256 pairs are initially eligible:

- `customer-account.js`: `940c11a79a01bd0979d68fa855a18d5da5b2bfb9feb277f3da9d1c9f6b802093` -> `d9bf368da56ecb72d6ad4fbf5d5a80543ceb48f40d4a96a931de955e17b542c6`.
- `scripts/check-customer-account.cjs`: `357b8507d6232726a1502fa71b60c1ac84035d1639c15809593e42d688657359` -> `a3ea9844dccac416c6f14544afa4f72c1fde493c2d2615940f6a588c64205dd6`.

`.cjs` is the actual test path; there is no `scripts/check-customer-account.js` exception. Both must be existing, regular 100644 modifications. This is NOT permission to override future content in either file. New source hashes require an independently audited L3 eligibility change. This deliberate maintenance cost avoids pretending a keyword filter can prove arbitrary JavaScript safe.

The application pair contains exactly two source replacements: delete the default-address descriptive paragraph and clear the idle loaded `资料已同步` text. All RPC functions/arguments, Auth/session checks, dirty-state computation, save disabled rules, back-button handlers, order/financial code and error handling remain byte-identical. The test pair adds back-button dimensions/hit-target checks, responsive widths, removed-copy checks, progress visibility, local screenshots, and two waits on the revised DOM status. All network mock/setup code and business/security assertions are retained. No live API writes are introduced. The immutable patch fixture exercises the complete pending four-file scope only in disposable Git repositories.

Everything else that automatic classification marks L3 is non-overridable: migrations/SQL, Edge Functions, Auth/RLS, Storage/delete behavior, payment/order amounts, admin privileges, deployment/security/workflow/policy/lockfiles, arbitrary tests and unknown files. Injecting one of these operations into an eligible filename changes its hash and is also non-overridable, even if an approval is forged to include the new hash.

## Approval contract

The trusted manifest has exactly `schemaVersion: 1` and `approvals` (1–20 entries). Each approval has exactly `id`, `review`, `issuedAt`, `expiresAt`, `diffFingerprint`, `files`. Each file row has exactly `path`, `beforeSha256`, `afterSha256`. Paths cannot repeat. IDs are unique; exactly one approval may match a diff. UTC timestamps must be canonical ISO dates, issued no later than now, not expired, with a lifetime of at most seven days. Unknown fields, invalid dates, malformed JSON, oversized files, unsupported pairs and ambiguity fail closed.

`diffFingerprint` is the existing classifier's SHA-256 of `JSON.stringify(changes)` read from Git (ordered paths, modes, statuses and complete before/after contents). It binds the **whole** release, including normal L1 CSS/HTML changes, not only exception files. It is distinct from the human-readable patch SHA-256. Any extra file, content change, mode change, missing/changed approval, wrong before source or cache-version failure prevents L1. CRLF normalization for reviewed file hashes matches existing Git content-version policy; Git-equivalent line-ending normalization is not a source change. Working-tree raw preservation hashes must still be checked before the later application commit.

The initial manifest transcribes the user's 2026-09-19 approval for the exact pending four-file diff; it has no effect on this infrastructure release or on the original dirty worktree. It may only be consumed after this infrastructure and approval have independently passed L3 review and become the release's trusted base. It expires 2026-09-26T05:10:12.000Z. Do not change release base merely to locate an old unexpired approval. No automatic renewal or wildcard approval exists.

## Gates and reports

Applied plans retain `automaticLevel: L3` for both overridden files, approval details, trusted source-base SHA and manifest content hash. Other L2/L3 files still determine the maximum level; any unrelated L3 rejects the exception. Required gates are derived normally from the effective level. No existing L3 productionApproval, frozenVersion, edgeBundler or productionMatch validation is loosened. Cache Version Guard is always evaluated first and cannot be overridden.

Report init/check/render/finalize continue to re-run `detectRelease` against the same base/head. The same trusted manifest and exact Git diff must still match. Expiry is checked again when classification/report evidence is validated; stale reports cannot continue or be presented as current approval. A report containing expired applied override evidence fails validation rather than silently retaining NOT_REQUIRED gates. Old finalized reports remain immutable evidence; rendering an expired override with the current active validator is deliberately refused. This is not a way to claim CI-only evidence proves a successful deployment.

## Verification and boundaries

Regression tests cover allowed transitions, missing/candidate-only/modified/malformed approvals, expiry/future issuance/excess lifetime, fingerprints, full-scope drift, cache failures, modes, duplicate/ambiguous records, trusted floors, uncertainty, forged report metadata, and hard L3 categories including aliased operations inside eligible filenames. Existing release/report suites remain required. The infrastructure branch `tooling/release-ui-override` runs the full Release checks workflow, including frozen dependency checks, PGlite, Docker bundler and media concurrency. Its commits use `[CF-Pages-Skip]`; main is not merged and production verification/deployment workflows are not dispatched.

Two existing test-fixture prerequisites were repaired without weakening their assertions: the version-only test now seeds a deliberately stale reference in its disposable HTML (the real main HTML already has current hashes, which otherwise made its supposed release an empty diff); the shared-state source extractor normalizes CRLF before finding its LF delimiter. No application files or expected business outcomes were changed.
