# Remaining work

Last reconciled: 2026-07-20

The repository implementation and automated local test surface are complete for the current contract architecture.
The remaining work is release, live-network, security-review, and downstream integration work.

## Contract repository

- Rehearse automatic verification and retry behavior on Celo Sepolia, including proxy/implementation presentation and
  provider-specific failures.
- Rehearse a Safe-owned UUPS upgrade on Celo Sepolia, with optional reinitializer calldata and manifest reconciliation.
- Run the manual deep fuzz/invariant, ten-year scale, coverage, Aderyn, Wake, and targeted mutation suites against the
  release candidate.
- Triage every current static-analysis and OSV finding, then freeze an immutable audit revision.
- Obtain an independent audit covering contracts, storage/upgrades, authority, booking/deposit invariants, policy,
  deployment recovery, and manifest trust boundaries.

## Product decision

Choose whether the UI ever offers persistent CommunityToken approval. The recommended default is permit-first with an
exact approval fallback. If a persistent approval is offered, it must be explicit, explain the spender risk, show the
allowance, and provide revocation.

## API integration

- Add strict manifest/export ingestion with immutable history and chain/config collision checks.
- Add an isolated idempotent deployment worker that resumes Ignition state and separates deployer, Safe proposer, and
  API operator credentials.
- Build manifest-derived clients and verify live roles before every operator write.
- Synchronize variable/zero-price booking entitlements, deposits, cancellations, Presence/Sweat issuance, and retries
  without duplicating transactions.
- Index contract events with finality, reorg rollback, backfill, and upgrade ABI boundaries.

## UI integration

- Build manifest-derived typed clients and block actions on the wrong chain.
- Implement permit-first booking, exact approval fallback, zero-price dates, receipt recovery, and distinct on-chain
  versus off-chain lifecycle state.
- Read separate token/access/stays clients; do not expose transfer or approval controls for non-transferable tokens.
- Add deployment administration for config, Ignition progress, Safe actions, verification, handoff acceptance, and
  reconciliation without exposing secrets.

## Operations and rollout

- Pin and monitor RPC, Safe Transaction Service, explorer, and Sourcify endpoints per network.
- Separate and rotate deployer, Safe proposer, and API operator secrets; bound gas funding and document emergency
  authority runbooks.
- Prove a fresh worker can restore backed-up Ignition journals/manifests and resume without redeployment.
- Rehearse the complete deploy/Safe/verify/import/book/cancel/token/index/upgrade flow on Celo Sepolia, including
  external-service outages.
- Operate one audited pilot village with explicit success and error-budget criteria before broader rollout.
