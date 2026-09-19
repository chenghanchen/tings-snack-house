## 2026-09-19 · cae4449 · style(account): unify back buttons and simplify details copy

**RELEASE SUCCESS ✓**

Version: `cae4449bb65e26250ffa75dfbd247b02afd04e39`

Branch: `main`

Level: **L1**; Base: `f7db79b60367fb7349d94405807b7ac3ba173ed2`; Diff: `9ca24fd126b8b8cfe948ddb3b10d91b1115ea71cbab1f3da1b027b0a0e12a3d7`

Manual override: **APPLIED**; ID: account-details-back-ui-20260919; trusted base: `f7db79b60367fb7349d94405807b7ac3ba173ed2`; expires: 2026-09-26T05:10:12.000Z; original file levels retained in JSON.

Updated: 2026-09-19T05:41:31.043Z

| Check | Result | Evidence | Checked at |
| --- | --- | --- | --- |
| Git | PASS | Clean release checkout confirmed immediately before history append | 2026-09-19T05:41:31.040Z |
| Tests | PASS | node scripts/release-check.mjs; exit=0; log=tests-1789796479678.log | 2026-09-19T05:41:19.682Z |
| Database | NOT_REQUIRED | L1: outside classified release scope | 2026-09-19T05:40:55.496Z |
| Security | PASS | node scripts/release-security.mjs; exit=0; log=security-1789796480335.log | 2026-09-19T05:41:20.339Z |
| GitHub | PASS | Read-only ls-remote verified origin/main equals the full release SHA | 2026-09-19T05:41:20.783Z |
| Cloudflare | PASS | Deployment required: false; Verification required: true; Cloudflare production deployment=fb0cb98f-58c7-457b-bd40-912715e6ec86; SHA=cae4449bb65e26250ffa75dfbd247b02afd04e39; deploy=success; site=https://tings-snack-house.pages.dev | 2026-09-19T05:41:22.216Z |
| Supabase | NOT_REQUIRED | L1: outside classified release scope | 2026-09-19T05:40:55.496Z |
| Desktop | PASS | https://tings-snack-house.pages.dev; 1710x1180; isolated Chromium; products/cart/checkout/pickup/delivery/layout; no order submitted; desktop.json; desktop-checkout.png | 2026-09-19T05:41:27.176Z |
| Mobile | PASS | https://tings-snack-house.pages.dev; 390x844; isolated Chromium mobile emulation (not physical device); products/cart/checkout/pickup/delivery/layout; no order submitted; mobile.json; mobile-checkout.png | 2026-09-19T05:41:29.863Z |
| Guest checkout | NOT_REQUIRED | L1: outside classified release scope | 2026-09-19T05:40:55.496Z |
| Production smoke test | PASS | Production HTML/JS/CSS (index.html, app.js, styles.css, customer-account.js, supabase-config.js) SHA256 matches committed source (CRLF normalized) | 2026-09-19T05:41:30.720Z |
| Release Report | PASS | report.json and report.md generated and verified by read-back | 2026-09-19T05:40:55.501Z |
| Release History | PASS | RELEASE-HISTORY.md archived with version marker and exact report; read-back verified | 2026-09-19T05:41:31.043Z |
| Frozen version | NOT_REQUIRED | L1: outside classified release scope | 2026-09-19T05:40:55.496Z |
| Edge bundler integrity | NOT_REQUIRED | L1: outside classified release scope | 2026-09-19T05:40:55.496Z |
| Production human approval | NOT_REQUIRED | L1: outside classified release scope | 2026-09-19T05:40:55.496Z |
| Frozen production MATCH | NOT_REQUIRED | L1: outside classified release scope | 2026-09-19T05:40:55.496Z |

Production: **HEALTHY**

全部必需门禁已有通过证据，报告及历史已归档。HEALTHY 仅限报告列明的验证范围。
