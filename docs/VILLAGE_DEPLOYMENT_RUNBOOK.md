# Village deployment runbook

Use [Deployment](./DEPLOYMENT.md) for schema and command details.

## Before deployment

1. Review the source revision and run the full repository checks.
2. Choose a unique, immutable lowercase village slug for the target chain.
3. For a generic village, list only the contracts the village actually needs. Review the dependencies printed by the
   CLI. For TDF, use the dedicated preset input and do not duplicate locked launch constants.
4. Confirm chain ID, API operator, treasury/recipient addresses, token parameters, and final owner.
5. For a Safe owner, record the exact expected owners and threshold in the config. Verify the intended Safe proxy,
   singleton/release, chain, deployed code, owners, and threshold independently. The deployment tool validates only
   code, the Safe read interface, and the configured membership/threshold. Keep deployer and Safe proposer credentials
   separate.
6. Retain the reviewed config as an immutable release record. Back it up and commit it together with the resulting
   real-network Ignition deployment directory and operational manifest.

## Testnet rehearsal

Run the same command, resolved config, ownership route, verification, and optional upgrade flow on Celo Sepolia:

```sh
yarn deploy:village -- --config <config.json> --network celoSepolia
# or
yarn deploy:tdf -- --config <tdf.json> --network celoSepolia
```

Review the printed requested/auto-added/resolved contract sets before transactions. A rerun with the same slug and
resolved spec must reconcile the same addresses. A changed resolved spec under the same chain/slug must fail with a
manifest collision.

Complete and retain evidence for all four release rehearsals:

1. Verify the Ignition deployment on Celo Sepolia and inspect the explorer presentation of every plain contract,
   proxy, and implementation. Record any provider-specific retry that was required.
2. Deploy with a real EOA deployer and the intended Safe as `finalOwner`. Submit and reconcile the EOA-to-Safe
   handoff, then confirm the manifest is `complete`, no owner action remains pending, and every live owner/default admin
   is the Safe.
3. With the Safe owning a dedicated rehearsal proxy, prepare, review, execute, and reconcile a Safe-owned upgrade with
   nonempty migration calldata. The standard rehearsal candidate is `CommunityTokenUpgradeMock` with
   `initializeUpgrade(42, false)`; after execution require `upgradeValue() == 42` as the migration-specific
   postcondition.
4. On a clean checkout or machine at the same source revision, restore only the reviewed config, matching real-network
   Ignition directory, and existing manifest. Reinstall the pinned toolchain, rerun the same command, and confirm it
   resumes/reconciles the same addresses without submitting replacement deployments.

## Production deployment

1. If this release replaces the live V1 system, stop until the separately audited migration, snapshot reconciliation,
   rehearsal, and rollback procedure is approved. The fresh V2 deployment command does not migrate V1 state.
2. Run the appropriate deploy command on `celo`.
3. Inspect `deployments/villages/<chainId>/<slug>.json` and `ignition/deployments/<deployment-id>/`.
4. If ownership is pending, submit or propose it and later reconcile:

```sh
yarn owner:submit -- --manifest <manifest.json> --network celo
yarn owner:status -- --manifest <manifest.json> --network celo
```

5. Require manifest status `complete`, an empty `pendingOwnerActions`, correct live owners/default admin, expected role
   membership with no unexpected operational-role holders, correct wiring and immutable configuration, nonempty
   bytecode, matching code hashes, and matching ERC-1967 slots.
6. Verify with the explicit Ignition command printed by deployment:

```sh
yarn hardhat --network celo ignition verify <deployment-id>
```

Verification failure does not justify redeployment. Retry the built-in command after resolving explorer/provider
availability.

## Recovery

- If the process stops during deployment, rerun the same command with the same config, network, slug, and Ignition
  directory.
- If Ignition finished but the manifest was not written, rerun; the journal resumes without new deployments.
- A fresh recovery environment needs the reviewed immutable config as well as the Ignition directory and any existing
  manifest. The manifest's config hash cannot reconstruct deployment parameters.
- If the manifest exists and the config hash differs, stop. Choose a new slug only for an intentionally new
  deployment.
- Treat on-chain authority, proxy slots, bytecode, and events as authoritative. Safe Transaction Service state is
  advisory.

## Upgrade

Prepare, submit, and reconcile as three explicit steps:

```sh
yarn upgrade:prepare -- --manifest <manifest.json> --contract <name> \
  --implementation <artifact> --version <version> --network celo \
  [--call <migration-function> --call-args '<json-array>']
yarn upgrade:submit -- --manifest <manifest.json> --upgrade <name>:<version> --network celo
yarn upgrade:status -- --manifest <manifest.json> --upgrade <name>:<version> --network celo
```

Commit the updated manifest and the upgrade Ignition directory after review.

Upgrade preparation must reject a `pending-handoff` manifest or any live pending ownership/default-admin transfer.
For Safe submissions, re-check the proposed batch and nonce in the Safe UI; the command rebuilds the transaction from
the current incomplete actions and current nonce on every submission.

For every upgrade, reviewers must record the expected proxy target, candidate implementation, `upgradeToAndCall`
calldata, and any decoded migration function/arguments before signing. A successful receipt alone shows that the call
did not revert; it is not a semantic assertion about the migrated state. After execution:

1. Run `upgrade:status` and require the prepared implementation address, runtime-code hash, ERC-1967 slot, and unique
   `Upgraded` event to reconcile.
2. Query and record the release-specific postcondition for every migration call. Examples include an initialized
   version/value, a newly configured dependency, or an exact transformed-state invariant.
3. Confirm preserved pre-upgrade state and that a one-time reinitializer cannot be called again.
4. Commit the reconciled manifest and test evidence. Do not mark the release complete when the implementation
   reconciles but a migration-specific postcondition fails or was never defined.
