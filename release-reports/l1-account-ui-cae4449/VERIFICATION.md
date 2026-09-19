# L1 account UI release verification

- Application commit: `cae4449bb65e26250ffa75dfbd247b02afd04e39`.
- Trusted base: `f7db79b60367fb7349d94405807b7ac3ba173ed2`.
- Exact scope: `customer-account.css`, `customer-account.js`, `index.html`, `scripts/check-customer-account.cjs`. No release tooling, backend or production configuration changes.
- Trusted override `account-details-back-ui-20260919`: APPLIED after validating the exact approved before/after hashes, full diff and file set against the trusted base. Valid through `2026-09-26T05:10:12Z`. Classification L1; no hard L3 change; Cache Version Guard PASS.
- Release diff fingerprint: `9ca24fd126b8b8cfe948ddb3b10d91b1115ea71cbab1f3da1b027b0a0e12a3d7`. Original per-file levels and override evidence remain in the unmodified generated JSON report.
- Local frontend checks: 11/11 PASS, 45 resource references and 23 frontend scripts. Security scan PASS (178 files; not a full security audit).
- Complete offline account UI regression PASS, including signed-in views, navigation, refresh, search/filter, order/session behavior, and unchanged error feedback. Responsive checks include 320/360/375/390/414/768/780/781/782/1100/1710px plus the 1723px details annotation.
- [Main CI](https://github.com/chenghanchen/tings-snack-house/actions/runs/35424544536): SUCCESS.
- [GitHub Pages build](https://github.com/chenghanchen/tings-snack-house/actions/runs/35424543913): SUCCESS; configuration unchanged.
- [Read-only production verification](https://github.com/chenghanchen/tings-snack-house/actions/runs/35424596159): SUCCESS. Generated report and history downloaded without altering gate results.
- Cloudflare production deployment `fb0cb98f-58c7-457b-bd40-912715e6ec86`: successful main deployment; full production commit MATCH with the application SHA above.
- Automated production Desktop 1710x1180 and Mobile 390x844 smoke PASS (products/cart/checkout/pickup/delivery/layout); no order submitted. Mobile uses Chromium emulation, not a physical iPhone/Safari.

## Additional authenticated production account checks

Performed in the existing signed-in production browser at `https://tings-snack-house.pages.dev/#snacks`, using normal refresh without clearing cache, replacing the session or using an incognito window. No customer field values or screenshots containing private account data are archived here.

- Desktop 1710x1180 and Mobile 390x844: account home, orders, delivery details, coupons and referral rewards each displayed a 50x40px back button with 15px font and 0px padding; no document or account-dialog horizontal overflow.
- Each child view's back action returned to account home. Account home's back action closed the dialog and returned to the store.
- Delivery details: removed explanatory paragraph absent; during the existing read-only load, progress feedback remained; after completion, status text was empty and its computed display was `none` on both viewports. Save behavior was not invoked.
- Orders loaded and refresh became enabled. Existing read-only page navigation remained functional. Rapid-click/refresh request-count, animation and error-path assertions are offline regression evidence, not production request-count measurements.
- Mobile details were visually inspected. No captured browser console errors. Temporary viewport override reset after verification.
- No saves, order cancellations, coupon claims, sign-outs, OTP sends, database writes or Edge deployments performed during this smoke test.

## Production resource matching and evidence

The live HTML's actual versioned URLs and fetched resource bodies match the committed normalized SHA-256 values:

- `customer-account.css`: `61514b2ba829db278d3f54dd7d3149de2832b461227a1fa9acb550958727e019`.
- `customer-account.js`: `d9bf368da56ecb72d6ad4fbf5d5a80543ceb48f40d4a96a931de955e17b542c6`.
- Browser DOM after normal refresh references those exact `?v=` versions. CI separately verifies production HTML/JS/CSS against the application commit.
- Database, Supabase baseline, Edge bundler, frozen version, production approval and Edge/frozen Production MATCH: NOT_REQUIRED under the trusted L1 classification, not fabricated PASS. Cloudflare commit MATCH remains required and passed.
- Production artifact ID `10578987878`; downloaded ZIP SHA-256 `209dc8748d4f404a7add12cb8a2ed7454a03b0561c4d76fedcfa9b900e247722` verified before extraction.
- Unmodified report JSON SHA-256 `8028c5407e300d3739bee28dbf02dd68769151149a51223a4944b747c51d17ff`; Markdown SHA-256 `4c7a0feae9acc60be0eac3dafd7b3a75b0982434f56c2067007f204a4eee9035` (artifact bytes).

This documentation-only archive references the tested application commit and uses the existing Cloudflare skip marker. It does not constitute another application release.
