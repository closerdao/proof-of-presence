# Closer smart contracts

This repository contains the current Closer village contracts and their deployment, upgrade, verification, and
security tooling. The former contract system is preserved separately on the `legacy-v1` branch, created from
`main` at commit `16735b858567a87aaa6af430bf8600ec0531a392`.

## Quick start

The pinned toolchain is Node.js 22, Yarn Classic, Solidity 0.8.35, and the security tools declared in
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
- `src/profiles/tdf/` — TDF-specific policy contracts composed with the generic village contracts.
- `ignition/modules/` — the only supported deployment graphs.
- `scripts/deployment/` — strict config/manifest validation and deployment reconciliation.
- `test/solidity/` — Solidity unit, fuzz, and invariant tests.
- `test/village/` — deployment, Safe, recovery, integration, scale, and upgrade tests.
- `security/` — security-tool configuration and reviewed regression baselines.

The contract and authority model is described in [Architecture](./docs/ARCHITECTURE.md). Operators should start with
[Deployment](./docs/DEPLOYMENT.md); API and UI consumers should use [Integration](./docs/INTEGRATION.md). Current
release work is tracked in [Remaining work](./docs/REMAINING_WORK.md).

## Common commands

```sh
yarn compile
yarn test
yarn validate:upgrades
yarn deploy:village -- --config config.json --network celoSepolia
yarn deploy:tdf -- --config config.json --network celoSepolia
yarn verify:village -- --manifest <manifest.json>
yarn export:village -- --manifest <manifest.json>
yarn upgrade:prepare -- --manifest <manifest.json> --contract <name> \
  --implementation <artifact> --version <id> --network <network>
```

Bare `yarn deploy` only prints help; it never sends a transaction.

## Deployment records and schemas

Hardhat Ignition owns transaction journaling and resumption. A strict deployment manifest summarizes reconciled
on-chain state for operators and downstream systems; it does not duplicate the Ignition journal. Consumer exports are
derived from manifests and contain only stable addresses, ABIs, aliases, and routing metadata.

- Deployment config: `schemaVersion: 3`.
- Deployment manifest: `schemaVersion: 3`, with `configSchemaVersion: 3`.
- Consumer export: `schemaVersion: 2`.

`schemaVersion` identifies the JSON wire format. It is not a contract version, proxy storage version, or Ignition
journal version. The value is required and checked with an exact schema literal, so unsupported or ambiguous files
fail before deployment. See [Deployment schemas](./docs/DEPLOYMENT.md#deployment-schemas) for the full explanation.

## Security

Production Solidity is compiled only with Solidity 0.8.35 for Cancun, using OpenZeppelin Contracts 5.6. The repository
has ABI/storage/code-size, dependency, coverage, static-analysis, formal-verification, fuzz, invariant, scale, and
upgrade-validation gates. See [Security tooling](./security/README.md) and
[Dependency policy](./docs/DEPENDENCY_POLICY.md).
