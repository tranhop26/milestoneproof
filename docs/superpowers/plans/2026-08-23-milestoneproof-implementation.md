# MilestoneProof Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build, test, deploy, and verify a backend-free GenLayer MVP that freezes grant milestones and lets validator consensus approve, reject, request more information, or safely leave submissions unresolved.

**Architecture:** A Python/GenVM Intelligent Contract owns every project, milestone, submission, verdict, and transition. A React/Vite client reads the contract directly and submits wallet-signed writes through `genlayer-js`; a shared TypeScript package guards the contract/UI schema boundary. Direct tests use an in-process GenVM stub, while live scripts and Playwright exercise the deployed contract and frontend.

**Tech Stack:** Python 3.12+, GenVM, `genvm-linter`, pytest, Node.js 20+, pnpm 10.18.2, `genlayer-js` 1.1.8, React 18.3.1, TypeScript 5.5.4, Vite 5.3.4, Vitest 2.1.9, TanStack Query 5.51+, React Router 6.26, Tailwind CSS 3.4.6, Radix UI primitives, Lucide icons, Playwright.

## Global Constraints

- The Intelligent Contract is the sole source of truth; do not add a backend, database, fake contract, or frontend-selected verdict.
- Support exactly one sponsor, one builder, and one to three sequential milestones per project.
- Store no money, stake, escrow, bounty, or payout in this MVP.
- Contract classification is `INTENTIONALLY_FROZEN`; add no owner, proxy, admin mutation, or privileged upgrade path.
- Treat `APPROVED`, `REJECTED`, `REQUEST_MORE_INFO`, and `UNRESOLVED` as distinct semantic outcomes.
- Missing, malformed, stale, contradictory, unsafe, or consensus-insufficient evidence must never become `APPROVED`.
- Distinguish wallet disconnected, awaiting signature, pending, `FINALIZED`, execution `SUCCESS`, error, and readback confirmed.
- Use public HTTPS evidence only; reject credentials, non-default ports, private/reserved hosts, malformed full commit SHAs, and replayed action domains.
- Maximums: three milestones, three submission attempts per milestone, four evidence items per revision, three resolution attempts, and a 72-hour information window.
- Never commit tokens, private keys, `.env`, local journals, deployment credentials, raw research, or internal task files.
- Stop for action-time identity confirmation before GitHub push, GenLayer deployment, and Vercel deployment.

## Planned File Map

```text
.
├── package.json                         # workspace commands and pinned toolchain
├── pnpm-workspace.yaml                  # workspace membership
├── pnpm-lock.yaml                       # reproducible Node dependency graph
├── tsconfig.base.json                   # shared strict TypeScript settings
├── .env.example                         # secret-free runtime variable names
├── vercel.json                          # SPA build and rewrite rules
├── deployments/schema.json              # manifest schema
├── packages/contracts/
│   ├── package.json                     # contract test/lint/deploy commands
│   ├── milestoneproof.py                # authoritative Intelligent Contract
│   ├── scripts/deploy.mjs               # guarded deployment + manifest writer
│   ├── scripts/verify.mjs               # source/address/schema/readback verifier
│   ├── scripts/e2e.mjs                  # live actor lifecycle and error branch
│   └── tests/
│       ├── _stubs/genlayer.py           # deterministic GenVM/runtime stub
│       ├── conftest.py                   # chain, actors, evidence, validator controls
│       ├── test_projects.py             # creation, nonces, frozen definitions
│       ├── test_evidence.py             # URL/version/freshness/replay validation
│       ├── test_resolution.py           # semantic consensus and safe failures
│       ├── test_state_machine.py        # transitions, expiry, retries, limits
│       ├── test_views.py                 # paginated read shapes
│       └── test_frozen.py                # no privileged recovery path
├── packages/shared/
│   ├── package.json
│   ├── tsconfig.json
│   ├── contract-shape.json               # Python-generated view fixture
│   ├── evidence-vectors.json             # shared safe/unsafe evidence cases
│   └── src/index.ts                      # enums, types, parsers, formatters
└── apps/web/
    ├── package.json
    ├── vite.config.ts
    ├── vitest.config.ts
    ├── playwright.config.ts
    ├── tailwind.config.ts
    ├── src/
    │   ├── App.tsx                       # routes and boundaries
    │   ├── index.css                     # MilestoneProof design tokens
    │   ├── lib/genlayer.ts               # network/read/write clients
    │   ├── lib/wallet.tsx                # injected + Studionet demo wallet state
    │   ├── lib/contract.ts               # typed contract read/write wrappers
    │   ├── lib/transaction.ts            # FINALIZED/execution/readback machine
    │   ├── hooks/useMilestoneProof.ts     # queries, mutations, reconciliation
    │   ├── components/AppShell.tsx
    │   ├── components/MilestoneRail.tsx
    │   ├── components/StatusBadge.tsx
    │   ├── components/TransactionPanel.tsx
    │   ├── components/EvidenceEditor.tsx
    │   ├── pages/Landing.tsx
    │   ├── pages/CreateProject.tsx
    │   ├── pages/ProjectWorkspace.tsx
    │   └── pages/SubmissionDetail.tsx
    └── e2e/live.spec.ts                  # browser-to-live-contract happy/error flow
```

---

### Task 1: Reproducible Workspace and Contract Test Harness

**Files:**
- Create: `package.json`, `pnpm-workspace.yaml`, `tsconfig.base.json`, `.env.example`
- Create: `packages/contracts/package.json`
- Create: `packages/contracts/tests/_stubs/genlayer.py`
- Create: `packages/contracts/tests/conftest.py`
- Test: `packages/contracts/tests/test_projects.py`

**Interfaces:**
- Consumes: approved design at `docs/superpowers/specs/2026-08-23-milestoneproof-design.md`.
- Produces: root commands `pnpm test`, `pnpm build`, `pnpm typecheck`, `pnpm lint`; Python fixtures `chain`, `SPONSOR`, `BUILDER`, `STRANGER`, and `valid_milestones()`.

- [ ] **Step 1: Write the failing constructor test**

```python
def test_contract_starts_empty(chain):
    assert chain.contract.get_config() == [0, 3, 3, 4, 3, 72 * 60 * 60]
    assert chain.contract.get_project_count() == 0
```

- [ ] **Step 2: Run the focused test and confirm the missing contract failure**

Run: `pnpm --filter @milestoneproof/contracts test -- -k test_contract_starts_empty -vv`

Expected: collection fails because `milestoneproof.py` does not exist.

- [ ] **Step 3: Add the workspace manifests and deterministic GenVM stub**

Use root scripts with these exact responsibilities:

```json
{
  "scripts": {
    "build": "pnpm --filter @milestoneproof/shared build && pnpm --filter @milestoneproof/web build",
    "typecheck": "pnpm -r --if-present typecheck",
    "lint": "pnpm lint:genvm && pnpm --filter @milestoneproof/web lint",
    "lint:genvm": "uvx --from genvm-linter genvm-lint check packages/contracts/milestoneproof.py",
    "test": "pnpm -r --sequential test",
    "test:contract": "pnpm --filter @milestoneproof/contracts test",
    "test:web": "pnpm --filter @milestoneproof/web test",
    "e2e:live": "pnpm --filter @milestoneproof/web e2e:live"
  }
}
```

The stub must implement `Address`, sized integers, `DynArray`, `TreeMap`, `gl.message.sender_address`, `gl.message_raw.datetime`, public decorators, `gl.storage.copy_to_memory`, `gl.nondet.web.render`, `gl.nondet.exec_prompt`, semantic-equivalence hooks, events, and `UserError`.

- [ ] **Step 4: Add a minimal compiling contract shell and make the test pass**

```python
class MilestoneProof(gl.Contract):
    project_count: u256

    def __init__(self):
        self.project_count = u256(0)

    @gl.public.view
    def get_config(self) -> list:
        return [0, 3, 3, 4, 3, 72 * 60 * 60]

    @gl.public.view
    def get_project_count(self) -> u256:
        return self.project_count
```

- [ ] **Step 5: Run the harness and commit**

Run: `pnpm test:contract`

Expected: constructor test passes.

Commit: `chore: scaffold MilestoneProof workspace and contract harness`

### Task 2: Frozen Project and Milestone Creation

**Files:**
- Modify: `packages/contracts/milestoneproof.py`
- Modify: `packages/contracts/tests/conftest.py`
- Test: `packages/contracts/tests/test_projects.py`

**Interfaces:**
- Consumes: `Chain.call(method, *args, sender=...)`, actor fixtures, and GenVM storage primitives.
- Produces: `create_project(builder, title, description, milestones, client_nonce) -> u256`, `get_project(id)`, `get_milestone(project_id, index)`, and sponsor/builder paginated indexes.

- [ ] **Step 1: Add failing creation, authorization-domain, and immutability tests**

```python
def test_sponsor_creates_frozen_three_milestone_project(chain, valid_milestones):
    pid = chain.call("create_project", BUILDER, "Release grant", "Ship a verified MVP", valid_milestones, "grant-001", sender=SPONSOR)
    assert int(pid) == 1
    assert chain.project(1).sponsor == SPONSOR
    assert chain.milestone(1, 0).state == OPEN
    assert chain.milestone(1, 1).state == LOCKED

def test_reused_sponsor_nonce_reverts(chain, valid_milestones):
    chain.create_project(valid_milestones, nonce="grant-001")
    with pytest.raises(Revert, match="nonce already used"):
        chain.create_project(valid_milestones, nonce="grant-001")
```

Also assert zero builder, self-sponsorship, empty/oversized fields, zero/two-past deadlines, zero/four milestones, empty criteria, and any attempted unknown mutation method fail.

- [ ] **Step 2: Run the project tests and confirm they fail**

Run: `pnpm test:contract -- -k 'project or nonce or milestone' -vv`

Expected: failures name missing records and `create_project`.

- [ ] **Step 3: Implement focused storage records and creation validation**

Define sized status constants and `@allow_storage @dataclass` records `Project`, `Milestone`, `Evidence`, and `Submission`. Store criteria as a bounded `DynArray[str]`; reject fields beyond explicit contract constants. Compute the nonce key from `sender + client_nonce`; never expose setters for project definitions.

- [ ] **Step 4: Add capped views and verify all project tests**

Views must return plain arrays containing versioned shapes, for example:

```python
[1, project_id, sponsor, builder, title, description, status,
 current_milestone, created_at, milestone_count]
```

Run: `pnpm test:contract -- packages/contracts/tests/test_projects.py -vv`

Expected: all project tests pass.

- [ ] **Step 5: Commit the independently usable project registry**

Commit: `feat: add frozen project and milestone registry`

### Task 3: Evidence Validation, Submission, and Replay Protection

**Files:**
- Modify: `packages/contracts/milestoneproof.py`
- Create: `packages/shared/evidence-vectors.json`
- Test: `packages/contracts/tests/test_evidence.py`
- Modify: `packages/contracts/tests/conftest.py`

**Interfaces:**
- Consumes: open milestones and immutable evidence policy from Task 2.
- Produces: `submit_evidence(project_id, milestone_index, evidence, client_nonce) -> u256`, `resubmit_evidence(project_id, milestone_index, evidence, client_nonce) -> u256`, canonical evidence digests, and state `OPEN -> SUBMITTED`.

- [ ] **Step 1: Write failing table-driven URL and binding tests**

```python
@pytest.mark.parametrize("url", INVALID_URLS)
def test_unsafe_evidence_url_reverts(chain, open_project, url):
    with pytest.raises(Revert, match="unsafe evidence URL"):
        chain.submit(open_project, evidence_url=url)

def test_wrong_builder_cannot_submit(chain, open_project):
    with pytest.raises(Revert, match="builder only"):
        chain.submit(open_project, sender=STRANGER)
```

Vectors must include credentials, `http`, fragments that obscure authority, backslashes, localhost, RFC1918, link-local, CGNAT, metadata IPs, reserved names, non-default ports, malformed/noncanonical IPv4, and valid GitHub/Vercel HTTPS URLs.

- [ ] **Step 2: Run evidence tests and verify failure**

Run: `pnpm test:contract -- packages/contracts/tests/test_evidence.py -vv`

Expected: missing validation and submission methods fail.

- [ ] **Step 3: Implement bounded canonical evidence storage**

Accept each item as `[source_kind, url, subject_ref, version_ref, observed_at]`. Require a full 40-hex Git commit for repository/CI evidence, at most four items, unique `(source_kind, subject_ref, version_ref)` tuples, observation at or after milestone open time, and submission before deadline. Hash canonical metadata with length-prefixed fields plus chain/contract/project/milestone/revision/sender domain values.

- [ ] **Step 4: Add replay and invalid-transition tests**

Assert reused client nonce, identical submission action, locked milestone, wrong milestone index, second open submission, expired deadline, and submission after project terminal state all revert without changing counters.

- [ ] **Step 5: Run tests and commit**

Run: `pnpm test:contract -- packages/contracts/tests/test_evidence.py -vv`

Expected: all evidence tests pass.

Commit: `feat: bind milestone evidence and reject replay`

### Task 4: Semantic GenLayer Resolution

**Files:**
- Modify: `packages/contracts/milestoneproof.py`
- Test: `packages/contracts/tests/test_resolution.py`
- Modify: `packages/contracts/tests/conftest.py`

**Interfaces:**
- Consumes: a stored `SUBMITTED` revision and immutable criteria/evidence memory copies.
- Produces: `resolve_submission(submission_id)`, semantic verdict normalization, per-criterion coverage, integrity flags, rationale, and contract-recorded `UNRESOLVED`.

- [ ] **Step 1: Write failing semantic outcome tests**

```python
def test_approved_requires_every_criterion_and_safe_integrity(chain, submitted):
    chain.set_verdict(verdict="APPROVED", criteria=[True, True], missing=[], integrity=[True, True, True, True])
    chain.call("resolve_submission", submitted, sender=SPONSOR)
    assert chain.submission(submitted).verdict == APPROVED
    assert chain.milestone(1, 0).state == APPROVED_MILESTONE

def test_malformed_validator_output_becomes_unresolved(chain, submitted):
    chain.set_raw_verdict("not-json")
    chain.call("resolve_submission", submitted, sender=BUILDER)
    assert chain.submission(submitted).verdict == UNRESOLVED
```

Add cases for `REJECTED`, `REQUEST_MORE_INFO`, unavailable web render, contradictory evidence, unsafe integrity flags, criterion-length mismatch, prompt injection, sponsor/builder-only resolution, and protocol exception leaving pre-call state unchanged in the transactional test harness.

- [ ] **Step 2: Run the resolution tests and verify failure**

Run: `pnpm test:contract -- packages/contracts/tests/test_resolution.py -vv`

Expected: missing resolution and normalization behavior fails.

- [ ] **Step 3: Implement source fetching and injection-defended prompt construction**

Copy storage records to memory before entering nondeterministic operations. Revalidate every URL immediately before `gl.nondet.web.render(url, mode="text")`. Fence sanitized criteria and evidence content as untrusted blocks and cap rendered text per item.

- [ ] **Step 4: Implement semantic equivalence and fail-closed normalization**

Normalize to this exact object before comparison:

```json
{
  "verdict": "APPROVED|REJECTED|REQUEST_MORE_INFO|UNRESOLVED",
  "criteria_met": [true, false],
  "missing_criteria": [1],
  "integrity": {
    "subject_match": true,
    "version_match": true,
    "fresh": true,
    "provenance_ok": true
  },
  "rationale": "bounded free text"
}
```

Equivalence compares verdict, every criterion Boolean, the sorted missing-index set, and all integrity flags; it ignores rationale text. `APPROVED` is invalid unless all criteria and integrity flags are true and `missing_criteria` is empty.

- [ ] **Step 5: Run focused and full contract suites, then commit**

Run: `pnpm test:contract -- packages/contracts/tests/test_resolution.py -vv`

Run: `pnpm test:contract`

Expected: all tests pass.

Commit: `feat: resolve milestone evidence by semantic consensus`

### Task 5: Cure, Retry, Expiry, and Frozen-State Adversarial Coverage

**Files:**
- Modify: `packages/contracts/milestoneproof.py`
- Test: `packages/contracts/tests/test_state_machine.py`
- Test: `packages/contracts/tests/test_frozen.py`
- Test: `packages/contracts/tests/test_views.py`

**Interfaces:**
- Consumes: verdicts and project/milestone/submission records from Tasks 2-4.
- Produces: `supplement_evidence`, `resubmit_evidence`, `retry_resolution`, `expire_milestone`, complete terminal transitions, and stable paginated view schemas.

- [ ] **Step 1: Add failing state-machine tests**

Cover the exact paths:

```text
REQUEST_MORE_INFO -> supplement within 72h -> SUBMITTED
REJECTED -> resubmit while attempts < 3 -> SUBMITTED
UNRESOLVED -> retry after cooldown while resolutions < 3 -> resolved outcome
APPROVED -> next milestone OPEN or project COMPLETED
deadline/info window elapsed -> expire_milestone -> project FAILED
```

Every test must assert counters, current milestone, terminal flags, and unchanged state after an invalid repeated call.

- [ ] **Step 2: Run the state-machine tests and verify failure**

Run: `pnpm test:contract -- packages/contracts/tests/test_state_machine.py -vv`

Expected: missing cure, retry, and expiry transitions fail.

- [ ] **Step 3: Implement transitions with effects before events**

Use one internal transition helper to enforce project/milestone consistency. Increment attempt counters before invoking resolution, preserve prior revision history, and reject terminal writes. Emit `ProjectCreated`, `EvidenceSubmitted`, `SubmissionResolved`, `EvidenceSupplemented`, `MilestoneOpened`, `MilestoneExpired`, and `ProjectCompleted` events only after storage is coherent.

- [ ] **Step 4: Prove frozen behavior and schema bounds**

`test_frozen.py` must assert the public write method set equals the seven designed methods and contains no name matching `owner`, `admin`, `upgrade`, `replace`, `set_code`, or `set_criteria`. `test_views.py` must test missing IDs, page size 0/51, newest-first actor indexes, and exact field counts/types.

- [ ] **Step 5: Run contract lint and all direct tests, then commit**

Run: `pnpm lint:genvm`

Run: `pnpm test:contract`

Expected: GenVM lint and every direct test pass.

Commit: `test: harden milestone lifecycle and frozen recovery`

### Task 6: Shared Contract Types and Drift Fixtures

**Files:**
- Create: `packages/shared/package.json`, `packages/shared/tsconfig.json`
- Create: `packages/shared/src/index.ts`, `packages/shared/src/index.test.ts`
- Create: `packages/shared/contract-shape.json`
- Modify: `packages/contracts/tests/test_views.py`

**Interfaces:**
- Consumes: versioned view arrays emitted by the completed contract.
- Produces: `parseProject`, `parseMilestone`, `parseSubmission`, `parseConfig`, `EvidenceInput`, `MilestoneInput`, and normalized string IDs/timestamps.

- [ ] **Step 1: Add failing parser tests using Python-generated fixtures**

```ts
it("parses the versioned project read shape", () => {
  const project = parseProject(contractShape.project)
  expect(project.schemaVersion).toBe(1)
  expect(project.currentMilestone).toBe(0)
  expect(project.sponsor).toMatch(/^0x[0-9a-f]{40}$/i)
})
```

Also test number, bigint, and decimal-string integer inputs plus wrong version, wrong field count, unknown status, and unsafe URL vectors.

- [ ] **Step 2: Run shared tests and confirm failure**

Run: `pnpm --filter @milestoneproof/shared test`

Expected: parsers do not exist.

- [ ] **Step 3: Implement exhaustive enums and runtime parsers**

Use string unions for `ProjectStatus`, `MilestoneStatus`, `Verdict`, and `SourceKind`; never cast unknown chain data directly. Reject unknown schema versions and field counts with named errors.

- [ ] **Step 4: Generate and lock the cross-language fixture**

Add a Python test mode `UPDATE_CONTRACT_SHAPE=1` that writes only deterministic read arrays. Normal test mode compares the current contract output with the committed fixture so either language fails when the schema drifts.

- [ ] **Step 5: Run contract + shared tests and commit**

Run: `pnpm test:contract && pnpm --filter @milestoneproof/shared test`

Expected: both suites pass against the same fixtures.

Commit: `feat: add typed contract boundary and drift fixtures`

### Task 7: Responsive Shell, Wallet, and Transaction State Machine

**Files:**
- Create: `apps/web/package.json`, `apps/web/vite.config.ts`, `apps/web/vitest.config.ts`, `apps/web/tailwind.config.ts`, `apps/web/src/main.tsx`, `apps/web/src/App.tsx`, `apps/web/src/index.css`
- Create: `apps/web/src/lib/genlayer.ts`, `apps/web/src/lib/wallet.tsx`, `apps/web/src/lib/transaction.ts`
- Create: `apps/web/src/components/AppShell.tsx`, `apps/web/src/components/StatusBadge.tsx`, `apps/web/src/components/TransactionPanel.tsx`
- Test: `apps/web/src/lib/wallet.test.tsx`, `apps/web/src/lib/transaction.test.ts`, `apps/web/src/components/AppShell.test.tsx`

**Interfaces:**
- Consumes: GenLayer Studionet chain config and shared status types.
- Produces: `WalletProvider`, `useWallet()`, accountless `readClient()`, signer `writeClient()`, `runWriteAndReadback()`, application routes, and responsive design tokens.

- [ ] **Step 1: Write failing transaction-state tests**

```ts
it("does not report success for a finalized execution error", async () => {
  const states: string[] = []
  await expect(runWriteAndReadback(failedFinalizedAdapter, s => states.push(s.phase))).rejects.toThrow()
  expect(states).toEqual(["AWAITING_SIGNATURE", "PENDING", "FINALIZED", "ERROR"])
  expect(states).not.toContain("SUCCESS")
})
```

Add wallet disconnected, rejected signature, wrong network, successful execution, failed readback, and draft-preservation cases.

- [ ] **Step 2: Run web tests and confirm failure**

Run: `pnpm test:web -- --run src/lib/transaction.test.ts`

Expected: transaction module is missing.

- [ ] **Step 3: Implement real clients and wallet lifecycle**

Create an accountless read client. The injected-wallet write client must include `provider: window.ethereum`, call `client.connect("studionet")` before writes, react to account/chain changes, and clear cached signers on disconnect. Studionet demo mode may persist only a generated burner key in local storage; never bundle a fixed key.

- [ ] **Step 4: Implement the seven-phase transaction panel and responsive shell**

Use a dark neutral background, emerald primary accent, Linear-like compact navigation, `aria-live` transaction updates, visible focus states, a desktop sidebar, and a mobile sheet. Status badges must use text/icons in addition to color.

- [ ] **Step 5: Run tests, typecheck, and commit**

Run: `pnpm test:web && pnpm typecheck`

Expected: wallet, transaction, and shell tests pass.

Commit: `feat: add responsive shell and truthful transaction states`

### Task 8: Typed Contract Adapter and Project Workflow UI

**Files:**
- Create: `apps/web/src/lib/contract.ts`, `apps/web/src/hooks/useMilestoneProof.ts`
- Create: `apps/web/src/pages/Landing.tsx`, `apps/web/src/pages/CreateProject.tsx`, `apps/web/src/pages/ProjectWorkspace.tsx`
- Create: `apps/web/src/components/MilestoneRail.tsx`
- Test: `apps/web/src/lib/contract.test.ts`, `apps/web/src/pages/CreateProject.test.tsx`, `apps/web/src/pages/ProjectWorkspace.test.tsx`

**Interfaces:**
- Consumes: shared parsers, wallet clients, and transaction state machine.
- Produces: `reads.config/project/milestone/submission/actorProjects`, `writes.createProject`, TanStack Query hooks, validated creation wizard, and authoritative project workspace.

- [ ] **Step 1: Write failing adapter and creation-flow tests**

Assert exact contract function names/argument order, one-to-three milestone validation, full builder address validation, future deadlines, nonce generation, wallet-disconnected call to action, and no navigation until readback returns the created project.

- [ ] **Step 2: Run the focused web tests and verify failure**

Run: `pnpm test:web -- --run src/lib/contract.test.ts src/pages/CreateProject.test.tsx`

Expected: adapter and pages are missing.

- [ ] **Step 3: Implement typed reads/writes and query keys**

All wrappers validate IDs and addresses before calldata. Actor project lists page from newest to oldest in batches no larger than 50. Mutations invalidate only affected project, milestone, submission, and actor-list keys after readback.

- [ ] **Step 4: Implement the landing, wizard, and Linear-style workspace**

The workspace header shows sponsor, builder, configured contract, and explorer links. `MilestoneRail` renders locked/open/submitted/approved/failed nodes from contract reads. Tabs are `Overview`, `Evidence`, `Submissions`, and `On-chain activity`; empty activity must say no on-chain activity instead of inventing rows.

- [ ] **Step 5: Run web tests, build, and commit**

Run: `pnpm test:web && pnpm build`

Expected: tests and production build pass.

Commit: `feat: connect project workflow UI to contract reads`

### Task 9: Evidence, Resolution, Readback, and Error UI

**Files:**
- Create: `apps/web/src/components/EvidenceEditor.tsx`
- Create: `apps/web/src/pages/SubmissionDetail.tsx`
- Modify: `apps/web/src/pages/ProjectWorkspace.tsx`
- Modify: `apps/web/src/hooks/useMilestoneProof.ts`
- Test: `apps/web/src/components/EvidenceEditor.test.tsx`, `apps/web/src/pages/SubmissionDetail.test.tsx`

**Interfaces:**
- Consumes: evidence vectors, typed write wrappers, wallet roles, transaction panel, and authoritative submission reads.
- Produces: submit, resolve, resubmit, supplement, retry, and expire user flows with role/state guards and preserved drafts.

- [ ] **Step 1: Write failing role, state, and readback tests**

Cover builder submit, stranger read-only view, sponsor/builder resolve, hidden invalid actions, `REQUEST_MORE_INFO` supplement, `UNRESOLVED` cooldown, `REJECTED` resubmit, terminal replay suppression, finalized execution error, and readback mismatch.

- [ ] **Step 2: Run focused tests and confirm failure**

Run: `pnpm test:web -- --run src/components/EvidenceEditor.test.tsx src/pages/SubmissionDetail.test.tsx`

Expected: evidence and submission UI is missing.

- [ ] **Step 3: Implement evidence editing with shared validation**

Render up to four evidence rows with source kind, URL, subject, full version reference, and observed timestamp. Keep the draft in component state until confirmed readback; remove it only after the returned submission digest matches the submitted digest.

- [ ] **Step 4: Implement verdict-specific audit panels and actions**

Show criteria coverage row-by-row, integrity flags, bounded rationale, revision history, transaction/explorer links, and distinct next actions. Never label `FINALIZED` as successful before `txExecutionResultName === FINISHED_WITH_RETURN`.

- [ ] **Step 5: Run tests, build, and commit**

Run: `pnpm test:web && pnpm build`

Expected: all web tests and build pass.

Commit: `feat: add evidence resolution and contract readback UI`

### Task 10: Deployment Manifest, Live Contract E2E, and Source Verification

**Files:**
- Create: `deployments/schema.json`
- Create: `packages/contracts/scripts/deploy.mjs`
- Create: `packages/contracts/scripts/verify.mjs`
- Create: `packages/contracts/scripts/e2e.mjs`
- Modify: `packages/contracts/package.json`, `package.json`, `.env.example`
- Test: `packages/contracts/tests/test_deployment_files.py`

**Interfaces:**
- Consumes: frozen contract source, `genlayer-js`, environment-selected network and deployer.
- Produces: guarded deploy command, immutable manifest, deployed-source/readback verifier, and live lifecycle evidence JSON.

- [ ] **Step 1: Write failing deployment hygiene tests**

Assert `.env.example` contains empty `DEPLOYER_PRIVATE_KEY`, `VERCEL_TOKEN`, `VITE_MILESTONEPROOF_ADDRESS`, and safe `VITE_GENLAYER_NETWORK=studionet`; runtime source contains no 64-hex private key or configured 40-hex contract address; manifest schema requires network, address, deployment transaction, deployer, source SHA-256, deployed-at timestamp, classification, and verification transaction/readback fields.

- [ ] **Step 2: Run deployment-file tests and confirm failure**

Run: `pnpm test:contract -- packages/contracts/tests/test_deployment_files.py -vv`

Expected: scripts and schema are absent.

- [ ] **Step 3: Implement a guarded deployment script**

The script must print network, deployer address, source hash, and intended manifest path, then refuse to deploy unless `CONFIRM_DEPLOY=YES` is present. It waits for `FINALIZED`, requires `FINISHED_WITH_RETURN`, extracts the address, reads `get_config`, fetches deployed code with `getContractCode`, compares source SHA-256, and writes a secret-free manifest atomically.

- [ ] **Step 4: Implement live happy and adversarial flows**

`e2e.mjs` uses fresh generated Studionet actors, creates a project, submits a deterministic public evidence fixture, resolves it, checks `FINALIZED`, execution result, and readback, then sends an unauthorized or replayed write and proves `FINISHED_WITH_ERROR`. It writes transaction hashes and readbacks to ignored `work/evidence/live-contract.json`.

- [ ] **Step 5: Run tests without deploying and commit**

Run: `pnpm test:contract -- packages/contracts/tests/test_deployment_files.py -vv`

Run: `node packages/contracts/scripts/deploy.mjs --dry-run`

Expected: tests pass and dry-run prints identity/source inputs without network mutation.

Commit: `feat: add guarded deployment and live verification tools`

### Task 11: Browser-to-Contract Integration Test and Responsive QA

**Files:**
- Create: `apps/web/playwright.config.ts`, `apps/web/e2e/live.spec.ts`
- Modify: `apps/web/package.json`, `apps/web/src/lib/wallet.tsx`
- Test: `apps/web/e2e/live.spec.ts`

**Interfaces:**
- Consumes: a user-confirmed deployed contract, configured local frontend, runtime-generated Studionet sponsor/builder keys, and public evidence URLs.
- Produces: browser evidence for wallet connection, successful transaction/readback, an important error branch, and responsive layouts.

- [ ] **Step 1: Add the opt-in live test with explicit environment guard**

```ts
test.skip(!process.env.E2E_CONTRACT_ADDRESS, "E2E_CONTRACT_ADDRESS is required")
test("creates, submits, resolves, and reads back a milestone", async ({ page }) => {
  await page.goto("/")
  await expect(page.getByText("Contract readback")).toBeVisible()
})
```

The full test generates ephemeral keys at runtime, injects only the selected key into the browser-local Studionet demo wallet, creates a project as sponsor, reconnects as builder to submit, reconnects as sponsor to resolve, waits through the seven UI phases, and asserts the next milestone opens from a fresh read.

- [ ] **Step 2: Add the important UI error branch**

Reconnect as an unrelated generated actor, open the project, and assert the interface explains that only the builder can submit while preserving public read access. Also intercept one receipt with `FINISHED_WITH_ERROR` in a non-live component fixture and assert `SUCCESS`/readback never appears.

- [ ] **Step 3: Add desktop and mobile assertions**

At 1440×900 assert sidebar, two-column workspace, milestone rail, and transaction panel are visible. At 390×844 assert sidebar is hidden behind the labeled navigation sheet, cards are single-column, hashes wrap safely, and all controls meet 44px touch targets.

- [ ] **Step 4: Run non-live UI tests now and document the gated live command**

Run: `pnpm test:web && pnpm build`

Expected: all non-live tests pass; live test remains skipped until deployment is authorized.

Live command after deployment in PowerShell: `$env:E2E_CONTRACT_ADDRESS = (Get-Content deployments/studionet.json | ConvertFrom-Json).contractAddress; pnpm e2e:live`

- [ ] **Step 5: Commit the integration harness**

Commit: `test: add browser-to-contract lifecycle coverage`

### Task 12: README, Recovery Runbook, Full Local Verification, and External Gates

**Files:**
- Create: `README.md`, `docs/recovery.md`, `docs/evidence/proof-matrix.md`
- Create: `vercel.json`
- Modify: `.gitignore`, `.env.example`

**Interfaces:**
- Consumes: all implemented commands, state machine, deployment schema, and observed verification results.
- Produces: concise setup/use/deploy documentation, frozen-contract recovery steps, proof-matrix template, and a clean candidate repository.

- [ ] **Step 1: Write concise operational documentation**

README sections must be: problem/trust, GenLayer decision and consequence, architecture, state machine summary, setup, environment variables, commands, contract deployment, frontend deployment, usage, verification evidence, and known limitations. Label Studionet as simulated and do not claim live completion before evidence exists.

- [ ] **Step 2: Write the frozen recovery runbook and proof matrix**

The runbook specifies: freeze writes in the UI by removing the configured address, preserve the old manifest, diagnose and patch source, rerun all tests, deploy only after confirmation, publish a successor manifest, recreate unfinished projects manually, and keep old results linked/readable. The proof matrix uses columns `Actor | Action | Contract method | Transaction hash | FINALIZED/SUCCESS | Readback | Source/test`.

- [ ] **Step 3: Run full local verification from a clean install**

Run: `pnpm install --frozen-lockfile`

Run: `pnpm lint && pnpm typecheck && pnpm build && pnpm test`

Run: `git diff --check && git status --short`

Expected: every command exits 0; only intended tracked changes remain.

- [ ] **Step 4: Review repository hygiene and commit local completion**

Inspect tracked, staged, and untracked files; scan for secret-shaped strings; confirm `node_modules`, `dist`, `.env`, `.vercel`, local evidence journals, research clone, and local instructions are ignored.

Commit: `docs: add MilestoneProof operations and evidence guide`

- [ ] **Step 5: Stop at the GitHub push confirmation gate**

Read only: `git config user.name`, `git config user.email`, `gh auth status`, `git remote -v`, current branch, candidate commit, and staged/untracked files. Present the exact GitHub account, repository owner/name, branch, and commit proposed for push; wait for explicit confirmation before creating a remote or pushing.

- [ ] **Step 6: Stop separately at the GenLayer deployment gate**

Read only: selected network, deployer address derived from the environment key without printing the key, deployer balance when relevant, source hash, and dry-run output. Present the exact wallet, network, source commit, and intended action; wait for explicit confirmation before setting `CONFIRM_DEPLOY=YES`.

- [ ] **Step 7: Stop separately at the Vercel deployment gate**

Read only: `vercel whoami`, current team scope, linked project, Git commit, contract address, and environment variable names without values. Present the exact Vercel team/project, source commit, contract/network configuration, and intended production deployment; wait for explicit confirmation before deploying.

- [ ] **Step 8: After authorized deployments, fix the evidence package**

Run the contract verifier, live contract E2E, deployed-site browser E2E, desktop/mobile smoke checks, console-error check, one successful transaction, and one important error branch. Record exact commit, source hash, Vercel URL, contract address, deployment transaction, explorer links, test totals, readbacks, proof matrix, and limitations. Only then replace provisional README language with verified claims and create the final evidence commit, subject to a new push confirmation if it changes the remote.
