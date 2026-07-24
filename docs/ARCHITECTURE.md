# Architecture

## Source boundaries

The repository has two production source areas:

- `src/village` contains reusable village contracts.
- `src/profiles/tdf` contains the TDF transfer policy and historical V1-compatible pricing curve.

`src/village/test` contains test-only proxy, Safe, policy, and upgrade implementations. It is excluded from
production security coverage. There is no separate historical source or deployment engine in this branch.

## Contract model

`VillageAccess` is the shared role authority. It uses enumerable access control and delayed default-admin transfer.
The operational roles are:

- `MINTER_ROLE` for CommunityToken mint/burn operations.
- `BOOKING_MANAGER_ROLE` for managed TokenizedStays cancellation.
- `BOOKING_PLATFORM_ROLE` for Presence/Sweat issuance.

`CommunityToken` is an ERC-20/ERC-2612 token with pausing, role-based mint/burn, an owner-adjustable maximum supply,
and a replaceable `ITransferPolicy`. A zero policy explicitly disables policy checks. Every mint path enforces
`maxSupply`; the owner may raise it or lower it no further than the current total supply.

`DynamicPriceSale` is an optional buy-only CommunityToken issuer. The caller always pays the quote token and may
choose another recipient. Pricing is delegated to an ERC-165 `IBondingCurve`, and both quotes and purchases use the
CommunityToken's live `totalSupply()`. External mints and burns therefore move the price and remaining capacity by
design; the TDF policy only prevents burns that would leave the V1 sale outside its safe operating supply. A purchase
splits the curve-calculated total payment between the village treasury and Closer; the fee is included in the curve
cost rather than added on top. Fixed launch limits live in proxy storage, while the village owner may replace the
curve, treasury, and atomic fee configuration, pause purchases, or upgrade the sale.

`VillagePresenceToken` and `VillageSweatToken` are non-transferable decaying tokens over the same implementation
base. Their readable balances decay with time while mint/burn accounting and holder checkpoints preserve provenance.

`TokenizedStays` holds CommunityToken deposits and records calendar-day entitlements with a price for each date. It
enforces a fixed 365-day lock window, Gregorian date validity, a bounded booking horizon, pause controls, and
role-authorized managed cancellation. Off-chain booking workflow state such as confirmation or check-in does not live
in this contract.

`TDFTransferPolicy` is a replaceable, non-upgradeable policy. While restricted, ordinary transfers must involve the
treasury or an allowed counterparty. Minting remains allowed, while burns must leave at least 5,381 TDF in supply.
That burn floor remains active even when ordinary transfer restrictions are disabled. The policy is deployed
restricted so setup fails closed.

`TDFV1BondingCurve` is stateless, ownerless, and non-upgradeable. Its name records that the implementation preserves
the historical V1 formula, units, evaluation order, and cent rounding. Its 4,109–200,000 TDF domain is a mathematical
input boundary, not the TDF token maximum or sale cap. TDF launches instead use a 5,381 TDF operating floor: it is the
lowest historical V1 quote-vector supply and safely supports the full configured 1–100 TDF purchase range with the
unchanged V1 checked arithmetic. The initial V2 TDF token maximum is 18,600 TDF and the primary sale cap is
15,097.5 TDF.

## Upgrade and storage model

`VillageAccess`, `CommunityToken`, the decaying tokens, `TokenizedStays`, and `DynamicPriceSale` use UUPS proxies.
Ignition deploys an implementation and `VillageUUPSProxy` with initializer calldata in the proxy constructor,
eliminating an externally initializable proxy window.

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
- `tdf`: all village modules plus TDFTransferPolicy, DynamicPriceSale, and a new TDFV1BondingCurve.

Other valid module combinations use a deterministic module ID derived from a stable module bit set. Existing graphs
without a sale retain their previous IDs; sale-enabled graphs use new IDs. The same contract modules are reused by
standalone contract deployment and profiles.

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
