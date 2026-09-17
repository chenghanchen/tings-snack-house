# Release evidence supplement

- Application SHA: `bc6f03dec64e898da40fa252d2e5e82db71ef45b`.
- Final automated result: **INCOMPLETE**. The missing reviewed `release-supabase-baseline.json` prevents Supabase provenance approval. Do not treat this as RELEASE SUCCESS.
- [Production verification run](https://github.com/chenghanchen/tings-snack-house/actions/runs/35203663839): management API, desktop/mobile, guest rejection-path and resource-hash checks. `report.json`, `report.md` and the appended root history were copied without alteration from its artifact and verified by read-back (line endings normalized).
- [Full evidence artifact](https://github.com/chenghanchen/tings-snack-house/actions/runs/35203663839/artifacts/10488738267): contains screenshots and logs referenced by the report. ZIP SHA-256: `9e199f650ecbbffb7c30fac42248ebdb08eb294735d1fc8dfd7a6f8747c6d638`. Artifact retention is 30 days; a verified local copy was also retained.
- [Release Checks run](https://github.com/chenghanchen/tings-snack-house/actions/runs/35203445091): all three jobs succeeded for the exact application SHA: test, edge-bundler and media-concurrency.
- [Docker lockfile proof](https://github.com/chenghanchen/tings-snack-house/actions/runs/35203445091/job/105143425700): both functions passed normal, tampered-lock rejection and restored-control bundling (six checks); no functions deployed.

## Change-specific production layout check

`node scripts/check-success-hero.cjs --production` passed against the deployed storefront. The test loads real production resources and displays the existing success markup locally in an isolated browser, without submitting an order or fabricating a backend response. This is success-layout coverage, not real order creation coverage. All mutation requests are blocked except the existing allowlist of read-only storefront RPCs.

| Viewport width | Hero width | Left / right margins | Result |
| --- | --- | --- | --- |
| 320px | 246px | 0 / 0px | PASS |
| 375px | 301px | 0 / 0px | PASS |
| 390px | 316px | 0 / 0px | PASS |
| 780px | 350px | 12 / 12px | PASS |
| 781px | 350px | 49 / 49px | PASS |
| 1710px | 350px | 49 / 49px | PASS |

## Backend boundary

`git diff 6b4b7b9 HEAD --name-only -- supabase '*.sql'` was empty at the application SHA. No backend deployment or database migration was performed for this CSS release. Management API observations remain submit-order v6 and admin-media-cleanup v4, both ACTIVE with JWT enabled. Existing P1/P2 closure is not reopened; this release's automated baseline prerequisite remains explicitly unresolved.

The follow-up archive commit uses `[CF-Pages-Skip]` and changes documentation only; it is not a new application release.
