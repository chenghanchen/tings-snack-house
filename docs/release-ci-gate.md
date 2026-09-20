# Release System v1 Stage 3 — release-gate

This is an L3 infrastructure change, not deployment authorization. It changes no
application code, release levels, override eligibility, production environment,
database, Supabase or Cloudflare configuration. Stage 2 worktree fingerprints
must remain unchanged. The main Ruleset is not changed by this implementation.

## Dependency and decision contract

`classify -> [test, edge-bundler, media-concurrency] -> release-gate`, with a direct
dependency from `classify` to `release-gate` as well. The gate has exactly
`needs: [classify, test, edge-bundler, media-concurrency]` and `if: always()`.
No continue-on-error, matrix, path filter or level-specific gate condition is
allowed. Stable job IDs and display names are identical.

Classification starts with `level=L3; valid=false`. Only a successful trusted-base
classifier invocation returning exactly L1, L2 or L3 sets valid=true. Failure
keeps the L3 floor for conservative downstream execution but blocks the gate.
The gate never reclassifies or infers a level from filenames/job names.

| Classification | classify | test | edge-bundler | media-concurrency |
| --- | --- | --- | --- | --- |
| L1 | success, valid=true | success | success/skipped | success/skipped |
| L2 | success, valid=true | success | success/skipped | success/skipped |
| L3 | success, valid=true | success | success | success |

Unknown/missing classification and neutral/failure/cancelled/timed_out/
action_required/stale/missing/unknown conclusions fail. Optional jobs are not
started for L1/L2, but an observed failure cannot be hidden. The matrix describes
CI jobs only; L3 production approval, frozen versions, MATCH and release reports
retain their existing requirements. CI PASS is not production RELEASE SUCCESS.

## Current-attempt, dual-SHA evidence

The gate queries only the GitHub Actions **current run/current attempt** jobs
endpoint, with its read-only token. Every target name must occur exactly once.
Each target must have the expected run_id, run_attempt, completed status and SHA.
No artifact is used as primary authorization evidence.

- PR: API job head_sha equals `github.event.pull_request.head.sha`; each executed,
  successful job verifies `git rev-parse HEAD == GITHUB_SHA` after checkout, and
  exports that SHA plus the current run ID/attempt. The latter SHA is the PR merge
  commit, NOT the API head SHA. The gate itself verifies its checkout as well.
- push/workflow_dispatch: API head_sha and checked-out HEAD both equal GITHUB_SHA.
- Legally skipped L1/L2 specialist jobs have a unique current-attempt skipped
  record and no outputs. They do not have a checkout because they did not run.
  Stale outputs on a skipped job are rejected.
- `needs` conclusions must match raw API conclusions. Successful jobs must have
  all three current-attempt checkout outputs. Missing/mismatched outputs fail.

Pagination checks total_count consistency, record IDs, duplicate names, exact
endpoint/next-page links and completion. Each request has a 10-second timeout;
at most 20 pages are accepted. API/protocol errors fail immediately. Missing or
in-progress records allow at most three independent snapshots, two seconds
apart; snapshots are never concatenated. If a partial rerun omits earlier jobs,
the result is FAIL with `Re-run all jobs`, never a lookup of old attempts.

## Verification and limitations

`node --test tests/release-ci-gate.test.mjs` tests status matrices, dual SHA,
provenance, pagination, bounded retries, workflow structure mutations and the
actual classify shell block with controlled successful/failing outputs. The gate
runs these lightweight tests even for L1; it does not invoke Docker or database
tests for L1. Existing Stage 2 classification/override/report tests remain intact.

Real PR proof must distinguish L3 infrastructure changes from actual L1 changes.
A test PR that introduces this workflow is L3. L1 can be demonstrated using a
documentation-only PR against an isolated validation base containing the gate.
L2 status logic is covered by the same production evaluator's fixture tests; do
not modify application UI merely to manufacture an L2 test PR. Negative proof
branches are disposable, explicitly DO NOT MERGE, and cannot change main.

The gate catches ordinary upstream failure/skip. It cannot defend itself against
an authorized actor rewriting the whole workflow or its own checks. Structure
tests prevent accidental conditional skipping, not malicious replacement of both
the tests and workflow. Cancellation/unavailable runners cannot produce PASS.

## Separately approved Ruleset migration

1. Review and separately approve integration of the verified infrastructure into
   the trusted main baseline. This task does not merge it.
2. Add `release-gate` as a fifth required check, with GitHub Actions as its source;
   preserve classify/test/edge-bundler/media-concurrency during transition.
3. Verify actual L1/L2 policy behavior and L3 success/failure blocking on current
   commit evidence. Keep strict up-to-date, PR requirements, empty bypass,
   non-fast-forward and deletion protections unchanged.
4. Only after verification and separate approval, remove the original four
   required contexts. Their jobs still run; release-gate is the required summary.
5. Missing new checks block merges; never remove old requirements before the new
   gate is present and working. No Ruleset change is made by these scripts.
