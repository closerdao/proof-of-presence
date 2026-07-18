# V2 Smart Contracts Architecture, Security, and Phase Readiness Review

Review date: 2026-07-13

> This review records the repository state and recommendations at the review date. Implemented resolutions are tracked
> in [`V2_REMEDIATION_IMPLEMENTATION.md`](./V2_REMEDIATION_IMPLEMENTATION.md). The later deployment-tooling decision—
> Hardhat Ignition for independently deployable/composable V2 Modules with mandatory OpenZeppelin validation—is
> recorded in [`PHASE_3_DEPLOYMENT_ARCHITECTURE_PLAN.md`](./PHASE_3_DEPLOYMENT_ARCHITECTURE_PLAN.md) and supersedes
> deployment-engine recommendations below where they differ. The authoritative status checklist for all unfinished
> work is [`V2_REMAINING_WORK.md`](./V2_REMAINING_WORK.md); findings and recommendations below are historical evidence,
> not the current task tracker. The reviewed membership interface, roles, wrappers, and deployment option were later
> removed because no V2 production contract consumed them; membership-specific findings below describe the old state.

## Executive verdict

The v2 direction is substantially better than the legacy architecture: generic modules are separated from TDF-specific policy, the diamond is not part of new village deployments, OpenZeppelin components are used for the standard primitives, and the selected stateful modules are deployed behind fresh UUPS proxies.

However, v2 is **not production-ready**, Phase 2 is **not complete against its own acceptance criteria**, and the repository is **not yet ready to treat Phase 3 one-click deployment as a safe production workflow**.

The main blockers are not stylistic. They affect booking economics, escrow solvency, lifecycle correctness, upgrade safety, role-governance safety, Safe ownership guarantees, TDF v2 integration, and deployment recoverability. In particular:

- a user chooses the stake `price` for their own booking and can choose zero;
- the escrow token can be replaced while liabilities remain, stranding the old token and corrupting withdrawals;
- cancellation and check-in transitions permit invalid lifecycle changes;
- the production proxy deployment path does not run OpenZeppelin upgrade-safety or storage-layout validation;
- `setRoleAdmin` lets a lower-level role administrator permanently rewrite and capture a role hierarchy;
- a configured Safe may still be controlled by the Closer deployer or API operator because Safe signers are not checked against those identities;
- TDF v2's transfer policy does not automatically permit `TokenizedStays`, so the nominal profile can be marked complete while deposits and withdrawals are blocked;
- the decaying-token dual ledger can be desynchronized by caller-supplied burn ages and loses fractional decay time at every mint/burn checkpoint;
- core paths perform loops over permanently growing historical arrays;
- rerunning or recovering a deployment is not idempotent and can overwrite the canonical manifest with a second set of contracts.

Do not deploy these v2 contracts with real value until the high-severity findings are resolved, invariant/fuzz testing is added, OpenZeppelin upgrade validation is part of CI and production deployment, and an independent smart-contract audit is performed.

## Scope and method

Reviewed:

- `src/village/**`;
- `src/profiles/tdf-v2/**`;
- v2 deployment, verification, export, and manifest tooling;
- `test/village/**` and `test/profiles/tdf-v2/**`;
- `docs/PHASE_2_GENERIC_VILLAGE_CONTRACTS_PLAN.md`;
- `docs/PHASE_3_ONE_CLICK_DEPLOYMENT_PLAN.md`;
- Hardhat, Rocketh, compiler, dependency, lint, and test configuration.

The legacy contract implementation was intentionally not reviewed. It was considered only as a namespace that v2 must not import and as an existing test baseline that the repository still runs.

Checks performed:

- `npm test`: exit 0; Mocha reported 171 passing and 5 pending, with Hardhat reporting 176 tests in total;
- v2 Solhint over `src/village/**/*.sol` and `src/profiles/**/*.sol`: exit 0 (its optional update check could not resolve the npm registry inside the sandbox, but linting completed successfully);
- import-boundary scan: generic village contracts do not import legacy, diamond, or TDF-profile code;
- initializer, implementation-lock, UUPS authorization, unsafe-opcode, and proxy-deployment review;
- comparison with current OpenZeppelin Contracts and OpenZeppelin Upgrades guidance.

This is a code and architecture review, not a formal audit. No contract, deployment, plan, or test code was changed.

## What is already good

- The `src/village`, `src/profiles/tdf-v2`, and `src/legacy/tdf-v1` split is clear and mechanically enforceable.
- Generic village code has no legacy, diamond, `AccessControlLib`, sale, or TDF-policy dependency.
- `VillageAccess` correctly uses OpenZeppelin's upgradeable default-admin and enumerable access-control components rather than custom role storage.
- Generic V2 contracts expose no project-specific membership state or API; membership remains off-chain until a
  concrete on-chain membership module is required.
- `CommunityToken` correctly uses OpenZeppelin ERC20, permit, pausing, ownership, and UUPS components, and customizes transfers through the OpenZeppelin 5 `_update` hook.
- Implementations call `_disableInitializers()` in their constructors, initializers initialize all current OpenZeppelin parents, and proxy initialization is atomic with proxy construction.
- `TokenizedStays` uses `SafeERC20` and `ReentrancyGuard` around token-moving entry points.
- TDF-only transfer rules live in `src/profiles/tdf-v2`, while generic modules depend only on `ITransferPolicy`.
- The zero transfer-policy address gives open ERC20 transfers as planned.
- Upgrade authorization is explicitly implemented and restricted to the module owner/Safe, while VillageAccess requires its default-admin Safe.
- The bare deployment command is non-transactional, and legacy, village, and TDF v2 commands are visibly separated.
- Manifests distinguish proxy and implementation addresses and include constructor/initializer data, transaction hashes, ABI data, owner, role grants, and pending actions.

These are solid foundations worth preserving while correcting the issues below.

## High-severity findings

### H-01: Users choose their own booking stake requirement

Evidence:

- [`bookAccommodation`](../src/village/stays/TokenizedStays.sol#L172) and [`bookAccommodationWithPermit`](../src/village/stays/TokenizedStays.sol#L176) accept `price` directly from the caller.
- The caller-provided value is stored in the booking and passed to the staking calculation at [`_bookAccommodation`](../src/village/stays/TokenizedStays.sol#L401).
- There is no minimum price, signed quote, price oracle, booking policy, or manager authorization.

Impact:

Any account can book an enabled date with `price = 0` and provide no stake. A pending booking can also be replaced with a lower caller-chosen price. UI or backend validation cannot protect a public contract function.

Recommendation:

Define the pricing authority before launch. Suitable designs include:

- a manager-signed EIP-712 booking quote binding account, dates/resource, price, nonce, deadline, chain ID, and `TokenizedStays` address;
- a replaceable `IStayPricingPolicy` that returns the required stake;
- manager-only on-chain booking creation if all ordinary booking is API-operated.

Reject zero stake unless an explicit policy authorizes a free booking. Add replay protection and tests proving a user cannot reduce or substitute the quoted price.

### H-02: Changing `communityToken` can make the escrow insolvent

Evidence:

- The owner can replace the token at any time through [`setCommunityToken`](../src/village/stays/TokenizedStays.sol#L118).
- Existing deposit and booking liabilities remain denominated only as raw amounts in `_deposits`.
- Withdrawals always transfer the _current_ `communityToken` at [`_withdrawUnlocked`](../src/village/stays/TokenizedStays.sol#L568).

Impact:

After a token change, the original escrow tokens remain trapped while withdrawals attempt to pay the new token. The ledger does not identify which token backs each liability, and there is no global-liability check or migration process. Even an accidental owner action can permanently break withdrawals.

Recommendation:

Prefer making the escrow token fixed after initialization. If token migration is a real requirement, require the contract to be paused, prove there are no liabilities, or implement an explicit audited migration that preserves per-account claims and verifies old/new token balances. Track total liabilities and enforce `tokenBalance >= totalLiabilities` as an invariant.

### H-03: Booking state transitions and cancellation authority are inconsistent

Evidence:

- A user calls `_cancelBookings(..., false)` at [`cancelAccommodation`](../src/village/stays/TokenizedStays.sol#L189), so the user can cancel pending, confirmed, or checked-in future bookings.
- A manager calls `_cancelBookings(..., true)` at [`cancelAccommodationFor`](../src/village/stays/TokenizedStays.sol#L193), so the manager can cancel only pending bookings.
- [`checkinAccommodationFor`](../src/village/stays/TokenizedStays.sol#L218) changes any non-canceled booking, including a pending booking, directly to checked-in.
- Confirm and check-in have no date window and are not stopped by the emergency pause.

Impact:

The apparent user/manager cancellation restrictions are reversed. A user can cancel a future checked-in booking and release stake, while a manager cannot cancel a confirmed booking. Managers can check in future or unconfirmed stays. This breaks lifecycle, accounting, and event assumptions.

Recommendation:

Write an explicit transition table and enforce it in one internal state-machine function. Decide separately:

- which states users may cancel;
- which states managers may cancel;
- whether pending must become confirmed before checked-in;
- allowed confirmation, cancellation, and check-in time windows;
- which transitions remain available while paused.

Preserve canceled records as history rather than using a separate existence flag to hide them unless deletion is a deliberate API contract.

### H-04: The production UUPS path is not upgrade-safety validated

Evidence:

- [`deployUupsProxy`](../scripts/deployment/village.ts#L629) manually deploys an implementation and `VillageUUPSProxy`.
- [`validateUupsImplementation`](../scripts/deployment/village.ts#L661) checks only that `proxiableUUID()` returns the ERC-1967 implementation slot.
- `@openzeppelin/hardhat-upgrades` is not a dependency.
- Hardhat output is not configured to retain storage layouts for an upgrade validation pipeline.
- Upgrade tests directly call `upgradeToAndCall` with compatible smoke-test subclasses; they do not run OpenZeppelin `validateImplementation`/`validateUpgrade` or compare a reference storage layout.

Impact:

An implementation may expose the correct UUID while still having an unsafe initializer, missing parent initialization, incompatible storage, a dangerous opcode/pattern, or another upgrade-safety issue. The current check is ERC-1822 compatibility, not the “equivalent validation flow” required by both plans.

Recommendation:

Use the current OpenZeppelin Hardhat Upgrades flow for production deployment and upgrades (`deployProxy(..., {kind: 'uups'})`, validation, and `prepareUpgrade`/`upgradeProxy` as appropriate). Configure storage layout output, establish V1 reference contracts, and make `validateUpgrade` a CI gate. Test implementation locking and initializer replay. Do not allow a Safe to execute an upgrade unless the candidate implementation and storage diff have a recorded validation artifact.

OpenZeppelin's current guidance explicitly requires locking implementations, overriding `_authorizeUpgrade`, and validating storage compatibility. The contracts satisfy the first two; the toolchain does not satisfy the third:

- [OpenZeppelin Contracts proxy API](https://docs.openzeppelin.com/contracts/5.x/api/proxy)
- [OpenZeppelin upgradeable contracts and namespaced storage](https://docs.openzeppelin.com/contracts/5.x/upgradeable)
- [OpenZeppelin Hardhat Upgrades](https://github.com/OpenZeppelin/openzeppelin-upgrades/tree/master/packages/plugin-hardhat)

### H-05: Safe owner modes do not prove that the deployer/API operator lacks owner authority

Evidence:

- [`assertFinalOwnerIsNotDeployer`](../scripts/deployment/village.ts#L898) compares the Safe proxy address with the deployer EOA; it does not inspect Safe owners.
- Auto-Safe config permits the Closer deployer or API operator in `owner.owners`.
- Existing-Safe expected owners are optional and may also include those accounts.
- [`safeVersion`](../scripts/deployment/village.ts#L38) is recorded in config but never verified or used to select a chain-specific deployment.
- [`resolveOwner`](../scripts/deployment/village.ts#L690) accepts arbitrary factory and singleton contracts with code, without an approved chain/version registry or bytecode check.
- Arbitrary `setupTo`/`setupData` is accepted even though Safe setup can execute external initialization logic.

Impact:

A deployment can pass every current “no retained admin” assertion while the deployer or API operator is a Safe signer and therefore retains owner/admin power. An incorrect or malicious Safe factory/singleton can also satisfy the minimal read ABI. This violates the central Phase 3 authority guarantee.

Recommendation:

- Validate Safe factory, singleton, fallback handler, and version against an approved per-chain registry and, where practical, expected runtime bytecode hashes.
- Always read and validate Safe owners and threshold; reject the Closer deployer and API operator as signers when the policy says they must have only narrow roles.
- Restrict setup delegatecall fields to zero unless a separately audited setup module is explicitly selected.
- Record verified Safe version, owners, threshold, factory, singleton, salt, and code hashes in the manifest.
- Test real supported Safe deployments on Celo and Celo Sepolia, not only `SafeMock`.

### H-06: TDF v2 plus `TokenizedStays` is not wired through the transfer policy

Evidence:

- [`TDFTransferPolicy`](../src/profiles/tdf-v2/TDFTransferPolicy.sol#L29) allows ordinary transfers only when the treasury or an allowed counterparty is one side.
- User deposits transfer from the user to `TokenizedStays`, and withdrawals transfer in the opposite direction; neither side is the treasury by default.
- Deployment creates the policy before the future `TokenizedStays` proxy address is known, and only emits actions for counterparties explicitly present in config at [`scripts/deployment/village.ts`](../scripts/deployment/village.ts#L496).
- After `TokenizedStays` is deployed, the script does not automatically add it to the policy or add a pending owner action for it.

Impact:

A TDF v2 deployment that selects tokenized stays can be marked `complete` even though its core deposit, booking top-up, and withdrawal transfers revert. The future proxy address cannot normally be supplied as a static config counterparty without deterministic address prediction.

Recommendation:

Make policy wiring a deployment invariant. Either predict/deploy deterministically and seed the policy, or deploy with an open policy and include a Safe bundle that allows `TokenizedStays` and activates the final policy atomically. At minimum, automatically emit the owner action after the proxy address is known and keep the manifest pending until it is executed and verified. Add an end-to-end TDF v2 test that deposits, books, cancels, and withdraws under the real TDF policy.

### H-07 (resolved): Role-admin hierarchy capture

`setRoleAdmin` is restricted to `DEFAULT_ADMIN_ROLE`, which is protected by `AccessControlDefaultAdminRules`. Lower-level
role administrators can grant or revoke only the roles they administer; they cannot rewrite the hierarchy. Tests cover
unauthorized hierarchy changes and Safe-controlled configuration of a future role.

### H-08: Decaying-token burn inputs can desynchronize the two balance ledgers

Evidence:

- [`burn`](../src/village/tokens/ERC20NonTransferableDecaying.sol#L180) accepts caller-supplied `(daysAgo, amount)` entries.
- It subtracts the caller-computed decayed amount from `lastDecayedBalance`, but burns the full non-decayed amount from OpenZeppelin ERC20 storage at [`ERC20Upgradeable._burn`](../src/village/tokens/ERC20NonTransferableDecaying.sol#L221).
- There is no stored mint-lot provenance tying a burn entry's `daysAgo` to real minted tokens.

Impact:

An authorized operator can burn recently minted raw tokens while claiming they are very old. The raw ERC20 balance can become zero while the reported decayed `balanceOf` remains positive. `totalSupply`, Transfer events, `nonDecayedBalanceOf`, and `balanceOf` then describe incompatible states. This can also happen through an API mistake, not only malice.

Recommendation:

Define one authoritative accounting model. If age-specific burn is required, store auditable mint lots/checkpoints and consume actual lots. Otherwise compute the decayed burn effect from current account state and preserve a hard invariant such as `decayedBalance <= nonDecayedBalance`. Add invariant tests over arbitrary mint/burn sequences and timestamps.

### H-09: Decay checkpoints discard elapsed time and rate changes are retroactive

Evidence:

- [`calculateDecayedBalance`](../src/village/tokens/ERC20NonTransferableDecaying.sol#L259) floors elapsed time to whole days.
- Mint and burn reset `lastDecayTimestamp` to `block.timestamp` at [`_mintWithDecay`](../src/village/tokens/ERC20NonTransferableDecaying.sol#L270) and [`burn`](../src/village/tokens/ERC20NonTransferableDecaying.sol#L198).
- [`setDecayRatePerDay`](../src/village/tokens/ERC20NonTransferableDecaying.sol#L106) changes a single global rate without checkpointing holders.

Impact:

Every mint or burn discards the unelapsed fraction of the current day. Repeated small mints less than 24 hours apart can indefinitely prevent existing balances from decaying. A rate change applies the new rate retroactively to the whole period since each holder's last checkpoint, so two otherwise identical holders can receive different historical treatment based on incidental activity.

Recommendation:

Use second-level accrual or preserve the remainder by advancing the checkpoint only by the number of completed decay intervals. Make the rate immutable if possible. If rates must change, use rate epochs/global accumulators that apply old and new rates only over their actual time ranges. Add time-boundary and rate-change fuzz tests.

### H-10: Core operations have permanently growing iteration costs

Evidence:

- Decaying-token [`totalSupply`](../src/village/tokens/ERC20NonTransferableDecaying.sol#L122) loops over every address ever added to `holders`; holders are never removed.
- `TokenizedStays` retains tombstoned years, booking days, and zero-amount deposits.
- Staked-balance, unlocked-balance, expected-stake, booking, restake, and release operations scan those arrays; [`_moveStakeToRelease`](../src/village/stays/TokenizedStays.sol#L518) repeatedly scans the deposit array and can be quadratic.

Impact:

Long-lived or busy villages eventually reach gas limits for important state-changing operations. `totalSupply()` also ceases to behave like the constant-time ERC20 getter integrations expect. Canceled/re-added records and fragmented deposits make the problem permanent.

Recommendation:

Set and test explicit scale targets. Maintain aggregate totals in storage, compact/merge stake buckets, avoid history arrays in critical calculations, and use bounded pagination for views. Consider OpenZeppelin `EnumerableSet` for active year/day keys where unordered enumeration is acceptable. Redesign the stake ledger around ordered aggregates/checkpoints so booking and withdrawal complexity is bounded.

### H-11: Deployment is neither idempotent nor safely resumable

Evidence:

- The village deployment path uses direct ethers deployments and does not persist/reuse Rocketh or OpenZeppelin deployment state.
- The files in `deploy/village/**` and `deploy/profiles/tdf-v2/**` are empty marker scripts; their selected-file list is recorded, but those scripts do not execute the deployment.
- A rerun deploys a new Safe (for auto-Safe) and a new set of contracts, then writes to the same manifest path.
- The manifest is written only after all deployment steps, so a partial failure leaves live contracts without the canonical product manifest.

Impact:

Retrying after an RPC timeout or partial failure can create duplicate villages and overwrite the previous canonical manifest. Operators cannot safely distinguish “transaction submitted but response lost” from “not deployed.” The Rocketh namespace allowlist is largely descriptive because actual deployment logic lives elsewhere.

Recommendation:

Choose one real deployment-state engine and make every step resumable by deployment ID/config hash. Refuse to overwrite an existing manifest unless it matches the same config and on-chain bytecode, or create an explicit revision/recovery workflow. Persist a journal after each confirmed transaction, record block/receipt data, and reconcile submitted transactions before retrying. Make the namespace allowlist constrain the code that actually executes.

## Medium-severity and architectural findings

### M-01: The decaying assets are not conventional ERC20s

`balanceOf` and `totalSupply` decay without Transfer events, while mint/burn Transfer events use raw non-decayed amounts. Many wallets, indexers, bridges, governance modules, and accounting systems reconstruct ERC20 state from events or assume constant-time getters. The contracts intentionally disable transfer and approval as well.

Either document these as non-standard, non-transferable points with a purpose-built interface, or explicitly define which ERC20 integrations are supported. The Phase 2 plan should not imply ordinary ERC20 interoperability.

### M-02: `DecayMath.mulDiv` duplicates a safer OpenZeppelin primitive

[`DecayMath.mulDiv`](../src/village/libraries/DecayMath.sol#L5) computes `(x * y) / denominator`, so the intermediate multiplication can overflow even when the final quotient fits. Use OpenZeppelin `Math.mulDiv`. If fixed-point exponent/root behavior remains custom, subject it to property testing or use a well-reviewed fixed-point library after evaluating its rounding and upgrade/storage implications.

### M-03: Replaceable dependencies are not validated consistently

`CommunityToken.setTransferPolicy` accepts any address, including an EOA. Calling an interface returning `bool` against an EOA yields unusable return data and can freeze mint, burn, and transfer paths. Code length alone does not prove semantics, but nonzero dependencies should at least be contracts and, where practical, expose ERC-165 or a versioned interface. The unused `TokenizedStays` membership dependency has been removed.

### M-04: Application storage does not use ERC-7201 namespaces

OpenZeppelin 5 upgradeable bases use namespaced storage, but the village modules keep their own state in ordinary sequential slots. This can be validated safely if fields are append-only, but it is less robust for a codebase intended to be modular and extensible. It is especially relevant to the abstract `ERC20NonTransferableDecaying` base.

Before production V1 fixes the layout forever, place application state in unique ERC-7201 namespaces and commit validated storage-layout baselines. Do not retrofit namespaces after deployment without an explicit compatible migration design.

### M-05: The authority model has multiple roots that can drift

Each upgradeable token/stay module has an `Ownable2Step` owner, while VillageAccess uses its default admin as the UUPS upgrade authority. No delegated upgrader role remains. `TDFTransferPolicy` has a separate `Ownable2Step` owner. Moving a village to a new Safe still requires coordinated ownership/default-admin changes across the modules and policy.

Either centralize operational authority through narrowly named roles in `VillageAccess`, or provide a tested governance migration/batch workflow and manifest reconciliation. Use `Ownable2Step` for the non-upgradeable TDF policy if it retains independent ownership.

### M-06: `AccessControlDefaultAdminRules` is configured with a zero delay

[`VillageAccess`](../src/village/access/VillageAccess.sol#L26) passes `0` as the default-admin delay. This preserves the single-admin/two-step mechanism but removes the delay protection, and it does not match plan language describing a delayed Safe handoff. Choose and document a real governance delay or change the plan to say that only acceptance, not time, is delayed. Test the chosen production delay.

### M-07: Generic escrow assumptions are not enforced

The ledger credits the requested transfer amount rather than the actual received balance delta, so fee-on-transfer or rebasing tokens can make liabilities exceed assets. This is not a problem for the current plain `CommunityToken`, but it becomes one because the token is replaceable with any IERC20. Restrict supported tokens or account by verified balance deltas and document rebasing behavior.

### M-08: Calendar, capacity, and inventory semantics are underspecified

Year duration need not match 365/366 days, booking timestamps use the midpoint of a computed day, `ONE_YEAR` is always 365 days, removed years can still have historical active bookings, and bookings are keyed by account/date rather than a room/resource. Multiple users can book the same date.

The Phase 2 plan says ordinary inventory booking remains API-based, so some of this may be intentional. The plan should explicitly define whether on-chain records represent entitlement/stake evidence or actual inventory, and define timestamp, leap-year, removal, and capacity rules.

### M-09: `MINTER_ROLE` also grants arbitrary forced-burn power

[`burnFromByRole`](../src/village/tokens/CommunityToken.sol#L100) lets a minter burn any account without allowance. Minting and confiscation are different trust powers. Remove the function if unnecessary or introduce a separately governed `BURNER_ROLE` with explicit product semantics.

### M-10: Transfer-policy replacement can freeze all token state changes

The policy is called from `_update`, which covers mint, burn, and transfer. A buggy policy can therefore block minting and burning as well as transfers. This may be useful, but it should be explicit. Consider limiting policy scope to ordinary transfers (`from != 0 && to != 0`) unless mint/burn policy is required, and add an emergency recovery path controlled by the Safe.

### M-11: Pending owner actions are not a complete Safe transaction workflow

`safe-transaction` mode currently emits independent calldata descriptions. It does not include a Safe nonce, operation, value, chain-specific safe transaction hash, MultiSend payload, signature state, or an execution/reconciliation command. Tests use an EOA for this mode and do not execute the action. This does not yet satisfy the Phase 3 acceptance criterion requiring a Safe transaction hash or deterministic bundle.

### M-12: Config and manifest provenance need stronger runtime guarantees

The JSON config is cast to a TypeScript interface rather than validated against a versioned runtime schema. `upgradeability` and top-level `safe` are accepted but unused, negative numeric strings are not rejected early, and manifest compiler/version fields are partly hard-coded or read from package declarations rather than resolved build metadata. Add a strict schema, reject unknown/unused fields, hash the normalized config, and record resolved compiler, dependency, artifact bytecode, deployer, block, and receipt data.

## OpenZeppelin and standard-component assessment

| Concern                | Current approach                                             | Assessment                                                                      |
| ---------------------- | ------------------------------------------------------------ | ------------------------------------------------------------------------------- |
| Role authority         | `AccessControlDefaultAdminRules` + `AccessControlEnumerable` | Good library choice; fix role-admin mutability and choose a real delay.         |
| ERC20                  | `ERC20Upgradeable`                                           | Correct.                                                                        |
| Permit                 | `ERC20PermitUpgradeable`                                     | Correct and nominally tested through tokenized-stays permit flow.               |
| Pausing                | `ERC20PausableUpgradeable` / `PausableUpgradeable`           | Correct primitive; define which booking admin transitions pause.                |
| Ownership              | `Ownable2StepUpgradeable`                                    | Good for modules; use two-step ownership consistently for TDF policy.           |
| Reentrancy             | `ReentrancyGuardUpgradeable`                                 | Correct on token-moving entry points.                                           |
| Token calls            | `SafeERC20`                                                  | Correct return-value handling; it does not solve fee/rebase accounting.         |
| Proxy                  | OpenZeppelin `ERC1967Proxy` through a thin wrapper           | Correct proxy primitive.                                                        |
| UUPS implementation    | OpenZeppelin `UUPSUpgradeable`                               | Correct primitive and authorization hook; production validation is missing.     |
| Math                   | Custom fixed-point `mulDiv`, power, root                     | Replace `mulDiv` with OpenZeppelin `Math.mulDiv`; property-test remaining math. |
| Enumerable active keys | Custom arrays + tombstones                                   | Consider OpenZeppelin `EnumerableSet` where ordering is not required.           |
| Upgrade storage        | OZ bases are ERC-7201; app storage is sequential             | Validatable but not the preferred extensible baseline before V1 launch.         |

No custom access-control, proxy, pausing, reentrancy, or basic ERC20 implementation should replace the existing OpenZeppelin components. The main opportunity is to remove custom generic functionality where OpenZeppelin already has the needed primitive, and to use the official upgrades tooling around the existing contracts.

## Phase 2 implementation status

| Phase 2 requirement                                    | Status                              | Notes                                                                                                       |
| ------------------------------------------------------ | ----------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| Legacy/generic/profile namespace separation            | Implemented                         | Generic imports are clean.                                                                                  |
| Minimal, token, and tokenized-stays module composition | Implemented nominally               | Selection works, subject to contract findings.                                                              |
| UUPS `VillageAccess`                                   | Implemented                         | Atomic initializer, Safe-only upgrades, enumerable roles, validation, and stable proxy address are covered. |
| `CommunityToken` with permit, pause, policy, mint/burn | Implemented nominally               | Policy/dependency validation and forced-burn authority need work.                                           |
| Generic presence and sweat tokens                      | Partial                             | Implemented as `VillagePresenceToken`/`VillageSweatToken`; dual-ledger decay correctness is not ready.      |
| Membership kept outside generic V2 contracts           | Implemented                         | No unused membership storage, interface, or authorization branch remains.                                   |
| Optional upgradeable `TokenizedStays`                  | Partial                             | Nominal paths exist, but H-01 through H-03 and H-10 block acceptance.                                       |
| TDF-only replaceable transfer policy                   | Implemented in isolation            | Not integrated correctly with tokenized stays.                                                              |
| Fresh OZ 5.x UUPS proxies                              | Implemented                         | Implementations are locked and initialized atomically.                                                      |
| OpenZeppelin upgrade validation in tests/deployment    | Implemented                         | `validateImplementation` gates deployment and `validateUpgrade` covers every UUPS implementation pair.      |
| Storage preservation tests                             | Partial                             | Compatible V2 mocks preserve representative state, without layout validation.                               |
| TDF v2 richest profile over generic modules            | Partial/inconsistent                | The profile forces only community token + TDF policy; presence, sweat, and stays are not profile defaults.  |
| TDF v1/v2 parity tests under `test/parity/**`          | **Not implemented**                 | The directory/drivers/tests do not exist.                                                                   |
| Safe handoff completion and deployer removal tests     | Partial                             | Pending state is tested; actual acceptance and post-acceptance removal are not.                             |
| Focused generic decay/burn/rounding tests              | Partial                             | Most detailed decay tests are legacy tests, not v2 invariant tests.                                         |
| Compiler and dependency baseline                       | Implemented as the plan was written | The plan's claim that these are “latest” is now stale; see below.                                           |

Phase 2 should not be marked complete until the high-severity contract issues, official upgrade validation, parity tests, TDF policy/escrow integration, and completed Safe handoff tests are addressed.

## Phase 2 plan issues that should be revised

1. **Do not say “preserve current booking behavior” without defining invariants.** The plan should specify pricing authority, legal state transitions, cancellation rights, stake-release rules, capacity/resource semantics, and escrow solvency. Otherwise bugs can be preserved as parity.
2. **Resolve naming contradictions.** Phase 2 says generic Solidity names should remain `PresenceToken` and `SweatToken`, while the implementation and Phase 3 use `VillagePresenceToken` and `VillageSweatToken`. The prefixed names avoid artifact collisions and are reasonable; the plans should agree.
3. **Define what the TDF v2 profile includes by default.** “Richest profile” implies presence, sweat, and tokenized stays, but tests accept only community token and policy. Decide whether a profile is a required module set or merely a namespace that allows optional modules.
4. **Treat decaying balances as a domain model, not a mechanical port.** Define the authoritative ledger, event/indexing expectations, rounding, rate changes, checkpoint behavior, and burn-lot semantics before declaring parity.
5. **Add a production upgrade process, not only upgradeable contracts.** The plan should require validation artifacts, Safe proposal/bundle generation, storage diff review, reinitializer testing, implementation verification, and post-upgrade checks.
6. **Clarify `AccessControlDefaultAdminRules` delay.** A zero delay contradicts “delayed handoff.” Specify the production delay and how a one-click deployment reaches completion.
7. **Use “selected and pinned baseline,” not “latest stable.”** Version claims age immediately and should be updated through a deliberate dependency-review task.

## Phase 3 readiness

The repository already contains a substantial Phase 3 prototype, but it is not a safe production implementation yet.

| Phase 3 area                                  | Status                | Main gap                                                                                             |
| --------------------------------------------- | --------------------- | ---------------------------------------------------------------------------------------------------- |
| Explicit deploy commands; bare deploy is safe | Implemented           | Good.                                                                                                |
| Legacy/village/profile command separation     | Implemented nominally | Rocketh deploy files are marker files; actual execution is elsewhere.                                |
| Serializable config and module normalization  | Partial               | No strict schema; unused fields; some validation occurs too late or not at all.                      |
| Per-village naming and manifest paths         | Implemented           | Add collision/revision policy.                                                                       |
| Initializer-seeded roles                      | Implemented           | Good default for known final owner.                                                                  |
| Safe-transaction mode                         | Partial               | Raw actions are not a deterministic Safe transaction bundle and cannot be reconciled.                |
| Temporary deployer admin                      | Partial               | Pending transfer is emitted, but acceptance/removal/completion is not executed or reconciled.        |
| Existing Safe mode                            | Partial               | Contract check is present; Safe identity/version and forbidden signers are not guaranteed.           |
| Auto-Safe mode                                | Prototype only        | Arbitrary factory/singleton, unused version, setup delegatecall risk, no chain registry.             |
| API operator least privilege                  | Partial               | Direct role grants are narrow, but the operator can still be a Safe signer.                          |
| UUPS compatibility/safety                     | **Not ready**         | UUID check only; no OZ validation.                                                                   |
| TDF v2 deployment                             | Partial               | Token/policy deploy, but tokenized-stays policy wiring is missing and profile semantics are unclear. |
| Verification planning                         | Implemented nominally | Tested as command generation, not against supported live explorers.                                  |
| Export from manifest                          | Implemented           | Good separation of source manifest and derived export.                                               |
| Idempotency/recovery                          | **Not implemented**   | Direct redeploy and manifest overwrite.                                                              |
| Production completion status                  | **Not implemented**   | No command reconciles owner actions and changes a pending manifest to complete.                      |

Before beginning UI/backend integration, Phase 3 needs a hardened deployment engine, approved Safe deployment registry, strict schema, actual OpenZeppelin proxy validation, deterministic Safe bundles, action reconciliation, idempotent retries, TDF integration tests, and manifest collision/provenance controls.

## Recommended target architecture

Keep the current high-level module split:

```text
VillageAccess (stable authority)
  -> CommunityToken (UUPS, optional transfer policy)
  -> Presence/Sweat points (UUPS, corrected decay ledger)
  -> TokenizedStays (UUPS escrow and core invariants)
       -> optional pricing/eligibility policy

TDF v2 profile
  -> generic modules above
  -> TDFTransferPolicy
  -> future sale/migration modules, separately bounded
```

Refinement principles:

- Keep escrow arithmetic and solvency in one core module; do not make financial invariants replaceable policies.
- Put village-specific pricing, eligibility, and possibly cancellation rules behind narrow, versioned interfaces where requirements genuinely differ.
- Prefer configuration and replaceable policies over one-off per-village implementations. Per-village UUPS forks fragment audit coverage.
- Use ERC-7201 namespaced application storage before the first production proxy is deployed.
- Give operational powers explicit roles (`PAUSER_ROLE`, `POLICY_ADMIN_ROLE`, `BURNER_ROLE`, etc.) rather than combining unrelated authority under owner/default admin/minter.
- Keep upgrade authority on a Safe or timelocked governance path; the API operator must never hold it.
- Provide one tested batch workflow for migrating the village Safe across every owner/role/policy surface.

`AccessManager` is not required merely because several modules exist. The current central `VillageAccess` authority exposed through OpenZeppelin `IAccessControl` is a reasonable simple design. Reconsider `AccessManager` only if selector-level scheduling, cross-contract execution delays, or centralized permission administration becomes a concrete requirement.

## Tooling and version assessment

Resolved locally:

| Tool/dependency                    | Repository version |
| ---------------------------------- | ------------------ |
| Solidity v2 pragma/profile         | 0.8.35             |
| Hardhat                            | 3.1.10             |
| OpenZeppelin Contracts             | 5.0.2              |
| OpenZeppelin Contracts Upgradeable | 5.0.2              |
| OpenZeppelin Hardhat Upgrades      | Not installed      |
| Solhint                            | 5.2.0              |

Registry versions observed on 2026-07-13 were Solidity/npm `solc` 0.8.36, Hardhat 3.9.1, OpenZeppelin Contracts/Upgradeable 5.6.1, and OpenZeppelin Hardhat Upgrades 4.0.2. This does not mean the repository should blindly update immediately. It means the plan's “latest” statements are stale and the selected baseline needs an explicit changelog/security/compatibility review.

Recommendations:

- Install and integrate the Hardhat 3-compatible OpenZeppelin Upgrades plugin before any production deployment.
- Upgrade OpenZeppelin within major version 5 only after reviewing release notes and validating every implementation/storage layout. Continue to keep legacy v4 deployments isolated.
- Pin production tool versions and enforce the lockfile in CI; do not rely on broad caret ranges for deployment reproducibility.
- Add Slither to CI and triage/suppress findings explicitly.
- Add fuzz/property/invariant testing (Hardhat-based or a complementary Foundry suite). Foundry need not become the primary deployment engine.
- Measure gas at realistic history sizes, not only fresh-contract unit tests.
- Run live dry-runs/forks against Celo and Celo Sepolia, including Safe and explorer verification.

## Required test additions

At minimum, add tests for:

- zero/underpriced booking rejection and quote replay/substitution;
- every legal and illegal booking state transition, role, time window, and pause state;
- escrow-token change rejection with liabilities;
- escrow solvency under deposit, booking, replacement, cancellation, restake, withdrawal, and token edge cases;
- `decayedBalance <= nonDecayedBalance` across arbitrary mint/burn sequences;
- fractional-day checkpoint behavior and non-retroactive rate changes;
- fixed-point math against a high-precision reference and extreme values;
- bounded gas with realistic holders, years, bookings, and deposit fragmentation;
- role-admin recovery and prohibition of self-admin capture;
- implementation initialization lock and parent-initializer validation;
- OpenZeppelin `validateUpgrade` for every V1-to-V2 mock, with state preservation after the validated upgrade;
- TDF v2 deposit/book/cancel/withdraw through the real TDF transfer policy;
- actual Safe owner acceptance, role grants, deployer removal, bundle execution, and manifest completion;
- rejection of deployer/API-operator Safe signers and unapproved Safe factories/singletons;
- deployment interruption and idempotent resume at every transaction boundary;
- manifest overwrite/collision protection and on-chain bytecode reconciliation;
- the Phase 2 `LegacyTDFV1Driver`/`TDFV2ProfileDriver` parity suite, after desired behavior is specified rather than copied blindly.

Useful invariants include:

- escrow assets are always at least recorded liabilities;
- `lockedStake + unlockedStake == stakedBalance` for every account;
- a booking never reduces required stake without an authorized cancellation/replacement;
- no unauthorized caller can change configuration, lifecycle, role hierarchy, or implementation;
- a completed manifest has no pending owner action and every declared authority/configuration is verified on-chain;
- a deployment ID/config hash resolves to one canonical set of addresses.

## Prioritized remediation order

1. Freeze the intended booking/staking/decay domain rules in the plans: pricing authority, lifecycle, escrow token, decay ledger, calendar, and TDF profile contents.
2. Fix H-01, H-02, H-03, H-07, H-08, and H-09 before preserving the first production storage layout.
3. Redesign unbounded stake/holder accounting to meet explicit scale and gas targets.
4. Move v2 application state to ERC-7201 namespaces while no production v2 proxy exists.
5. Integrate OpenZeppelin Hardhat Upgrades and make validated deployment/upgrade artifacts mandatory.
6. Complete TDF policy/stays wiring and end-to-end profile tests.
7. Harden Safe validation, generate executable deterministic bundles, and implement pending-action reconciliation.
8. Make deployments idempotent, journaled, collision-safe, and recoverable.
9. Complete missing Phase 2 parity and invariant tests, then run Slither and a dedicated external audit.
10. Only after these gates are green, connect the Phase 3 backend/UI to the deployment workflow.

## Final assessment

The codebase has the right _shape_ for a generic village platform: independent modules, explicit interfaces, a stable role authority, TDF policy isolation, and selective UUPS proxies. It should evolve from this base rather than return to a diamond or TDF-specific monolith.

What is missing is a trustworthy set of economic and state invariants around `TokenizedStays` and the decaying tokens, plus the operational discipline that makes upgradeable, multi-contract deployments safe. Once those are corrected—and validated by official upgrade tooling, invariant tests, Safe execution tests, and an independent audit—the architecture can support Phase 3 and future village-specific configuration without turning every village into a custom contract fork.
