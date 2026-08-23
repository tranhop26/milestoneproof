# Verification proof matrix

Live fields remain `PENDING` until an authorized Studionet deployment and deployed-site run produce independently checkable values. Local fixtures do not receive invented transaction hashes.

| Actor | Action | Contract method | Transaction hash | FINALIZED/SUCCESS | Readback | Source/test |
|---|---|---|---|---|---|---|
| Sponsor | Create project with frozen builder and milestones | `create_project` | `PENDING` | `PENDING` | `PENDING` project ID and frozen fields | Live browser E2E after deployment |
| Builder | Submit repository evidence | `submit_evidence` | `PENDING` | `PENDING` | `PENDING` submission ID, digest, and `SUBMITTED` milestone | Live browser E2E after deployment |
| Sponsor or builder | Resolve sufficient evidence | `resolve_submission` | `PENDING` | `PENDING` | `PENDING` `APPROVED` and next milestone `OPEN` | Live browser E2E after deployment |
| Unauthorized wallet | Attempt builder-only evidence submission | `submit_evidence` | `PENDING` | `PENDING` expected execution error | `PENDING` unchanged milestone/submission | Live browser E2E after deployment |
| Local fixture | Render successful lifecycle without a chain transaction | adapter fixture | N/A | Simulated `FINALIZED` / `SUCCESS` | Simulated `READBACK`; one read call | `apps/web/e2e/live.spec.ts` successful receipt test |
| Local fixture | Reject failed execution before readback | adapter fixture | N/A | Simulated `FINALIZED` / no success | Zero readback calls | `apps/web/e2e/live.spec.ts` failed receipt test |

Final evidence must also record repository URL, exact commit, Vercel URL, contract address, deployment transaction, explorer links, source SHA-256, command totals, browser viewport checks, console results, and remaining limitations.
