# Phase 2.5 final candidate: isolated trusted launcher, anchor NOT selected

CI_CONTROL_CHANGE=true. Human diff review is mandatory for this change.
Only the non-required shadow workflow and its npm entries use the new launcher.
Ruleset and required release-gate remain unchanged. Previous Linux results are
NOT evidence for this new commit. No actual anchor SHA is configured yet.

## Small proposed chain

Event base/head + actual checkout → exact Git blobs → separate selector processes
→ trusted requirements UNION candidate requirements → independent verdict.

`ci-trusted-launcher.mjs select|gate` is the human-reviewed invocation boundary.
It reads the four-module closure from the event's exact base commit; if any module
is absent, it requires BOOTSTRAP_TRUST_ANCHOR_SHA, an explicit full commit SHA.
The anchor must be locally available after an explicit fetch by the reviewed
workflow. No branch/tag/latest/head lookup chooses its identity. An invalid or
nonregular present module, unsupported complete implementation, invalid SHA,
unreadable object or incomplete anchor fails, never tries a different source.

Every module is read from the SAME selected SHA via Git objects and copied into
one fresh OS temporary directory. Relative imports stay within that four-file
closure; remaining imports are Node builtins. No npm or candidate package scripts
are executed by this launcher. The temporary directory is removed in finally.
There is no per-file SHA override or artifact executable input.

`ci-requirements.mjs` reads the trusted selector from that selected revision and
the candidate selector from the explicit PR head commit, not worktree files.
Both selectors inspect the same checkout diff. The binding contains base SHA,
head SHA, checkout SHA, run id and attempt. A merge checkout must have exactly
the event-bound base/head parents. No dynamic main lookup or historical evidence.

Missing base implementation without an explicit usable anchor is full/invalid.
Missing/deleted candidate, malformed output, exceptions, incomplete diff or wrong
SHA also require full and prevent a successful verdict. Invalid inputs never mean
base-only. Workflow/selector/gate/runner/cache/dependency/config changes force full
independently of both selectors' returned requirements. `CI_CONTROL_CHANGE` is
explicitly included in the calculation and must be shown in the future PR review.

The real CLI and tests both use runTrusted → isolated verifyRequirements, which
recomputes that calculation and substitutes the resulting
requirements before checking current-attempt job evidence. It ignores candidate
selection claims. Direct invocation of ci-shadow-gate.mjs refuses to execute;
there is no remaining candidate-only verdict CLI. A complete trusted base takes
precedence over the configured bootstrap SHA.

## Attack demonstration and accepted boundary

Launcher attack tests replace or delete candidate gate/helper files, forge selector
output and supply candidate same-name API helpers. The actual launcher rejects
required database skipped using the isolated trusted verdict. A child process
exercises the real CLI with mocked GitHub API evidence and the same implementation.
Candidate code execution is not an OS security sandbox. Workflow/routing/launcher
changes still require human review. CI summaries explicitly mark CI_CONTROL_CHANGE
and HUMAN DIFF REVIEW REQUIRED; this is not automatic workflow trust.

## Files the future reviewed anchor must contain

- scripts/ci-select.mjs — selector and selection schema validation.
- scripts/ci-requirements.mjs — revision binding, union and control-path floor.
- scripts/ci-shadow-gate.mjs — final requirements/job verdict.
- scripts/release-ci-gate.mjs — existing generic context and current-attempt API
  utilities imported by the gate, not its legacy level-based verdict.

The launcher loads ALL transitive imports from that same reviewed Git tree.
The selector is intentionally standalone; unknown relative imports fail closed.
No imports of release-level, Override or Report are introduced. The generic API
helper remains an old-file dependency to extract before that file can be retired.

## Activation and remote retention remain pending explicit approval

The shadow workflow intentionally leaves BOOTSTRAP_TRUST_ANCHOR_SHA empty, so a
base missing the new implementation FAILS until approval supplies the exact SHA.
PR events only are supported; non-PR/manual invocation fails closed rather than
guessing a base/head identity. No trust anchor is silently selected by this commit.
After approval: push the commit, retain an explicit remote branch/tag/ref, fetch
that retained object, verify its full commit SHA against the approved constant,
and configure the reviewed launcher invocation. The ref preserves reachability;
its movable name must never choose identity. A hard-coded SHA alone does not stop
unreachable-object garbage collection. No tag/ref is created by this candidate.

Local trust tests can PASS; remote availability/activation/Linux acceptance remain
separate from code approvability and are not claimed by this candidate.
Do not delete legacy modules, merge, deploy or begin Phase 3.
