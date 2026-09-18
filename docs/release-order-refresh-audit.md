# Order refresh UI: independent L3 infrastructure audit

Baseline: `2be07ac33c3a3758d548ae200bf21713da3fb678`. Application files, workflows, database and production configuration are unchanged in this branch. The original worktree remains separate. The preserved UI patch under tests/fixtures is test data, not deployed application code.

## Original L3 triggers

| File | Rule | Actual change / audit |
| --- | --- | --- |
| customer-account.js | Unclassified-file fallback | SVG template, setOrderRefreshBusy, disabled click guard and removal of customerOrderUpdated. RPC names/arguments, session validation, request identity and financial/order logic unchanged. |
| index.html | onlyManagedVersionsChanged knew only styles.css/mobile-header.js, so other executable HTML fell through | Existing account CSS/JS version queries alone change to content hashes. Paths, defer attribute and script bodies unchanged. |
| scripts/check-customer-account.cjs | Unclassified-file fallback | Offline fixture, presentation/interaction assertions and console checks. |
| scripts/check-order-refresh.cjs | riskPath matches order | Offline fixture helper, not production order code. |

The account edit is not literally CSS-only: manual repeated refresh clicks become disabled while an existing request is busy. It is an audited low-risk UI transition; backendChanged=false alone did not authorize reduced gates.

## Exact policy boundary

Only the one-way customer-account.js modification from normalized hash `2a1b49e338c28710261381c5ba566201918d7dfcbe8ac3c3f998904ec11bbd51` to `940c11a79a01bd0979d68fa855a18d5da5b2bfb9feb277f3da9d1c9f6b802093` is L1, with both modes 100644. Unknown bytes, reverse transitions, aliases, additions, deletion or mode changes remain L3. This is not an account-directory exemption.

The two support paths likewise require exact reviewed source fingerprints. These include the original suite, dimension-corrected baseline, pending UI test snapshot and dimension-corrected pending snapshot. Scope approval never makes a failing assertion PASS. Any future test-code change requires fresh review.

Account CSS/JS join the exact managed index.html reference map. All four resources must have a unique consumer and correct content SHA; changed content requires a changed URL. All tracked HTML is checked, including unchanged and extra consumers. Unknown URLs, duplicate/missing consumers, changed script paths or executable attributes cannot be disguised as version updates.

FULL_GATES, trusted base evaluation, production approval, frozen version and Production MATCH are unchanged. Mixed high-risk edits select L3. This branch itself is L3; CI success is neither main synchronization nor production approval.

## Stale assertion evidence

Full account regression stopped at desktop successLayout (baseline around line 984, pending UI around line 1013). The next mobile assertion shared the obsolete label width.

| Assertion | Old | Approved design / current source | Correct expectation |
| --- | --- | --- | --- |
| Referral code font | 15px | Prior UI request 16px; styles.css line 67 | 16px |
| Delivery label | 90px | Prior UI request 80px; third summary row, line 73 | 80px desktop/mobile |
| Desktop address | 320px | Same fixed viewport after label narrowed by 10px; CSS comment and rendered evidence | 330px |

check-success-dialog.cjs independently asserts 16px, unobstructed close hit areas, no clipping/overflow across 320–1710px. None of those checks are removed. Correcting only these expectations allows the full offline account suite to pass on both published baseline source and an isolated copy of pending UI. OTP, owner isolation, cancellation, XSS, session races, cart, search and filter checks remain. No production credentials or writes are used.

## Original worktree SHA-256 preservation

| File | Raw hash |
| --- | --- |
| customer-account.css | 274f6c6adbd701ddf42b250af1fb99f6f7d77b438a2fceb0979981621a8f2deb |
| customer-account.js | 940c11a79a01bd0979d68fa855a18d5da5b2bfb9feb277f3da9d1c9f6b802093 |
| index.html | ce50731e40ff555f7c0583e6e3b471b8c7de93b17d3a588f4c9997eace55790d |
| scripts/check-customer-account.cjs | 71de69a1f8d9af0e646fac914eae5c53ad9f949490f93585e8eb6c2d055f97ae |
| scripts/check-order-refresh.cjs | 437daffbaa35590870ff78332a1a642d6a9454cf4643984e031f60a3e31218b9 |

Three application files' diff SHA-256: `d4df50973ff7ec29755e7df6d45d1dadddd2eed41def922c47be8a6dfd24ec8d`. Original files are not overwritten. The corrected infrastructure test must later be reconciled with pending UI assertions; this stage does not merge main or release UI.
