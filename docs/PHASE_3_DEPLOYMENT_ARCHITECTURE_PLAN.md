# Phase 3 deployment architecture plan

Date: 2026-07-15

> This document preserves the original design rationale. The simplified implemented ownership, manifest, Safe, and
> upgrade workflow in [`PHASE_3_ONE_CLICK_DEPLOYMENT_PLAN.md`](./PHASE_3_ONE_CLICK_DEPLOYMENT_PLAN.md) is authoritative
> where the two documents differ. Task status remains in [`V2_REMAINING_WORK.md`](./V2_REMAINING_WORK.md).

## Decision

Contract deployment and one-click village deployment are separate concerns:

1. Independently deployable **contract Modules** perform safe, repeatable EVM deployment mechanics for one contract.
2. **Village profile Modules** compose the same contract Modules into a complete on-chain village deployment.
3. A **one-click orchestration Module** selects a profile, invokes Ignition, coordinates final-owner actions, verifies
   postconditions, and publishes a product manifest.

The one-click flow is therefore an orchestrator over normal deployment tooling. It must not contain a second copy of
the contract deployment logic or shell out to a chain of unrelated deployment scripts.

For V2, use this stack:

- **Hardhat 3** for compilation, artifacts, network connections, tests, and plugins.
- **Hardhat Ignition** as the sole V2 contract deployment, transaction journaling, reconciliation, and resumption
  engine.
- **OpenZeppelin Contracts** for audited UUPS implementations and the audited `ERC1967Proxy` inherited by
  `VillageUUPSProxy`.
- **OpenZeppelin Hardhat Upgrades validation** as a mandatory preflight through `validateImplementation` and
  `validateUpgrade`; Ignition, rather than `deployProxy`, submits the V2 deployment transactions.
- **Hardhat Verify and Ignition verification** for Etherscan-compatible explorers and Sourcify.
- **Safe Protocol Kit** for constructing one atomic `MultiSendCallOnly` final-owner transaction and **Safe API Kit**
  for optional Transaction Service proposal/status synchronization.
- **Zod** at untrusted configuration and manifest boundaries.
- A strict compact product manifest for Safe actions, product postconditions, verification attempts, and publication;
  it is not a second transaction or orchestration journal.

Keep Rocketh/hardhat-deploy as the legacy V1 deployment engine only. V2 must not create competing Rocketh state.

## OpenZeppelin support in Ignition

Three related OpenZeppelin capabilities must not be conflated:

1. `@openzeppelin/contracts-upgradeable` contains Solidity base contracts such as `UUPSUpgradeable` and
   `ERC20Upgradeable`. Ignition deploys implementations using these contracts normally.
2. `@openzeppelin/contracts` contains proxy implementations such as `ERC1967Proxy` and
   `TransparentUpgradeableProxy`. Ignition can deploy these audited contracts directly. The official Ignition proxy
   guide demonstrates this explicit implementation-plus-proxy model.
3. `@openzeppelin/hardhat-upgrades` provides the `deployProxy`, `upgradeProxy`, `prepareUpgrade`, validation,
   implementation-reuse, `.openzeppelin` network-state, and extended verification APIs. Ignition does not currently
   expose those asynchronous deployment APIs as Ignition Futures.

The selected design uses capabilities 1 and 2 for on-chain deployment and capability 3 for mandatory validation. It
does not use `deployProxy` for V2 initial deployment.

This avoids two competing contract-deployment stores. If Ignition deployed a proxy and the project later wanted the
OpenZeppelin plugin to manage that same proxy through `upgradeProxy` or `prepareUpgrade`, the proxy could be
registered with `forceImport`, but Ignition state and `.openzeppelin` state would then both need to be preserved and
reconciled. That is a supported escape hatch, not the default V2 workflow.

Official references:

- [Hardhat Ignition module composition and proxy deployment](https://hardhat.org/ignition/docs/guides/upgradeable-proxies)
- [Hardhat Ignition reconciliation and resumability](https://hardhat.org/ignition/docs/explanations/reconciliation)
- [Hardhat Ignition CLI, deployment IDs, parameters, and `--verify`](https://hardhat.org/ignition/docs/reference/cli-commands)
- [OpenZeppelin Upgrades validation and deployment behavior](https://docs.openzeppelin.com/upgrades-plugins)
- [OpenZeppelin Hardhat Upgrades API and `forceImport`](https://docs.openzeppelin.com/upgrades-plugins/api-hardhat-upgrades)
- [OpenZeppelin network deployment files](https://docs.openzeppelin.com/upgrades-plugins/network-files)
- [Safe API Kit proposal and confirmation flow](https://docs.safe.global/sdk/api-kit/guides/propose-and-confirm-transactions)

## Why Ignition fits the required interfaces

The required operational interfaces are:

- deploy one specific contract independently;
- deploy a selected group of contracts for a village;
- deploy a complete named village profile;
- resume any of those deployments after an interruption;
- use the exact same contract definitions from the one-click backend flow;
- verify either an individual deployment or a complete village deployment.

Ignition contract Modules provide the reusable unit. Each contract Module can be deployed directly. A profile Module
uses `m.useModule` to compose those same child Modules into one dependency graph. The one-click orchestrator selects
and deploys the profile Module programmatically.

This is preferable to having the one-click flow invoke multiple CLI processes. Thin CLIs and the one-click flow share
the same Ignition Module definitions, so there is only one Implementation of each deployment.

## Implemented architecture and remaining hardening

The target separation is now implemented:

- `ignition/modules/contracts/**` contains the six reusable contract Modules and one shared explicit UUPS proxy
  construction helper;
- `ignition/modules/profiles/**` composes those Modules through `m.useModule`, including stable custom module-set
  graphs for village-specific selections;
- `scripts/deployment/ignition.ts` is the contract deployment Implementation used by `deploy:contract`,
  `deploy:village`, and `deploy:tdf-v2`;
- OpenZeppelin validation runs before Ignition and neither `deployProxy` nor the former manual test fallback is a V2
  deployment engine;
- Ignition owns contract transaction recovery; the smaller Closer journal contains only authority/orchestration
  transactions;
- the no-op V2 Rocketh marker files have been removed, while `deploy/legacy/**` remains unchanged;
- live wrappers and manual retry call the same Ignition verification task by deployment ID;
- `upgrade:v2:prepare` validates compatibility, deploys the proposed implementation through Ignition, and prepares
  the final-owner/Safe action without executing it.

Remaining hardening is tracked only in `V2_REMAINING_WORK.md`: Celo Sepolia explorer rehearsal and proxy linking,
provider-specific verification classification, final manifest/export corruption coverage, and the broader Safe
upgrade/reinitializer/rollback scenario matrix.

## Target Modules

### 1. Independently deployable contract Modules

Create one Ignition Module per deployable V2 contract:

- `VillageAccessModule`;
- `CommunityTokenModule`;
- `VillagePresenceTokenModule`;
- `VillageSweatTokenModule`;
- `TokenizedStaysModule`;
- `TDFTransferPolicyModule`.

Each Module owns only the mechanics for its contract:

- typed parameters required for constructor or initializer arguments;
- implementation deployment when upgradeable;
- atomic initializer calldata encoding;
- audited `VillageUUPSProxy` deployment when upgradeable;
- `m.contractAt` attachment of the implementation ABI to the proxy address;
- returned implementation, proxy, and typed contract Futures;
- deployment metadata needed for verification and the product manifest.

An upgradeable Module follows this shape conceptually:

```ts
const CommunityTokenModule = buildModule('CommunityTokenModule', (m) => {
  const {villageAccess} = m.useModule(VillageAccessModule);
  const implementation = m.contract('CommunityToken');
  const initializerData = m.encodeFunctionCall(implementation, 'initialize', [
    m.getParameter('name'),
    m.getParameter('symbol'),
    m.getParameter('initialSupply'),
    m.getParameter('initialRecipient'),
    villageAccess,
    m.getParameter('transferPolicy'),
    m.getParameter('owner'),
  ]);
  const proxy = m.contract('VillageUUPSProxy', [implementation, initializerData]);
  const communityToken = m.contractAt('CommunityToken', proxy);

  return {communityToken, implementation, proxy};
});
```

The real initializer arguments must match the contract ABI and the validated deployment config. Passing initializer
calldata to the proxy constructor is mandatory so no externally initializable proxy window exists.

The Module must not know about unrelated village modules, Safe Transaction Service state, product status, or manifest
publication. This gives high Locality and lets the same Module run independently or inside a profile.

### 2. Village profile Modules

Create explicit profile Modules:

- `MinimalVillageModule`;
- `TokenVillageModule`;
- `TokenizedStaysVillageModule`;
- `TdfV2VillageModule`.

Each profile uses `m.useModule` to compose contract Modules and encodes only on-chain dependencies that Ignition can
execute with the deployment signer. Profile Modules return every deployed contract needed by reconciliation and
manifest publication.

The TDF profile additionally uses internal `TdfCommunityTokenModule` and `TdfTokenizedStaysModule` composition
Modules. They introduce no new contracts: they pass the `TDFTransferPolicy` Future directly into
`CommunityToken.initialize` and then pass the token Future into `TokenizedStays.initialize`. This keeps generic
standalone deployment parameters intact while ensuring an internally deployed policy is active from the token's first
balance update.

Profiles are deliberately explicit rather than one runtime-conditional mega-module. The one-click orchestrator maps
the validated `deploymentProfile` to the corresponding Module. A village-specific adjustment belongs in a typed
parameter, a named optional extension Module, or a new profile—not an ad hoc branch inside a contract Module.

### 3. Upgrade-safety preflight

Ignition's ability to deploy an OpenZeppelin proxy does not itself run the OpenZeppelin Hardhat Upgrades validation
suite. Every supported production entrypoint must therefore run a preflight before invoking Ignition:

- `validateImplementation(factory, {kind: 'uups'})` for every selected UUPS implementation;
- `validateUpgrade(currentFactory, nextFactory, {kind: 'uups'})` for every upgrade;
- initializer argument/count and parent-initializer checks;
- `_disableInitializers()` constructor pattern on implementations;
- configured `_authorizeUpgrade` authority;
- no broad `unsafeAllow` or `unsafeSkipStorageCheck` bypasses;
- compilation/build-info availability required by the validator.

The existing `validate:upgrades` command remains a CI gate, but CI alone is insufficient: individual and one-click
production deployment wrappers must also run the relevant validation before a signer submits transactions.

Direct raw Ignition CLI use may remain available for local development. The documented production commands must use
the validation wrapper so users cannot accidentally bypass the safety gate.

### 4. Deployment entrypoints

Expose both individual and composed interfaces:

```text
scripts/deploy-contract.ts       # validated deployment of one selected contract Module
scripts/deploy-village.ts        # validated deployment of one selected profile Module
```

Recommended commands:

```text
npm run deploy:contract -- --contract CommunityToken --config <file>
npm run deploy:village -- --config <file>
npm run deploy:tdf-v2 -- --config <file>
```

Optional package aliases such as `deploy:community-token` may call `deploy:contract` with a fixed contract selector.
The wrapper performs config parsing, chain matching, OpenZeppelin preflight, stable deployment-ID selection, Ignition
invocation, on-chain reconciliation, verification policy, and output formatting.

The one-click orchestrator imports or programmatically invokes the same profile/contract Modules. It does not invoke
the individual CLI entrypoints as child processes.

### 5. Deployment identity and state

Use a stable Ignition deployment ID derived from the target, not from timestamps:

```text
village-<chainId>-<villageSlug>-<deploymentProfile>
```

For an independent contract not associated with a village:

```text
contract-<chainId>-<logicalDeploymentName>-<contractModule>
```

If an individual Module intentionally extends an existing village deployment, it must use that village's deployment
ID and compatible Module/Future IDs so Ignition can reconcile existing Futures. Otherwise it receives a distinct
deployment ID. Reusing a deployment ID with incompatible parameters must be rejected.

Maintain three deliberately different artifacts:

- `ignition/deployments/<deploymentId>/**`: Ignition's authoritative contract transaction journal;
- Closer orchestration state: Safe proposal/execution, product postconditions, verification retries, and publication;
- `VillageDeploymentManifest`: stable product-facing result for Closer API/UI.

The latter two must reference the Ignition deployment ID. They must not duplicate or mutate Ignition's transaction
journal. Rocketh and `.openzeppelin` deployment state are not authoritative for V2.

#### Implementation reuse

Unlike OpenZeppelin `deployProxy`, separate Ignition deployment IDs do not automatically reuse an implementation with
identical bytecode. The initial V2 design should deploy a fresh implementation for each village deployment. This
costs more gas but avoids a hidden cross-village implementation registry and makes provenance, recovery, and
independent contract deployment straightforward.

If deployment volume later makes reuse valuable, introduce it explicitly: deploy validated implementations under a
chain-and-bytecode-hash Ignition deployment ID, pass the implementation address into village Modules, verify its
runtime code hash and UUPS UUID, and record that shared dependency in every manifest. Do not accept an arbitrary
existing implementation address merely to save gas.

### 6. Authority orchestration

Ignition deploys contracts and can execute calls owned by the deployment signer. It cannot sign or execute an
arbitrary Safe-owned operation without the configured Safe threshold.

The authority Module accepts planned final-owner calls and produces one of these states:

- no owner action required;
- EOA calls executed and reconciled;
- Safe `MultiSendCallOnly` prepared;
- Safe transaction proposed and awaiting confirmations/execution;
- Safe transaction executed and reconciled.

All Safe-owned calls known at planning time must be encoded in one atomic batch. Transaction Service submission is
optional coordination; on-chain state remains authoritative for execution and completion.

### 7. Verification

Ignition supports `--verify` for direct CLI deployment and a verification task for an existing deployment ID. The
one-click programmatic path should invoke the same verification capability after Ignition has checkpointed mined
receipts.

Recommended policy:

- local and ephemeral networks: `off`;
- live networks: `best-effort` by default;
- verify all implementation, proxy, and plain-contract Futures;
- use Etherscan-compatible and Sourcify verifiers where supported;
- record per-provider results as `pending`, `verified`, `already-verified`, `retryable-failure`, or
  `terminal-failure`;
- retry indexing-related failures with bounded backoff;
- allow `ignition verify <deploymentId>` or the shared verification wrapper to resume later;
- never redeploy a successful contract because an explorer is unavailable.

OpenZeppelin's extended Hardhat verification task officially guarantees complete proxy verification for proxies
deployed by the Hardhat Upgrades plugin. Because V2 proxies will be Ignition-deployed, test CeloScan's automatic
proxy/implementation linking during the Celo Sepolia rehearsal. Verification of both addresses is required even if
the explorer does not automatically link them. Do not create `.openzeppelin` state solely for cosmetic explorer
linking.

### 8. Manifest publication

The manifest publishes only reconciled facts:

- Ignition deployment ID and selected Module IDs;
- proxy and implementation addresses;
- deployment and implementation transaction hashes;
- ABI/source/artifact metadata;
- selected profile and product aliases;
- final owner, API operator, roles, and pending owner actions;
- Safe proposal/execution state;
- per-provider verification state;
- compiler, OpenZeppelin, Hardhat, Ignition, source revision, and config hash.

The manifest is the Interface to other Closer repositories. It is not Ignition's journal and must not be used to infer
unreconciled completion.

## Suggested file structure

```text
ignition/
  modules/
    contracts/
      VillageAccess.ts
      CommunityToken.ts
      VillagePresenceToken.ts
      VillageSweatToken.ts
      TokenizedStays.ts
      TDFTransferPolicy.ts
    profiles/
      MinimalVillage.ts
      TokenVillage.ts
      TokenizedStaysVillage.ts
      TdfCommunityToken.ts
      TdfTokenizedStays.ts
      TdfV2Village.ts

scripts/
  deploy-contract.ts
  deploy-village.ts
  deployment/
    config.ts
    preflight.ts
    authority.ts
    state.ts
    verification.ts
    manifest.ts
    village-orchestrator.ts
```

Keep Ignition Modules declarative and entrypoints thin. Avoid one wrapper per library call or duplicating contract
deployment logic in the orchestrator.

## Execution sequences

### Individual contract

1. Parse and validate the contract-specific config.
2. Resolve the target chain and signer.
3. Run OpenZeppelin UUPS validation when applicable.
4. Derive or validate the stable deployment ID.
5. Deploy the selected Ignition contract Module.
6. Reconcile runtime code, proxy implementation slot, initializer state, and owner/roles.
7. Attempt best-effort verification.
8. Return a machine-readable deployment result suitable for later manifest import.

### One-click village

1. Parse and validate the versioned `VillageDeploymentConfig` before connecting a signer.
2. Resolve the chain and reject network/config mismatch.
3. Select the explicit village profile Module.
4. Run OpenZeppelin validation for every selected UUPS implementation.
5. Open or reconcile the Ignition deployment ID.
6. Deploy the profile; Ignition executes the composed contract Module dependency graph.
7. Reconcile proxy slots, owners, roles, module wiring, treasury, and transfer-policy state.
8. Execute EOA-owned final actions or prepare one Safe MultiSend batch.
9. If direct-Safe execution is pending, publish `pending-owner-actions` with the prepared Protocol Kit transaction;
   resume contract transactions only through Ignition and reconcile completion from live contract state.
10. After owner actions execute, rerun and reconcile all final authority invariants.
11. Attempt best-effort Ignition verification for all deployed Futures.
12. Atomically publish the village manifest and derived ABI/address export.

## Future upgrades

Use Ignition for deployment transactions and OpenZeppelin for mandatory compatibility validation:

1. `validateUpgrade(currentFactory, nextFactory, {kind: 'uups'})` must pass.
2. An Ignition upgrade Module deploys the new implementation under a stable upgrade deployment ID.
3. The authority Module prepares the UUPS `upgradeToAndCall` operation for the owner Safe.
4. Safe owners review and execute the operation.
5. The orchestrator reconciles the ERC-1967 implementation slot and authority invariants.
6. Ignition/Hardhat verification runs for the new implementation.
7. The product manifest gains an immutable upgrade-history entry.

The API operator has no implementation-upgrade authority, and the deployment worker does not retain owner authority.

If a future requirement genuinely needs `prepareUpgrade` or `upgradeProxy`, explicitly `forceImport` the relevant
proxy and treat `.openzeppelin` as an additional governed artifact from that point onward. Do not introduce that state
implicitly.

## Migration plan

### Stage 0: lock current behavior

- Add a focused Safe MultiSend test proving every planned owner call is present, ordered correctly, and atomic.
- Add production-path tests that prove OpenZeppelin validation runs before any Ignition transaction.
- Preserve config safety defaults, legacy isolation, collision rejection, crash/resume, ownership, role, wiring, Safe,
  and on-chain reconciliation tests.
- Add independent contract deployment and profile-composition tests.
- Add verification tests for plain, implementation, proxy, retry, and existing-deployment flows.

### Stage 1: introduce Ignition contract Modules

- Install and configure the Hardhat 3 Ignition ethers integration.
- Implement and test one independently deployable Module per V2 contract.
- Ensure UUPS Modules deploy `VillageUUPSProxy` with atomic initializer calldata.
- Compare resulting runtime state against the current OpenZeppelin `deployProxy` path before removing it.

### Stage 2: introduce profile Modules

- Compose contract Modules with `m.useModule` for every supported profile.
- Map the versioned deployment config to Ignition parameters.
- Replace V2's no-op Rocketh provenance files with actual Ignition Module/Future IDs.
- Keep legacy Rocketh deployment untouched.

### Stage 3: add supported deployment wrappers

- Add the validated `deploy:contract` interface.
- Migrate `deploy:village` and `deploy:tdf-v2` to select profile Modules.
- Make raw Ignition CLI usage explicitly local/developer-level unless validation is run first.
- Record stable deployment IDs and reconcile reruns.

### Stage 4: integrate orchestration state and Safe handling

- Remove contract transaction journaling from the custom village code and rely on Ignition for that concern.
- Retain a smaller Closer journal only for Safe state, product postconditions, verification retry, and publication.
- Make the authority Module the sole implementation for building, proposing, checking, and reconciling Safe actions.

### Stage 5: integrate automatic verification

- Run Ignition verification automatically for live-network individual and profile deployments.
- Keep verification by deployment ID as the recovery path.
- Record implementation, proxy, and plain-contract provider results in the product manifest.
- Test CeloScan proxy linking without adding OpenZeppelin deployment state solely for verification.

### Stage 6: backend one-click integration

- Run the same validated `deploy:village` entrypoint from an isolated Closer deployment worker.
- Resume by Ignition deployment ID and config hash after RPC or worker timeouts.
- Propose the prepared Safe transaction when configured, then reconcile on-chain before activation.
- Publish only the reconciled manifest to API/UI consumers.

### Stage 7: live rehearsal

- Rehearse every contract Module, profile, and owner mode on Celo Sepolia.
- Test interrupted deployment, resume, Safe confirmation/execution, explorer outage, verification retry, manifest
  import, and a validated Safe-owned UUPS upgrade.
- Activate one pilot village before wider rollout.

## Acceptance criteria

- Every V2 contract has an independently callable, validated deployment interface.
- Every village profile composes the same contract Modules rather than reimplementing them.
- The one-click orchestrator invokes Ignition Modules programmatically and does not shell out through contract CLIs.
- Ignition is the sole V2 contract transaction/deployment journal.
- OpenZeppelin implementation/upgrade validation runs before every applicable production deployment.
- `VillageUUPSProxy` initialization is atomic and proxy implementation slots are reconciled.
- Rocketh state is used only by explicitly named legacy V1 commands.
- V2 no longer depends on no-op Rocketh files as provenance markers.
- Interrupted deployment resumes without redeploying reconciled Futures.
- One Safe MultiSend contains all known final-owner actions.
- On-chain state, not Transaction Service or journal state alone, determines completion.
- Live-network deployments attempt verification automatically.
- Explorer outages produce visible retryable state without invalidating deployed contracts.
- Future Safe-owned upgrades use Ignition implementation deployment plus OpenZeppelin compatibility validation.

## Explicit non-goals

- Migrating the legacy V1 diamond away from Rocketh in this phase.
- Using OpenZeppelin `deployProxy` and `.openzeppelin` as a second default V2 deployment engine.
- Making Foundry the primary deployment engine in a Hardhat 3/TypeScript codebase.
- Using Tenderly simulation as a production prerequisite; it can be added later as an optional preflight.
- Automatically executing a Safe transaction without the configured owner threshold.
- Treating explorer verification as part of EVM transaction atomicity.
