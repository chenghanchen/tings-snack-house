# P1 safe-retry frozen regression evidence

Scope: independent hosted test project `tings-snack-house-storage-test` (`lyqgpylekkywiwxjuqgi`), 2026-09-17 UTC / September 16 Chicago. This is not production approval or a Release Report.

The implementation and regression test were frozen after the full hosted regression passed. Base commit before this fix: `ac0b8024d4fff391de558a85d35b0c7b8c0b1b43`; that base SHA is not the patch version. Bind subsequent CI evidence to the commit containing this document.

## Frozen file SHA-256

| File | SHA-256 (LF source bytes) |
|---|---|
| media-deletion-guard-migration.sql | `11c606789374080b086beffbbbdcb579e954c2c7911a60ef7fefcfeebee101ad` |
| media-deletion-retry-migration.sql | `c317ae4041a4a6a9efa9705b34ad126e97f0f548132bf0a60e82a6226657a50a` |
| tests/media-deletion-guard-db.test.mjs | `1d8683572f9097bb60d27393b279ca7dc3249bf56db137abe3ba4c1e8bcb2d8d` |

Hosted RPC body, CRLF normalized to LF: MD5 `a9853bd9437997a8ad43f8d5cb499113`, matched before each competing transaction and after regression. Git blob SHA-256 must be checked against this table after committing, not just against working-tree metadata.

## Fresh hosted concurrency evidence: PASS

Both cases require distinct backend PIDs, a real ungranted advisory lock, and `pg_blocking_pids(waiter)` containing the holder before the holder commits. Timeout or a different error fails assertions; timing alone cannot pass.

- Reference first: holder 44337, waiter 44338. Waiting reservation then returned `[]`, committed reference existed, no fence created. [A SQL](https://supabase.com/dashboard/project/lyqgpylekkywiwxjuqgi/sql/61d37d91-beb6-482e-9569-7c5e8badb2d9), [B SQL](https://supabase.com/dashboard/project/lyqgpylekkywiwxjuqgi/sql/c75e6e23-8f63-4266-be39-800dc461bf30).
- Fence first: holder 44983, waiter 44984. Later reference rejected by the exact expected reference-guard exception; reference absent, fence present. [A SQL](https://supabase.com/dashboard/project/lyqgpylekkywiwxjuqgi/sql/2fc0e145-94c7-49c3-91e9-b050a62ce33f), [B SQL](https://supabase.com/dashboard/project/lyqgpylekkywiwxjuqgi/sql/bc93442d-4543-4e3c-8386-8eb08e522e46).

## Fresh hosted Storage and retry evidence: PASS

Run `p1-check-20260917014435157`, 01:44:35.157–01:44:41.107 UTC:

- Upload/read 200/200, 76 bytes each, matching SHA256 `9c7af84db8dbbaeff1eac1a5c611f70944f8c9e215c384e8650e47ed98024486`.
- Retired-path reupload denied. API masks details as 500/P0001; correlated fresh [Postgres log](https://supabase.com/dashboard/project/lyqgpylekkywiwxjuqgi/logs?id=ffb0f021-6a24-4170-b26a-b25a050dd1a1), 01:44:36.869 UTC, proves `public.reject_retired_storage_write() line 7 at RAISE`, Supabase Storage API, exact expected retirement message. Gateway event `08dd2c02-d085-4dac-9994-54e94477e771` is the same-second POST 500 for the run's `retired.txt`. Generic HTTP 500 alone was not counted as PASS.
- Actual malformed-JSON Storage DELETE returned 400/InvalidRequest. Object remained readable with unchanged hash; reference insertion remained blocked by the exact guard. Normal shared deletion workflow then retried DELETE once successfully, with no skipped paths and no remaining object.
- Completed deletion's real reserve RPC returned `[]`; fence remained.

Synthetic fresh files use test-only `graceMs: 0`; production grace is unchanged. Hosted fault injection covers a rejected Storage request, not every internal Storage failure. Lost-success-acknowledgement and inconsistent-reference branches additionally passed local PGlite regression, not claimed as hosted network faults.

## Cleanup and boundaries

[Final hosted state](https://supabase.com/dashboard/project/lyqgpylekkywiwxjuqgi/sql/469bb86f-1126-4357-8ba1-46f3e24a6731): zero run files, zero regression product rows, zero active regression transactions; 9 enabled guards, RLS retained, bucket private; reserve execute denied to anon/authenticated and allowed to service_role. Three run fences retained as permanent safety/evidence. Pre-existing bucket placeholder retained.

Local targeted regression: 21/21, no skips. No production credentials, changes, migrations or Edge Function deployments were used. Current evidence permits pre-production final review only. Explicit approvals and read-only production preflight are still required before any production migration; CI/commit success is not production RELEASE SUCCESS.
