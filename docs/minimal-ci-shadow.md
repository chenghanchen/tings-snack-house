# Minimal CI migration: shadow phase only

This phase does NOT replace the required release-gate, change Rulesets, remove an
existing workflow, or authorize deployments. ci-shadow.yml runs on PRs/manual
dispatch only. No production requests, platform credentials or write permissions.
The existing release-check workflow remains authoritative.

## Dependency graph and contract

shadow-select → shadow-test + shadow-database + shadow-edge + shadow-media-concurrency → release-gate-shadow

The last job uses if: always(). Selected jobs require actual success; unselected
jobs permit only success/skipped, never neutral/failure/cancelled. Missing,
duplicate, unfinished or mismatched evidence fails. Success requires positive
case counts emitted only after every mandatory operation. Every Node test file
requires complete TAP counters and a real named test; empty files do not pass.
Browser completeness uses the unchanged Stage 5 seven-module policy, layout
matrix, mobile/touch contexts and zero retries.

API evidence uses the existing exact-run/attempt pagination utility, not Report
or artifacts. PR API head SHA and Git checkout merge SHA are separately bound.
Success outputs bind run/attempt/checkout SHA. The gate recomputes selection from
the same complete Git diff. Partial reruns cannot borrow evidence: Re-run all jobs.

No shadow job is named release-gate. It cannot impersonate or satisfy the current
required context. Migrating that name requires separate approval.

## Additive path table

| Change | Requirements beyond base |
| --- | --- |
| Presentation HTML, explicit mobile header/nav/footer, CSS, image/font assets | none |
| SQL anywhere, migration/schema/RLS/RPC/database contract | database |
| Explicit account/order/database callers | database + edge |
| Current Edge functions (cross DB boundaries) | database + edge |
| Edge unit-test entry | edge |
| Storage deletion/media references/cleanup/guards and media callers | database + edge + media-concurrency |
| Shared Edge module, dependency/config/lock, workflow/selector, unknown path | full, unknown=true |
| Rename/delete/copy/type change, nonregular file, unavailable diff | full, unknown=true |

Exact lists are in ci-select.mjs. No JS semantic inference, source-hash approval,
L1/L2/L3 or whole-JS-directory exemption. Paths identify relevant suites, NOT proof
that arbitrary new code is safe. Reviewers must identify new cross-boundary
dependencies. The shadow is not approved as the sole safety authority.

Unknown complete diffs require the full set. An unavailable diff schedules all
high-risk jobs AND fails the gate. Malformed selection defaults conditional jobs
to run and fails the gate. Extra tests cannot replace missing scope evidence.

## Direct runner

- CI_BASE_SHA=<full SHA> npm run ci:select: current-checkout-bound JSON.
- CI_BASE_SHA=<full SHA> npm run ci:check -- base: local references, syntax,
  whitespace, Cache Version Guard, secret scan, non-DB Node suites, Stage 5 once.
- npm run ci:check -- database: three mandatory PGlite suites, individually
  checked for nonzero execution and no skipped tests.
- npm run ci:check -- edge: existing Edge units, frozen Deno type/dependency
  verification and unchanged six-case Linux Docker bundling proof.
- npm run ci:check -- media-concurrency: unchanged four-case isolated PostgreSQL
  concurrency proof in Linux Docker.

Node/browser child timeout remains 240 seconds. Existing Edge/Docker workloads
retain their longer isolated job budgets. Linux CI installs pinned dependencies
and Playwright Chromium with system dependencies. Missing tools fail, never PASS.
Use LF checkouts for existing SQL engine-recognition assertions; CRLF changes SQL
function text. Do not weaken migration guards to hide environment problems.

Base runs no database server, Docker, Deno or production check. Offline Node tests
may import backend pure functions, not deployed services. Shadow comparison
intentionally duplicates work ACROSS workflows; new base runs the browser once.

## Cache Version Guard extraction

cache-version-guard.mjs is independent of classifier/Report. The map, parser and
validation function are an exact extraction, with a byte-for-byte parity test.
Managed resources remain styles.css, mobile-header.js, customer-account.css and
customer-account.js. Git-tree hashes, reference restrictions, changed-cache-key
and NOT_REQUIRED semantics remain unchanged. No Stage 6 manifest or production
fetch is introduced.

The old classifier must remain a standalone trusted-base script: a new import
would break its temporary-file loading and fixture copies. Its embedded guard is
temporarily retained with exact parity tests. Remove this duplicate only during
later approved legacy retirement.

## Comparison and remaining migration dependencies

Selector tests print old level/DB scope and new requirements for identical
fixtures. CSS is old L1/new base. Arbitrary mobile-module bytes can be old L3/new
base because the new mechanism uses responsibility, not source-transition proof.
Account/backend files are not in the presentation list. SQL and Edge no longer
automatically select unrelated jobs. Unknown and media remain full. These are
explicit selection differences, NOT source-semantic equivalence or authority to
remove the old gate.

Before deleting the legacy path:
1. Obtain real Linux shadow CI evidence, including Docker, on the exact candidate.
2. Approve the path table and review responsibility-change gaps.
3. Extract generic run/attempt API helpers from release-ci-gate.mjs; the shadow
   imports those helpers but not the old L1/L2/L3 decision function.
4. Decide which legacy classifier/Report/Override Node tests retire with modules;
   the current mandatory Node inventory still includes them.
5. Migrate the existing required release-gate implementation atomically via PR,
   keeping its stable name. Never delete a required check first.
6. Separately retire old modules/workflows/docs/npm callers. No production
   approval or deployment authority is created here.

Rollback is not adopting the new shadow files/npm entries. The authoritative
workflow, Ruleset, Stage 5 and production remain untouched.
