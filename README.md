# MilestoneProof

MilestoneProof is a backend-free GenLayer MVP for verifying sequential open-source grant milestones from public repository, release, CI, and deployment evidence. The Intelligent Contract is the source of truth; the frontend never invents a verdict or advances a milestone optimistically.

## Problem and trust

A sponsor and builder cannot safely rely on one another to judge completion: a builder may submit unrelated, stale, or incomplete evidence, while a sponsor may change criteria or withhold acceptance. The sponsor therefore freezes one to three milestones, criteria, source policy, deadline, and builder address on-chain before work starts. MilestoneProof has no funds, stake, or escrow.

## GenLayer decision and consequence

GenLayer validators decide whether the evidence bound to the project, builder, milestone, revision, chain, and contract proves every frozen criterion.

- `APPROVED` completes the milestone and opens the next, or completes the project.
- `REJECTED` permits a fresh submission while attempts remain.
- `REQUEST_MORE_INFO` permits a bounded supplement without advancing the milestone.
- `UNRESOLVED` preserves the milestone and permits a cooldown-limited retry.
- A protocol or execution failure commits no state and is shown separately from `UNRESOLVED`.

## Architecture

```text
apps/web/            React/Vite UI, wallet adapter, reads and writes
packages/contracts/  GenLayer Intelligent Contract, direct tests, deploy/verify/live-E2E scripts
packages/shared/     Runtime parsers and contract/frontend shape fixtures
deployments/         Immutable, secret-free deployment manifests
docs/                Design, recovery runbook, and evidence matrix
```

The contract is `INTENTIONALLY_FROZEN`: there is no owner, proxy, admin mutation, or upgrade path. The web app uses an accountless client for reads and a wallet-backed client for writes. There is no backend and no promoted feature is powered by mock data.

## State machine summary

Projects move from `ACTIVE` to `COMPLETED` or `FAILED`. Ordered milestones move through `LOCKED`, `OPEN`, `SUBMITTED`, `APPROVED`, or `FAILED`. Submission verdicts are `NONE`, `APPROVED`, `REJECTED`, `REQUEST_MORE_INFO`, and `UNRESOLVED`. Authorization, deadline, replay, attempt, evidence-integrity, and transition checks are enforced by the contract.

Every frontend write renders `AWAITING_SIGNATURE` → `PENDING` → `FINALIZED` → `SUCCESS` → `READBACK`, with `DISCONNECTED` and `ERROR` branches. `FINALIZED` alone is not treated as successful execution.

## Setup

Requirements: Node.js 20+, pnpm 10.18.2, Python 3.12+, `uvx` for the GenVM linter, and an installed Google Chrome browser for local Playwright tests. The Playwright configuration uses the system `chrome` channel; it does not require bundled Chromium.

```sh
cp .env.example .env
pnpm install --frozen-lockfile
pnpm --filter @milestoneproof/web dev
```

Configure a deployed contract address before using real reads or writes. Never commit `.env`.

## Environment variables

| Variable | Purpose |
|---|---|
| `VITE_GENLAYER_NETWORK` | Frontend network; currently `studionet` |
| `VITE_MILESTONEPROOF_ADDRESS` | Canonical deployed contract address used by the frontend |
| `GENLAYER_NETWORK` | Contract deploy/verify network override |
| `DEPLOYER_PRIVATE_KEY` | Deployment wallet key; environment only |
| `DEPLOYMENT_MANIFEST_PATH` | Optional manifest path override |
| `E2E_CONTRACT_ADDRESS` | Contract used by live browser E2E |
| `CONFIRM_LIVE_E2E` | Must equal `YES` only after approval for state-changing live E2E |
| `CONFIRM_DEPLOY` | Must equal `YES` only after action-time deploy approval |
| `VERCEL_TOKEN` | Vercel CLI token; environment only |

`.env.example` contains names and safe empty values only.

## Commands

```sh
pnpm lint                 # GenVM and web lint
pnpm typecheck            # all workspace type checks
pnpm build                # shared package and production web build
pnpm test                 # direct contract, shared, and web tests
pnpm --filter @milestoneproof/web e2e  # reproducible local Playwright suite
pnpm deploy:contract:dry-run
pnpm verify:contract -- --manifest deployments/studionet.json
pnpm e2e:contract:live -- --manifest deployments/studionet.json
pnpm e2e:live             # state-changing deployed-browser flow; confirmation-gated
```

## Contract deployment

Deployment is intentionally gated. First set `GENLAYER_NETWORK` and `DEPLOYER_PRIVATE_KEY`, then run `pnpm deploy:contract:dry-run`. Confirm the printed network, derived deployer, source SHA-256, candidate commit, and manifest path. Only after explicit approval, set `CONFIRM_DEPLOY=YES` and run `pnpm deploy:contract`.

The script waits for `FINALIZED`, requires `FINISHED_WITH_RETURN`, verifies the transaction sender, reads `get_config`, compares deployed source, and writes an immutable schema-checked manifest. It refuses to overwrite an existing manifest. Studionet support and tests are simulated until the live deployment/readback gate is completed.

## Frontend deployment

Set `VITE_GENLAYER_NETWORK=studionet` and the canonical `VITE_MILESTONEPROOF_ADDRESS` from the verified manifest. Link the intended Vercel team/project and inspect `vercel whoami` without exposing `VERCEL_TOKEN`. After explicit production-deploy approval, deploy from the repository root with Vercel; `vercel.json` builds the monorepo and serves the SPA from `apps/web/dist`.

## Usage

1. Connect the sponsor wallet on GenLayer Studionet and create a project with frozen criteria and builder.
2. Connect the frozen builder wallet and submit one to four public evidence items.
3. Sponsor or builder resolves the submission through GenLayer consensus.
4. Wait for execution success and authoritative contract readback before relying on the verdict.
5. Use resubmit, supplement, retry, or permissionless expiry only when the recorded state allows it.

## Verification evidence

Local direct, parser, UI, deployment-gate, and browser-to-contract fixture tests are implemented. Manual local browser QA observed:

- desktop 1440×900: landing and sidebar rendered cleanly;
- mobile 390×844: navigation sheet focus, Escape close, focus restore, and no horizontal overflow;
- missing-wallet branch: visible accessible alert;
- console: no errors; two React Router future-flag warnings only.

These are local results, not proof of a Studionet deployment. Exact transaction and readback evidence belongs in [the proof matrix](docs/evidence/proof-matrix.md) after authorized live execution.

## Known limitations

- No live Studionet contract address, deployment transaction, explorer link, or verified readback has been recorded yet.
- No Vercel production URL or deployed-site transaction has been verified yet.
- Studionet funding in live E2E uses the network simulation method and is explicitly Studionet-only.
- The contract header pins the tested GenLayer runner; the linter currently reports that a newer runner is available, so upgrades require a fresh compatibility review.
- A frozen-contract defect requires successor deployment and manual recreation of unfinished projects; see [the recovery runbook](docs/recovery.md).
- The UI supports one configured contract deployment at a time; historical addresses remain readable through their original explorer/manifest links.
