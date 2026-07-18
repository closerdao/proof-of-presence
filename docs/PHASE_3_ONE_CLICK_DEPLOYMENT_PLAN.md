# Phase 3: V2 Deployment And Upgrade Architecture

Date: 2026-07-17

> **Status:** Implemented in `scripts/deployment/**`, `scripts/deploy-*.ts`, and `ignition/modules/**`. The remaining
> cross-repository API/UI rollout is tracked in
> [`PHASE_3_CROSS_REPOSITORY_INTEGRATION.md`](./PHASE_3_CROSS_REPOSITORY_INTEGRATION.md) and
> [`V2_REMAINING_WORK.md`](./V2_REMAINING_WORK.md).

## Goals

- Keep V2 deployment resumable, deterministic, and small enough to audit.
- Use standard tooling instead of maintaining a second deployment engine.
- Support either an existing Safe or an EOA as the final production authority.
- Support a deployer that completes configuration and then initiates a two-step authority handoff.
- Validate UUPS implementations and upgrades before preparing owner transactions.
- Keep legacy TDF V1 behavior and deployment state isolated and unchanged.

## Tool Boundaries

- **Hardhat Ignition** is the only V2 deployment and resumption journal. Stable deployment IDs and Module IDs make
  reruns idempotent. The wrapper does not parse or duplicate Ignition's journal.
- **OpenZeppelin Hardhat Upgrades** validates UUPS implementations and storage compatibility. It is a validation layer,
  not a second V2 deployment engine.
- **Safe Protocol Kit** constructs Safe transactions and their hashes. **Safe API Kit** proposes them and reads
  Transaction Service state. The deployment code does not implement Safe nonce, hash, signature, or multisend logic.
- **Rocketh/hardhat-deploy** remains scoped to `deploy/legacy/tdf-v1/**`.
- The V2 manifest is a strict, compact product artifact. It is not an outer transaction journal.

## Versioned Configuration

Every V2 deployment uses the strict schema-v2 input parsed by `scripts/deployment/config.ts`:

```json
{
  "schemaVersion": 2,
  "villageSlug": "example-village",
  "chainId": 42220,
  "deploymentProfile": "tdf-v2",
  "ownership": {
    "mode": "direct",
    "finalOwner": {
      "type": "safe",
      "address": "0x...",
      "expectedOwners": ["0x...", "0x..."],
      "expectedThreshold": 2
    }
  },
  "modules": [],
  "apiOperator": "0x...",
  "communityToken": {"name": "Village Token", "symbol": "VILLAGE"},
  "presenceToken": {"decayRatePerDay": "288617"},
  "sweatToken": {"decayRatePerDay": "288617"},
  "tdfTransferPolicy": {"treasury": "0x...", "restrictionsEnabled": true}
}
```

Supported profiles are `minimal-village`, `token-village`, `tokenized-stays-village`, and `tdf-v2`. The `modules`
array adds allowlisted modules to a profile. `tokenizedStays` requires `communityToken`; `tdf-v2` selects all V2 TDF
modules and requires both decay rates and the transfer-policy config.

When `CommunityToken` and an internally deployed `TDFTransferPolicy` are selected together, the Ignition graph passes
the policy Future into the token initializer. The zero policy remains available for generic unrestricted tokens, but
the TDF token never has an unrestricted bootstrap window while counterparty owner actions are pending.

Configuration validation occurs before deployment and includes chain ID, stable slug, nonzero addresses, module
relationships, initial supply recipient, role safety, and Safe owner/threshold expectations. Initial operational roles
are seeded by `VillageAccess.initialize`; the API operator is never made default admin or upgrader.

## Ownership Modes

### Direct (default)

Contracts initialize directly with the final Safe or EOA as authority.

- A direct EOA must be available among the configured Hardhat signers so required post-deployment actions can be sent.
- A direct Safe must already exist on the selected chain. Its code, owner set, and threshold are checked before
  deployment when expectations are supplied.
- Owner-only post-deployment configuration is recorded as `ownerActions`.
- For a Safe, Protocol Kit prepares one transaction and the manifest remains `pending-owner-actions` until execution is
  observed on-chain. For an EOA, `owner:submit` sends the actions with the matching signer.
- Completion is based on contract state, not only a transaction receipt or Safe service status.

### Deployer handoff

Contracts initialize with the deployer temporarily as authority.

1. The deployer executes the remaining policy counterparty, restriction, and other deployment configuration.
2. The runner verifies the configured state.
3. Each `Ownable2Step` contract receives `transferOwnership(finalOwner)`.
4. `VillageAccess` receives `beginDefaultAdminTransfer(finalOwner)`.
5. The runner verifies every pending recipient and marks this deployment run complete.

Acceptance by the final EOA or Safe is deliberately outside deployment orchestration. The manifest and CLI print a
`manualActions` entry for each `acceptOwnership` or `acceptDefaultAdminTransfer` call, including target, calldata,
recipient, initiating transaction hash, and admin acceptance schedule. A rerun tolerates a partially or fully accepted
handoff, but acceptance does not change the recorded deployment-completion meaning.

## Deployment Flow

1. Parse the strict config and verify its chain ID against the selected network.
2. Derive a stable Ignition deployment ID from chain, village, profile, and target.
3. Run OpenZeppelin implementation validation before any Ignition deployment.
4. Deploy the selected static/composed Ignition Module graph.
5. Verify runtime code, EIP-1967 implementation slots, initializer wiring, roles, and policy state.
6. Execute deployer-owned actions or prepare direct-owner actions according to the ownership mode.
7. Write the strict schema-v2 manifest atomically.
8. Run verification separately through Ignition; a verifier outage does not roll back a successful deployment.

A crash before manifest publication is recovered by rerunning the same command and deployment ID. Ignition resumes its
journal, and the wrapper rebuilds and reconciles the manifest from returned deployment results and live contract state.
No second transaction/proxy/ABI map is maintained.

## Commands

```bash
npm run deploy                         # help only; never deploys
npm run deploy:legacy -- <network>     # V1 only
npm run deploy:contract -- --contract <name> --config <file> --network <network>
npm run deploy:village -- --config <file> --network <network>
npm run deploy:tdf-v2 -- --config <file> --network <network>

npm run owner:submit -- --manifest <file> --network <network> [--upgrade <contract>:<version>]
npm run owner:status -- --manifest <file> --network <network> [--upgrade <contract>:<version>]

npm run verify:village -- --manifest <file>
npm run export:village -- --manifest <file> [--out <file>]
```

`safe:propose` and `safe:status` remain compatibility aliases for `owner:submit` and `owner:status`. They do not add a
second Safe workflow.

## Manifest

The strict manifest contains only data consumers and operations need:

- schema/config versions and config hash;
- source/network/profile/module provenance;
- each contract's address, implementation address when applicable, ABI, initializer/constructor arguments, and code
  hashes;
- deployer, initial authority, final authority, and ownership mode;
- initial role grants;
- pending direct-owner actions and at most one prepared Safe transaction;
- informational manual handoff acceptance calls;
- concise verification attempts;
- Ignition deployment/Module IDs and relevant package versions;
- immutable upgrade history.

It intentionally omits a duplicate transaction journal, selected source-file lists, top-level ABI maps, duplicate proxy
maps, and custom orchestration checkpoints. Unknown fields and malformed nested records are rejected when the manifest
is read or written.

## Upgrade Flow

`upgrade:v2:prepare` is generic for manifest-managed UUPS contracts:

1. Read the live EIP-1967 implementation before deploying anything.
2. Require it to match either the manifest's current implementation or a known prepared candidate that was executed.
3. Select the matching current artifact and run OpenZeppelin `validateUpgrade` against the requested implementation.
4. Encode optional migration calldata from `--call` and JSON `--call-args`.
5. Deploy only the new implementation through a stable Ignition upgrade Module.
6. Simulate the complete `upgradeToAndCall` from the current authority with `eth_call`.
7. Record the implementation code hash, spec hash, validation time, and owner action.
8. Prepare a Safe transaction when the current authority is a Safe; otherwise leave the action for the configured EOA.

The prepare command never executes an upgrade. `owner:submit` sends/proposes it, and `owner:status` reconciles service
and live implementation state. A second conflicting prepared upgrade for the same contract is rejected.

## Verification And Export

`verify:village` delegates to `hardhat ignition verify` for the manifest deployment ID and stores only a concise attempt
summary. `export:village` derives consumer address/ABI data from each manifest contract record. Neither command creates
independent deployment state.

## Acceptance Criteria

- Bare `deploy` is non-transactional.
- V1 and V2 deployment namespaces cannot be mixed by the V2 wrappers.
- OpenZeppelin validation happens before implementation deployment.
- Rerunning the same config resumes the same Ignition deployment and addresses.
- Direct EOA, direct Safe, EOA handoff, and Safe handoff are covered by tests.
- Handoff configuration is complete before authority transfer starts.
- Safe transaction construction uses Protocol Kit and proposal/status uses API Kit.
- Manifest completion is reconciled from on-chain postconditions.
- Upgrade preparation rejects stale live implementations and validates the actual live storage lineage.
- V1 sources, tests, compiler profile, and deployment state remain available under the explicit legacy namespace.
