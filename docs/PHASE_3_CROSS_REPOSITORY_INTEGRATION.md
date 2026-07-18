# Phase 3 cross-repository integration

Date: 2026-07-17

> This document defines the cross-repository integration behavior. The authoritative checklist and status for all
> remaining work is [`V2_REMAINING_WORK.md`](./V2_REMAINING_WORK.md); update task status there.

## Purpose

This document lists the work required outside `proof-of-presence` to consume V2 village deployments safely. It covers
the known `closer-api` and `closer-ui` integration points and the operational boundary around deployment manifests,
Safe owner actions, verification, and event indexing.

The rollout should keep an explicit `legacy-v1` versus `village-v2` generation switch. Do not infer the generation
from an address or attempt to use one ABI for both systems.

## Unresolved decision: persistent CommunityToken approval

Before implementing the V2 booking transaction flow, product and security owners must decide whether the UI should
offer a persistent `MaxUint256` CommunityToken allowance to `TokenizedStays`.

This is not required by the contracts. The preferred default remains EIP-2612 permit for the exact booking need, with
an exact standard `approve` transaction as fallback. A persistent allowance saves future signatures/approval
transactions, but increases the amount exposed if the TokenizedStays proxy, its upgrader, or an authorized booking
path is ever compromised or misconfigured.

The unresolved choices are:

1. **No persistent approval:** use a short-lived permit or exact allowance for each booking. This minimizes standing
   authority and is the recommended security default.
2. **Explicit opt-in persistent approval:** allow `MaxUint256` only behind a clearly labeled “remember approval”
   choice that displays the spender/proxy address, explains the risk, and provides allowance visibility and a revoke
   action.

Do not silently create an unlimited approval during deployment, account setup, or a booking. Do not reproduce V1's
token-level allowance override. Record the final product decision in the API/UI implementation before the V2 booking
flow is accepted.

## Shared contract and manifest model

The deployment manifest produced by this repository is the source of truth for:

- chain ID, network, village slug, and deployment profile;
- Ignition deployment ID and selected contract/profile Module IDs;
- proxy and implementation addresses;
- contract ABIs and product aliases;
- final owner/Safe and API operator;
- exact roles granted to the API operator;
- pending owner actions and the single prepared Safe transaction;
- informational manual ownership-acceptance calls in deployer-handoff mode;
- Safe Transaction Service proposal, confirmation, and execution status;
- verification status and deployment provenance.

The backend should validate the manifest schema and config hash, persist the original immutable JSON in durable object
storage, and import a queryable projection into its database. UI configuration should be served from that projection
or a generated export. Hand-maintained address/ABI files must remain only for legacy V1.

## `closer-api`

### 1. Manifest ingestion and village configuration

- Add a versioned manifest-ingestion path for trusted deployment workers.
- Key records by `(chainId, villageSlug, deploymentProfile)` and reject config-hash/address collisions.
- Store both proxy and implementation addresses, but expose proxy addresses to application consumers.
- Validate runtime chain ID before activating a manifest.
- Do not mark a direct-owner deployment operational while `status` is `pending-owner-actions`.
- A deployer-handoff manifest is complete once configuration is verified and every transfer is initiated. Treat it as
  operational only after the product independently confirms that the final owner accepted every `manualActions` item.
- Keep immutable manifest history so upgrades and ownership changes are auditable.
- Replace the static V1 diamond/address configuration in `contracts/mainnet.js` and `contracts/testnet.js` for V2
  villages with manifest-derived configuration.

### 2. Deployment orchestration

- Generate strict `VillageDeploymentConfig` JSON from authenticated village-admin input.
- Run deployments in an isolated worker with a per-environment deployer key; never accept private keys in HTTP input.
- Treat `(chainId, villageSlug, configHash)` as the product idempotency key and persist the corresponding stable
  Ignition deployment ID. Resume that deployment ID after timeouts rather than creating a new one.
- Persist deployment logs, Ignition deployment ID, manifest path, source revision, and command outcome.
- Invoke the validated `deploy:village` wrapper. Do not bypass its OpenZeppelin preflight by calling a raw Ignition
  Module from an API request.
- If direct-Safe owner actions exist, call `owner:submit` using only the designated proposer key, then poll/synchronize
  Transaction Service state. Do not collect the other Safe owners' keys.
- After the Safe transaction executes, rerun deployment reconciliation before reporting `complete`.
- For deployer handoff, surface every manual acceptance call and verify final authority before activating the
  deployment; do not route those calls through `owner:submit` or treat them as tracked deployment actions.
- Run verification by Ignition deployment ID through the shared `verify:village` wrapper and expose provider-specific
  results without converting a verification outage into a failed deployment. Do not implement a second verifier in
  the backend.
- Publish the manifest/export to UI consumers only after schema validation and on-chain reconciliation.

### 3. Booking and deposit verification

Update `utils/stays/tokenStakeOnChainSync.js` for the V2 `TokenizedStays` ABI:

- use the manifest's `TokenizedStays` proxy instead of `BLOCKCHAIN_DAO_DIAMOND_ADDRESS`;
- normalize `BookingView` as `{ year, dayOfYear, pricePerDate }`; there is no on-chain `status` or timestamp;
- keep workflow status, confirmation, check-in, inventory, and room assignment entirely in the booking database;
- treat booking conflict/missing/past/horizon/date, paused-contract, and allowance/permit failures as distinct errors;
- map UI dates to Gregorian UTC `(year, dayOfYear)` values and use the contract helpers for shared test vectors;
- accept day 366 only in a Gregorian leap year;
- submit and verify one `BookingInput` per date, including its independently calculated `pricePerDate`;
- do not skip the on-chain transaction merely because the price is zero when an entitlement record is required;
- record transaction hash, block number, wallet, dates, per-date price, chain ID, and TokenizedStays address on the
  booking/payment ledger.
- use `getBooking` for a single date, `getBookings` for paginated year windows, and `getDepositState` for the user's
  deposited/locked/unlocked summary;
- use `requiredLockedBalanceAt` only for current or future projections within the contract's retained horizon.

The contract accepts a separate `pricePerDate` for every date, so the backend's existing per-night split and one-wei
remainder can be represented exactly. Zero is encoded distinctly from a missing booking and returned decoded by the
contract getters.

### 4. Cancellation synchronization

- A user wallet may call `cancelBookings` for its own future entitlement.
- The API operator may call `cancelBookingsFor` only when it has `BOOKING_MANAGER_ROLE`.
- Decide which off-chain cancellation transitions trigger the manager transaction and make the operation idempotent.
- Do not treat a failed on-chain cancellation as proof that the off-chain booking itself must stay active; record and
  surface synchronization state separately from the booking lifecycle.
- Never attempt on-chain confirmation or check-in calls in V2; those functions no longer exist.

### 5. API-operator transactions and token jobs

- Store the per-village API-operator key in the existing encrypted secret system and bind it to chain ID and village.
- Before sending a transaction, verify the operator still has the required role in `VillageAccess`.
- Update presence and sweat jobs to resolve `VillagePresenceToken` and `VillageSweatToken` proxies from the manifest.
- Preserve the current `mintBatch` input shape, but record per-item provenance so retries cannot double mint.
- Confirm the selected operator has `BOOKING_PLATFORM_ROLE` or `BOOKING_MANAGER_ROLE`; it does not need ownership or
  implementation-upgrade authority.
- Keep burn-age provenance as an acknowledged limitation until the decay model is upgraded.
- Review token-stat and sweat calculations that currently scan V1 TDF transfers; restricted V2 transfer events may
  represent a different economic signal.

### 6. Event indexing and reconciliation

- Index `BookingCreated`, `BookingCanceled`, `BookingPruned`, `BookingBalanceReconciled`, `Deposit`, `Withdrawal`, and
  `OrphanedTokensRecovered` from the deployment block.
- Use `(chainId, contract, transactionHash, logIndex)` as the event idempotency key.
- Wait for the chosen Celo finality depth and support reorg rollback.
- Events provide entitlement history, not off-chain workflow-status history.
- Periodically reconcile indexed state against `getBooking`, `getDepositState`, `totalDepositedBalance`,
  `orphanedTokenBalance`, and deployment owner/role invariants.
- Track proxy upgrades and switch ABI interpretation at the effective implementation block when an upgrade changes
  emitted events.

### 7. Backend tests

- V1/V2 configuration routing and manifest-schema rejection.
- Zero-price entitlement creation.
- Permit and explicit-approval booking verification.
- Leap-day and timezone-boundary dates.
- Existing-date conflict and canceled-date rebooking.
- User and manager cancellation synchronization.
- Safe states: not proposed, awaiting confirmations, ready to execute, executed, failed, and reconciled complete.
- RPC timeout/retry without duplicate deployment or duplicate minting.
- Explorer-verification failure without deployment rollback.

## `closer-ui`

### 1. Manifest-derived configuration

- Replace the V2 use of static `BLOCKCHAIN_DAO_DIAMOND_ADDRESS` and the large static diamond ABI with the selected
  village manifest/export.
- Expose separate typed clients for `CommunityToken`, `TokenizedStays`, `VillageAccess`, Presence, and Sweat.
- Require the connected wallet chain ID to match the manifest before enabling reads or writes.
- Retain the old configuration path behind the explicit `legacy-v1` generation switch during migration.

### 2. Booking transaction flow

Update `packages/closer/hooks/useBookingSmartContract.js` or replace it with a typed V2 hook:

- remove pending-status replacement logic and all reads of `booking.status`;
- allow zero-price entitlement transactions;
- treat an existing active date as `BookingConflict` rather than overwriting it;
- submit each backend-calculated per-date price as integer token units;
- preflight the Gregorian date, rolling horizon, connected chain, wallet balance, current deposit/lock state, and contract pause;
- call the V2 TokenizedStays proxy, never the legacy diamond address;
- update receipt parsing for V2 events and custom errors;
- preserve the transaction hash in the backend ledger before waiting for confirmation so refresh/recovery is possible.

### 3. Permit and approval UX

Preferred flow:

1. Read existing CommunityToken allowance for TokenizedStays.
2. Calculate a conservative maximum fresh-token amount required by the booking.
3. If allowance is insufficient, request an EIP-2612 permit signature from the user.
4. Submit `createBookingsWithPermit` with a short deadline, correct chain ID, token name/domain, current nonce, and
   permit amount.
5. If permit signing is unsupported or rejected, offer standard `approve` followed by `createBookings`.

Whether to offer an optional “remember approval” choice is intentionally unresolved. If product and security owners
approve it, it may use `MaxUint256`, but it must be explicit, explain that TokenizedStays can pull CommunityToken up
to that allowance, show the spender address, and provide a revoke/reset action. Do not recreate V1's token-level
allowance override.

Permit signatures and rejected wallet prompts are not failed on-chain transactions. Keep signature, submission,
mining, and backend-reconciliation states separate in the UI.

### 4. Booking lifecycle UX

- Continue displaying backend `draft`, `pending`, `confirmed`, `paid`, `cancelled`, check-in, and check-out states.
- Do not derive those states from TokenizedStays.
- Display on-chain entitlement synchronization as a separate state such as `not-required`, `awaiting-wallet`,
  `submitted`, `confirmed`, `mismatch`, or `cancellation-pending`.
- Remove any UI controls that attempt V2 on-chain confirm/check-in operations.

### 5. Wallet and token views

- Read CommunityToken, Presence, Sweat, deposit state, paginated bookings, and year summaries from their separate V2
  proxy addresses.
- Do not assume Presence/Sweat are transferable or approvable.
- Avoid frequent `totalSupply()` polling for decaying tokens because it loops over all historical holders.
- Make the Sweat/Contribution product alias display-only; use `VillageSweatToken` as the contract key.

### 6. Village deployment administration UI

- Build the configuration form from the versioned deployment-config schema.
- Show ownership mode, final owner type, Safe address, owners/threshold, API operator, enabled modules, treasury, and
  restrictions before submission.
- Display deployment transactions separately from the single Safe owner-action transaction.
- Display the Ignition deployment ID and distinguish the selected village profile from its composed contract Modules.
- Show Safe proposal link/hash, confirmation count, threshold, execution result, and final on-chain reconciliation.
- Show explorer/Sourcify verification per proxy and implementation.
- Warn clearly for EOA ownership and for deployer handoff's still-unaccepted manual actions.
- Never expose deployer, API-operator, or Safe-owner private keys to the browser.

### 7. Frontend tests

- V1/V2 client selection and wrong-chain blocking.
- Zero-price booking.
- Permit success, permit rejection, expired permit, explicit approval fallback, and optional maximum approval.
- Booking with a sufficient existing unlocked deposit and therefore no token pull.
- `BookingConflict`, pause, insufficient balance, allowance, and wallet-rejection errors.
- Leap-day date encoding in the configured village timezone.
- Refresh/recovery after transaction submission but before receipt.
- Safe deployment progress and failed explorer verification display.

## Operations and release engineering

- Pin and monitor RPC, Safe Transaction Service, Celo explorer, and Sourcify endpoints per chain.
- Keep deployer, Safe proposer, and API operator as separate secrets and rotate them independently.
- Fund deployer/API operator addresses with bounded gas budgets and alert on low balance.
- Require an immutable source revision and clean production build for deployments.
- Back up manifests outside the contracts repository and test restoration.
- Rehearse the complete flow on Celo Sepolia: deploy, propose one Safe batch, collect threshold confirmations, execute,
  reconcile, verify, import manifest, book with permit, cancel, mint Presence/Sweat, and index events.
- Add monitoring for pending Safe actions, failed reconciliation, role/owner drift, proxy upgrades, paused contracts,
  transfer-policy changes, deposited-balance invariant failures, and orphaned-token anomalies.

## Recommended rollout order

1. Implement manifest ingestion and explicit V1/V2 configuration routing in the API.
2. Update API on-chain reads and event indexing for the status-free TokenizedStays ABI.
3. Update API-operator Presence/Sweat and manager-cancellation transactions.
4. Add the UI's manifest-derived V2 clients and read-only views.
5. Add permit-first booking with explicit approval fallback and zero-price support.
6. Add deployment/Safe/verification administration surfaces.
7. Run the Celo Sepolia rehearsal and retain V1 rollback/configuration paths.
8. Activate one pilot village before broader rollout.

## Cross-repository completion criteria

- No V2 runtime path imports a legacy diamond address or ABI.
- The persistent CommunityToken approval decision is recorded and the selected exact/permit/opt-in behavior is tested.
- A manifest cannot become active until direct owner actions are executed and reconciled on-chain, or every manual
  deployer-handoff acceptance has been independently confirmed.
- One Safe MultiSend transaction contains every required final-owner action and is displayed before confirmation.
- Booking status remains fully functional off-chain while entitlement synchronization is independently observable.
- Zero-price, permit, approval fallback, cancellation, leap-day, retry, and event-reorg cases are tested.
- API operator, deployer, and Safe roles/ownership match the manifest after rollout.
- Proxy implementations and non-proxy contracts have recorded verification outcomes.
