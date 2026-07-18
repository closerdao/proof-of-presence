# V2 Smart Contracts Review Feedback Follow-up

> **Superseded implementation status:** The later decisions and implemented remediation are recorded in
> [`V2_REMEDIATION_IMPLEMENTATION.md`](./V2_REMEDIATION_IMPLEMENTATION.md). Where the two documents conflict—most
> notably H-01 and H-05—the remediation document is authoritative. The later decision to use independently
> deployable/composable Hardhat Ignition Modules with mandatory OpenZeppelin validation supersedes this document's
> deployment-engine recommendations; see
> [`PHASE_3_DEPLOYMENT_ARCHITECTURE_PLAN.md`](./PHASE_3_DEPLOYMENT_ARCHITECTURE_PLAN.md). The reconciled authoritative
> checklist for unfinished work is [`V2_REMAINING_WORK.md`](./V2_REMAINING_WORK.md); the remaining-work list below is
> historical and must not be used for current status. Project-specific membership was subsequently removed from V2,
> so membership-specific recommendations below are retained only as review history.

Date: 2026-07-15

This document provides the complete response to the feedback recorded in
[`V2_REVIEW_RESPONSE.md`](./V2_REVIEW_RESPONSE.md). It covers every high- and medium-severity finding,
all additional notes, and incorporates the later decision for H-01 that booking discounts and the final booking price
will be calculated by the backend, with zero-price bookings allowed.

No code changes are described as already completed here. This is the recommended resolution and remaining-work record.

## High-severity findings

### H-01 — Backend-calculated booking price, with zero allowed

The decision makes sense: discounts and final stake pricing belong in the backend, and zero-price bookings should be
possible.

However, the user wallet currently calls `bookAccommodation` directly. The backend calculates the intended amount,
but the frontend transports it into user-controlled calldata. Backend verification happens only afterward.

Therefore, use a backend-signed EIP-712 booking authorization containing at least:

- user account;
- dates;
- price, including zero;
- booking/stay identifier;
- nonce;
- expiry;
- chain ID and `TokenizedStays` address through the EIP-712 domain.

The contract should verify that the authorization signer has an appropriate role. Zero should not be rejected—it
should require the same backend authorization as every other price.

This is a good use for OpenZeppelin's `EIP712Upgradeable`, `SignatureChecker`, and a nonce mechanism rather than custom
signature recovery.

Current integration discrepancies also need resolving:

- The UI explicitly refuses to send a zero-price booking.
- The API skips on-chain verification when nothing is owed, so a zero-price stay currently creates no on-chain booking.
- Duration discounts are applied to fiat accommodation pricing, but the token rental amount used for the on-chain
  stake appears to be calculated without that discount.

The remaining product decision is whether a free stay must still be represented on-chain. If yes, UI and API behavior
must change accordingly.

### H-02 — Changing `communityToken`

`CommunityToken` is UUPS-upgradeable. Its proxy address remains stable while its implementation can change.

Routine token fixes and improvements therefore do not require `TokenizedStays` to change its `communityToken` address.
Remove `setCommunityToken()` and fix the escrow token after initialization.

If a truly exceptional token migration is ever necessary, it should be an explicit migration procedure requiring:

- pause;
- known total liabilities;
- reconciliation of the old token balance;
- transfer or recreation of all claims;
- verification that the new token fully backs liabilities.

A general-purpose setter cannot safely accomplish that.

Tracking aggregate escrow liabilities is still worthwhile even with a fixed token, so deployment and invariant tests
can assert:

```text
communityToken.balanceOf(TokenizedStays) >= total recorded liabilities
```

### H-03 — Pausing and booking transitions

`TokenizedStays` should remain pausable. It holds user tokens and contains complex stake-release logic, so an emergency
stop is justified. V1 was also pausable: booking and both cancellation entry points used `whenNotPaused`; confirmation
and check-in did not.

The main problem is not simply missing `Pausable`. It is inconsistent transition authority:

- Users can currently cancel pending, confirmed, and even future checked-in bookings.
- Managers can cancel only pending bookings.
- Managers can check in a pending or far-future booking.
- There is no consistent transition or time-window validation.

Users and managers should not have identical permissions. The recommended baseline is:

| Action            | User                       | Booking manager                                                  |
| ----------------- | -------------------------- | ---------------------------------------------------------------- |
| Cancel pending    | Own booking, before cutoff | Any booking                                                      |
| Cancel confirmed  | Own booking, before cutoff | Any booking                                                      |
| Cancel checked-in | No                         | Only through a separate exceptional correction flow, if required |
| Confirm           | No                         | Pending → Confirmed only                                         |
| Check in          | No                         | Confirmed → CheckedIn only, within an allowed time window        |

The concrete cancellation cutoff and check-in window are product rules that should be documented before
implementation.

Implementation recommendations:

- Put all transition checks in one internal state-machine function.
- Reject invalid source/target combinations instead of silently doing nothing.
- Preserve canceled bookings as historical records.
- Decide whether pausing is financial-only or freezes all lifecycle changes. A conservative default is to pause
  ordinary state transitions as well, with any emergency correction being a separately named and audited admin
  function.

The manager should normally be able to cancel both pending and confirmed bookings. Checked-in cancellation should not
be part of the ordinary flow because it changes already-realized attendance and stake/accounting history.

### H-04 — `validateUpgrade` as a CI gate

A CI gate is a required automated check that must pass before code can be merged or released.

For example, CI would run something equivalent to:

```text
compile
validate initial implementations
validate every supported old → new implementation upgrade
upgrade state-preservation tests
```

If OpenZeppelin finds incompatible storage, missing initializer calls, unsafe operations, or another upgrade-safety
problem, the command exits unsuccessfully and CI blocks the PR.

`validateUpgrade` does not execute an upgrade. It statically validates a candidate implementation against a reference
implementation or deployed proxy.

Recommended changes:

- Add a Hardhat 3-compatible `@openzeppelin/hardhat-upgrades`.
- Use `deployProxy(..., { kind: "uups" })` for production proxy deployments.
- Run `validateImplementation` for initial implementation safety.
- Run `validateUpgrade` for every future implementation.
- Use `prepareUpgrade` for Safe-controlled upgrades, so the implementation is validated and deployed before a Safe
  proposal is created.
- Record the validation result, implementation bytecode hash, storage-layout diff, and reference version.
- Add initializer replay and implementation-lock tests.

OpenZeppelin confirms that `validateUpgrade` compares candidate storage compatibility without deploying or upgrading:
[OpenZeppelin Upgrades documentation](https://github.com/openzeppelin/openzeppelin-upgrades/blob/master/docs/modules/ROOT/pages/api-hardhat-upgrades.adoc).

“V1 reference contract” in this context means the first production version of the new V2 module—not the legacy
diamond.

### H-05 — Deployer/API owner checks and Safe owners

Keeping the deployer in control for a prototype can be acceptable. The danger is presenting that deployment as
independently governed or production-ready.

If the deployer is a Safe signer, compromising that deployer key may still contribute toward Safe control. If the API
operator is a signer and also holds operational roles, separation of duties becomes weaker. That is a problem only
when the deployment's security policy promises those identities have no governance authority.

Replace two loosely related booleans with an explicit policy such as:

```text
governancePolicy:
  prototype
  managed
  independent
```

Possible semantics:

- `prototype`: deployer/API ownership or Safe membership allowed; manifest visibly says non-production.
- `managed`: Closer may remain one Safe signer but not unilateral owner.
- `independent`: deployer and API operator cannot be direct owners or Safe signers.

If `checkFinalOwnerIsNotDeployer` and `checkFinalOwnerIsNotApiOperator` are retained, defaulting them to false is safe
only inside an explicitly marked prototype profile. A global false default is a production footgun.

Even when deployer/API Safe signers are allowed, the deployment should still read Safe owners and threshold to verify
that the Safe was configured as requested. Verification and policy rejection are different things.

Checking `safeVersion` is practical. The preferred implementation is not merely trusting a free-form version string:

- Resolve singleton, proxy factory, and fallback handler through `@safe-global/safe-deployments`.
- Match chain ID and requested version.
- Verify deployed addresses and available code hashes.
- Use Safe Protocol Kit to interact with the resulting Safe.

The registry exposes versioned network addresses and code hashes:
[Safe deployments documentation](https://github.com/safe-global/safe-deployments/blob/main/README.md).

### H-06 — TDF policy, treasury, allowlists, and deterministic deployment

Currently, `TokenizedStays` is the contract that needs to receive and return community tokens:

```text
user → TokenizedStays     deposit or booking top-up
TokenizedStays → user     withdrawal
```

Presence and Sweat tokens are separate point contracts and do not receive community tokens.

Future sale, marketplace, migration, or other escrow contracts may also require allowlisting, but they should be added
only when those modules exist.

For TDF V2 with tokenized stays, the `TokenizedStays` proxy must be an allowed counterparty.

V1 had three relevant behaviors:

- Transfers from/to the diamond were allowed.
- Transfers from the treasury were allowed.
- The diamond was reported as having unlimited allowance over every holder's TDF, even without a normal approval.

The unlimited allowance belonged to the DAO/diamond, not the treasury.

Keep `treasury` as a separate semantic address rather than representing it only as a generic counterparty. It makes
intent, configuration, events, manifest data, and future treasury replacement clearer. Note that V1 allowed transfers
_from_ treasury, while V2 currently permits both transfers to and from treasury; confirm whether that expansion is
intended.

There is no policy/token circular dependency: the policy needs only its treasury and owner. Ignition can therefore
pass its deployment Future directly into the token initializer without deterministic address prediction. The
deployment order is:

1. Deploy `VillageAccess`.
2. Deploy `TDFTransferPolicy` with restrictions enabled.
3. Initialize `CommunityToken` with the deployed policy Future.
4. Deploy `TokenizedStays`.
5. Configure `TDFTransferPolicy` with `TokenizedStays` allowed.
6. Verify deposit, booking, cancellation, and withdrawal.
7. Mark the deployment complete.

If Safe execution is required for step 5, the manifest remains pending until the Safe batch executes. Ordinary token
transfers remain restricted throughout that pending period.

### H-07 — `setRoleAdmin`

Changing `setRoleAdmin` to require `DEFAULT_ADMIN_ROLE` is safe for the intended flows.

It does not prevent `MEMBERSHIP_MANAGER_ROLE` from adding or removing members. It only prevents lower-level operators
from rewriting who administers roles.

The clean options are:

- Remove public `setRoleAdmin` entirely if the hierarchy is fixed; or
- Retain it with `onlyRole(DEFAULT_ADMIN_ROLE)` for extensibility.

The current deployment code does not depend on a lower-level role calling it, so this should not break deployment or
normal role management. Add tests proving:

- membership managers can still manage members;
- membership managers cannot change role administration;
- the default admin can recover every configurable hierarchy;
- self-admin cycles cannot be introduced by operators.

### H-08 — Age-specific burning

This behavior is substantially inherited from V1, but parity with V1 does not make it safe.

Exact correction of a historical award may require knowing the age of the tokens being removed. The problem is that
the contract accepts `daysAgo` without proving that the burned raw tokens came from a mint of that age.

For example, an operator can burn recently minted raw tokens while claiming they are old. The contract may burn 100
raw units but subtract only 90 decayed units, leaving a positive displayed decayed balance backed by zero raw balance.

If exact historical correction is required, use this model:

- Assign mint lots/checkpoints an immutable ID and issuance timestamp.
- Store the remaining raw amount for each lot.
- Make burning reference actual lot IDs.
- Have the contract derive age and decayed value from stored timestamps.
- Never accept an unverifiable caller-supplied age.

To keep gas bounded, burns should specify a limited set of lot IDs rather than making the contract scan every
historical lot.

If exact lot correction is unnecessary, the simpler model is proportional burning:

```text
decayed amount removed =
    current decayed balance × raw amount burned / current raw balance
```

That loses lot-specific semantics but preserves ledger consistency. Given the stated requirement, use actual stored
mint lots or correction IDs, followed by invariant and fuzz tests.

### H-09 — Fractional-day loss and rate changes

There are two separate issues.

First, elapsed fractional days are discarded whenever mint or burn resets the checkpoint.

Example:

1. User has 100 points.
2. Twenty-three hours pass—not yet one complete day.
3. One point is minted.
4. The contract calculates zero elapsed days and resets the timestamp.
5. The previous 23 hours disappear.

Repeating this before every 24-hour boundary can keep the old balance from decaying indefinitely.

Second, changing the global rate applies the new rate retroactively from each user's previous checkpoint. A user
checkpointed yesterday and a user checkpointed 100 days ago receive different historical treatment even though the
rate changed today.

The simplest safe resolution is to make the decay rate immutable per deployment.

If runtime rate changes are required, use:

- second-level accrual rather than flooring to days;
- or preserve checkpoint remainder instead of resetting to `block.timestamp`;
- rate epochs or a cumulative global decay index so old and new rates apply only during their actual periods.

The current global mutable rate plus per-user timestamps is not sufficient for non-retroactive rate changes.

### H-10 — Permanently growing gas costs

`EnumerableSet` can help with active year/day keys, but it is not a complete solution.

Recommended redesign:

- Maintain decayed aggregate supply through a global checkpoint/index rather than iterating all holders.
- Remove the need to enumerate every historical holder on-chain; use events/indexing or paginated active-holder views.
- Maintain per-account/per-year required stake aggregates as bookings are added and removed instead of recalculating
  from every booking.
- Use active booking sets that remove canceled keys rather than permanent tombstone arrays.
- Replace repeated deposit-array scans with an ordered queue/checkpoint structure and a head index.
- Merge compatible stake buckets when possible.
- Put explicit maximum sizes on user-supplied batches.
- Paginate historical views.
- Define realistic scale targets and test gas at those sizes.

The goal is bounded state-changing complexity. A view function being large is inconvenient; a cancellation or
withdrawal eventually exceeding block gas is a production failure.

### H-11 — Idempotent and resumable deployment

The usual solution is a deployment state engine plus explicit reconciliation—not one large script that writes a
manifest only at the end.

Recommended model:

- Derive a stable `deploymentId` from chain ID, village slug/profile, and normalized config hash.
- Persist a journal after every submitted/confirmed transaction.
- Before resending, reconcile transaction receipt, deployed code, constructor/initializer data, and expected bytecode.
- Reuse compatible existing deployments.
- Refuse to overwrite a canonical manifest for a different config hash.
- Write product manifests from reconciled deployment state.
- Record block number/hash and receipt status.
- Make every post-deployment owner action independently resumable.

There is no single package that handles the entire Closer workflow:

- OpenZeppelin Upgrades should own proxy validation and implementation deployment state.
- Safe Protocol Kit/API Kit should own Safe transaction construction/proposal.
- Rocketh or another selected deployment state mechanism should perform actual deployments rather than merely
  contributing marker filenames.
- A thin custom orchestration/reconciliation layer will still be needed for Closer's manifest and workflow status.

## Medium-severity and architectural findings

### M-01 — What may not work with the decaying ERC20s

Systems commonly reconstruct ERC20 balances from `Transfer` events. These contracts emit raw mint/burn amounts, while
`balanceOf` changes over time without emitting transfers.

Consequences include:

- wallets displaying stale or raw balances;
- indexers disagreeing with `balanceOf`;
- portfolio trackers reporting the wrong supply;
- governance integrations assuming a stable token balance;
- bridges/DEXes failing because transfer and approval are disabled;
- accounting systems finding that event-derived supply differs from `totalSupply()`.

Describe these as non-transferable decaying points, not conventionally interoperable ERC20 assets. Define a
purpose-built `IDecayingPoints` interface and document that only direct contract reads and Closer's indexer are
supported.

### M-02 — OpenZeppelin `Math.mulDiv`

Replacing the custom implementation with OpenZeppelin `Math.mulDiv` is safe and recommended.

For inputs where `x * y` does not overflow, both implementations use floor division and should return the same result.

The behavior improves where the intermediate multiplication overflows but the final quotient fits: OpenZeppelin
performs full-precision multiplication and returns the correct result instead of reverting.

Before replacing it, add differential tests proving equal results across existing normal ranges and explicit
large-number cases.

### M-03 — Dependency validation

Recommended behavior:

- `setTransferPolicy(0)` should remain allowed if zero means open transfers.
- Any nonzero transfer-policy address should have code.
- The unused `setMembership` dependency and member-aware booking branch were removed.
- `setRoleAuthority` already performs a code check.

ERC-165 is useful only if the relevant interfaces and implementations explicitly support it. The current narrow
interfaces do not yet provide meaningful ERC-165 guarantees.

Before the first production deployment, it would be reasonable to:

- make the dependency interfaces ERC-165-identifiable;
- explicitly advertise those interface IDs in `VillageAccess` and policies;
- check `supportsInterface` in setters.

If ERC-165 is not added, code-length validation plus strict deployment allowlists is still a defensible baseline. Code
length alone prevents EOAs but cannot prove correct semantics.

### M-04 — ERC-7201 storage

The reference to “V1” meant the first production version of these new V2 proxy contracts, not the legacy TDF V1
contracts.

Legacy storage does not need modification.

The new V2 proxies still need attention. Sequential application storage is not inherently broken, and OpenZeppelin
validation can keep it safe if fields are only appended. But because no V2 production proxy exists yet, now is the best
time to move application state into ERC-7201 namespaces.

Recommended namespaces include:

- Community token application state;
- decaying-token base state;
- TokenizedStays state.

Once production proxies exist, this change becomes a storage migration problem. Do it before deployment.

### M-05 — Ownership transfer and centralized authority

Separate state and separate ownership per contract are normal and acceptable. The important requirements are:

- every module should normally have the same intended governance Safe;
- owner state must be verified separately on every module;
- governance migration must update every module;
- operational authority should be role-based rather than spread across owners.

`VillageAccess` should not inherit `Ownable2Step`. `AccessControlDefaultAdminRules` already provides a specialized
two-step default-admin transfer and exposes `owner()` as the default admin.

`TDFTransferPolicy` should use non-upgradeable OpenZeppelin `Ownable2Step`.

A governance migration tool should generate two Safe bundles:

1. Old Safe initiates ownership/default-admin transfers across all modules.
2. New Safe accepts each pending transfer.

“Centralize operational authority” means functions such as pausing, booking administration, policy management,
minting, and burning should use narrowly named roles in `VillageAccess`. Owners remain the shared Safe and act mainly
as governance/break-glass authority.

This avoids using ownership for everyday API operations while keeping each module independently upgradeable.

### M-06 — Default-admin delay

`AccessControlDefaultAdminRules(0, admin)` still enforces:

- one default admin;
- two-step transfer;
- pending admin acceptance.

But a zero delay means the new admin may accept immediately.

A nonzero delay creates a cancellation window between initiating and accepting the admin transfer. It protects against
accidental or compromised-admin handoffs.

It does not delay ordinary role grants. It only affects default-admin transfer and related delay changes.

Choose a governance delay based on the operational model—commonly some number of days for production—and make it
explicit in deployment config. Initializer-seeded deployments with the final Safe do not need to wait; the delay
matters during later transfers and temporary-deployer handoffs.

If zero remains intentional, change the plan language from “delayed handoff” to “two-step handoff without a time
delay.”

### M-07 — Fee-on-transfer/rebasing flow

The issue happens during:

```solidity
communityToken.safeTransferFrom(account, address(this), amount)
```

The ledger credits `amount`. A fee-on-transfer token might deliver only 98 when 100 was requested. The contract then
owes 100 while holding 98.

A negative-rebasing token can make the escrow insolvent later without any transfer.

The current plain `CommunityToken` has neither behavior, so fixing H-02 by making the escrow token permanent also
largely resolves M-07.

Support only exact-transfer, non-rebasing tokens. Balance-delta accounting is possible, but fee tokens complicate
booking-price and refund semantics unnecessarily.

### M-08 — Calendar, inventory, and capacity

The on-chain contract does not model rooms or listing capacity. Multiple users can book the same date because bookings
are keyed by user and date.

It therefore represents stake/entitlement evidence, not authoritative accommodation inventory. That is consistent
with the Phase 2 statement that ordinary inventory stays in the API, but it needs to be documented explicitly.

Other issues to define:

- exact meaning of year `start` and `end`;
- UTC/time-zone agreement with the backend;
- leap-year behavior;
- whether `ONE_YEAR` means 365 days or one calendar year;
- whether years with bookings may be updated or removed;
- what happens to historical bookings after year removal;
- permitted check-in window.

Keep room/resource capacity in the API unless there is a concrete requirement for on-chain inventory. Signed booking
authorizations can bind API-approved dates without reimplementing the entire inventory system on-chain.

### M-09 — Separate minter and burner roles

For `CommunityToken`, minting and forced burning should be separate.

Recommended behavior:

- `MINTER_ROLE`: mint only.
- User: burn own tokens.
- Approved spender: standard allowance-based `burnFrom`.
- `BURNER_ROLE`: forced administrative burn only, if the product explicitly needs it.

If forced confiscation of community tokens is not required, remove `burnFromByRole` entirely.

Currently, `MINTER_ROLE` is used only by `CommunityToken`. Presence and Sweat use `BOOKING_PLATFORM_ROLE` and
`BOOKING_MANAGER_ROLE` for both minting and burning. That also grants broad authority: a booking manager can manage
stays and mutate both points systems.

Consider narrower point roles, for example:

- `PRESENCE_OPERATOR_ROLE`;
- `SWEAT_OPERATOR_ROLE`;
- or distinct point mint/burn roles if different services hold them.

The right granularity depends on whether the same API operator legitimately performs all those actions.

### M-10 — Policy replacement freezing operations

`CommunityToken._update` runs for mint, burn, and transfer. A policy that reverts or returns false can therefore block
all three.

The current TDF policy permits mint and burn because one side is zero, but a future replacement may not.

Recommended default:

```text
Call transfer policy only for ordinary transfers:
from != address(0) && to != address(0)
```

Mint and burn already have their own access control. If a village genuinely needs mint/burn policy, expose that through
explicit policy methods rather than treating every `_update` identically.

Also:

- validate nonzero policies as contracts;
- retain a Safe-controlled recovery path to zero or a known safe policy;
- test reverting and malformed policies;
- consider a governance delay for policy replacement.

### M-11 — Safe transaction workflow

Current pending actions are calldata descriptions, not complete Safe transactions.

Use:

- `@safe-global/protocol-kit`;
- `@safe-global/types-kit`;
- `@safe-global/api-kit` when using the Safe Transaction Service;
- `@safe-global/safe-deployments` for official versioned addresses.

Protocol Kit can create a batch from multiple meta-transactions, calculate the deterministic Safe transaction hash,
collect signatures, and execute it. API Kit can propose and query the transaction:
[Safe Protocol Kit documentation](https://docs.safe.global/reference-sdk/protocol-kit/transactions/executetransaction).

The manifest should record:

- Safe address and chain ID;
- nonce;
- complete Safe transaction data;
- operation type;
- Safe transaction hash;
- proposal/service state if used;
- signatures collected or required;
- execution transaction hash;
- post-execution reconciliation result.

A deployment becomes complete only after the intended on-chain state is verified—not merely because a Safe
transaction was proposed.

### M-12 — Config provenance versus H-05

This overlaps with H-05 around Safe configuration, but it is a separate issue.

H-05 is about who controls governance. M-12 is about proving what configuration and artifacts were actually deployed.

Recommended changes:

- Parse config using a strict runtime schema such as Zod or JSON Schema/Ajv.
- Reject unknown and unused fields.
- Use discriminated owner-mode schemas.
- Validate numeric strings, ranges, and zero addresses.
- Canonically normalize and hash the config.
- Record the config hash in every journal/manifest revision.
- Record actual compiler version/settings and build-info data.
- Record dependency/lockfile versions.
- Record creation and runtime bytecode hashes.
- Record deployer, transaction receipt, block number/hash, and confirmations.
- Record source/git revision where available.
- Never silently overwrite an existing manifest with a different config hash.

## Other notes

### 1. Tenderly fork dry run

Add both:

- fast local Hardhat fork tests in CI;
- an optional/required Tenderly Virtual TestNet production preflight.

The Tenderly preflight should:

- fork Celo/Celo Sepolia at a recorded block;
- use the exact normalized production config;
- run the exact deployment workflow;
- execute or simulate Safe batches;
- run role, ownership, policy, proxy, and end-to-end smoke checks;
- measure gas;
- preserve the simulation URL/report;
- discard fork-only manifest addresses afterward.

Tenderly supports creating a Virtual TestNet from a specific block and using its RPC as a Hardhat network:
[Tenderly Virtual TestNet documentation](https://docs.tenderly.co/virtual-environments/develop/create-virtual-environment-via-api).

It is valuable preflight evidence, but it does not replace OpenZeppelin validation, tests, or real-network
post-deployment reconciliation.

### 2. Current deployment tooling

The current script is not yet using the best available tooling throughout:

- UUPS deployment is manual rather than OpenZeppelin Upgrades.
- Safe deployment and actions use handwritten minimal ABIs rather than Safe SDKs.
- Rocketh files are markers, not the executing state engine.
- Runtime config validation is handwritten TypeScript checks rather than a strict schema.
- There is no transaction journal or resumable recovery.
- There is no complete Safe bundle/reconciliation workflow.

Recommended target stack:

- OpenZeppelin Hardhat Upgrades;
- Safe Protocol Kit, API Kit, Types Kit, and Safe Deployments;
- Zod or Ajv;
- one real deployment-state/journal engine;
- Slither;
- fuzz/invariant tests;
- Hardhat fork plus Tenderly preflight.

### 3. Make `TDFTransferPolicy` `Ownable2Step`

Agreed. Use OpenZeppelin non-upgradeable `Ownable2Step`.

Because it is not a proxy contract, it should use the ordinary contracts package, not
`Ownable2StepUpgradeable`.

### 4. Verify roles and ownership after deployment

Add a post-deployment reconciliation command that checks:

- `VillageAccess.defaultAdmin()`;
- pending default admin and delay;
- role-admin relationships;
- every expected role grant;
- absence of forbidden roles on deployer/API operator;
- `owner()` and `pendingOwner()` on every upgradeable module;
- role authority, membership, community token, and policy addresses;
- proxy implementation slots;
- TDF policy owner, pending owner, treasury, and allowed counterparties;
- Safe owners and threshold;
- paused states;
- completed Safe actions.

The current deployment checks some initializer-seeded state, but it does not reconcile complete Safe execution or
every dependency/configuration surface.

### 5. V1 unlimited approval

V1 gave the DAO/diamond effectively unlimited allowance from every TDF holder. It was not specifically an unlimited
treasury approval.

V2 should not reproduce this by default. The preferred user flow is:

- normal ERC20 approval; or
- ERC-2612 permit through `bookAccommodationWithPermit`.

The Phase 2 plan already says the allowance bypass should exist only as an explicitly selected TDF compatibility
extension if strict V1 UX parity is required. Use permit and omit the bypass unless strict parity is explicitly chosen.

### 6. Parity tests

Parity tests are worthwhile, but they should compare deliberately selected observable behavior rather than copy known
V1 bugs.

Create two drivers:

```text
LegacyTDFV1Driver
TDFV2ProfileDriver
```

Run the same scenarios through both and normalize differences in ABI/error formatting.

Test:

- membership;
- booking initial status;
- deposit, booking, replacement, cancellation, restake, and withdrawal;
- confirmation and check-in;
- checked-in night counts;
- year enable/disable behavior;
- TDF treasury/escrow transfer rules;
- Presence/Sweat minting, decay, burning, and non-transferability;
- role permissions.

Classify each scenario as:

- required parity;
- intentional V2 change;
- legacy bug fixed;
- removed/out-of-scope functionality.

Do not require parity for unsafe H-01/H-03/H-08/H-09 behavior.

### 7. Missing intended V1 functionality

The major Phase 2 functional surfaces are nominally present: membership, community token, booking/staking, and
Presence/Sweat points.

The unimplemented or intentionally changed areas are:

- No actual V1/V2 parity suite, so equivalence is not yet proven.
- TDF V2 profile does not automatically include Presence, Sweat, and TokenizedStays despite being described as the
  richest profile.
- TDF policy is not automatically wired to TokenizedStays.
- V1's implicit DAO unlimited allowance is omitted; permit is the preferred replacement.
- Dynamic sale and crowdsale are intentionally out of generic Phase 2 scope.
- V1's global diamond pause became per-module pauses; there is no single emergency batch operation.
- V1 `getRoles()` is absent, though individual public role IDs and enumerable role membership are available.
- Several V1 lifecycle and decay behaviors were ported but need correction rather than parity.

No major generic module appears to be missing, but parity, TDF profile composition, policy wiring, and operational
emergency behavior remain incomplete.

### 8. Suggested tests

Add the tests after the booking and decay domain decisions are finalized so they encode desired behavior rather than
current bugs.

Required groups:

- Signed booking quote validation, including authorized zero prices.
- Replay, user, dates, contract, chain, price, and expiry substitution.
- Complete booking transition matrix and time windows.
- Pause behavior for every entry point.
- Escrow solvency invariants.
- TDF policy end-to-end staking.
- Decay ledger invariants and actual mint-lot burns.
- Fractional time and rate-change behavior.
- Large-number differential math tests.
- Realistic gas-scale tests.
- Role hierarchy capture/recovery.
- Separate mint/burn permissions.
- Dependency validation and hostile policies.
- OpenZeppelin upgrade validation and state preservation.
- Safe ownership acceptance, bundle execution, and reconciliation.
- Deployment interruption/resume at every transaction boundary.
- Manifest collision and provenance checks.
- V1/V2 selected parity scenarios.

### 9. Complete remaining-work list

> **Historical and superseded:** many items below have since been implemented or deliberately excluded. Use
> [`V2_REMAINING_WORK.md`](./V2_REMAINING_WORK.md) for the current backlog.

To ensure nothing from the original review is lost, the remaining work is:

1. Finalize signed backend booking authorization, including authorized zero-price bookings.
2. Decide whether zero-price stays must exist on-chain.
3. Make backend token discounts match the intended stake economics.
4. Fix `TokenizedStays` lifecycle transitions, time windows, cancellation rights, and pause semantics.
5. Remove or tightly migrate `setCommunityToken`.
6. Track and test escrow liabilities/solvency.
7. Restrict `setRoleAdmin` to default admin or remove it.
8. Redesign decaying-token burns around real mint provenance or proportional accounting.
9. Fix fractional-time decay and rate-change semantics.
10. Redesign unbounded holder, booking, year, and deposit iteration.
11. Move new V2 application storage to ERC-7201 before production.
12. Replace custom `mulDiv` with OpenZeppelin `Math.mulDiv`.
13. Validate replaceable dependency contracts/interfaces.
14. Separate mint and forced-burn authority.
15. Narrow point-token operator roles.
16. Limit transfer policy to ordinary transfers unless explicitly required otherwise.
17. Make `TDFTransferPolicy` `Ownable2Step`.
18. Automatically wire TokenizedStays through the TDF policy.
19. Decide and document the exact TDF V2 default module set.
20. Define calendar, leap-year, year-removal, and on-chain entitlement semantics.
21. Choose/document the default-admin transfer delay.
22. Introduce explicit prototype/production governance policies.
23. Validate Safe deployments through official chain/version deployment data.
24. Integrate OpenZeppelin Hardhat Upgrades.
25. Make upgrade validation a required CI/release gate.
26. Generate validation artifacts before Safe upgrade proposals.
27. Use Safe Protocol/API tooling for deterministic executable batches.
28. Add owner-action execution and reconciliation commands.
29. Implement journaled, idempotent, collision-safe deployment recovery.
30. Add strict versioned runtime config validation.
31. Add config hashes and full compiler/artifact/receipt provenance.
32. Make Rocketh/deployment namespaces constrain the actual executing engine.
33. Add complete post-deployment ownership/role/config verification.
34. Add local-fork and Tenderly deployment preflight.
35. Add the complete test groups listed above.
36. Add the V1/V2 parity suite.
37. Pin and deliberately review tool/dependency upgrades rather than claiming “latest.”
38. Add Slither and fuzz/invariant testing to CI.
39. Run realistic gas-scale tests.
40. Update Phase 2/3 documentation for naming, profile composition, booking authority, decay semantics, governance delay,
    deployment completion, and selected/pinned versions.
41. Run an independent smart-contract audit after remediation.
42. Connect production Phase 3 UI/API deployment only after those gates pass.
