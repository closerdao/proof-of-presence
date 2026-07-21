# Architecture

## Source boundaries

The repository has two production source areas:

- `src/village` contains reusable village contracts.
- `src/profiles/tdf` contains the TDF transfer policy.

`src/village/test` contains test-only proxy, Safe, policy, and upgrade implementations. It is excluded from
production security coverage. There is no separate historical source or deployment engine in this branch.

## Contract model

`VillageAccess` is the shared role authority. It uses enumerable access control and delayed default-admin transfer.
The operational roles are:

- `MINTER_ROLE` for CommunityToken mint/burn operations.
- `BOOKING_MANAGER_ROLE` for managed TokenizedStays cancellation.
- `BOOKING_PLATFORM_ROLE` for Presence/Sweat issuance.

`CommunityToken` is an ERC-20/ERC-2612 token with pausing, role-based mint/burn, and a replaceable
`ITransferPolicy`. A zero policy explicitly disables policy checks.

`VillagePresenceToken` and `VillageSweatToken` are non-transferable decaying tokens over the same implementation
base. Their readable balances decay with time while mint/burn accounting and holder checkpoints preserve provenance.

`TokenizedStays` holds CommunityToken deposits and records calendar-day entitlements with a price for each date. It
enforces a fixed 365-day lock window, Gregorian date validity, a bounded booking horizon, pause controls, and
role-authorized managed cancellation. Off-chain booking workflow state such as confirmation or check-in does not live
in this contract.

`TDFTransferPolicy` is a replaceable, non-upgradeable policy. While restricted, ordinary transfers must involve the
treasury or an allowed counterparty; minting and burning remain allowed. The policy is deployed restricted so setup
fails closed.

## Upgrade and storage model

`VillageAccess`, `CommunityToken`, the decaying tokens, and `TokenizedStays` use UUPS proxies. Ignition deploys an
implementation and `VillageUUPSProxy` with initializer calldata in the proxy constructor, eliminating an externally
initializable proxy window.

Production implementations:

- disable direct initialization in their constructors;
- authorize upgrades through the contract's owner or default admin;
- keep custom state in ERC-7201 namespaced storage;
- use OpenZeppelin's stateless UUPS and Initializable bases from Contracts 5.6;
- are validated by the OpenZeppelin Hardhat Upgrades plugin before deployment and upgrade preparation.

`TokenizedStays` uses `ReentrancyGuardTransient`, so Cancun support is part of the build boundary. Upgrade tests use
generation-neutral `*UpgradeMock` implementations. A test reinitializer may use numeric revision `2`; that number is
an initializer revision and is unrelated to product or deployment schemas.

## Deployment architecture

Contract Ignition modules are composed into stable profile modules. Supported profiles are:

- `minimal-village`: VillageAccess only unless extra modules are selected.
- `token-village`: VillageAccess and CommunityToken.
- `tokenized-stays-village`: VillageAccess, CommunityToken, and TokenizedStays.
- `tdf`: all village modules plus TDFTransferPolicy.

Other valid module combinations use a deterministic module ID derived from a stable module bit set. The same contract
modules are reused by standalone contract deployment and profiles.

Hardhat Ignition is the sole transaction journal and resumption engine. The deployment wrapper adds config
validation, OpenZeppelin validation, ownership/Safe handling, on-chain reconciliation, verification, and atomic
manifest publication. It never replaces Ignition's journal.

## Authority model

Two ownership modes are supported:

- `direct`: contracts initialize directly to the final EOA or Safe. Final-owner configuration actions may remain in
  `pending-owner-actions` until submitted and reconciled.
- `deployer-handoff`: the deployer completes configuration, initiates two-step ownership/admin transfers, and records
  acceptance calls in `manualActions`.

Safe-owned actions are prepared as one atomic transaction. Safe Transaction Service state is advisory; live contract
postconditions determine completion. The API operator receives only configured operational roles and has no upgrade
authority.

## Build boundary

All contracts compile with Solidity 0.8.35, optimizer runs 2000, and the Cancun EVM target. OpenZeppelin Contracts and
Contracts Upgradeable are both pinned to 5.6.1. There are no compiler overrides or older OpenZeppelin aliases in the
current branch.
