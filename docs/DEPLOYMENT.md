# Deployment

## Configuration

Every deployment starts from a strict JSON config. Unknown fields, missing schema versions, invalid addresses, and
profile/module inconsistencies are rejected before the network deployment graph runs.

Example TDF config:

```json
{
  "schemaVersion": 3,
  "villageSlug": "example-village",
  "chainId": 11142220,
  "deploymentProfile": "tdf",
  "ownership": {
    "mode": "direct",
    "finalOwner": {
      "type": "safe",
      "address": "0x1111111111111111111111111111111111111111",
      "expectedOwners": [
        "0x2222222222222222222222222222222222222222"
      ],
      "expectedThreshold": 1
    }
  },
  "modules": [],
  "apiOperator": "0x3333333333333333333333333333333333333333",
  "communityToken": {
    "name": "Example Community",
    "symbol": "EXAMPLE",
    "initialSupply": "0",
    "apiOperatorCanMint": true
  },
  "presenceToken": {
    "name": "Example Presence",
    "symbol": "PRES",
    "decayRatePerDay": "288617"
  },
  "sweatToken": {
    "name": "Example Contribution",
    "symbol": "CONTRIB",
    "decayRatePerDay": "288617"
  },
  "tdfTransferPolicy": {
    "treasury": "0x4444444444444444444444444444444444444444",
    "allowedCounterparties": [],
    "restrictionsEnabled": true
  }
}
```

Use decimal strings for integers that may exceed JavaScript's safe integer range. The selected RPC chain ID must
match `chainId`. A TDF profile requires a treasury and enables every module.

## Commands and records

Deploy a profile:

```sh
yarn deploy:village -- --config config.json --network celoSepolia
yarn deploy:tdf -- --config config.json --network celoSepolia
```

Deploy one allowlisted contract and its required dependencies:

```sh
yarn deploy:contract -- --contract TDFTransferPolicy --config config.json --network celoSepolia
```

Canonical manifest paths are:

- `deployments/villages/<chainId>/<villageSlug>.json`
- `deployments/profiles/tdf/<chainId>/<villageSlug>.json`
- `deployments/contracts/<chainId>/<villageSlug>/<contract>.json`

Ignition state is under `ignition/deployments/<deploymentId>/`. For real networks, retain the exact config, source
revision, Ignition journal, manifest, and verification output in version control and durable backup. Localhost and
ephemeral Hardhat outputs remain ignored.

Rerunning the same config resumes the stable Ignition deployment ID and reconciles live state. Reusing a manifest path
with a different config hash fails.

## Ownership and verification

A direct EOA deployment can execute its owner actions immediately. A direct Safe deployment records
`pending-owner-actions`; propose and monitor the batch with:

```sh
yarn owner:submit -- --manifest <manifest.json> --network <network>
yarn owner:status -- --manifest <manifest.json> --network <network>
```

In deployer-handoff mode, `manualActions` records the final owner's acceptance calls. The deployment wrapper may
report setup complete once transfers are initiated, but a product must independently confirm every final authority
before activation.

Verification is retryable and never changes whether a successfully reconciled deployment exists:

```sh
yarn verify:village -- --manifest <manifest.json> --network <network>
```

## Upgrades

Prepare a validated implementation and owner action:

```sh
yarn upgrade:prepare -- --manifest <manifest.json> --contract CommunityToken \
  --implementation CommunityTokenNext --version release-2026-08 --network celoSepolia \
  --call initializeUpgrade --call-args '[42,false]'
```

The command compares the current and next implementation storage layouts, deploys the candidate through Ignition,
records its runtime code hash, and prepares `upgradeToAndCall`. Owner submission/status commands accept
`--upgrade <contract>:<version>`. Live ERC-1967 proxy state is reconciled before another candidate can be prepared.

## Deployment schemas

`schemaVersion` is a wire-format discriminator for JSON files. It protects readers from silently interpreting a file
whose fields or meanings have changed.

This repository uses:

- config schema `3`;
- manifest schema `3`, which records `configSchemaVersion: 3`;
- consumer export schema `2`.

Config parsing requires the literal `3`; there is no default. The version is part of the canonical config hash.
Manifest parsing also requires the exact current literals. The current schema renamed the profile to `tdf` and the
record kind to `deploymentKind`, so older shapes are intentionally rejected instead of accepted through aliases.

Schema versions are independent of Solidity versions, proxy implementation revisions, `reinitializer(n)`, and
Ignition's internal journal format. Increase a schema version when a breaking JSON field, type, invariant, or meaning
changes. Additive fields may still require a bump when strict consumers would otherwise reject them.
