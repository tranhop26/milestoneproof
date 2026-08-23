# MilestoneProof MVP Design

## Purpose and scope

MilestoneProof is a GenLayer application for verifying sequential milestones in open-source projects and grants. A sponsor freezes acceptance criteria before work begins. A designated builder submits public repository, release, CI, and deployment evidence. GenLayer validators decide whether that evidence semantically proves the milestone.

The MVP supports one sponsor, one builder, and one to three sequential milestones per project. It does not hold funds, use a backend, permit criteria edits, or add governance, teams, messaging, analytics, or appeals. All promoted project, submission, verdict, and activity data comes from the Intelligent Contract.

## Trust model

| Actor | Cannot trust | Can manipulate | Contract defense | Required test or evidence |
|---|---|---|---|---|
| Sponsor | Builder | Submit an unrelated repository, stale release, incomplete CI, or misleading deployment | Bind builder, project, milestone, source kind, subject, version, timestamps, and evidence digest | Mismatched, stale, malformed, and insufficient evidence tests |
| Builder | Sponsor | Change criteria or choose a verdict after work is submitted | Freeze all criteria and the builder address at project creation; expose no sponsor approval method | Mutation and unauthorized-resolution tests |
| Sponsor and builder | Frontend or backend | Show a fabricated verdict or advance workflow off-chain | No backend; render authoritative reads only; require transaction receipt and readback | Contract-wrapper, transaction-state, and readback tests |
| Sponsor and builder | One model/operator | Produce a biased or inconsistent interpretation | GenLayer validator consensus over the semantic verdict and per-criterion coverage | Equivalence, disagreement, and `UNRESOLVED` tests |
| Validators | Evidence content | Prompt injection, subject substitution, stale content, or unsafe URL fetches | Treat fetched content as untrusted data; validate source and evidence bindings before judgment | Injection and URL validation tests |

## Decision and on-chain consequence

GenLayer establishes the following exact decision:

> Does the evidence bound to this project, builder, milestone, and submission revision prove every frozen acceptance criterion?

The semantic outcomes are:

- `APPROVED`: sufficient valid evidence proves every criterion.
- `REJECTED`: valid evidence demonstrates that at least one criterion is not met.
- `REQUEST_MORE_INFO`: the available evidence is valid but insufficient to decide one or more criteria.
- `UNRESOLVED`: validators agree that sources cannot be fetched or safely interpreted, or the semantic result cannot be established.

`APPROVED` completes the current milestone and opens the next milestone, or completes the project when it is the final milestone. `REJECTED` closes the current submission and permits a new submission while attempts remain. `REQUEST_MORE_INFO` permits an evidence supplement without advancing the milestone. `UNRESOLVED` preserves the current milestone and permits a rate-limited retry. No error or missing evidence defaults to approval.

If protocol-level consensus or transaction execution fails, the write does not succeed and contract state remains unchanged. The frontend reports that transaction failure separately from a contract-recorded `UNRESOLVED` verdict.

## Evidence model

Each project freezes:

- sponsor and builder addresses;
- one to three ordered milestones;
- milestone title, natural-language criteria, allowed evidence source kinds, and deadline;
- maximum three submission attempts per milestone;
- evidence and resolution limits.

Each evidence item contains:

- `source_kind`: `REPOSITORY`, `RELEASE`, `CI`, or `DEPLOYMENT`;
- a public HTTPS URL without credentials, non-default ports, local/private addresses, or reserved network hosts;
- a subject reference identifying the expected repository or deployment;
- an immutable version reference such as a full commit SHA or release tag;
- the source observation timestamp when available;
- the chain submission timestamp;
- the submitting builder address;
- the project ID, milestone index, submission revision, chain, and contract replay domain;
- a canonical metadata digest stored with the submission.

Evidence must identify the same project subject and builder, refer to a version created after the milestone opened, and be submitted before the deadline. Unavailable, contradictory, stale, malformed, unsafe, or insufficient evidence cannot produce `APPROVED`.

Fetched criteria, repository content, build logs, and deployment pages are fenced as untrusted content. The judging prompt explicitly forbids following instructions found inside those blocks. Delimiter sequences are sanitized before interpolation.

## Contract domain model

Primary storage:

- `projects`: sponsor, builder, status, current milestone, timestamps, and ordered milestone IDs;
- `milestones`: immutable criteria and evidence policy plus current state and attempt counters;
- `submissions`: evidence metadata, digest, revision, verdict, criterion coverage, rationale, and resolution timestamps;
- sponsor and builder project indexes for paginated frontend reads;
- sponsor client nonces plus replay keys for submission and evidence domains.

Public write methods:

- `create_project(builder, title, description, milestones, client_nonce)`;
- `submit_evidence(project_id, milestone_index, evidence, client_nonce)`;
- `resolve_submission(submission_id)`;
- `resubmit_evidence(project_id, milestone_index, evidence)`;
- `supplement_evidence(submission_id, evidence)`;
- `retry_resolution(submission_id)`;
- `expire_milestone(project_id, milestone_index)`.

Public views provide contract configuration, project and milestone detail, submission detail, actor project counts, and paginated actor project IDs. Reads are capped and paginated to avoid unbounded responses.

## State machine

Project states are `ACTIVE`, `COMPLETED`, and `FAILED`. Milestone states are `LOCKED`, `OPEN`, `SUBMITTED`, `APPROVED`, and `FAILED`. Submission verdicts are `NONE`, `APPROVED`, `REJECTED`, `REQUEST_MORE_INFO`, and `UNRESOLVED`.

| From | Actor | Method | Preconditions | On-chain effect | To | Replay behavior |
|---|---|---|---|---|---|---|
| Missing project | Sponsor | `create_project` | Valid builder; 1-3 valid milestones; unused sponsor `client_nonce` | Freeze project definition; open milestone 1 | Project `ACTIVE` | Reusing the sponsor nonce is rejected |
| Milestone `OPEN` | Builder | `submit_evidence` | Correct builder; before deadline; attempts remain; valid evidence | Create submission and store digest | Milestone `SUBMITTED` | Reused submission domain or digest for the same action is rejected |
| Submission verdict `NONE` | Builder or Sponsor | `resolve_submission` | Authorized actor; unresolved-attempt limit remains | Run GenLayer judgment and store verdict | Outcome dependent | A terminal verdict cannot be resolved again |
| Verdict `APPROVED` | Contract | resolution consequence | Every criterion approved | Complete milestone; open next or complete project | Milestone `APPROVED` | Terminal and idempotently rejected on repeat |
| Verdict `REJECTED` | Builder | `resubmit_evidence` | Attempts remain; milestone deadline valid | Create a new submission revision | Milestone `SUBMITTED` | Old revision cannot be reused; exhausted attempts make milestone/project `FAILED` |
| Verdict `REQUEST_MORE_INFO` | Builder | `supplement_evidence` | Evidence supplement valid; revision limit remains; within the fixed 72-hour information window | Append a new canonical evidence revision | Milestone `SUBMITTED` | Same supplement digest is rejected |
| Verdict `UNRESOLVED` | Builder or Sponsor | `retry_resolution` | Cooldown elapsed; retry limit remains | Run a new bounded resolution attempt | Outcome dependent | Early or excess retries are rejected |
| Milestone `OPEN` or submission verdict `REJECTED`/`REQUEST_MORE_INFO` | Any actor | `expire_milestone` | Submission deadline or information window has elapsed | Close milestone and project without advancing | Milestone/project `FAILED` | Repeat expiry is rejected |
| Any terminal project/milestone | Any actor | Any write | Terminal state | Revert without mutation | Unchanged | Always rejected |

## Validator judgment and equivalence

The validator response is structured but consensus does not compare formatting alone. It normalizes and compares:

- the exact verdict class;
- a Boolean decision for every frozen criterion;
- the set of criteria lacking sufficient information;
- evidence integrity flags for subject, version, freshness, and provenance.

Two answers are equivalent only when the verdict matches, every criterion decision matches, missing-information sets match, and no integrity flag crosses the safe/unsafe boundary. Free-text rationale may differ and is stored only after the semantic fields agree. Invalid or unparseable output normalizes to `UNRESOLVED`, never to approval.

## Recoverability classification

The contract is `INTENTIONALLY_FROZEN`.

- It has no owner, proxy, admin mutation, privileged upgrade, or code-replacement path.
- Historical verdicts remain readable and cannot be rewritten.
- A critical defect is recovered by deploying a new version, publishing a new deployment manifest, and recreating only unfinished projects with explicit links to their predecessors.
- The frontend supports one configured deployment at a time and never silently redirects an old address to a new contract.

Tests must prove privileged upgrade and post-creation criteria mutation paths do not exist.

## Architecture

The repository is a backend-free pnpm monorepo:

```text
milestoneproof/
├── apps/web/                  # React, Vite, TypeScript, responsive UI
├── packages/contracts/        # Python/GenVM contract, direct tests, deploy and live E2E scripts
├── packages/shared/           # Cross-language types, parsers, and shape fixtures
├── deployments/              # Secret-free deployment manifests
├── docs/                      # Design, recovery, and evidence documentation
├── .env.example
└── README.md
```

The contract is the source of truth. The shared package detects contract/UI schema drift. The web app has an accountless read client and a wallet-backed write client. Query hooks poll transaction state and invalidate reads only after confirmed execution. No optimistic verdict or milestone progression is displayed.

## Frontend and visual system

The visual direction combines patterns rather than copying products:

- Linear-inspired sequential milestone rail with diamond markers and clear current focus;
- shadcn/ui primitives for sidebar, tabs, tables, forms, dialogs, sheets, and responsive behavior;
- developer-dashboard conventions for commit hashes, deployment status, transaction logs, and audit cards.

The four screens are a landing/trust explanation, project creation wizard, project workspace, and submission detail. The project workspace has a project header, milestone rail, frozen criteria panel, evidence panel, and consensus/readback panel. Tabs expose `Overview`, `Evidence`, `Submissions`, and `On-chain activity`.

Desktop uses a compact sidebar and two-column workspace. Mobile uses a sheet navigation and single-column cards. Hashes and addresses use monospace text and explorer links.

Status colors are emerald for `APPROVED`, red for `REJECTED`, violet for `REQUEST_MORE_INFO`, amber for `UNRESOLVED`, blue pulse for pending transactions, and neutral gray for locked milestones.

Each write distinguishes:

- wallet disconnected;
- awaiting signature;
- pending transaction;
- `FINALIZED` consensus status;
- execution `SUCCESS`;
- execution or transport error;
- contract readback confirmed.

`FINALIZED` is never presented as execution success. The UI shows success only after a successful receipt and shows authoritative outcome data only after contract readback. Failed writes retain the user's evidence draft.

## Error handling

Client-side validation prevents transactions known to be invalid while contract validation remains authoritative. Wallet rejection, locked-wallet, wrong-network, RPC, consensus, execution, and readback errors have distinct messages and recovery actions. Retrying is idempotent and never reuses a terminal action. The UI does not hide a previous on-chain submission when a later transaction fails.

Unsafe URLs, invalid addresses, malformed commit identifiers, missing criteria, excessive evidence, expired deadlines, unauthorized actors, invalid transitions, cooldown violations, and replay attempts revert without partial state changes.

## Test strategy

Direct contract tests use a GenVM stub with programmable validator and web-fetch results. They cover authorization, invalid transitions, terminal calls, malformed and missing data, unsafe URLs, stale or mismatched evidence, injection attempts, evidence and action replay, retry cooldowns, attempt limits, verdict equivalence, parse/fetch/consensus failure, `REQUEST_MORE_INFO`, `UNRESOLVED`, milestone sequencing, project completion, and frozen-contract behavior.

Shared tests validate every contract view shape and normalize chain integer representations. Web tests cover typed wrappers, wallet states, forms, route errors, transaction lifecycle, readback gating, status presentation, draft retention, responsive navigation, and explorer links.

The live integration flow performs:

1. sponsor project creation;
2. builder evidence submission;
3. resolution through `FINALIZED` and execution `SUCCESS`;
4. contract readback proving `APPROVED` and the next milestone `OPEN`;
5. an unauthorized or replayed transaction proving rejection;
6. a `REQUEST_MORE_INFO` or `UNRESOLVED` case proving no milestone advancement.

After authorized deployment, the same material path is exercised through the deployed frontend. The evidence package records exact transaction hashes, terminal states, readbacks, source hash, commit, deployment address, explorer link, web URL, and lint/build/test results.

## Deployment and external-action gates

Deployment scripts read secrets only from environment variables and `.env` files excluded from version control. `.env.example` contains names and safe defaults but no real token, private key, or deployed address placeholder in runtime source.

Before GitHub push, GenLayer deployment, or Vercel deployment, inspect and present the active Git author, GitHub account and remote owner, deployment wallet, and Vercel team/project. State the exact proposed external action and wait for the user's action-time confirmation.

## Acceptance boundary

The MVP is complete only when lint, build, direct tests, web tests, and integration tests pass; the frozen source is deployed; its address and deployment transaction are recorded; readback matches the submitted source and expected state; the live frontend performs one successful transaction and one important failure branch; and the fixed proof matrix is complete. Anything not backed by this evidence is listed as a limitation rather than advertised as working.
