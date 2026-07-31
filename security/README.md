# Smart-contract security tooling

The automated production scope is `src/village` and `src/profiles/tdf`. Solidity test helpers under
`src/village/test` and formal harnesses under `security/smt` are excluded from production baselines.

## Standard workflow

```sh
mise install
mise run setup
mise run check
mise run security:static
```

`mise run check` covers type checking, formatting, zero-warning project linting, all contract tests, and OpenZeppelin
upgrade/storage validation. `mise run security:static` runs Slither, ERC conformance, focused SMT proofs, OSV
dependency scanning, and artifact regression checks.

Manual suites:

```sh
mise run security:deep
mise run security:aderyn
mise run security:wake
mise run security:gambit
```

`security:deep` raises fuzz and invariant runs and checks coverage regression. The standard pull-request suite already
includes the ten-year scale case.
Aderyn, Wake, and targeted Gambit mutation generation are independent pre-audit evidence rather than per-commit
linters. Aderyn finding dispositions are tracked in `security/ADERYN_TRIAGE.md`.

For an audit candidate, commit all intended changes, start from a clean worktree, and run:

```sh
mise run security:preaudit
```

The clean-tree guard records the source commit, pinned Node/Yarn/Solidity versions, and hashes of reviewed build and
analysis inputs in ignored `security-reports/audit-metadata.json`. Individual analyzer reports record their own tool
versions. Preserve that directory with the audit handoff; do not regenerate evidence from an uncommitted tree.

## Analysis tools

Slither 0.11.6 is the primary broad detector, pinned to the immutable commit behind that release. The runner verifies
the executable version and records both its source and version before producing JSON/SARIF per production contract.
Medium/high project findings fail. Suppressions must name one detector, sit next to the intentional construct, and
explain the disposition.

Aderyn is a manual second opinion using the Mise-pinned Solidity 0.8.35 binary. The runner fails if no production
sources or detectors are observed.

Wake is another manual second opinion. `mise.toml` and the runner pin the same immutable
`microHoffman/wake` commit with Solidity 0.8.35 support. Replace it with upstream only after upstream supports the
same compiler and passes the integrity checks.

`yarn analyze:standards` checks the CommunityToken ERC-20/ERC-2612 surface and ERC-165 contracts, including the
VillageCitizenNFT ERC-721, Metadata, Enumerable, ERC-5192, and ERC-4906 identifiers.
`mise run security:smt` proves focused Gregorian-date and TokenizedStays exposure properties with the pinned Solidity
SMTChecker and Z3, including a negative control that must yield a counterexample.

## Fuzzing, invariants, scale, and mutation

Hardhat Solidity tests are the canonical fuzz and stateful invariant system. Default runs are bounded for pull
requests; `yarn test:deep` increases runs and sequence depth. The continuous ten-calendar-year TokenizedStays case
runs in the standard suite, while `yarn test:scale` remains available as a focused command.

Gambit configuration targets high-risk booking, decay, policy, and authorization code. `mise run security:gambit`
uses the pinned Cargo tool to generate a deterministic sample, then runs every mutant against the Solidity suite in an
isolated temporary copy. Gambit itself is only a mutant generator; the project runner supplies the kill/survival gate.
A surviving mutant needs either a new assertion/test or an explicit equivalence disposition.

## Reviewed baselines

- `security/artifact-baseline.json` records the exact production inventory, source identity, function selectors,
  event topics, deployed-bytecode hash, and code size. Any addition, removal, or bytecode change blocks until the
  complete diff is reviewed and `yarn security:artifacts:update` is run intentionally. Storage compatibility is
  enforced separately by OpenZeppelin upgrade validation.
- `security/coverage-baseline.json` records line coverage for production sources and requires 90% for new files.
  The gate also requires every executable production Solidity source to appear in LCOV. Update with
  `yarn security:coverage:update` after reviewing uncovered lines.
- `security/osv-baseline.json` records reviewed exact vulnerability tuples while preserving full report visibility.
  Update with `yarn security:dependencies:update` only after dependency triage.

Generated reports belong in ignored `security-reports/` and CI artifacts. External audit reports may be retained
under `security/audits/` with audited revision, scope, date, auditor, and remediation status.
