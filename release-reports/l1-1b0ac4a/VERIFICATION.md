# L1 mobile catalog release — supplemental verification

Application: `1b0ac4a0ec73c5def8a60049fa7c325f45a86afc`.
Base: `0b0262fcf2cbbc32cc9d07b0f6a7b4c639b1e4a6`.

The three-file application diff is L1: `index.html`, `mobile-header.js`,
`styles.css`. The classifier and all backend/configuration files are unchanged.

## Narrow-tablet overflow fix

At 781px the existing five-column product grid used `1fr` tracks whose automatic
minimum sizes were expanded by promotional price content. The grid's scroll
width was 796px inside a 672px container; document scrollWidth was 850px versus
clientWidth 781px. The same overflow was reproduced with the committed baseline.

Only the 781–1023px range now uses
`repeat(var(--site-cols,4),minmax(0,1fr))`. Configured column count and gaps are
preserved. No overflow hiding/clipping, business-logic changes, or settings
changes were introduced. Desktop rules at 1024px and above remain unchanged.

Local and production checks passed at: 320, 360, 375, 390, 414, 430, 455, 600,
768, 780, 781, 782, 800, 820, 834, 900, 1023, 1024, 1280, 1440, 1710px.
At every width, document scrollWidth equaled clientWidth; cards had no internal
horizontal overflow, and checked titles/images/prices/controls/options remained
inside their cards. The existing horizontal category carousel is intentional.

Local browser comparison removing only the overflow fix confirmed identical
product-grid relative geometry at 1024, 1280, 1440 and 1710px. Phone tests also
passed category centering/edge exceptions, horizontal scrolling when necessary,
search placeholder, 400px hero minimum height, stock-warning placement and local
cart add/remove. No order was submitted. Mobile coverage is Chromium emulation,
not a physical iPhone/Safari certification.

## Release evidence

- [Main L1 CI](https://github.com/chenghanchen/tings-snack-house/actions/runs/35317935023): PASS; 11 frontend tests, asset/syntax checks, security scan. L3-only jobs were not required.
- [Production verification](https://github.com/chenghanchen/tings-snack-house/actions/runs/35318038856): all required L1 gates PASS; the exact generated report and appended history were downloaded and verified before archival.
- [GitHub Pages build](https://github.com/chenghanchen/tings-snack-house/actions/runs/35317933963): successful; configuration unchanged.
- Cloudflare Management API confirmed canonical production deployment `3a2d14d4-818c-4b05-9782-d82593902d73`, clean main, successful deployment, exact application SHA.
- Production Desktop 1710x1180 and Mobile 390x844 smoke tests passed: products, local cart, checkout entry, pickup/delivery controls and layout. Write requests were blocked; no real orders or test emails.
- Production `index.html`, `mobile-header.js`, `styles.css` each matched the committed source SHA-256 (CRLF normalized); the report's standard production asset check also passed.
- Downloaded artifact SHA-256: `a5156eecdec6e2fc5af078072d525bf0cefdf2a2d83c04de1cbc795787fd37cd`.

Detailed screenshots and JSON evidence are retained in the workflow artifact and
local ignored `.build/l1-responsive/` and
`.build/releases/1b0ac4a0ec73c5def8a60049fa7c325f45a86afc/production-responsive/`.
Database, Supabase baseline and Edge Functions Production MATCH are
**NOT_REQUIRED**, not PASS. No database, Supabase Auth, Edge Functions or GitHub
Pages configuration was modified.

The separate `[CF-Pages-Skip] docs(release):` archive commit preserves this
application release receipt; it is not a new application deployment.
