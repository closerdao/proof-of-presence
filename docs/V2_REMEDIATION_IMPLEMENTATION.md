# V2 remediation decisions and implementation

Date: 2026-07-17

This document supersedes conflicting recommendations in
[`V2_REVIEW_FEEDBACK_FOLLOWUP.md`](./V2_REVIEW_FEEDBACK_FOLLOWUP.md). It records the decisions in the latest follow-up,
what was implemented, and the rationale for the remaining decisions. The authoritative checklist and current status
for all unfinished contracts, API, UI, and operations work is
[`V2_REMAINING_WORK.md`](./V2_REMAINING_WORK.md); update task status there.

## High-severity findings

### H-01 — Backend price; zero is valid

No EIP-712 authorization was added. `TokenizedStays` continues to accept the backend-calculated price supplied through
the client, including zero. The contract now documents EIP-712 as a possible future hardening measure only. A focused
test confirms that a zero-price booking is recorded without moving tokens.

This preserves the agreed product flow but does not make calldata trustworthy: until signed quotes are introduced, a
user who submits the transaction can alter the price. That risk is now explicit rather than silently treated as solved.

### H-02 — Fixed CommunityToken reference

`TokenizedStays.setCommunityToken` was removed. The initializer-only token reference is documented in the contract:

- existing deposits and booking liabilities are denominated in the original token;
- replacing it could strand old assets or pay old claims with an unrelated token;
- `CommunityToken` is UUPS-upgradeable, so its implementation can change while its proxy address stays stable.

Token accounting now uses the following terms consistently:

| Term                    | Meaning                                                                                                  |
| ----------------------- | -------------------------------------------------------------------------------------------------------- |
| deposited balance       | CommunityToken credited to one user and held by TokenizedStays; it includes locked and unlocked amounts  |
| required locked balance | the maximum simultaneously required amount across the user's active and future 365-day booking intervals |
| locked balance          | the lesser of deposited balance and required locked balance; it cannot be withdrawn                      |
| unlocked balance        | deposited balance not currently required by bookings; it can be withdrawn or reused by another booking   |
| total deposited balance | the sum of all user-credited deposited balances                                                          |
| orphaned token balance  | CommunityToken held by TokenizedStays but not credited to any user's deposited balance                   |

Direct ERC-20 transfers do not create deposits. The owner can recover only the independently measured orphaned balance;
the recovery path cannot reduce user deposits and remains available while booking/deposit mutations are paused.

### H-03 — Booking lifecycle and pause policy

Resolved by removing booking workflow status from TokenizedStays. Pending, confirmed, checked-in, and canceled states,
confirmation/check-in functions, member-dependent initial status, and checked-in-night views are no longer on-chain.
The contract stores only active date/price records used for booking locks. Users and booking managers may cancel active
future records; the Closer backend remains authoritative for booking workflow status, inventory, and capacity.

Each booking input has its own `pricePerDate` and locks that amount during `[bookingDay, bookingDay + 365 days)`.
Overlapping intervals add; non-overlapping intervals reuse the same deposited tokens. Expiry unlocks the amount but
does not transfer it—the user calls `withdraw` or `withdrawMax`. The current and future required amount is exposed by
`requiredLockedBalance`, and `requiredLockedBalanceAt` supports bounded future projections.

### H-04 — OpenZeppelin upgrade workflow and CI gate

Current implementation:

- production deployment uses `@openzeppelin/hardhat-upgrades` for `validateImplementation` and `deployProxy` with
  UUPS;
- `yarn validate:upgrades` validates every current implementation and current-to-V2 test upgrade;
- CI runs that command as a required step;
- upgradeable application state uses ERC-7201 namespaced storage;
- implementation locking and state-preserving upgrade tests remain in place.
- executed upgrades are reconciled from the live ERC-1967 implementation slot and prepared implementation bytecode
  hash before EOA receipts, Safe service state, or recovery paths can mark them executed; both the implementation
  address and its runtime code hash are refreshed in the manifest.

The selected Phase 3 target changes the deployment mechanism without relaxing these safety checks: Hardhat Ignition
will own V2 implementation/proxy transactions and resumption, while OpenZeppelin `validateImplementation` and
`validateUpgrade` remain mandatory before Ignition can submit applicable production transactions. The target does not
use `deployProxy` or `.openzeppelin` as a second default V2 deployment-state engine. See
[`PHASE_3_DEPLOYMENT_ARCHITECTURE_PLAN.md`](./PHASE_3_DEPLOYMENT_ARCHITECTURE_PLAN.md).

The newest compatible tooling was pinned. `@openzeppelin/hardhat-upgrades@4.0.0` and Hardhat 3.6 are used because the
latest upgrades release pulls `undici@8`, which requires Node 22.19 while this repository currently supports/runs Node
22.14. Bypassing that engine constraint would be unsafe deployment tooling.

### H-05 — Optional final-owner checks and Safe validation

The requested flags are implemented and default to `false`:

- `checkFinalOwnerIsNotDeployer`;
- `checkFinalOwnerIsNotApiOperator`.

When false, prototype deployments may leave the deployer or API operator as direct owner. The manifest records the
resolved setting so this is visible. Implementation upgrades are authorized only by the final owner/Safe; the API
operator and deployment worker have no delegated upgrade role.

For production-network auto-Safe deployment, `@safe-global/safe-deployments` now checks the requested Safe version,
chain, singleton, proxy factory, and runtime code hashes. Setup delegatecalls and setup payments are rejected. Safe
owners and threshold are verified against the auto-Safe configuration, but no policy rejects the deployer or API
operator merely for being one signer.

### H-06 — Transfer restrictions, allowance, treasury, and deployment order

#### a. Disabling transfer restrictions

Implemented explicitly. `TDFTransferPolicy.transfersRestricted` can be toggled by its owner. When false, all transfers
are allowed while the token keeps the same policy address. The generic `CommunityToken` also retains the option to set
its policy to the zero address, which skips policy calls entirely.

`TDFTransferPolicy` now constructs with restrictions enabled. TDF-specific Ignition composition passes the deployed
policy Future directly into `CommunityToken.initialize`, so the token enforces the policy from its first balance
update rather than temporarily using the unrestricted zero address. The remaining owner actions configure
counterparties such as `TokenizedStays`. If a village explicitly configures `restrictionsEnabled: false`, the final
owner/Safe action disables restrictions; the owner can use the same switch later to enable or restrict ordinary
transfers. No deterministic deployment is required.

#### b. Unlimited allowance in V2

V2 does not reproduce V1's implicit unlimited allowance. In V1, the diamond had maximum allowance over every holder,
which let booking/deposit flows call `transferFrom` in one transaction without prior approval, including booking
deficit deposits.

That also gave the diamond unusually broad pull authority. V2 uses normal ERC-20 allowance or EIP-2612 permit through
`depositWithPermit` and `createBookingsWithPermit`. The current Closer UI directly submits the legacy booking
transaction and does not approve first; the API only verifies the resulting record. Phase 3 UI integration must switch
to permit by default with explicit approval as a fallback. Any maximum approval must be an explicit, revocable user
choice. The V1 unlimited allowance was for the DAO/diamond, not treasury.

#### c. Treasury direction

No current V2 flow requires CommunityToken transfers to treasury, but the product decision is to allow both inbound
and outbound treasury transfers. `treasury` remains a distinct semantic policy field and the current policy already
implements this behavior.

No deterministic deployment was added.

### H-07 — Role-admin changes

`setRoleAdmin` was retained because future role hierarchies may need configuration. It is now callable only by
`DEFAULT_ADMIN_ROLE`.

OpenZeppelin's `getRoleAdmin(role)` remains the source of truth used by `grantRole` and `revokeRole`. Initial admin
relationships are established with internal `_setRoleAdmin` in the constructor; later hierarchy changes go through the
root-admin-only external function. A delegated role admin can administer members of its role but cannot redefine the
hierarchy or make itself more powerful.

### H-08 — Burn age data

Unchanged as requested. The current burn API still trusts supplied age buckets. A prominent contract-level comment
documents this limitation and the future authenticated/proportional burn-accounting option.

### H-09 — Fractional decay and mutable rates

The whole-day decay model is retained, but mint and burn no longer reset an account's partial-day progress. Each account
stores `decayCheckpointTimestamp` and `decayCheckpointBalance`. A mutation applies only complete elapsed days and
advances the timestamp by that whole-day amount, preserving the remainder. A partial burn keeps the schedule; burning
to zero clears it; the next mint starts a new schedule.

New mint amounts join the account's existing daily schedule. This is intentionally the low-complexity behavior: a new
amount can reach the next account-level decay boundary in less than 24 hours. Exact per-lot 24-hour decay would require
separate lots or second-level/global-index accounting and is deferred unless the product requires it.

Changing the decay rate after balances exist remains unsupported operationally because historical balances would not
have a rate epoch. A cumulative index or rate-epoch design is required before live mutable rates are enabled.

### H-10 — `totalSupply()` usage

The decaying token's holder-looping `totalSupply()` is not called by any internal write operation in V2. Therefore it
does not currently make mint or burn transactions grow through an internal `totalSupply` call.

It remains an externally callable unbounded view. Contracts can call views during their own transactions, and RPC
queries can eventually exceed practical gas/resource limits. TokenizedStays no longer stores or scans year, booking, or
deposit arrays: it uses direct day mappings, cached annual exposure summaries, a rolling 64-year booking horizon, and
one credited deposited balance per account.

### H-11 — Deployment recovery

Implemented without deterministic deployment:

- a config hash identifies one deployment intent;
- a journal checkpoints the owner resolution and every deployed contract/transaction boundary;
- reruns restore journaled contracts, require runtime code, and verify UUPS implementation slots;
- a completed manifest is reconciled instead of redeployed;
- a different config at the same manifest/journal path is rejected;
- completed or partially completed owner actions are reconciled on rerun.

The manifest now records config/code hashes, receipt block/status, implementation code hashes, source revision when
available, and pinned tool versions.

## Medium-severity decisions

- **M-01:** unchanged as requested.
- **M-02:** custom multiplication/division was replaced with OpenZeppelin `Math.mulDiv`; differential tests were not
  added, per the decision. Existing math/decay tests continue to pass.
- **M-03:** replaceable policy dependencies require contract code and ERC-165 interface support. Role authority
  requires nonzero contract code. ERC-20 itself does not have a canonical ERC-165 interface, so the fixed deposited token
  uses the appropriate code check rather than a fake ERC-165 requirement. Project-specific membership interfaces,
  roles, deployment options, and wrappers were removed because no V2 contract consumes membership.
- **M-04:** V2 upgradeable application state and V2 upgrade-test state use ERC-7201 namespaces with comments warning
  that namespaces must never be renamed after deployment. Legacy V1 was not changed.
- **M-05:** `TDFTransferPolicy` now uses `Ownable2Step`. Upgradeable modules already use
  `Ownable2StepUpgradeable`. The deployment verifies `owner()` and zero `pendingOwner()` for every ownable module.
  Operational roles remain centralized in `VillageAccess`; the final owner/Safe controls ownership-only configuration
  and upgrades. Introducing an `AccessManager` was not necessary for the current module count.
- **M-06:** the zero default-admin transfer delay remains unchanged.
- **M-07:** CommunityToken is a standard non-rebasing, non-fee-on-transfer ERC-20, so exact-amount deposit accounting is
  valid. A fee-on-transfer/rebasing replacement is intentionally unsupported.
- **M-08:** the contract now explicitly stores only active booking-lock evidence, not booking status or global
  room inventory; the backend remains responsible for workflow, capacity, and conflicting reservations.
- **M-09:** no role split was added. Booking platform and booking manager roles already mint and burn Presence/Sweat.
  CommunityToken uses `MINTER_ROLE` for minting and forced role-based burns; a booking manager may receive that role if
  the same operator legitimately manages CommunityToken. This combined authority is accepted for the current model.
- **M-10:** unchanged as requested.
- **M-11:** Safe Protocol Kit builds one executable batched owner transaction and computes its Safe transaction hash.
  `yarn safe:propose` now uses Safe API Kit to submit an owner-signed proposal idempotently to the Transaction Service.
  Every pending owner action is an atomic call in that one `MultiSendCallOnly` transaction. `yarn safe:status` records
  confirmations and execution state without handling additional owners' keys. Proposal remains an explicit operator
  action because it requires a Safe-owner key and API credentials; it does not execute the transaction. Safe owners
  review, confirm, and execute through their normal Safe workflow, after which deployment reconciliation verifies the
  actual on-chain state.
- **M-12:** deployment JSON is parsed through a strict, versioned Zod schema. Unknown keys, invalid addresses, negative
  quantities, invalid discriminated owner configs, and malformed bytes are rejected before transactions.

## Other notes

- Tenderly preflight is intentionally excluded. The deployment entrypoint contains a future-integration note.
- The TDF V2 profile now always includes CommunityToken, Presence, Sweat/Contribution, TokenizedStays, and
  TDFTransferPolicy. Membership remains off-chain.
- TokenizedStays is automatically included in the policy's prepared allowlist actions. The token is already wired to
  the restricted policy; the deployment remains pending until the same Safe batch completes the required allowlisting.
- A generic `getRoles()` function was not added. Named role constants, OpenZeppelin enumeration, and the deployment
  manifest already provide a less ambiguous role registry.
- V1/V2 parity tests remain intentionally excluded.
- Post-deployment verification checks default role admins, configured grants, every owner and pending owner, proxy
  implementation slots, module dependencies, treasury, Safe owners/threshold, and policy wiring.
- Focused tests cover the new policy switch, two-step ownership, root-only role hierarchy changes, fixed deposited
  token, zero/variable-price bookings, rolling lock boundaries, gradual unlock, deficit-only deposits, cancellation,
  pruning, orphan recovery, preserved decay checkpoints, config validation, manifest collision/reconciliation, the
  full TDF profile, and OpenZeppelin upgrade validation.

## Remaining work not already covered by the decisions above

> Historical snapshot only. The reconciled authoritative checklist, including dependencies and completion criteria,
> is [`V2_REMAINING_WORK.md`](./V2_REMAINING_WORK.md).

1. If requirements change, resolve H-08 and the deferred parts of H-09 in a future upgrade: authenticated burn
   provenance, exact per-lot/second-level accrual, and mutable-rate epoch/index design. Do not change a live rate until
   then.
2. Review local Slither findings, then decide when to add Slither to CI; add broader fuzz/invariant coverage and obtain
   an independent audit before meaningful mainnet value is entrusted.
3. Integrate the V2 permit/approval flow and the Phase 3 deployment/status/manifest workflow into Closer API/UI.
   The concrete cross-repository checklist is maintained in
   [`PHASE_3_CROSS_REPOSITORY_INTEGRATION.md`](./PHASE_3_CROSS_REPOSITORY_INTEGRATION.md).
4. Complete event indexing and ensure events remain the historical source after permissionless pruning.
