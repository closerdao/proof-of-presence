# Phase 2 Implementation Plan: Generic Village Contracts

> **Implementation note (2026-07-15):** The implemented collision-free artifact names are
> `VillagePresenceToken` and `VillageSweatToken`, despite older passages below using the shorter names. The TDF V2
> profile now composes CommunityToken, both point tokens, TokenizedStays, and TDFTransferPolicy. Project-specific
> on-chain membership was removed because no V2 contract consumes it; membership remains an off-chain product concern.
> TokenizedStays stores active date/stake entitlements only; booking approval, confirmation, check-in, inventory, and
> lifecycle status are authoritative off-chain. Current remediation status and unresolved decay decisions are tracked in
> [`V2_REMEDIATION_IMPLEMENTATION.md`](./V2_REMEDIATION_IMPLEMENTATION.md). The authoritative checklist for all
> unfinished work across the contracts, API, UI, and operations repositories is
> [`V2_REMAINING_WORK.md`](./V2_REMAINING_WORK.md); task status must be updated there rather than in this plan.

## Goal

Refactor the contract model into a generic village contract suite that can support:

- small villages that only need proof-of-presence or sweat/contribution tokens;
- token-based villages that need a configurable community token;
- tokenized-stays villages that need on-chain date entitlements and staking;
- a future TDF v2 deployment profile built from the same generic modules.

Phase 2 starts only after Phase 1 has a green Hardhat 3 baseline.

The current `TDFDiamond` remains supported as a legacy/special-case deployment. New generic village deployments should be diamond-free by default and should compose standalone modules through explicit interfaces.

## Design Principles

- Preserve selected TDF behavior where it remains part of the V2 product, while keeping legacy-only behavior separate.
- Prefer OpenZeppelin Contracts 5.x components over custom implementations for access control, ERC20 behavior, pausing, reentrancy guards, and upgrade patterns.
- Keep `AccessControlLib` and diamond storage only for the legacy TDF diamond.
- Make village modules independently deployable and skippable.
- Make TDF v2 a deployment profile over generic modules, not another TDF-only architecture.
- Use regular contracts by default, but deploy `CommunityToken`, `PresenceToken`, `SweatToken`, and `TokenizedStays` behind OpenZeppelin proxies from day one so token balances and tokenized-stay state do not require manual migration for compatible future upgrades.
- Prefer replaceable policy contracts over upgradeable policy contracts for rules that are expected to change.
- Keep TDF-only policy code, sale logic, treasury assumptions, and migration helpers out of the generic core.
- Keep the generic village suite mechanically removable or extractable into a future standalone repo.

## Repository Division

Phase 2 should keep v1 legacy contracts, generic village modules, and TDF v2 profile code in separate source namespaces.

Target layout:

```text
src/
  legacy/
    tdf-v1/
      diamond/
      tokens/
      sales/
      interfaces/
      libraries/

  village/
    access/
    interfaces/
    tokens/
    stays/
    libraries/

  profiles/
    tdf-v2/
```

Target test layout:

```text
test/
  legacy/
    tdf-v1/
  village/
  profiles/
    tdf-v2/
  parity/
```

Target deployment layout:

```text
deploy/
  legacy/
    tdf-v1/
  village/
  profiles/
    tdf-v2/
```

Import rules:

- `src/village/**` may import OpenZeppelin contracts and other `src/village/**` modules.
- `src/village/**` must not import `src/legacy/**`, diamond storage, `AccessControlLib`, TDF sale modules, or TDF-specific policy modules.
- `src/profiles/tdf-v2/**` may import `src/village/**` and TDF v2-specific policy/configuration.
- `src/legacy/tdf-v1/**` may keep legacy internals and current TDF assumptions.
- V1/V2 parity tests are intentionally deferred; if added later, `test/parity/**` is their only intended location.

If useful legacy logic needs to be reused, extract or reimplement it as generic village code instead of importing from `src/legacy/**`.

The first Phase 2 implementation does not need to move every existing file immediately. It may add new code under `src/village/**` and `src/profiles/tdf-v2/**` first, then perform a separate move-only cleanup for legacy files after behavior is stable.

Keep the generic v2 token names as `PresenceToken` and `SweatToken`. Avoid artifact-name collisions while legacy and generic contracts coexist by moving legacy contracts under `src/legacy/tdf-v1/**` and, if both generations are compiled at the same time, renaming the legacy Solidity contract names or deployment artifact names to `LegacyPresenceToken` and `LegacySweatToken`.

## Architecture Profiles

### Minimal Village

For villages that only need proof-of-presence or sweat/contribution accounting:

- `VillageAccess`
- optional `PresenceToken`
- optional `SweatToken`

This profile must not require a community token, tokenized stays, or a diamond.

### Token Village

For villages that need a configurable village token:

- `VillageAccess`
- `CommunityToken`
- optional `ITransferPolicy`
- optional `PresenceToken`
- optional `SweatToken`

The default transfer policy is open transfers. A zero transfer-policy address means unrestricted ERC20 transfers.

### Tokenized-Stays Village

For villages that need on-chain tokenized-stay staking:

- `VillageAccess`
- `CommunityToken`
- optional `ITransferPolicy`
- `TokenizedStays`

`TokenizedStays` contains active accommodation-date stake entitlements without depending on the diamond. Closer API
remains authoritative for booking workflow status and inventory.

### TDF v2 Profile

TDF v2 should be modeled as the richest deployment profile over generic modules:

- `VillageAccess`
- `CommunityToken` configured with TDF name, symbol, supply, and recipients
- TDF-specific transfer policy
- `PresenceToken`
- `SweatToken`
- `TokenizedStays`
- optional TDF-specific sale module
- optional TDF migration helpers

TDF v2-specific policy belongs in TDF-specific contracts or deployment configuration, not in the generic base modules.

## Access Control Decision

The repo already has access control:

- `AccessControlLib` defines role constants and diamond-internal role storage.
- `AdminFacet` exposes role management on the TDF diamond.
- `PresenceToken` and `SweatToken` currently check roles through `daoAddress.hasRole(...)`.

The issue is not absence of access control. The issue is that the current public role authority is embedded in `TDFDiamond`. If a village wants `PresenceToken` or `SweatToken` without deploying tokenized stays, there is no standalone role contract for those tokens to call.

Implementation approach:

- Keep `AccessControlLib` only for the legacy `TDFDiamond`.
- Add `VillageAccess` as the generic standalone role authority.
- Implement `VillageAccess` with OpenZeppelin `AccessControlDefaultAdminRulesUpgradeable`, `AccessControlEnumerableUpgradeable`, and UUPS upgradeability.
- Initialize the VillageAccess proxy atomically with the village owner/Safe as the initial default admin when the owner/Safe address is known. The deployment transaction may be sent by a separate deployer address as long as the initializer seeds the provided owner/Safe address, not `msg.sender`, as the default admin.
- If deployment needs temporary deployer privileges, model the `AccessControlDefaultAdminRules` handoff explicitly: schedule the owner/Safe as pending default admin, accept the transfer from the owner/Safe after the delay, and treat the deployment as pending admin acceptance until that Safe transaction is executed. Do not assert immediate Closer deployer admin removal for this flow; the no-retained-admin check passes only after the owner/Safe accepts.
- Add `VillageRoles` as a constants-only library or interface for shared role IDs. `VillageRoles` is not a deployed contract and should not store role assignments.
- Avoid importing diamond libraries from generic tokens or generic modules.
- Keep `AccessManager` out of Phase 2 unless the architecture changes to selector-based permissions across many managed target contracts.
- Keep the VillageAccess proxy address stable and authorize implementation upgrades only through its `DEFAULT_ADMIN_ROLE`, held by the village owner/Safe.

`VillageAccess` should expose the standard role-management surface expected by existing role consumers:

- `hasRole(bytes32,address)`
- `grantRole(bytes32,address)`
- `revokeRole(bytes32,address)`
- `renounceRole(bytes32,address)`
- `getRoleAdmin(bytes32)`
- `setRoleAdmin(bytes32,bytes32)`

Do not model project membership in the V2 contracts. No V2 module consumes membership for authorization or booking
behavior, and the API is authoritative for membership and workflow state. If a future on-chain requirement emerges,
introduce a dedicated membership module with an explicit domain model rather than adding unused wrappers to the root
role authority.

New roles can be added later without redeploying `VillageAccess` because OpenZeppelin roles are arbitrary `bytes32` identifiers. Granting a new role only records permission data; a module must still check that role before the new role changes on-chain behavior.

Use these role constants initially:

- `DEFAULT_ADMIN_ROLE`
- `MINTER_ROLE`
- `BOOKING_MANAGER_ROLE`
- `BOOKING_PLATFORM_ROLE`

Keep `STAKE_MANAGER_ROLE` and `VAULT_MANAGER_ROLE` available only if TDF v2 parity or deployment tooling needs legacy-compatible role names. Generic modules should check only the roles they actually need.

Add new role constants only when a concrete module requires them.

## Upgradeability Decision

Phase 2 uses upgradeability selectively:

| Module                                  | Upgradeable? | Reason                                                                                                            |
| --------------------------------------- | ------------ | ----------------------------------------------------------------------------------------------------------------- |
| `VillageAccess`                         | Yes          | Its proxy keeps the authority address and role/admin state stable while the Safe can apply validated fixes.       |
| `VillageRoles`                          | No           | Constants-only library or interface; no deployment or storage.                                                    |
| `CommunityToken`                        | Yes          | ERC20 balance migration is operationally expensive. The proxy address is the canonical token address.             |
| `PresenceToken`                         | Yes          | Decaying proof-of-presence balances should stay at a stable address while compatible logic fixes remain possible. |
| `SweatToken`                            | Yes          | Same reasoning as `PresenceToken`.                                                                                |
| `TokenizedStays`                        | Yes          | Date entitlement, staking, and locking state is complex and expensive to migrate.                                 |
| `ITransferPolicy` implementations       | No           | Deploy a new policy contract and point the token/profile at it.                                                   |
| TDF-specific sale and migration helpers | Usually no   | Sales and migration helpers are bounded-purpose modules. Deploy new versions when needed.                         |

Adding a role does not upgrade or replace `VillageAccess`: compute the new `bytes32` role ID, configure its admin if
needed, grant it, and upgrade only the UUPS module or replaceable policy that consumes the role. A grant has no effect
until some contract checks that role.

If `VillageAccess` behavior itself must change, validate and deploy a compatible UUPS implementation, then have the
Safe execute `upgradeToAndCall` against the existing proxy. Consumer `setRoleAuthority` functions remain an independent
emergency recovery path if an authority upgrade becomes unusable: deploy and seed a replacement authority, verify it,
and have the Safe atomically repoint every consumer.

Upgradeable modules should use new OpenZeppelin Contracts 5.x upgradeable implementations. Do not upgrade already-deployed OpenZeppelin 4.x proxy implementations in place to OpenZeppelin 5.x implementations.

Proxy requirements:

- use initializers, not constructors, for proxy state;
- lock implementation contracts with `_disableInitializers()`;
- use OpenZeppelin upgrade validation in tests and deployment scripts;
- preserve storage compatibility on every implementation upgrade;
- authorize all implementation upgrades only through the village owner/Safe;
- test unauthorized upgrade attempts and state preservation across upgrades.

## Implementation Steps

### 0. Establish Solidity And OpenZeppelin Baseline

Before adding generic modules, make the compiler and library baseline explicit.

Changes:

- upgrade the Hardhat Solidity compiler profile to the latest stable release, `0.8.35`;
- update exact Solidity pragmas from `0.8.28` to `0.8.35` where contracts are compiled by the default profile;
- upgrade OpenZeppelin dependencies to the selected Contracts 5.x release;
- account for the current legacy contracts' OpenZeppelin 4.x API surface before expecting the full suite to compile against OpenZeppelin 5.x. Legacy imports such as `security/ReentrancyGuard.sol`, `SafeMath`, and ERC20 `_beforeTokenTransfer` hooks must either be migrated to 5.x-compatible APIs or isolated in a legacy compiler/dependency strategy;
- deploy new generic upgradeable modules as fresh OpenZeppelin 5.x proxies. Do not attempt an in-place v4-to-v5 implementation upgrade for existing v4-style proxies;
- keep `evmVersion: 'paris'` unless Celo and Celo Sepolia compatibility is explicitly validated for a newer EVM target;
- do not enable Solidity experimental compiler modes in Phase 2;
- run the full compile and test suite before implementing new generic modules.

If reproducible legacy bytecode becomes important, keep legacy TDF contracts on a separate `0.8.28` compiler profile instead of forcing the legacy diamond through the new compiler.

### 1. Preserve Legacy TDF Modules

Keep these modules available as legacy or TDF-specific modules:

- current `TDFDiamond` deployment;
- `TDFToken`;
- `DynamicSale`;
- fixed `Crowdsale`;
- TDF treasury transfer exceptions;
- diamond-specific deployment and role-handoff scripts.

Deployment scripts should clearly distinguish legacy TDF modules from generic village modules. Generic village v1 must not require `DynamicSale`, `Crowdsale`, or `TDFDiamond`.

If legacy files are moved, move them under `src/legacy/tdf-v1/**`, `test/legacy/tdf-v1/**`, and `deploy/legacy/tdf-v1/**` in a separate move-only step so behavior changes remain reviewable.

### 2. Add Generic Role Authority

Add `VillageAccess` and `VillageRoles`.

`VillageAccess` responsibilities:

- hold generic village roles;
- provide the standard OpenZeppelin role API;
- provide enumerable role membership for roles that need on-chain listing;
- support granting narrow API-operator roles;
- use village owner/Safe as the initial default admin when the address is known, even if deployment is sent from another address;
- support a delayed Safe admin handoff only when temporary deployer admin is unavoidable, with no retained Closer deployer admin role after the Safe accepts;
- expose `setRoleAdmin(bytes32,bytes32)` for controlled future role-admin changes.

`VillageRoles` responsibilities:

- define reusable role constants;
- keep generic modules independent from `AccessControlLib`;
- preserve role names that map to current behavior where useful;
- avoid deployment and storage. This is a library or interface, not a role registry.

### 3. Add Generic Community Token

Add `CommunityToken` as an upgradeable configurable ERC20 using OpenZeppelin ERC20 components.

Initializer inputs should include:

- name;
- symbol;
- initial supply;
- initial recipient;
- role authority;
- optional transfer policy.

Behavior:

- minting is role-gated through `MINTER_ROLE`;
- burning is role-gated or self-service only where explicitly implemented;
- transfer policy is mutable only by an admin role;
- zero transfer-policy address means open transfers;
- include OpenZeppelin `ERC20Permit` so tokenized-stays deposits and booking top-ups can authorize `TokenizedStays` in the same user flow without a separate approval transaction;
- OpenZeppelin 5.x transfer customization should use `_update`, not the old `_beforeTokenTransfer` hook;
- pausing, if included, should use OpenZeppelin `Pausable` or `ERC20Pausable`;
- the token proxy address is the canonical token address used by UI, backend, staking, and policy modules;
- include likely standard ERC20 extensions from day one where they are expected to be needed. Later token-extension upgrades are allowed only when OpenZeppelin upgrade validation proves storage compatibility.

Do not copy `TDFToken`'s custom pausability, DAO-specific transfer wording, or DAO infinite-allowance override into generic `CommunityToken`.

### 4. Generalize Presence And Sweat Tokens

Keep the decaying non-transferable ERC20 base behavior, but remove TDF-specific and diamond assumptions. Keep the generic contract names `PresenceToken` and `SweatToken`.

Changes:

- rename `daoAddress` concepts to `roleAuthority`;
- use OpenZeppelin `IAccessControl` as the role-authority interface;
- keep configurable name, symbol, decay rate, role authority, and owner/Safe;
- create `SweatToken` as the generic sweat/contribution token;
- create `PresenceToken` as the generic proof-of-presence token while keeping the module ID `presence-token`;
- preserve decay helpers, batch minting, burn flows, `burnAll`, non-decayed getters, and non-transferability;
- preserve the current operational authorization shape where minting and burning are allowed for `BOOKING_PLATFORM_ROLE`, `BOOKING_MANAGER_ROLE`, or the owner/Safe unless a module-specific review chooses a narrower rule;
- migrate OpenZeppelin 5.x ERC20 transfer restrictions to `_update` where needed;
- deploy both tokens behind OpenZeppelin proxies from day one.

Do not reuse TDF treasury-transfer issuance policy as generic behavior.

### 5. Keep Membership Off-Chain

Do not add `IVillageMembership`, membership roles, or membership wrappers to `VillageAccess`. No V2 contract consumes
them, while the API already owns membership, booking approval, and lifecycle state. Add a separate on-chain membership
module only if a future use case requires contracts to consume a clearly defined membership model such as expiry,
tiers, delegated wallets, payments, history, or portable credentials.

### 6. Add Optional Tokenized-Stays Module

Refactor the current diamond booking and staking behavior into a generic optional upgradeable module.

`TokenizedStays` should depend on:

- community token;
- role authority;
- village owner/Safe;
- optional transfer or booking policy interfaces if implementation work finds that village-specific rules should be replaceable.

`TokenizedStays` is the natural escrow for tokenized-stay staking:

- it should hold staked `CommunityToken` balances;
- it should use OpenZeppelin `SafeERC20` and `ReentrancyGuard` patterns where token transfers and state changes interact;
- `CommunityToken` transfer policy must allow the transfers needed for deposits, booking-driven stake locks, withdrawals, and restaking;
- fresh token pulls from a user wallet must be authorized through normal ERC20 allowance or `ERC20Permit`;
- transfer policy only decides whether a transfer is permitted; it does not bypass `transferFrom` allowance checks;
- support permit-based entry points such as `depositWithPermit(...)` and permit-enabled booking/top-up flows where `TokenizedStays` needs to pull fresh tokens;
- the TDF v2 default uses the same allowance or permit flow; V1's implicit infinite allowance is not reproduced.

It should provide the V2 behavior that remains on-chain:

- accommodation year/calendar setup;
- enabled and disabled years;
- active date-entitlement creation and future-date cancellation by the user or booking manager;
- duplicate active-date rejection;
- booking creation/cancellation events suitable for off-chain indexing;
- booking list and getter views;
- stake deposits;
- stake withdrawals;
- restaking;
- locked and unlocked stake views;
- booking-driven stake locking and release calculations.

Ordinary Closer booking and its full lifecycle remain API-based. An on-chain `Booking` is only an active date/price
record used by tokenized-stay staking; it deliberately has no status field.

### 7. Add Optional TDF-Specific Policy Modules

Keep TDF policy out of the generic core.

TDF-specific modules may include:

- `TDFTransferPolicy`;
- optional TDF v2 sale module;
- migration helpers from current TDF contracts;
- TDF deployment profile configuration.

`TDFTransferPolicy` should contain TDF-only transfer permission rules such as treasury transfer exceptions. It must not be described as spender authorization and must not be relied on to bypass ERC20 allowance.

TDF v2 uses explicit ERC20 allowance or EIP-2612 permit. It does not include a privileged-spender compatibility
extension modeled after the V1 `TDFToken.allowance()` override.

These modules may depend on generic interfaces, but generic modules must not depend on TDF-specific modules.

### 8. Update Tests

Keep all existing TDF tests passing.

Add focused tests for:

- `VillageAccess` admin setup with a known Safe seeded as initial default admin from a separate deployer address, role grants, revokes, renounces, role-admin changes, dynamic future roles, and deployer admin removal;
- delayed `AccessControlDefaultAdminRules` handoff behavior if a temporary-deployer profile is implemented: deployer can schedule the Safe, only the Safe can accept after the delay, and deployer admin removal is proven after acceptance rather than immediately after deployment;
- `VillageRoles` constants matching expected role names;
- `CommunityToken` proxy initialization, initial supply, mint role, burn behavior, `ERC20Permit`, pausing if included, and transfer policy;
- `PresenceToken` proxy initialization, role authority, minting, burning, decay helpers, and non-transferability;
- `SweatToken` proxy initialization, role authority, minting, burning, decay helpers, and non-transferability;
- `TokenizedStays` proxy initialization and deployment only when enabled;
- tokenized-stays active date creation, duplicate rejection, manager/user cancellation, and event history;
- tokenized-stays staking deposit, withdraw, restake, locked, and unlocked flows;
- tokenized-stays escrow transfer behavior with normal ERC20 allowance and with permit;
- V2 allowance and permit flows without a token-level privileged-spender bypass;
- authorized and unauthorized upgrades for `CommunityToken`, `PresenceToken`, `SweatToken`, and `TokenizedStays`;
- upgrade validation and state preservation across representative implementation upgrades;
- deployment profiles proving modules can be included or skipped independently.

Add negative tests that confirm:

- unauthorized API operators cannot perform admin actions;
- unauthorized accounts cannot upgrade proxy-backed modules;
- villages can deploy `PresenceToken` and `SweatToken` without the diamond;
- villages can deploy `PresenceToken` and `SweatToken` without tokenized stays;
- generic modules do not import or require `AccessControlLib`;
- generic modules do not import from `src/legacy/**`;
- generic modules do not expose unused project-specific membership state or APIs;
- a transfer policy alone cannot make `TokenizedStays` spend user tokens without allowance or permit;
- the Closer deployer does not retain generic admin roles after initialization when the Safe is seeded as initial admin, or after Safe acceptance when a temporary-deployer handoff flow is explicitly used.

V1/V2 parity tests are intentionally excluded from the current scope. V2 deliberately does not preserve the legacy
on-chain status lifecycle or implicit unlimited allowance. Focused V2 tests define the selected product behavior;
targeted migration/parity tests can be added later only for a concrete migration requirement.

## Acceptance Checks

Phase 2 is done when:

- Phase 1 checks still pass.
- Solidity compiler configuration and default-profile source pragmas are upgraded to `0.8.35`.
- OpenZeppelin dependencies are upgraded to the selected Contracts 5.x release.
- Existing TDF behavior remains supported.
- Generic modules compile and test.
- New generic contracts live under `src/village/**` and do not import from legacy or TDF-specific modules.
- TDF v2-specific contracts live under `src/profiles/tdf-v2/**` and depend on generic modules instead of reintroducing diamond assumptions.
- Generic modules use OpenZeppelin components instead of custom access-control or pausing code where the library already provides the needed behavior.
- `VillageAccess`, `CommunityToken`, `PresenceToken`, `SweatToken`, and `TokenizedStays` are deployed through OpenZeppelin proxies with validated upgrade paths.
- Upgrade authority for every proxy-backed module is controlled only by the village owner/Safe, and unauthorized upgrades fail.
- Proxy upgrades preserve representative token balances, decay state, booking state, and staking state.
- A village can deploy `PresenceToken` and `SweatToken` without deploying the TDF diamond.
- A village can deploy a community token without deploying tokenized stays.
- A village can deploy tokenized stays only when selected.
- Membership and booking workflow approval remain off-chain; TokenizedStays stores only active date entitlements.
- `TokenizedStays` can act as the staking escrow, fresh token pulls are authorized by allowance or permit, and the selected transfer policy permits the token movements needed by deposit, withdrawal, restake, and booking-driven lock/release flows.
- TDF v2 can be represented as a deployment profile over generic modules.
- Generic modules do not depend on TDF-specific policy contracts.
- Focused V2 tests prove the deliberately selected behavior without requiring broad V1 parity.
- Known-Safe deployment profiles prove the Closer deployer does not retain admin roles after initialization. Any temporary-deployer handoff profile records the pending Safe acceptance state and proves deployer admin removal after the Safe accepts.

## Out Of Scope

- No production one-click UI/API integration yet.
- Safe auto-creation and versioned manifest persistence exist as contracts-repository Phase 3 foundations, but are not
  required for the Phase 2 contract acceptance boundary.
- No production migration from current TDF to TDF v2 yet.
- No requirement to convert the legacy TDF diamond in Phase 2.
- No in-place upgrade of existing OpenZeppelin 4.x proxy implementations to OpenZeppelin 5.x implementations.
- No requirement to physically move all legacy files unless the move is done as a separate move-only cleanup.
- No Foundry requirement.

## Assumptions

- Villages may choose different module combinations.
- Some villages may want proof-of-presence without a village token.
- Some villages may want proof-of-presence without tokenized stays.
- Some villages may want tokenized stays without a TDF-style token sale.
- Generic access authority is needed because role authority must exist outside `TDFDiamond`.
- Phase 2 keeps membership off-chain. Introduce a separate registry or credential module only when concrete on-chain requirements exist.
- TDF v2 should be built from generic modules plus TDF-specific policies, not from another TDF-only architecture.
- The proxy address is the canonical address for each upgradeable token and for `TokenizedStays`.
- Future roles can be granted on the existing `VillageAccess`; future behavior changes require modules or policies that check those roles.
- Future village-specific business rules should usually be added through new optional modules or replaceable policies instead of expanding the generic core.
