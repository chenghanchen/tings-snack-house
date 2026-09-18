## 2026-09-18 · 1b0ac4a · style: refine mobile catalog and prevent narrow tablet overflow

**RELEASE SUCCESS ✓**

Version: `1b0ac4a0ec73c5def8a60049fa7c325f45a86afc`

Branch: `main`

Level: **L1**; Base: `0b0262fcf2cbbc32cc9d07b0f6a7b4c639b1e4a6`; Diff: `18ba187ed24192e7af5e48063d114ed0459a5fd121e9d5c762c364810cc10992`

Updated: 2026-09-18T07:09:42.712Z

| Check | Result | Evidence | Checked at |
| --- | --- | --- | --- |
| Git | PASS | Clean release checkout confirmed immediately before history append | 2026-09-18T07:09:42.710Z |
| Tests | PASS | node scripts/release-check.mjs; exit=0; log=tests-1789715371869.log | 2026-09-18T07:09:31.872Z |
| Database | NOT_REQUIRED | L1: outside classified release scope | 2026-09-18T07:08:58.660Z |
| Security | PASS | node scripts/release-security.mjs; exit=0; log=security-1789715372144.log | 2026-09-18T07:09:32.148Z |
| GitHub | PASS | Read-only ls-remote verified origin/main equals the full release SHA | 2026-09-18T07:09:32.588Z |
| Cloudflare | PASS | Deployment required: false; Verification required: true; Cloudflare production deployment=3a2d14d4-818c-4b05-9782-d82593902d73; SHA=1b0ac4a0ec73c5def8a60049fa7c325f45a86afc; deploy=success; site=https://tings-snack-house.pages.dev | 2026-09-18T07:09:33.286Z |
| Supabase | NOT_REQUIRED | L1: outside classified release scope | 2026-09-18T07:08:58.660Z |
| Desktop | PASS | https://tings-snack-house.pages.dev; 1710x1180; isolated Chromium; products/cart/checkout/pickup/delivery/layout; no order submitted; desktop.json; desktop-checkout.png | 2026-09-18T07:09:38.012Z |
| Mobile | PASS | https://tings-snack-house.pages.dev; 390x844; isolated Chromium mobile emulation (not physical device); products/cart/checkout/pickup/delivery/layout; no order submitted; mobile.json; mobile-checkout.png | 2026-09-18T07:09:40.303Z |
| Guest checkout | NOT_REQUIRED | L1: outside classified release scope | 2026-09-18T07:08:58.660Z |
| Production smoke test | PASS | Production HTML/JS/CSS (index.html, app.js, styles.css, customer-account.js, supabase-config.js) SHA256 matches committed source (CRLF normalized) | 2026-09-18T07:09:41.342Z |
| Release Report | PASS | report.json and report.md generated and verified by read-back | 2026-09-18T07:08:58.662Z |
| Release History | PASS | RELEASE-HISTORY.md archived with version marker and exact report; read-back verified | 2026-09-18T07:09:42.712Z |
| Frozen version | NOT_REQUIRED | L1: outside classified release scope | 2026-09-18T07:08:58.660Z |
| Edge bundler integrity | NOT_REQUIRED | L1: outside classified release scope | 2026-09-18T07:08:58.660Z |
| Production human approval | NOT_REQUIRED | L1: outside classified release scope | 2026-09-18T07:08:58.660Z |
| Frozen production MATCH | NOT_REQUIRED | L1: outside classified release scope | 2026-09-18T07:08:58.660Z |

Production: **HEALTHY**

全部必需门禁已有通过证据，报告及历史已归档。HEALTHY 仅限报告列明的验证范围。
