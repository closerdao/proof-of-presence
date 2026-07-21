# Dependency policy

## Reproducible installs

- Tool versions are pinned in `mise.toml` and `mise.lock`.
- Direct JavaScript dependencies use exact versions in `package.json`.
- `yarn.lock` is authoritative; CI installs with `yarn install --frozen-lockfile --ignore-scripts`.
- Related packages should be upgraded together and verified with `mise run check` and the relevant security gates.
- Broad `resolutions` are not used merely to hide vulnerability reports. A resolution requires proof that every
  parent package supports the chosen version and a documented reason.

## Current dependency boundary

The contract stack is:

- Solidity 0.8.35 targeting Cancun;
- OpenZeppelin Contracts and Contracts Upgradeable 5.6.1;
- OpenZeppelin Hardhat Upgrades 4;
- Hardhat 3.11 with Ethers, Mocha, Chai matchers, Ignition, and verification plugins;
- Ethers 6 and Safe API/Protocol/Types kits;
- TypeScript 5.9, ESLint 9, Prettier 3, Solhint 6, Mocha 11, Zod 4, and tsx.

Both OpenZeppelin packages are development/build dependencies because this repository publishes contracts rather than
a runtime JavaScript application. `@safe-global/safe-deployments` remains only as a transitive dependency of Safe
Protocol Kit; it is no longer a direct dependency.

The repository does not use OpenZeppelin 4 aliases, Rocketh, Hardhat Deploy, TypeChain, date-fns, Luxon, fs-extra, or
Lodash directly. Reintroducing any of them requires a current architectural need and normal dependency review.

## Compiler and OpenZeppelin boundary

OpenZeppelin Contracts 5.6 uses instructions and primitives that require the Cancun target. All production and test
contracts therefore compile through one Solidity 0.8.35/Cancun profile with optimizer runs set to 2000.

`Initializable` and `UUPSUpgradeable` are stateless bases imported from `@openzeppelin/contracts`.
`TokenizedStays` uses `ReentrancyGuardTransient`. Upgrade validation must pass after every Solidity, OpenZeppelin,
Hardhat, or optimizer change, and intentional bytecode/storage changes require an artifact-baseline review.

## Update policy

Dependabot groups Hardhat, OpenZeppelin, Safe, and development-tooling updates. The following major migrations remain
separate reviewed changes:

- TypeScript 6 or later;
- ESLint 10 or later;
- Chai 6 or later;
- dotenv 17 or later.

Before merging dependency changes:

1. read the owning project's release and migration notes;
2. regenerate `yarn.lock`;
3. run type checking, formatting, linting, all tests, and upgrade validation;
4. run the dependency and artifact security gates;
5. review changes to compiler output, ABI, storage layout, code size, Ignition behavior, and Safe handling.

## Vulnerability baseline

`yarn security:dependencies` scans the lockfile with OSV-Scanner. The committed baseline records current exact
package/version/advisory tuples and fails any new tuple. It is not an ignore list; full findings remain in the generated
report.

Current findings are transitive development/deployment-tool findings, including old archive/zip, glob/regex, YAML,
serialization, HTTP/WebSocket, elliptic, and utility packages. Some originate through Ignition, Safe, Mocha, Solhint,
or OpenZeppelin tooling. Prefer updates of the owning parent package. Update the baseline only after reviewing the full
report and documenting any material risk change.

The direct dependencies are currently at their declared versions, and a Yarn Classic semver-compatible upgrade does
not replace the affected nested lock entries. Do not force the following incompatible or unavailable remediations:

- Hardhat's `adm-zip` requires a jump from 0.4 to 0.6;
- Mocha's `diff` and `serialize-javascript` require new major versions;
- `elliptic` has no fixed release for the recorded advisory.

Other findings have fixed patch/minor releases, but remain owned by current Hardhat, Mocha, Solhint, ESLint,
TypeScript-ESLint, Ignition, Safe, or OpenZeppelin dependency chains. Prefer upstream parent releases over broad Yarn
resolutions. These packages execute only in local/CI build, test, lint, deployment, or verification tooling; none are
linked into deployed EVM bytecode. Revisit the baseline whenever a parent release or advisory changes.

## Static-analysis compatibility

The security toolchain deliberately pins compatible analyzer/compiler combinations. Wake uses a pinned project fork
until upstream supports Solidity 0.8.35; Slither runs from a recorded upstream commit for ERC-7201 support; Aderyn is a
secondary independent pass. Hardhat compilation and OpenZeppelin upgrade validation remain the authoritative build and
storage-layout gates.
