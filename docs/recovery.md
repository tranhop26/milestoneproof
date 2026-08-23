# Frozen-contract recovery

MilestoneProof is `INTENTIONALLY_FROZEN`. Recovery never mutates or redirects the old contract.

1. Freeze new writes in the UI by removing `VITE_MILESTONEPROOF_ADDRESS` from the deployed frontend environment and redeploying the disabled configuration. Keep the old address visible as read-only context.
2. Preserve the old deployment manifest, transaction link, source SHA-256, and verification evidence unchanged.
3. Diagnose the defect, patch a successor contract, and document the affected states and migration limits.
4. From a clean install, rerun lint, typecheck, build, all direct tests, integration tests, secret scan, and deployment dry-run.
5. Present the candidate commit, network, derived deployer address, source hash, and exact deployment action. Deploy only after explicit action-time confirmation.
6. Verify `FINALIZED`, successful execution, deployed source, `get_config` readback, and the transaction sender. Publish a new immutable successor manifest; never overwrite the old one.
7. Update the frontend to the successor address only after a separate Vercel team/project and production-deploy confirmation.
8. Recreate unfinished projects manually on the successor contract with the same frozen terms where still valid. Record predecessor and successor project/address links in project documentation.
9. Keep old results, manifests, transaction links, and read-only explorer records linked and readable. Never imply that old verdicts moved or were rewritten.

Completed projects remain historical records on the old contract. There is no automatic migration, privileged upgrade, custody transfer, or refund path because the MVP holds no funds.
