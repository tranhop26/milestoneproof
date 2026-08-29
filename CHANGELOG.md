# Changelog

All notable MilestoneProof changes are recorded here. Dates use UTC.

## 2026-08-29 — Explorer release polish

### Added

- Added a contract-backed **Projects** dashboard that combines the connected wallet's sponsor and builder indexes, deduplicates project IDs, and reads every displayed project from the Intelligent Contract.
- Added Sponsor and Builder role filters, truthful empty/loading/error/network states, responsive project cards, and direct workspace links.
- Added read-only browser coverage for the dashboard on desktop and mobile, including console-warning and horizontal-overflow checks.
- Added this changelog and a copy-ready Explorer submission evidence package.

### Changed

- Replaced the `/projects` placeholder with the authoritative project index.
- Enabled the supported React Router migration flags to remove application-controlled future warnings.
- Configured local read-only browser tests against the public canonical Studionet address; state-changing live tests remain separately confirmation-gated.

### Contract and deployment impact

- No Intelligent Contract code changed and no contract redeployment is required.
- The canonical contract remains `0xE4081A4E9CD3A6eAc9Ce59f858257E1dee384986` on Studionet with classification `INTENTIONALLY_FROZEN`.
- GitHub and Vercel production publication remain pending explicit action-time identity confirmation.

## 2026-08-25 — Verified production MVP

- Published the backend-free React/Vite frontend and verified it against the canonical Studionet contract.
- Recorded a wallet-signed production project creation and authoritative project `17` readback.
- Preserved contract deployment, live lifecycle, production, recovery, and proof-matrix evidence.
