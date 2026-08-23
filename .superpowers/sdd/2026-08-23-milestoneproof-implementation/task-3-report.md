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

## Fix Round 1

### Implementation

- Replaced product-name replay constants with the live `gl.message.chain_id` and `gl.message.contract_address` values in both canonical digest and action-key payloads.
- Captures submission time once before validation; it bounds `observed_at`, drives deadline validation/storage, and is length-prefixed into both replay payloads.
- Removed the GitHub/Vercel provider allowlist. GitLab, Codeberg, and custom public HTTPS domains are accepted; literal private/reserved hosts and known DNS-to-private-IP alias suffixes remain rejected until Task 4's final-target fetch revalidation.
- Normalizes repository/CI 40-hex commit references to lowercase before tuple uniqueness, storage, and hashing.
- Extended the GenLayer test runtime with typed chain ID and contract address transaction context, and expanded failure snapshots to include nonce/action-key maps.

### RED / GREEN

- RED: `pnpm test:contract -- tests/test_evidence.py -q` — 6 expected failures for public hosts, actual chain/contract domains, submission timestamp binding, future observations, and uppercase commit normalization.
- RED: `pnpm test:contract -- -k unsafe_evidence_url -q` — 5 expected failures for known private-DNS aliases after provider allowlist removal.
- GREEN focused: `pnpm test:contract -- tests/test_evidence.py -q` — 81 passed.
- GREEN full: `pnpm test:contract` — 81 passed.
- `git diff --check` — clean.

### Self-review

- `test_canonical_digest_uses_actual_chain_and_contract_domains` varies chain and deployed address independently; builder, milestone, revision, timestamp, future-observation, map-immutability, and uppercase-normalization cases are covered by named behavior tests.
- Independent review found the DNS-alias regression created by removing the provider allowlist. The five aliases are restored as shared invalid vectors and rejected by a targeted suffix guard without blocking normal custom domains.

### Concerns

- Task 4 must revalidate the resolved final fetch target, including redirects, before rendering arbitrary public DNS evidence. Task 3 rejects literal/private/reserved and known alias forms only.

## Fix Round 2

### Implementation and self-review

- `MilestoneProof._reserved_host` now applies exact-or-subdomain matching to every reserved and private-alias provider, including `localtest.me`, `nip.io`, `sslip.io`, `xip.io`, and `traefik.me`.
- Added `https://localtest.me/evidence` to the shared invalid vectors; `test_unsafe_evidence_url_reverts_without_mutation` proves the revert and unchanged state/maps through the shared vector table.
- Reviewed adjacent checks: the same exact-or-subdomain predicate now covers every provider in the helper rather than mixing equality and dotted suffix tests.

### RED / GREEN

- RED: `pnpm test:contract -- -k unsafe_evidence_url -q` — 1 expected failure (`https://localtest.me/evidence` accepted).
- GREEN targeted: `pnpm test:contract -- -k unsafe_evidence_url -q` — 29 passed.
- GREEN focused: `pnpm test:contract -- tests/test_evidence.py -q` — 82 passed.
- GREEN full: `pnpm test:contract` — 82 passed.
- `git diff --check` — clean.

Files: `packages/contracts/milestoneproof.py`, `packages/shared/evidence-vectors.json`, and this report.
