# Offline browser release baseline

`node scripts/check-browser-baseline.cjs` is mandatory from `release-check.mjs` for L1/L2 (same baseline), and also L3. It is not production verification. No path-based selection, retries, missing-browser fallback, or skipped mandatory suites. Install the lockfile's Playwright Chromium with `npx --no-install playwright install --with-deps chromium` on Linux. No system browser/channel is used.

The orchestrator launches one Chromium process; scenarios have isolated contexts and separate modules. Failure/zero/missing/duplicate suite evidence causes nonzero exit. `test` retains its existing Release Report wrapper and 240-second child deadline; `release-gate`, classification, Override and required gates are unchanged.

| Module | Completed scenario unit | Required executions |
| --- | --- | --- |
| network-policy | real browser allow/deny probe | 6 |
| storefront | one viewport's header/catalog/category geometry and interaction | 9 |
| account | complete pre-existing account/checkout/wallet/order workflow in a device context | 2 |
| order-refresh | complete anti-reentrancy/loading/animation/retry/stale-response workflow | 2 |
| success-dialog | one viewport x short/long address x delivery/pickup; plus close/overlay checks per viewport | 36 |
| marketing | complete pre-existing offline authoring workflow | 2 |
| cache | old cache -> ordinary reload -> ordinary revisit | 2 |

Counts are scenario executions, NOT individual assertion counts. Every group emits `BROWSER_RESULT`; `.build/browser-baseline/results.json` records elapsed milliseconds and retries=0. CI uploads it alongside the existing report. Missing modules/launch errors still fail even when no scenario starts.

## Coverage-preserving consolidation

- Required geometry matrix: 320, 390, 768, 780, 781, 782, 1023, 1024, 1710. Mobile <=780 uses actual Chromium mobile/touch contexts; desktop uses non-mobile contexts. This is not an iOS/WebKit certification.
- Account's 22 legacy layout loops keep their literal previous widths and all assertions. `matrixFor` adds requested boundaries inside each scene's applicable range, then partitions work between mobile and desktop contexts. The unit regression proves the union contains every old width exactly once. Functional workflows run twice; the legacy scenario bodies are retained, not rewritten as a new giant suite.
- Hero and address entrypoints are removed; `check-success-dialog.cjs` delegates to the combined module. It loads real HTML/CSS in production order, keeps hero containment/centering, close-target 9-point coverage/3 clicks, overlay stacking and approved 300px/16px contracts. Long delivery/pickup addresses now target the current `submittedFulfillmentNote` row. Removed obsolete selectors/110.53px and 295–301px dimensions referred to a removed address row. Layout assertions use viewport containment, wrapping, no overlap/clipping.
- Order refresh keeps its standalone workflow: rapid clicks -> one call; disabled/aria-busy/spin; reduced motion; completion; failure/retry; search/filter/back; logout invalidates old pending response. Animation assertions poll real transforms instead of sleeping 90ms.
- Full account integration still exercises refresh in its surrounding account state. Do not remove these state-transition checks merely because the focused suite also refreshes.
- Historical `.build` experiments are NOT CI inputs. Cache uses current managed references, canonical LF hashes (same convention as Cache Version Guard), a deterministic synthetic older resource version, and an actual local HTTP forward proxy. No historical commit or uncommitted diff is required.

## Isolation and timing

Fixtures fulfill only explicitly registered local origins/files and the exact mock SDK URL. Unknown requests fail instead of returning empty 200. WebSockets, workers, WebTransport and WebRTC are denied. Contexts block service workers. Browser errors and unexpected console errors fail. No production credentials or network data are needed; simulated writes are frontend fixtures, not backend authorization evidence.

Cache context intentionally has NO request routing (Playwright routing disables HTTP cache). Its explicit local proxy serves only the registered fixture host; unknown destinations, CONNECT/upgrade and paths fail. Versioned CSS/JS must be fetched once, reused before upgrade, then requested using current URLs after ordinary reload, and reused again. No cache clearing/cache-disable API or hard refresh is used.

There are zero flaky retries and no arbitrary readiness sleeps. The inherited gesture tests intentionally hold a mouse press for 650ms and touch for 550ms to test the real long-press threshold; these are input durations, not readiness workarounds. All other readiness uses state/geometry/animation polling. The existing 240-second report subprocess timeout is not increased.

This infrastructure PR must use `[CF-Pages-Skip]`, remain unmerged pending review, and leave application assets, production/configuration, Ruleset and safety tools untouched.
