## 2026-09-18 · 0935bdb · fix(ui): version managed assets by content hash

**RELEASE SUCCESS ✓**

Version: `0935bdb9ede47506cbbf5d8ecc26e5d1c87690ce`

Branch: `main`

Level: **L1**; Base: `9767d121aeaeaa9d61b9a9482aeda8fefe8522e6`; Diff: `a4420b90c8e97899607d65bca66487a308f3d1a293a7af403a7139157a52b6a8`

Updated: 2026-09-18T08:12:39.653Z

| Check | Result | Evidence | Checked at |
| --- | --- | --- | --- |
| Git | PASS | Clean release checkout confirmed immediately before history append | 2026-09-18T08:12:39.651Z |
| Tests | PASS | node scripts/release-check.mjs; exit=0; log=tests-1789719148754.log | 2026-09-18T08:12:28.758Z |
| Database | NOT_REQUIRED | L1: outside classified release scope | 2026-09-18T08:12:04.128Z |
| Security | PASS | node scripts/release-security.mjs; exit=0; log=security-1789719149177.log | 2026-09-18T08:12:29.182Z |
| GitHub | PASS | Read-only ls-remote verified origin/main equals the full release SHA | 2026-09-18T08:12:29.696Z |
| Cloudflare | PASS | Deployment required: false; Verification required: true; Cloudflare production deployment=e7909b34-ab17-45cb-b145-dd496311d9bd; SHA=0935bdb9ede47506cbbf5d8ecc26e5d1c87690ce; deploy=success; site=https://tings-snack-house.pages.dev | 2026-09-18T08:12:30.707Z |
| Supabase | NOT_REQUIRED | L1: outside classified release scope | 2026-09-18T08:12:04.128Z |
| Desktop | PASS | https://tings-snack-house.pages.dev; 1710x1180; isolated Chromium; products/cart/checkout/pickup/delivery/layout; no order submitted; desktop.json; desktop-checkout.png | 2026-09-18T08:12:36.004Z |
| Mobile | PASS | https://tings-snack-house.pages.dev; 390x844; isolated Chromium mobile emulation (not physical device); products/cart/checkout/pickup/delivery/layout; no order submitted; mobile.json; mobile-checkout.png | 2026-09-18T08:12:38.649Z |
| Guest checkout | NOT_REQUIRED | L1: outside classified release scope | 2026-09-18T08:12:04.128Z |
| Production smoke test | PASS | Production HTML/JS/CSS (index.html, app.js, styles.css, customer-account.js, supabase-config.js) SHA256 matches committed source (CRLF normalized) | 2026-09-18T08:12:39.461Z |
| Release Report | PASS | report.json and report.md generated and verified by read-back | 2026-09-18T08:12:04.130Z |
| Release History | PASS | RELEASE-HISTORY.md archived with version marker and exact report; read-back verified | 2026-09-18T08:12:39.653Z |
| Frozen version | NOT_REQUIRED | L1: outside classified release scope | 2026-09-18T08:12:04.128Z |
| Edge bundler integrity | NOT_REQUIRED | L1: outside classified release scope | 2026-09-18T08:12:04.128Z |
| Production human approval | NOT_REQUIRED | L1: outside classified release scope | 2026-09-18T08:12:04.128Z |
| Frozen production MATCH | NOT_REQUIRED | L1: outside classified release scope | 2026-09-18T08:12:04.128Z |

Production: **HEALTHY**

全部必需门禁已有通过证据，报告及历史已归档。HEALTHY 仅限报告列明的验证范围。
