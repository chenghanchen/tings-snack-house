# L1 managed-resource cache repair — 0935bdb

Result: **RELEASE SUCCESS**. Application version: `0935bdb9ede47506cbbf5d8ecc26e5d1c87690ce`.

## Scope and authoritative evidence

- The complete application diff from synchronized main `9767d121aeaeaa9d61b9a9482aeda8fefe8522e6` changes only two resource version references in `index.html`. The CSS and JavaScript contents are unchanged. That base includes the separately reviewed cache-guard infrastructure; the intervening changes from the previous frontend application `1b0ac4a` are release documentation/infrastructure, not additional application changes.
- Trusted classification: **L1**; Cache Version Guard: **PASS**. Full diff fingerprint: `a4420b90c8e97899607d65bca66487a308f3d1a293a7af403a7139157a52b6a8`.
- [Main Release checks](https://github.com/chenghanchen/tings-snack-house/actions/runs/35322821904): success. Frontend checks cover 11 tests, 45 local references and 23 scripts; security scan passes.
- [Production verification](https://github.com/chenghanchen/tings-snack-house/actions/runs/35323151496): success; attached `report.json` and `report.md` are unmodified tool-generated results. Artifact ID `10538175133`; downloaded ZIP SHA-256 `03cb41c066d17cbd03975e434e27c263dc41a81f12b9115976564308c518a919`.
- Cloudflare canonical production deployment `e7909b34-ab17-45cb-b145-dd496311d9bd` is successful and its full commit matches the application version. The separate report archival commit is not an application deployment.
- Existing [GitHub Pages build](https://github.com/chenghanchen/tings-snack-house/actions/runs/35322820760) succeeded; configuration was not changed.

## Cache strategy and exact production resource MATCH

Versions are the full lowercase SHA-256 of each managed resource with CRLF normalized to LF, as enforced by the already-reviewed guard. They are not hand-maintained dates. All tracked HTML consumers are checked by the guard; this release does not expand its managed scope.

| Resource | Previous cache key | New version / production content SHA-256 |
| --- | --- | --- |
| `styles.css` | `20260916e` | `560f5cd7c6989270183deeef945e9e8d37f77484e329da1504213c642ccb1a8b` |
| `mobile-header.js` | `20260915a` | `902f8028e24f807bc808063aa320158619aa2ace602e40a8577427a9cd1b976a` |

Both exact versioned production URLs were fetched read-only after deployment and their normalized body fingerprints matched these values. The standard production gate additionally verifies its listed HTML/JS/CSS assets.

## Retained-cache verification

**Persistent-browser experiment — PASS, 390px and 1710px:** a local HTTP fixture seeded actual older resources from `d0efe8d4ac43d17ce4c104388df96a0b05b2bbfa` under the old URLs, with long-lived immutable cache headers. An ordinary revisit proved cache reuse: resource transfer sizes were zero, decoded bodies were nonempty, and server request counts remained one per old resource. In the same persistent profile, switching the served HTML and using ordinary reload requested each new hashed URL once. A further ordinary revisit reused those new resources. No cache clearing, hard refresh, incognito context or request routing was used. Mobile cards changed from the old two-column block layout to the new one-column grid-card layout and the search placeholder updated; desktop geometry stayed unchanged. This is an offline cache-mechanism experiment, not a substitute for the production checks.

**Original production browser tab — PASS:** before deployment the existing user tab visibly retained two-column mobile cards, wrapping category buttons and the old search hint. After successful deployment, one ordinary reload of that same tab displayed the new horizontal one-column cards, single-row categories and `搜索你喜欢的零食…`. Screenshots before and after are recorded in the task. No cache was cleared and no replacement/incognito session was used for this check.

The guarantee is conditional on receiving the new HTML, as requested; this release does not introduce service workers or modify HTML caching headers.

## Responsive and production smoke results

Local and production checks both passed at widths **320, 360, 375, 390, 414, 430, 455, 600, 768, 780, 781, 782, 800, 820, 834, 900, 1023, 1024, 1280, 1440, 1710px**. In each case `scrollWidth == clientWidth`; no horizontal page overflow was hidden to satisfy testing. Category scrolling, search presentation and mobile hero assertions passed.

The workflow independently passed Desktop 1710×1180 and Mobile 390×844 smoke tests for products, local cart, checkout entry, pickup/delivery controls and layout. No order was submitted. Browser emulation is not a claim of physical iPhone/Safari certification.

Local evidence retained outside Git:

| Evidence | SHA-256 |
| --- | --- |
| `.build/cache-l1-proof/cache-proof.json` | `770c1dcf24c61668bbffcb38cd8a382c9b4dd0b837ffa34c02f19f559a6aa691` |
| `.build/cache-l1-local-responsive/responsive.json` | `f4bce9a22beffd34292a2365518c0081fcf6346ede4d91e29c00cd99d8257e0c` |
| `.build/cache-l1-production-responsive/responsive.json` | `6f0c76b761cd8f0acc63f725422ba214a68fcef1cfaf1a6fd018f48e096c9249` |

## Boundaries

Database, Supabase baseline, frozen Edge version/dependency/production MATCH, production approval and guest-write-path gates are **NOT_REQUIRED**, not PASS, under this trusted L1 classification. No database, Supabase Auth, Edge Functions, business logic, Release Levels or platform configuration was modified. No production orders, emails or media deletions were performed. Success is limited to the explicitly verified frontend release scope.
