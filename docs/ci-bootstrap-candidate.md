# Phase 2.5 step 1: candidate only, no trust anchor selected

CI_CONTROL_CHANGE=true. Human diff review is mandatory for this change.
No workflow, Ruleset or required check is replaced in this step. The existing
shadow launcher still uses its old candidate-only path; Linux results on the
previous PR head are NOT evidence that this new trust chain is installed.

## Small proposed chain

Event base/head + actual checkout → exact Git blobs → separate selector processes
→ trusted requirements UNION candidate requirements → independent verdict.

`ci-requirements.mjs` reads the base selector from the explicit base commit and
the candidate selector from the explicit PR head commit, not worktree files.
Both selectors inspect the same checkout diff. The binding contains base SHA,
head SHA, checkout SHA, run id and attempt. A merge checkout must have exactly
the event-bound base/head parents. No dynamic main lookup or historical evidence.

Missing base is currently full high-risk AND invalid (anchor not chosen).
Missing/deleted candidate, malformed output, exceptions, incomplete diff or wrong
SHA also require full and prevent a successful verdict. Invalid inputs never mean
base-only. Workflow/selector/gate/runner/cache/dependency/config changes force full
independently of both selectors' returned requirements. `CI_CONTROL_CHANGE` is
explicitly included in the calculation and must be shown in the future PR review.

`verifyRequirements` recomputes that calculation and substitutes the resulting
requirements before checking current-attempt job evidence. It ignores candidate
selection claims. It must be loaded from the reviewed revision in step 2; calling
the candidate's copy does NOT turn it into a trusted final verdict.

## Attack demonstration and accepted boundary

The gate attack test executes a candidate gate that prints PASS and exits 0.
That attack DOES succeed against the candidate gate. The separately loaded test
verdict rejects the same job evidence when database is required but skipped.
The passing regression means the boundary is demonstrated, not that GitHub's
candidate workflow has become tamper-proof. Candidate code execution is not an
OS security sandbox. Workflow/routing/launcher changes still require human review.

## Files the future reviewed anchor must contain

- scripts/ci-select.mjs — selector and selection schema validation.
- scripts/ci-requirements.mjs — revision binding, union and control-path floor.
- scripts/ci-shadow-gate.mjs — final requirements/job verdict.
- scripts/release-ci-gate.mjs — existing generic context and current-attempt API
  utilities imported by the gate, not its legacy level-based verdict.

ALL transitive imports must come from the same reviewed Git tree. Extracting only
the gate and resolving its imports against candidate files would defeat the anchor.
The selector is intentionally standalone; unknown relative imports fail closed.
No imports of release-level, Override or Report are introduced. The generic API
helper remains an old-file dependency to extract before that file can be retired.

## Step 2 remains pending explicit approval

No anchor SHA has been selected, no bootstrap fallback has been wired and no
trusted launcher has been installed. After review, the user must explicitly name
the immutable anchor SHA. A future launcher loads the implementation from the
event base Git tree, falling back ONLY when the implementation is absent to that
exact approved anchor. Corrupt/invalid present policy must not silently fall back.
Union, verdict and imports must all use the trusted source. Candidate selectors
still execute separately and may only add requirements. This launcher itself
remains within the explicitly accepted human-review boundary.

Until then: step-1 tests can PASS; Phase 2.5 trust-chain acceptance remains PENDING.
Do not delete legacy modules, merge, deploy or begin Phase 3.
