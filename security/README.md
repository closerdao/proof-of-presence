# Smart-contract security tooling

The automated scope is the active V2 contracts under `src/village` and `src/profiles/tdf-v2`. The frozen V1 contracts
under `src/legacy` and Solidity test mocks are excluded unless an explicit legacy change requires a separate review.

## Local workflow

Install the pinned external toolchain and Git hooks:

```sh
mise install
mise run setup
```

Mise owns Node.js, the Yarn CLI, `uv`, `solc`, Z3, OSV-Scanner, and Lefthook. Yarn continues to own all JavaScript
dependencies. The generated `mise.lock` records platform-specific artifacts and checksums. CI uses the same `mise.toml`
and lockfile.

The hooks are deliberately fast and check-only:

- pre-commit: Prettier, ESLint, and zero-warning Solhint on staged files;
- pre-push: TypeScript type checking and a Solidity compile.

Hooks improve feedback time, but CI remains authoritative. Install them with `lefthook install`; bypassing a hook does
not bypass any CI gate.

## Gates

| Tier             | Commands                                                                         | Purpose                                                                                                                                      |
| ---------------- | -------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Pull request     | `mise run check`                                                                 | formatting, zero-warning lint, V2 tests, and OpenZeppelin upgrade/storage validation                                                         |
| Pull request     | `mise run security:static`                                                       | Slither, ERC conformance, TokenizedStays formal verification, dependency vulnerabilities, ABI selectors, storage fingerprints, and code size |
| Manual deep      | `mise run security:deep`                                                         | higher-run Hardhat fuzz/invariants, ten-year scale tests, and coverage regression checks                                                     |
| Manual pre-audit | `mise run security:aderyn`, `mise run security:wake` / GitHub Actions `preaudit` | independent static-analysis passes and targeted review evidence before a release/audit                                                       |

There is no scheduled “nightly” stage. Deep and pre-audit runs are explicit `workflow_dispatch` choices so failures
have an owner and a release context. OpenZeppelin Monitor/Forta are not part of this repository's code-quality flow;
they are runtime operations products and are unnecessary here.

### Slither

`yarn analyze:slither` installs/runs Slither from the latest `master`, resolves `refs/heads/master`, and stores that
exact commit in `security-reports/slither/commit.txt`. This is intentional: the latest published package lacks the
`erc7201` builtin required by the V2 namespaced-storage contracts. JSON and SARIF are generated per contract and any
medium/high finding fails the command.

Slither remains the primary Solidity static analyzer because of its detector breadth and ecosystem integration.
Aderyn is a pre-audit second opinion, not a replacement. Run it locally with `mise run security:aderyn`; the same task
runs in CI. It exposes the Mise-pinned solc 0.8.35 binary through Aderyn's compiler lookup path and fails if the
analyzer compiles no files, runs no detectors, or omits either the TokenizedStays or TDF transfer-policy entrypoint.
Suppressions must name one detector, sit next to the intentional construct, and explain why the finding is false or
accepted. Broad detector exclusions within the active V2 production scope are forbidden.

Wake is an additional manual pre-audit second opinion. Upstream `eth-wake` 4.22.1 supports Solidity only through
0.8.34, so `mise.toml` installs the project's Solidity 0.8.35-compatible
[`microHoffman/wake` fork](https://github.com/microHoffman/wake/tree/feat/solidity-0.8.35-support) as a Python CLI tool.
The dependency and `scripts/security/run-wake.js` are pinned to the same immutable commit; updates require an explicit
reviewed change and never follow a moving branch automatically. Run it with `mise run security:wake`.

`wake.toml` matches the V2 production compiler target and excludes frozen V1, tests, formal harnesses, and standalone
dependency findings. Wake itself generates the HTML report. The runner preserves that native report under
`security-reports/wake`, records the fork and repository commits, accepts Wake's documented findings exit code, and
separately fails medium/high-impact findings with at least medium confidence. It also fails if Wake omits the required
TokenizedStays or TDF transfer-policy sources from its build metadata, preventing a zero-production-scope scan from
passing. Replace the fork with an upstream release only after upstream supports Solidity 0.8.35 and passes the same
integrity checks.

`yarn analyze:standards` separately checks CommunityToken's ERC-20/ERC-2612 surface and the ERC-165 contracts. These
checks complement unit tests; they do not prove full behavioral conformance.

`mise run security:smt` verifies the production-used `GregorianDateMath` and `TokenizedStaysExposure` helpers with the
pinned Solidity SMTChecker and Z3. BMC proves the bounded Gregorian conversion loop, while CHC proves the signed
exposure bounds and reducers. Every assertion has a stable property ID; the gate fails if any property is unproved,
unsupported, timed out, or missing. A deliberate negative control must also produce a concrete counterexample, which
guards against a broken solver or result parser. Reports are written under `security-reports/smtchecker`.

The runner requires the exact locked solc 0.8.35 and Z3 4.15.8 versions. Use the Mise command rather than invoking the
package script from a shell that may resolve system binaries first. The checked-in Z3 assets support Linux x64 with
glibc 2.39 and macOS x64/ARM64; unsupported platforms fail during `mise install` instead of silently using another
solver build. SMTChecker remains focused because external calls and the complete upgradeable inheritance graph turn
whole-contract analysis into timeouts rather than useful proof evidence.

### Solhint and formatting

Solhint is active in `yarn lint`, the pre-commit hook, and CI. Active production Solidity must have zero warnings.
Formatting belongs only to Prettier; the obsolete Solhint Prettier plugin is intentionally not installed. Gas-style
rules that were producing noisy or mechanically unsafe advice are disabled, while correctness and maintainability
rules remain enabled.

### Fuzzing and mutation testing

Hardhat 3 Solidity fuzz and stateful invariant tests are the canonical fuzzing system. The default suite is bounded for
pull requests, and `yarn test:v2:deep` raises fuzz runs, invariant runs, and sequence depth. Echidna and Medusa are not
added because a second property-runner would duplicate the same harnesses without a current coverage gap.

Gambit is useful only as targeted pre-audit mutation testing. The pinned manual workflow generates a deterministic,
small sample from high-risk booking, decay, transfer-policy, and authorization code using `security/gambit.json`. It is
not a vulnerability detector and is not a per-commit linter. Review `gambit summary`, apply each generated mutant in a
temporary clean checkout, and run the corresponding V2 Solidity test file. Any surviving mutant is either a missing
assertion/test or an explicitly documented equivalent mutant; generating mutants alone is not a mutation score.

### Dependency, ABI, storage, size, and coverage evidence

- `yarn security:dependencies` scans `yarn.lock` with OSV-Scanner and writes JSON under `security-reports/osv`. The
  committed baseline keeps the existing dependency backlog visible while failing every new package/version/advisory
  tuple. Update it with `yarn security:dependencies:update` only after triaging the complete report; it is not an ignore
  list and does not remove findings from output.
- `yarn security:artifacts` fails on removed/changed selectors or event topics and the EIP-170 runtime code-size limit.
  It also reports bytecode and compiler storage-layout hash changes for review. After an intentional ABI review, update
  the committed baseline with `yarn security:artifacts:update`.
- `yarn security:coverage` runs scoped V2 coverage and fails line-coverage regressions. New production files start with
  a 90% line minimum. Hardhat 3's LCOV currently exports line data, not statement counters, so the gate is explicitly a
  line baseline. Update it only after reviewing the uncovered lines with `yarn security:coverage:update`.
- `yarn validate:upgrades` remains the authoritative OpenZeppelin UUPS/storage compatibility check.

Generated reports belong in the ignored `security-reports/` directory and are uploaded by CI; do not create a tracked
`security/reports/` tree. Final reports from external human audits may be retained under `security/audits/` with their
audited commit, scope, date, auditor, and remediation status. Baseline updates should never be bundled into unrelated
changes merely to make a gate pass.
