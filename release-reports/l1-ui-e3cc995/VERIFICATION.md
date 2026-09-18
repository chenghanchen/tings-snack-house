# L1 success-dialog release evidence

- Application: `e3cc9956cdf256da9d0611b205a90dab136983ee`
- Trusted base: `6364c238378035b61623c8947e31a16e2e9ff41d`
- Scope: only `styles.css`, `scripts/check-success-hero.cjs`, `scripts/check-success-dialog.cjs`.
- CI: https://github.com/chenghanchen/tings-snack-house/actions/runs/35307111393
- Production verification: https://github.com/chenghanchen/tings-snack-house/actions/runs/35307196784
- Original artifact: `production-verification-e3cc9956cdf256da9d0611b205a90dab136983ee`, ID `10531024817`.
- Artifact SHA-256: `6a74d7cb76ab39ddbb6609c7d29b4a41f272fbdb4c7664d70ddd53ca14760d78`; downloaded ZIP matched before extraction.
- Archived JSON and Markdown are unchanged workflow outputs; history equals the workflow history (Git LF normalized). Classification was independently recomputed from the complete local Git range and matched.

## UI-specific checks beyond the standard smoke test

Local frontend tests: 11 passed; resource/syntax checks and source secret scan passed. Offline success-hero regression passed at 320/375/390/780/781/1710 px. Success-dialog regression passed at 320/375/390/430/780/781/1710 px, including 50px close-button hit area, three click positions, text wrapping and referral overlay stacking.

After deployment, production asset fingerprints matched the application commit. An isolated Edge/Chromium display-only fixture exercised the production success dialog and its actual close handler at 320/390/780/781/1710 px, three close clicks each. All passed, with no script errors or blocked write attempts. Success text was synthetic display data, not an order response; no order was submitted. Phone checks are browser emulation, not a physical-device claim.

The first supplemental fixture attempt reopened the dialog before its asynchronous close/reset event completed, causing a fixture-only timeout. The ignored local harness was corrected to await the real close event; all five sizes then passed. No application source was changed to resolve this harness race. Supplemental JSON/screenshots remain in `.build/l1-success-production-e3cc9956cdf256da9d0611b205a90dab136983ee/`; the workflow artifact contains the formal desktop/mobile smoke evidence and report.

Database, Supabase baseline, Edge bundling, production approval and frozen Production MATCH were NOT_REQUIRED under the trusted L1 policy, not asserted PASS. No database, Supabase Auth, Edge Functions or GitHub Pages configuration was changed.

This archive is a separate documentation commit with `[CF-Pages-Skip]`; it does not change the verified application tree or redefine the application version.
