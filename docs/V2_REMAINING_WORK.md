# V2 remaining work

Last reconciled: 2026-07-18

This checklist contains only unfinished V2 work across `proof-of-presence`, `closer-api`, `closer-ui`, operations,
security, and rollout. Completed work and accepted/deferred design decisions are recorded in
[`V2_REMEDIATION_IMPLEMENTATION.md`](./V2_REMEDIATION_IMPLEMENTATION.md) and the detailed phase plans; they are not
repeated here.

Statuses are `DECISION`, `READY`, `IN PROGRESS`, and `BLOCKED`. Release gates are:

- **Gate A:** unresolved product decisions;
- **Gate B:** contracts and deployment tooling;
- **Gate C:** API and UI integration;
- **Gate D:** production readiness and rehearsal;
- **Gate E:** pilot rollout.

## 1. Shared decision

### DEC-01 — Persistent CommunityToken approval

- **Status:** `DECISION`; **Gate:** A; **Repositories:** `closer-api`, `closer-ui`.
- Choose either permit-first with exact approval fallback and no persistent approval, or add a separate explicit
  opt-in “remember approval” action with allowance visibility, risk explanation, and revoke support.
- **Recommendation:** do not create unlimited approval during deployment, account setup, or ordinary booking.
- **Complete when:** API/UI implement the selected behavior and cover permit, exact/existing approval, rejection,
  expiry, and revocation.

## 2. `proof-of-presence`

### POP-DEP-08 — Finish automatic verification on a live Celo network

- **Status:** `IN PROGRESS`; **Gate:** B.
- Rehearse Celo Sepolia explorer/provider classification, implementation and proxy verification/linking, failure
  recording, and retry by the same Ignition deployment ID.
- Confirm that verification failure never invalidates or repeats a successful deployment.
- **Complete when:** a recorded Celo Sepolia run proves initial verification, retry/recovery, and proxy presentation.

### POP-UPG-01 — Rehearse a Safe-owned V2 upgrade on Celo Sepolia

- **Status:** `IN PROGRESS`; **Gate:** B.
- Rehearse a complete Safe-owned upgrade on Celo Sepolia, including optional reinitializer calldata and verification
  retry. Rollback support is not required for the initial release.
- **Complete when:** the live rehearsal leaves the manifest consistent with the proxy slot and implementation
  bytecode, and verification can be retried without repeating the upgrade.

### POP-SEC-01 — Close pre-audit review items

- **Status:** `IN PROGRESS`; **Gate:** D; **Depends on:** final Gate B implementation.
- Triage the current advisory Slither output. Fix project-specific findings or document a narrow disposition; keep
  OpenZeppelin/ERC-7201 and Solidity-0.8.35 analyzer limitations separate from actionable findings.
- Resolve the development/deployment-tool dependency audit: move direct `luxon` to a patched compatible 3.x release,
  take safe upstream parent-package/lockfile updates where available, and record any remaining non-production
  transitive exceptions in [`DEPENDENCY_POLICY.md`](./DEPENDENCY_POLICY.md). Do not use broad forced resolutions only
  to silence the report.
- Freeze the reviewed contract/deployment scope for the independent audit.
- **Complete when:** every static-analysis and dependency finding has a reviewed disposition and the audit revision is
  immutable.

## 3. `closer-api`

Detailed integration design:
[`PHASE_3_CROSS_REPOSITORY_INTEGRATION.md`](./PHASE_3_CROSS_REPOSITORY_INTEGRATION.md).

### API-MAN-01 — Add manifest ingestion and explicit V1/V2 routing

- **Status:** `READY`; **Gate:** C.
- Validate schema/config hash, retain immutable manifest history, key deployments by chain/village/profile, and expose
  proxy addresses plus matching ABIs to consumers.
- Never infer generation from an address or shared ABI.
- **Complete when:** malformed/colliding manifests are rejected and no V2 runtime path uses static V1 diamond config.

### API-DEP-01 — Add the isolated one-click deployment worker

- **Status:** `BLOCKED`; **Gate:** C; **Depends on:** API-MAN-01 and completed Gate B workflows.
- Invoke the validated village wrapper with separate deployer/Safe-proposer secrets; resume by Ignition deployment ID
  and config hash; synchronize Safe, verification, and on-chain reconciliation state.
- Never activate `pending-owner-actions` deployments, including a TDF deployment whose required transfer-policy
  counterparty configuration has not executed.
- Persist immutable logs, source revision, command outcome, manifest, and deployment provenance; never accept private
  keys through HTTP/browser input.
- **Complete when:** interruption, duplicate request, Safe pending/execution, verification outage, and publication are
  idempotent in integration tests.

### API-WEB3-01 — Add manifest-derived V2 clients

- **Status:** `BLOCKED`; **Gate:** C; **Depends on:** API-MAN-01.
- Add separate VillageAccess, CommunityToken, TokenizedStays, Presence, Sweat, and policy clients; verify chain ID and
  the operator's live role before writes.
- **Complete when:** explicit `legacy-v1` and `village-v2` configurations work side by side without cross-generation
  imports.

### API-BOOK-01 — Implement V2 entitlement and pricing synchronization

- **Status:** `BLOCKED`; **Gate:** C; **Depends on:** API-WEB3-01.
- Submit `{year, dayOfYear, pricePerDate}` inputs with no on-chain booking status. Keep inventory, room assignment,
  confirmation, and check-in in the booking database.
- Support different integer prices per date, including zero, and persist the transaction hash before confirmation.
- **Complete when:** variable/zero price, conflict, pause, balance/allowance, calendar, refresh, and idempotent retry
  cases pass.

### API-AUTH-01 — Implement the selected permit/approval policy

- **Status:** `BLOCKED`; **Gate:** C; **Depends on:** DEC-01 and API-WEB3-01.
- Support existing allowance, EIP-2612 domain/nonce/deadline validation, exact approval fallback, and the selected
  persistent-approval behavior without V1's implicit allowance override.
- **Complete when:** rejection/expiry, unsupported wallet, insufficient/existing allowance, revocation, and retry are
  distinct tested states.

### API-CAN-01 — Synchronize V2 cancellation

- **Status:** `BLOCKED`; **Gate:** C; **Depends on:** API-BOOK-01.
- Define user cancellation versus idempotent manager `cancelBookingsFor`; keep failed entitlement sync separate from
  the off-chain lifecycle and never call removed confirmation/check-in functions.
- **Complete when:** user, manager, already-canceled, past-date, missing-entitlement, retry, and mismatch paths pass.

### API-TOK-01 — Migrate Presence/Sweat and operator jobs

- **Status:** `BLOCKED`; **Gate:** C; **Depends on:** API-WEB3-01.
- Resolve proxies from manifests, verify narrow roles, preserve mint/burn provenance and idempotency, and respect the
  accepted trusted-age and immutable-live-decay-rate constraints.
- **Complete when:** retries cannot double mint/burn and role loss, wrong chain, partial batch failure, and proxy
  upgrade cases pass.

### API-EVT-01 — Add V2 event indexing and reconciliation

- **Status:** `BLOCKED`; **Gate:** C; **Depends on:** API-MAN-01.
- Index booking, deposit, withdrawal, pruning, reconciliation, and orphan-recovery events by
  `(chainId, contract, transactionHash, logIndex)` with Celo finality, reorg rollback, backfill, and proxy-upgrade ABI
  boundaries.
- **Complete when:** duplicate delivery, reorg, missed range, cancellation/rebooking, pruning, leap day, and upgrade
  cases pass.

### API-TEST-01 — Add the complete backend V2 integration suite

- **Status:** `BLOCKED`; **Gate:** C; **Depends on:** all API items above.
- Require manifest routing/rejection, deployment/Safe/verification states, booking authorization and cancellation,
  token jobs, calendar boundaries, event reorgs, and retry/idempotency tests in API CI.

## 4. `closer-ui`

### UI-WEB3-01 — Add manifest-derived typed V2 clients

- **Status:** `BLOCKED`; **Gate:** C; **Depends on:** API-MAN-01.
- Resolve every V2 address/ABI from the selected village manifest, retain an explicit legacy client, and block
  reads/writes on the wrong chain.

### UI-BOOK-01 — Replace the V1 booking hook with the V2 entitlement flow

- **Status:** `BLOCKED`; **Gate:** C; **Depends on:** UI-WEB3-01 and API-BOOK-01.
- Submit backend-calculated per-date prices, including zero; preflight chain/calendar/balance/deposit/lock/pause state;
  parse V2 events/errors; and recover submitted transactions after refresh.

### UI-AUTH-01 — Implement permit-first approval UX

- **Status:** `BLOCKED`; **Gate:** C; **Depends on:** DEC-01 and API-AUTH-01.
- Request bounded permit, fall back to exact approval, implement the selected persistent option, display the spender,
  and keep signature/submission/mining/reconciliation states distinct.

### UI-LIFE-01 — Separate booking lifecycle from entitlement state

- **Status:** `BLOCKED`; **Gate:** C; **Depends on:** UI-BOOK-01.
- Keep backend lifecycle states while separately displaying entitlement states and mismatch/recovery. Remove controls
  that attempt V2 on-chain confirmation or check-in.

### UI-TOK-01 — Update V2 wallet and token views

- **Status:** `BLOCKED`; **Gate:** C; **Depends on:** UI-WEB3-01.
- Read CommunityToken, Presence, Sweat, deposits, paginated bookings, and summaries from separate proxies. Do not offer
  transfers/approvals for non-transferable points and avoid frequent holder-looping `totalSupply()` calls.

### UI-DEP-01 — Add village deployment administration

- **Status:** `BLOCKED`; **Gate:** C; **Depends on:** API-DEP-01.
- Show validated config, owner/Safe state, Ignition IDs, contract transactions, the owner-action batch, verification,
  final reconciliation, and accurate pending/interrupted/failure states; never expose private keys.

### UI-TEST-01 — Add the complete frontend V2 suite

- **Status:** `BLOCKED`; **Gate:** C; **Depends on:** all UI items above.
- Require generation selection, manifest clients, wrong-chain, booking/authorization/cancellation/calendar, receipt
  recovery, token views, and deployment-administration tests in UI CI while retaining legacy coverage.

## 5. Operations, security, and rollout

### OPS-01 — Pin and monitor external services

- **Status:** `READY`; **Gate:** D.
- Pin RPC, Safe Transaction Service, Celo explorer, and Sourcify endpoints per chain and alert separately on service
  outages and on-chain deployment failures.

### OPS-02 — Separate secrets, authority, and gas funding

- **Status:** `READY`; **Gate:** D.
- Separate and rotate deployer, Safe proposer, and API operator secrets; enforce bounded balances and gas alerts; add
  loss, compromise, role-removal, and emergency runbooks.

### OPS-03 — Make releases and deployment artifacts reproducible

- **Status:** `BLOCKED`; **Gate:** D; **Depends on:** final Gate B workflow.
- Require an immutable clean source revision; back up Ignition state and manifests outside the repository; prove a
  fresh worker can restore, reconcile, export, and resume without redeployment.

### OPS-04 — Add V2 operational monitoring

- **Status:** `BLOCKED`; **Gate:** D; **Depends on:** API-DEP-01 and API-EVT-01.
- Monitor Safe actions, deployment/reconciliation, owner/role drift, upgrades, pause and transfer-policy changes,
  deposit/orphan anomalies, index lag/reorgs, and operator gas; attach a tested runbook to every alert.

### SEC-01 — Obtain an independent smart-contract audit

- **Status:** `BLOCKED`; **Gate:** D; **Depends on:** POP-SEC-01 and code/deployment freeze.
- Audit Solidity, UUPS validation and upgrades, role/Safe authority, TDF transfer policy, booking deposits/locks, decay
  limitations, Ignition/recovery/verification, and manifest trust boundaries.
- **Complete when:** high/critical findings are fixed and retested and lower findings are fixed or explicitly accepted.

### REL-01 — Rehearse the complete V2 flow on Celo Sepolia

- **Status:** `BLOCKED`; **Gate:** D; **Depends on:** Gates B and C plus OPS-01 through OPS-04.
- Deploy every profile/owner mode; interrupt/resume; execute and reconcile the Safe batch; verify; import the manifest;
  book/cancel; mint/burn Presence/Sweat; index events; and execute a validated Safe-owned upgrade.
- Include RPC/explorer/Transaction-Service outages and manifest restoration; retain signed configs, IDs, manifests,
  transactions, verification results, alerts, and deviation resolutions.

### REL-02 — Operate one pilot village before broad rollout

- **Status:** `BLOCKED`; **Gate:** E; **Depends on:** Gate D and SEC-01.
- Define pilot success/error-budget criteria, retain explicit V1 routing, and review incidents, gas, indexing,
  approvals, authority state, and support load before broader activation.
