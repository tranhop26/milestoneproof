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

Requirements: Node.js 20+, pnpm 10.18.2, Python 3.12+ with `genvm-linter`, and an installed Google Chrome browser for local Playwright tests. The Playwright configuration uses the system `chrome` channel; it does not require bundled Chromium.

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
pnpm verify:contract
pnpm e2e:contract:live -- --manifest deployments/studionet.json
pnpm e2e:live             # state-changing deployed-browser flow; confirmation-gated
```

## Contract deployment

Deployment is intentionally gated. First set `GENLAYER_NETWORK` and `DEPLOYER_PRIVATE_KEY`, then run `pnpm deploy:contract:dry-run`. Confirm the printed network, derived deployer, source SHA-256, candidate commit, and manifest path. Only after explicit approval, set `CONFIRM_DEPLOY=YES` and run `pnpm deploy:contract`.

The canonical frozen deployment is `0xE4081A4E9CD3A6eAc9Ce59f858257E1dee384986`; deployment transaction [`0x06070a…7421`](https://genlayer-explorer.vercel.app/tx/0x06070af739d7bc61b60c6e43ae71b6b301582207c18f86ebcf971579d23d7421) is `FINALIZED / FINISHED_WITH_RETURN`. The verified source SHA-256 is `2cded3b2849cbf7808ea91205520a24537895f66e68dc0a5e625e52ff99b510a`; authoritative `get_config` readback is `[0,3,3,4,3,259200]`. See [`deployments/studionet.json`](deployments/studionet.json).

The deploy script waits for `FINALIZED`, requires successful execution, verifies the sender, reads `get_config`, compares source, and writes a schema-checked manifest. It refuses to overwrite an existing manifest.

## Frontend deployment

Set `VITE_GENLAYER_NETWORK=studionet` and the canonical `VITE_MILESTONEPROOF_ADDRESS` from the verified manifest. Link the intended Vercel team/project and inspect `vercel whoami` without exposing `VERCEL_TOKEN`. After explicit production-deploy approval, deploy from the repository root with Vercel; `vercel.json` builds the monorepo and serves the SPA from `apps/web/dist`.

The verified production deployment is [milestoneproof-zeta.vercel.app](https://milestoneproof-zeta.vercel.app), built by Vercel as deployment `dpl_3tBYTdjsBMs8drpDFykieGFiM1NQ` from merged `main` commit `876d1d0ea987229d7cd8faa41e117dc45a1b6116`. The deployed UI rejected an identical sponsor/builder before submission, then wallet `0x21b4…2eC7` created project `17` through transaction [`0xe3002e…0b91`](https://explorer-studio.genlayer.com/tx/0xe3002e66b1d1cb3dab6320e8a4c9f8968191246d65fa40d62db0e6bfef500b91). The transaction is `FINALIZED / SUCCESS`; [production project readback](https://milestoneproof-zeta.vercel.app/projects/17) renders the frozen title, actors, `OPEN` milestone, canonical contract, and authoritative-readback state. Exact metadata is in [`deployments/vercel-production.json`](deployments/vercel-production.json).

## Usage

1. Connect the sponsor wallet on GenLayer Studionet and create a project with frozen criteria and builder.
2. Connect the frozen builder wallet and submit one to four public evidence items.
3. Sponsor or builder resolves the submission through GenLayer consensus.
4. Wait for execution success and authoritative contract readback before relying on the verdict.
5. Use resubmit, supplement, retry, or permissionless expiry only when the recorded state allows it.

## Verification evidence

Fresh local and production verification on 2026-08-25 produced:

- `pnpm lint`: GenVM validation (16 methods) and ESLint passed;
- `pnpm typecheck` and `pnpm build`: passed; production UI built from 2,091 modules;
- `pnpm test`: 210 contract tests plus direct runtime probe, 7 shared tests, and 111 web tests passed;
- local Playwright: 3 passed, 1 live test correctly skipped without confirmation flags;
- authorized live Playwright recorded on 2026-08-24: 1 passed in 2.7 minutes, covering create, unrelated-wallet denial, builder submission, sponsor resolution, terminal suppression, and next-milestone readback;
- contract live E2E recorded on 2026-08-24: authorized rejection plus approved happy path are preserved in [`deployments/studionet-live-e2e.json`](deployments/studionet-live-e2e.json).
- Vercel production smoke: deployment `READY`; project `3` readback rendered `APPROVED`; the identical-party form branch was rejected before submission; a wallet-signed create transaction finalized successfully and production readback rendered project `17` as `ACTIVE` with milestone `OPEN`.

Exact transaction and readback evidence is mapped in [the proof matrix](docs/evidence/proof-matrix.md).

## Known limitations

- Studio queued one identical V8 deployment before its delayed UI state refreshed; `deployments/studionet-v8-duplicate.json` records it for transparency, but the frontend and canonical manifest use only `0xE408…4986`.
- Studionet funding in live E2E uses the network simulation method and is explicitly Studionet-only.
- The contract header pins the tested GenLayer runner; the linter currently reports that a newer runner is available, so upgrades require a fresh compatibility review.
- A frozen-contract defect requires successor deployment and manual recreation of unfinished projects; see [the recovery runbook](docs/recovery.md).
- The UI supports one configured contract deployment at a time; historical addresses remain readable through their original explorer/manifest links.
