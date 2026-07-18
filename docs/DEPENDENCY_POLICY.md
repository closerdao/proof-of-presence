# Dependency policy

## Reproducible installs

- Use Node.js 22.22.2 and Yarn Classic 1.22.22, as declared in
  `.tool-versions` and `package.json`.
- Direct dependencies are exact-pinned. `yarn.lock` is the authoritative
  transitive dependency graph and CI installs it with `--frozen-lockfile`.
- Update related packages together, then run type checking, formatting,
  linting, contract tests, upgrade validation, and the ABI/bytecode review.
- Do not add broad `resolutions` merely to make an audit report green. Prefer
  upgrading the package that owns the vulnerable dependency. A resolution is
  acceptable only after compatibility tests prove that the parent package's
  declared range supports it and the reason is documented here.

## Active dependency groups

- OpenZeppelin Contracts v5 and the Hardhat Upgrades plugin
- Hardhat 3, its Nomic Foundation plugins, Ethers v6, and TypeChain
- Safe API Kit, Protocol Kit, Types Kit, and Safe deployments
- TypeScript execution, tests, formatting, and Solidity linting tools

Dependabot checks these groups weekly. It opens reviewable pull requests; it
does not auto-merge them.

## Frozen and deferred dependencies

- `@openzeppelin/contracts-v4` and
  `@openzeppelin/contracts-upgradeable-v4` are immutable aliases used by the
  already-deployed V1 contracts. Do not upgrade or replace their imports. The
  `src/legacy` tree is formatter-excluded so a tooling update cannot rewrite
  frozen source and contract metadata for style-only reasons.
- Rocketh and `hardhat-deploy` are held at the current versions until the
  legacy deployment path is migrated and its generated output is reviewed.
- Major upgrades of TypeScript, ESLint, Chai, date-fns, dotenv, Luxon, and
  fs-extra are separate migrations. In particular, date-fns is only used by
  the legacy deployment code.
- The project remains on Ethers. A viem/wagmi migration would be an application
  architecture change, not dependency maintenance.

## OpenZeppelin v5 build boundary

V1 remains compiled for Paris. OpenZeppelin Contracts 5.6 uses EIP-5656
`MCOPY`, so Solidity 0.8.35 V2 contracts target Cancun. The two V1 libraries
with range pragmas have explicit Paris compiler overrides to keep them out of
the V2 compiler target.

OpenZeppelin 5.6 makes `Initializable` and `UUPSUpgradeable` stateless bases in
`@openzeppelin/contracts`. V2 imports them from that package and does not call
the removed no-op UUPS initializer. `TokenizedStays` uses the constructor-free
`ReentrancyGuardTransient`, which is supported by the same Cancun boundary and
does not reserve proxy storage. Upgrade validation must pass after every
OpenZeppelin update.

## Known audit exceptions

- Luxon 3.0.4 is currently used only by frozen V1 tests. Its reported ReDoS
  does not process production input; the explicitly deferred Luxon update
  should still move to a patched 3.x release when the legacy test harness is
  refreshed.
- TypeChain, Solhint, and OpenZeppelin Defender SDK packages still bring in
  transitive `lodash@4.17.21`. The project's direct Lodash dependency is
  patched. Do not force incompatible transitive resolutions; track updates of
  the owning development tools instead.
- Ignition's transitive `lodash-es@4.17.21` usage is limited to collection and
  equality helpers; it does not use the vulnerable template API. Do not force
  a resolution without an upstream-compatible release.
- Mocha's transitive `serialize-javascript@6` is development-only. Track the
  upstream update rather than overriding Mocha's dependency graph.

Reassess these exceptions whenever their parent package is upgraded or the
dependency starts handling untrusted production input.

## Static-analysis compatibility

Slither 0.11.5 does not yet parse Solidity 0.8.35's `erc7201(...)` compile-time
builtin. Its V2 run therefore remains advisory until upstream support lands;
Hardhat compilation and OpenZeppelin upgrade validation are the authoritative
storage-layout gates in the meantime. The Slither runner still targets Cancun
so its compiler configuration matches the V2 build.
