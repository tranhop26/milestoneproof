# MilestoneProof — GenLayer Explorer submission

## Submission links

- Project: **MilestoneProof**
- Network: **GenLayer Studionet**
- Live app: https://milestoneproof-zeta.vercel.app
- GitHub: https://github.com/tranhop26/milestoneproof
- Intelligent Contract: `0xE4081A4E9CD3A6eAc9Ce59f858257E1dee384986`
- Deployment transaction: https://explorer-studio.genlayer.com/tx/0x06070af739d7bc61b60c6e43ae71b6b301582207c18f86ebcf971579d23d7421
- Production write proof: https://explorer-studio.genlayer.com/tx/0xe3002e66b1d1cb3dab6320e8a4c9f8968191246d65fa40d62db0e6bfef500b91
- Production readback: https://milestoneproof-zeta.vercel.app/projects/17

## Short description

MilestoneProof is a backend-free grant milestone verifier. A sponsor freezes the builder, ordered acceptance criteria, allowed public evidence sources, and deadlines on-chain. The builder submits repository, release, CI, or deployment evidence, and GenLayer validators semantically decide whether every frozen criterion is proven. The contract—not the frontend—records the verdict and advances, preserves, or fails the milestone.

## Why GenLayer is essential

Ordinary deterministic contracts cannot inspect and semantically compare public web evidence with natural-language acceptance criteria. MilestoneProof uses GenLayer nondeterministic execution for that decision while keeping authorization, deadlines, attempt limits, replay protection, state transitions, and authoritative readback deterministic and on-chain.

The deployed source uses `gl.vm.run_nondet_unsafe(evaluate_evidence, validate_evidence)`. This is the pinned and live-verified custom semantic path for the deployed GenLayer runner. Validators compare the normalized decision fields—verdict, `criteria_met`, `missing_criteria`, and integrity flags—while rationale is explanatory and excluded from equality. Invalid or conflicting semantic output becomes `UNRESOLVED`; it is never presented as approval.

## Trust model and lifecycle

1. Sponsor creates one to three frozen sequential milestones and selects a different builder address.
2. Only the frozen builder can submit evidence for the open milestone.
3. Sponsor or builder can trigger semantic resolution; permissionless expiry is allowed only when the recorded deadline/window permits it.
4. `APPROVED` opens the next milestone or completes the project. `REJECTED`, `REQUEST_MORE_INFO`, and `UNRESOLVED` preserve bounded recovery paths.
5. The UI promotes a write only after `FINALIZED`, successful execution, and authoritative contract readback.

MilestoneProof has no token custody, escrow, admin, proxy, owner mutation, or upgrade path. Its deployment classification is `INTENTIONALLY_FROZEN`.

## Contract evidence

- Canonical source path: `packages/contracts/milestoneproof.py`
- Final deployed-source commit: `6da88e5c2e662adcb65c3500abad9895d3acd596`
- Merged contract release commit: `876d1d0ea987229d7cd8faa41e117dc45a1b6116`
- Source SHA-256: `2cded3b2849cbf7808ea91205520a24537895f66e68dc0a5e625e52ff99b510a`
- Deployment transaction: `0x06070af739d7bc61b60c6e43ae71b6b301582207c18f86ebcf971579d23d7421`
- Deployment result: `FINALIZED / FINISHED_WITH_RETURN`
- `get_config` readback: `[0,3,3,4,3,259200]`
- Manifest: `deployments/studionet.json`

The deployment script verified the finalized transaction, execution result, deployer, source match, and configuration readback before writing the secret-free manifest.

## Live evidence already observed

- Contract live lifecycle: sponsor create, unrelated-wallet rejection, builder evidence submission, semantic approval, and terminal project readback are recorded in `deployments/studionet-live-e2e.json` with real transaction hashes.
- Production UI: wallet `0x21b4…2eC7` created project `17` in transaction `0xe3002e66b1d1cb3dab6320e8a4c9f8968191246d65fa40d62db0e6bfef500b91`; production then rendered `ACTIVE`, milestone `OPEN`, frozen actors and criteria, the canonical contract, and authoritative-readback state.
- Local fixture tests are labeled separately and do not receive invented transaction hashes.

## Frontend release evidence

- Current verified production commit: `876d1d0ea987229d7cd8faa41e117dc45a1b6116`
- Explorer-polish release commit: **PENDING FINAL RELEASE COMMIT**
- Current Vercel deployment: `dpl_3tBYTdjsBMs8drpDFykieGFiM1NQ`
- Final Explorer-polish Vercel deployment: **PENDING CONFIRMED PRODUCTION DEPLOYMENT**
- Release improvement: `/projects` now reads both actor indexes from the contract, deduplicates them, and renders only authoritative project records with role filters and fail-closed error handling.

## Verification status

The release candidate passed GenVM and web lint, all workspace typechecks, and a production build of 2,092 modules. Direct tests passed: 212 contract plus the runtime probe, 7 shared, and 122 web (341 tests total). Local Playwright passed 4 read-only/fixture tests with the 1 state-changing live test correctly skipped. `pnpm verify:contract` freshly reconfirmed the finalized successful deployment, source SHA-256, and `[0,3,3,4,3,259200]` configuration readback. The state-changing live suites were not rerun for this frontend-only release because existing contract evidence is preserved and no contract code changed.

## Known limitations

- `run_nondet_unsafe` is a runner-compatibility constraint of this deployed source. Migrating to another nondeterministic API or newer runner requires a new compatibility review, tests, and successor deployment; this submission does not claim that `run_nondet` is unavailable.
- A defect in the intentionally frozen contract cannot be upgraded in place; recovery requires a successor deployment and manual recreation of unfinished projects.
- The UI targets one configured contract at a time, and the Projects dashboard is wallet-indexed rather than a global project directory.
- Studionet simulation funding is used only by separately confirmed live E2E flows.

## Redeployment decision

**Contract redeployment required: No.** This release changes frontend discovery, browser coverage, and evidence documentation only. Preserving the canonical address also preserves verified source provenance and the existing live project history.
