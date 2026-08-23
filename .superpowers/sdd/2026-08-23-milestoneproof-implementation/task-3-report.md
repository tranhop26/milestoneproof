# Task 3 — Evidence Validation, Submission, and Replay Protection

## Implementation

- Added bounded `Submission` storage plus `submit_evidence` and the Task 3 placeholder `resubmit_evidence` (explicitly unavailable until the later rejected-verdict transition work).
- Validates builder ownership, active/open state, deadline, source policy, up-to-four evidence items, five-field evidence shape, full lowercase 40-hex repository/CI commits, non-stale observations, and length-prefix-safe unique evidence tuples.
- Stores an immutable evidence copy and SHA-256 `u256` digest. Canonical fields are length-prefixed and include chain/contract domains, project, milestone, revision, builder, evidence count, and every evidence field.
- Adds builder nonce and canonical action replay keys before any mutation; valid writes create one submission and move `OPEN -> SUBMITTED`.
- Added shared vectors and real behavior tests for valid GitHub/Vercel URLs; credentials (including empty), HTTP, fragments, backslashes, control characters, private/reserved literals, noncanonical numeric hosts, private-DNS aliases, malformed/unknown DNS names, and non-default ports.
- DNS evidence hosts are deliberately restricted to GitHub and Vercel suffixes. This is the fail-closed defense available without a rebinding-safe contract DNS/fetch primitive.

Files changed: `packages/contracts/milestoneproof.py`, `packages/contracts/tests/conftest.py`, `packages/contracts/tests/test_evidence.py`, `packages/shared/evidence-vectors.json`.

## TDD evidence

- RED: `pnpm test:contract -- tests/test_evidence.py -vv` — 37 failures from absent submission state/methods (the brief's path with `packages/contracts/` is invalid from the contracts package root).
- RED/GREEN: delimiter-collision uniqueness test; URL cases for single-label hosts, DNS aliases to loopback, control characters, and empty userinfo each failed before their narrow fixes and passed afterward.
- GREEN focused: `pnpm test:contract -- tests/test_evidence.py -q` — 70 passed.
- GREEN full: `pnpm test:contract` — 70 passed.
- `git diff --check` — clean.

## Self-review

- Read-only review found DNS aliases and empty credentials bypassing the first URL validator. Both are covered by shared vectors and fixed; the final all-contract run is above.
- Failure tests assert milestone state, submission count/current ID, and submission-map size are unchanged.

## Concerns

- Supporting arbitrary third-party evidence hosts safely requires a rebinding-safe resolve-and-fetch primitive. This task intentionally accepts only trusted GitHub/Vercel host suffixes rather than risk resolving a syntactically public hostname to a private address.
