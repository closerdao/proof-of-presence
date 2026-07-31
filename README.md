# Closer smart contracts

This branch contains protocol V2: a fresh UUPS-based Closer village graph plus its deployment, upgrade, verification,
and security tooling. Protocol V1 is the deployed Diamond-based system recorded on `main` (with an archival snapshot
on `legacy-v1`) and has live Celo mainnet state. Deploying V2 does not upgrade or migrate that V1 state.

A production replacement of V1 therefore requires a separately reviewed migration design, snapshot/reconciliation
procedure, rehearsal, and rollback policy. That work is a release blocker and is intentionally not hidden inside the
fresh-deployment commands in this branch.

## Quick start

The pinned toolchain is Rust 1.97.1, Node.js 22, Yarn Classic, Solidity 0.8.35, and the security tools declared in
`mise.toml`.

```sh
mise install
mise run setup
mise run check
```

`mise run check` runs type checking, formatting, linting, all contract tests, and OpenZeppelin upgrade validation.
The complete test suite currently contains Solidity fuzz/invariant tests and TypeScript deployment/integration tests.

## Repository structure

- `src/village/` — reusable access, token, booking, proxy, interface, and library contracts.
- `src/profiles/tdf/` — TDF-specific transfer policy and historical pricing curve.
- `ignition/modules/` — the only supported deployment graphs.
- `scripts/deployment/` — strict config/manifest validation and deployment reconciliation.
- `test/solidity/` — Solidity unit, fuzz, and invariant tests.
- `test/village/` — deployment, Safe, recovery, integration, scale, and upgrade tests.
- `security/` — security-tool configuration and reviewed regression baselines.

The contract and authority model is described in [Architecture](./docs/ARCHITECTURE.md). Operators deploying a new
village should follow the [Village deployment runbook](./docs/VILLAGE_DEPLOYMENT_RUNBOOK.md) and use
[Deployment](./docs/DEPLOYMENT.md) as the detailed reference. API and UI consumers should use
[Integration](./docs/INTEGRATION.md). Security assumptions and accepted limitations are explicit in the
[Threat model](./docs/THREAT_MODEL.md). Current release work is tracked in
[Remaining work](./docs/REMAINING_WORK.md).

## Common commands

```sh
yarn compile
yarn test
yarn validate:upgrades
yarn deploy:village -- --config config.json --network celoSepolia
yarn deploy:tdf -- --config config.json --network celoSepolia
yarn hardhat --network celoSepolia ignition verify <deployment-id>
yarn upgrade:prepare -- --manifest <manifest.json> --contract <name> \
  --implementation <artifact> --version <id> --network <network> \
  [--call <migration-function> --call-args '<json-array>']
yarn upgrade:submit -- --manifest <manifest.json> --upgrade <name>:<id>
yarn upgrade:status -- --manifest <manifest.json> --upgrade <name>:<id>
```

Bare `yarn deploy` only prints help; it never sends a transaction.

## Deployment records and schemas

Hardhat Ignition owns transaction journaling and resumption. A strict deployment manifest summarizes reconciled
on-chain state for operators; it does not duplicate the Ignition journal. Reviewed immutable configs, real-network
Ignition directories, and manifests are committed together. A consumer-specific export will be introduced only when
an API or UI has a concrete release format to consume.

- Deployment config: `schemaVersion: 2`.
- Deployment manifest: `schemaVersion: 2`.

`schemaVersion` identifies the JSON wire format. It is not protocol V2, a contract version, proxy storage version, or
Ignition journal version. Production protocol V1 predates this manifest format; there is no schema-1 V1 manifest to
load. Within the V2 deployment tooling only schema 2 is supported, and removed draft shapes fail before deployment
instead of being migrated. See [Deployment schemas](./docs/DEPLOYMENT.md#deployment-schemas) for the full explanation.

## Security

Production Solidity is compiled only with Solidity 0.8.35 for Cancun, using OpenZeppelin Contracts 5.6. The repository
has ABI/storage/code-size, dependency, coverage, static-analysis, formal-verification, fuzz, invariant, scale, and
upgrade-validation gates. See [Security tooling](./security/README.md) and
[Dependency policy](./docs/DEPENDENCY_POLICY.md).
