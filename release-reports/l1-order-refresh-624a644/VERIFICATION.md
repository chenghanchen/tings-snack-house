# L1 order refresh release verification

- Application commit: `624a644f0502086df1012f21f04f111f80ac5f98`.
- Trusted base: `8347e5f30b3b7bd412a59cf00058f792905c0821`.
- Classification: L1; all five changed files L1; all four managed resource versions PASS.
- Only newly edited source during this release: restore the account UI regression's previously approved 16px referral-code font, 80px delivery label (desktop/mobile), and 330px desktop address expectations. Pending application UI contents were not further edited. Classifier, workflows, dependencies, security gates and backend files were unchanged.
- Local frontend tests: 11/11 PASS; 45 resource references and 23 frontend scripts checked.
- Full offline account browser suite: PASS, including owner isolation, session races, cancellation, XSS, reorder/cart preservation and checkout presentation.
- Focused offline refresh suite: PASS for one request per click, rapid-click lock, busy animation start/stop, error/retry, removed timestamp, session reset, reduced motion, search/filter/back and no page errors.
- Responsive widths: 320, 360, 375, 390, 414, 768, 780, 781, 782, 1100, 1710 px; no header overlap or account-dialog horizontal overflow.
- Secret scan: PASS (171 source/config files; ignored files and Git history excluded).
- [Main CI](https://github.com/chenghanchen/tings-snack-house/actions/runs/35421232406): PASS.
- [Production verification](https://github.com/chenghanchen/tings-snack-house/actions/runs/35421298195): PASS; generated report and appended history downloaded without altering gate results.
- Cloudflare production deployment: `b926758b-eaa6-4293-8643-a9eca9aa18c0`, successful main deployment at the exact application commit.
- Production Desktop 1710x1180 and Mobile 390x844 smoke: PASS. Mobile is Chromium emulation, not physical iPhone/Safari validation. No order submitted.
- Additional read-only production verification: HTML and its actual versioned account CSS/JS URLs match the committed normalized SHA-256 values. CSS: `274f6c6adbd701ddf42b250af1fb99f6f7d77b438a2fceb0979981621a8f2deb`; JS: `940c11a79a01bd0979d68fa855a18d5da5b2bfb9feb277f3da9d1c9f6b802093`.
- Refresh interaction scenarios use an offline SDK fixture; they are not claimed as authenticated production-account tests. Production smoke and source matching provide separate live evidence.
- Database, Supabase, guest checkout, frozen version, Edge bundler, production approval and frozen Production MATCH: NOT_REQUIRED by the unchanged L1 policy, not fabricated PASS. No database/Auth/configuration changes, Edge deployment, media deletion or production order writes performed.
- Production artifact: `10576718808`; ZIP SHA-256 `f532fd52a42cd3bab33ac6cee53368ff2fd8282bdde7730164cf355f0683dde1` verified before extraction.

The report signs the application commit above. This documentation-only archive is not a new application release and uses the existing Cloudflare skip marker.
