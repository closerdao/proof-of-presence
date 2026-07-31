# Deployment

Hardhat Ignition is the transaction journal and resumption engine. The repository wrapper resolves a strict config,
validates UUPS implementations, builds one deterministic graph, performs address-dependent setup, reconciles live
state, and writes a slim operational manifest.

## Deployment schemas

Deployment configs and manifests both use `schemaVersion: 2`. The version identifies each strict JSON wire format; it
is unrelated to protocol V1/V2, contract versions, proxy storage versions, initializer revisions, or Ignition
journals. The production V1 system on `main` predates this format and has no schema-1 manifest. Within the V2 tooling,
only schema 2 is supported, so removed draft fields fail validation instead of being migrated.
All unsigned-integer contract values are decimal strings. JSON numbers are rejected even when small, avoiding a
second representation that becomes unsafe above JavaScript's exact-integer range. Decimal strings must fit Solidity
`uint256`; Presence/Sweat `decayRatePerDay` additionally cannot exceed the contract limit of `4399711`. Chain IDs, fee
basis points, and Safe thresholds remain bounded JSON numbers as defined by the schema.

## Generic config

Generic schema-2 configs select canonical contract names:

```json
{
  "schemaVersion": 2,
  "villageSlug": "example-village",
  "chainId": 11142220,
  "contracts": ["TokenizedStays", "VillageCitizenNFT"],
  "finalOwner": {
    "type": "safe",
    "address": "0x1111111111111111111111111111111111111111",
    "expectedOwners": ["0x2222222222222222222222222222222222222222"],
    "expectedThreshold": 1
  },
  "apiOperator": "0x3333333333333333333333333333333333333333",
  "communityToken": {
    "name": "Example Community",
    "symbol": "EXAMPLE",
    "maxSupply": "18600000000000000000000"
  },
  "citizenNft": {
    "baseURI": "https://example.invalid/citizens/"
  }
}
```

Dependencies are automatic:

- `CommunityToken`, `VillagePresenceToken`, `VillageSweatToken`, and `VillageCitizenNFT` require `VillageAccess`.
- `TokenizedStays` and `DynamicPriceSale` require `CommunityToken` and `VillageAccess`.
- `TDFTransferPolicy` has no dependency.

The command prints requested, auto-added, and resolved contracts before opening a network connection. Configuration
for a resolved contract is required; configuration for an unselected contract is rejected as unused.

```sh
yarn deploy:village -- --config config.json --network celoSepolia
```

A single contract uses the same command, for example `"contracts": ["TDFTransferPolicy"]`. There is no separate
single-contract deployment engine.

## TDF preset

`deploy:tdf` accepts village-specific values and applies the locked TDF contract set and launch constants:

```json
{
  "schemaVersion": 2,
  "villageSlug": "example-tdf",
  "chainId": 11142220,
  "finalOwner": {
    "type": "safe",
    "address": "0x1111111111111111111111111111111111111111",
    "expectedOwners": ["0x2222222222222222222222222222222222222222"],
    "expectedThreshold": 1
  },
  "apiOperator": "0x3333333333333333333333333333333333333333",
  "communityToken": {
    "initialSupply": "5381000000000000000000",
    "initialRecipient": "0x4444444444444444444444444444444444444444"
  },
  "citizenNft": {"baseURI": "https://example.invalid/citizens/"},
  "presenceToken": {"decayRatePerDay": "288617"},
  "sweatToken": {"decayRatePerDay": "288617"},
  "tdfTransferPolicy": {"treasury": "0x5555555555555555555555555555555555555555"},
  "dynamicPriceSale": {
    "quoteToken": "0x6666666666666666666666666666666666666666",
    "villageTreasury": "0x5555555555555555555555555555555555555555",
    "closerFeeRecipient": "0x7777777777777777777777777777777777777777"
  }
}
```

```sh
yarn deploy:tdf -- --config tdf.json --network celoSepolia
```

The preset locks max supply 18,600 TDF, sale cap 15,097.5 TDF, 1–100 TDF whole-token purchases, recipient limit 915
TDF, 500 bps Closer fee, minimum operating supply 5,381 TDF, and the internal V1 curve. These fields are absent from
the input so they cannot be overridden accidentally.

## Identity and records

The graph ID hashes schema version 2, the canonically ordered resolved contract set, and any graph-changing preset. The
Ignition deployment ID contains chain ID, village slug, and that graph hash. Thus the same village/spec resumes one
journal, while different village slugs deploy independent instances of the same graph.

The committed records are:

- The reviewed immutable deployment config used by the command.
- `ignition/deployments/<deployment-id>/` for Ignition journals, addresses, and build information on real networks.
- `deployments/villages/<chainId>/<villageSlug>.json` for reconciled operational state.

The manifest stores identity, canonical addresses, code hashes, current implementations, ownership state, pending
actions, minimal Safe transaction data, and prepared/executed upgrade evidence. It does not store ABIs, constructor
or initializer arguments, deployment parameters, verification attempts, tool versions, or Safe Transaction Service
snapshots. It cannot replace the immutable config during recovery.

## Ownership

All fresh contracts start under the deployer so address-dependent setup can finish atomically. Authority is then
transferred with Ownable2Step or AccessControlDefaultAdminRules.

```sh
yarn owner:submit -- --manifest <manifest.json> --network <network>
yarn owner:status -- --manifest <manifest.json> --network <network>
```

EOA and Safe final owners are supported. Safe service data is advisory and is printed, not persisted; live contract
authority determines completion. If a Safe transaction executes unsuccessfully, rerun the submit command to prepare
and propose a replacement using the Safe's current nonce. Every submission re-derives the still-incomplete actions
and current Safe transaction; a stale persisted transaction is never proposed when its hash no longer matches.

A Safe config must include the exact expected owners and threshold. Deployment checks code, the Safe read interface,
membership, and threshold. This deliberately does not attest a particular Safe singleton or release, so operators
must verify the Safe identity independently.

## Verification

Verification is explicit and uses Ignition directly. The deploy command prints the exact command:

```sh
yarn hardhat --network <network> ignition verify <deployment-id>
```

Explorer availability therefore cannot change deployment or manifest state.

## Upgrades

```sh
yarn upgrade:prepare -- --manifest <manifest.json> --contract <name> \
  --implementation <artifact> --version <version> [--network <network>] \
  [--call <migration-function> --call-args '<json-array>']
yarn upgrade:submit -- --manifest <manifest.json> --upgrade <name>:<version> [--network <network>]
yarn upgrade:status -- --manifest <manifest.json> --upgrade <name>:<version> [--network <network>]
```

Preparation validates storage/UUPS compatibility, deploys the implementation through Ignition, hashes its bytecode,
simulates `upgradeToAndCall` from live authority, and records a Safe or EOA action. Execution is accepted only after
the ERC-1967 slot, implementation code hash, and exact `Upgraded` event reconcile. A failed Safe proposal is reported
by the status command and replaced by the next submit command. Preparation is blocked until the deployment ownership
handoff is complete and no ownership/default-admin transfer remains pending.

Reconciliation proves that the prepared implementation became active. It does not prove the intended semantic result
of arbitrary migration calldata. Every release that supplies `--call` must define and check a migration-specific
postcondition after the transaction, in addition to reviewing the exact target and calldata before submission.
