# Verification proof matrix

Canonical contract: `0xE4081A4E9CD3A6eAc9Ce59f858257E1dee384986`. Source and readbacks are fixed in `deployments/studionet.json` and `deployments/studionet-live-e2e.json`; local fixtures do not receive invented transaction hashes.

| Actor | Action | Contract method | Transaction hash | FINALIZED/SUCCESS | Readback | Source/test |
|---|---|---|---|---|---|---|
| Sponsor | Create project with frozen builder and milestone | `create_project` | `0x670153bb6e1f20c598d3886d7f48017421eb815b42da5e2013efed876495b381` | `FINALIZED / FINISHED_WITH_RETURN` | Project `3`, frozen actor/criterion/source, milestone `OPEN` | `deployments/studionet-live-e2e.json` |
| Unauthorized wallet | Attempt builder-only evidence submission | `submit_evidence` | `0xe3e40db9b3c7babdb7819c63d7a98d1aa69bcafe602e4383d46d43b941f11bf0` | `FINALIZED / FINISHED_WITH_ERROR` | Project remains `ACTIVE`; milestone remains `OPEN`; current submission ID `0` | `deployments/studionet-live-e2e.json` |
| Builder | Submit release evidence | `submit_evidence` | `0x85e5603e510b7d6a7812a9a89996d7480844d8e989c05ae4519242142b0bae0b` | `FINALIZED / FINISHED_WITH_RETURN` | Submission digest recorded; milestone `SUBMITTED` | `deployments/studionet-live-e2e.json` |
| Sponsor | Resolve sufficient evidence | `resolve_submission` | `0x963c6a601c16a7c2b69272ed630989919d76c0281edf281e69aa6a8bcded9b68` | `FINALIZED / FINISHED_WITH_RETURN` | Verdict `APPROVED`; milestone and project `COMPLETED`; all integrity flags true | `deployments/studionet-live-e2e.json` |
| Browser actors | Create, deny unrelated wallet, submit, resolve, then reload | Same methods above | Fresh hashes rendered and linked by the UI | All promoted writes reached `FINALIZED`, `SUCCESS`, then `READBACK` | Second milestone displayed `OPEN` after reload | `apps/web/e2e/live.spec.ts`; authorized run: 1 passed in 2.7m |
| Production sponsor `0x21b4…2eC7` | Create a frozen project from the Vercel UI | `create_project` | `0xe3002e66b1d1cb3dab6320e8a4c9f8968191246d65fa40d62db0e6bfef500b91` | `FINALIZED / SUCCESS` | Project `17` is `ACTIVE`; milestone `0` is `OPEN`; title, actors, criterion, source, deadline, and canonical contract render from readback | `deployments/vercel-production.json`; `https://milestoneproof-zeta.vercel.app/projects/17` |
| Production sponsor `0x21b4…2eC7` | Attempt identical sponsor and builder | Client guard before contract submission | N/A | Rejected before signature | Error `Sponsor and builder must be different addresses.`; sponsor project count unchanged | Vercel production browser verification recorded in `deployments/vercel-production.json` |
| Local fixture | Render successful lifecycle without a chain transaction | adapter fixture | N/A | Simulated `FINALIZED` / `SUCCESS` | Simulated `READBACK`; one read call | `apps/web/e2e/live.spec.ts` successful receipt test |
| Local fixture | Reject failed execution before readback | adapter fixture | N/A | Simulated `FINALIZED` / no success | Zero readback calls | `apps/web/e2e/live.spec.ts` failed receipt test |

Repository: `https://github.com/tranhop26/milestoneproof`, deployed source commit `6da88e5c2e662adcb65c3500abad9895d3acd596`. Production: `https://milestoneproof-zeta.vercel.app`.
