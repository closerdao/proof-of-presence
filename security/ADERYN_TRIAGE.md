# Aderyn finding triage

This triage applies to Aderyn 0.6.8 scanning the active Solidity scope with solc 0.8.35 and the Cancun EVM target.
The generated report remains available under the ignored `security-reports/aderyn/` directory and as a CI artifact.

## Line-scoped dispositions

- `contract-locks-ether` is marked `aderyn-fp` on the six concrete proxy/implementation declarations. Aderyn follows
  OpenZeppelin's payable `ERC1967Proxy` constructor, proxy fallback, and UUPS `upgradeToAndCall` surface. Empty upgrade
  calldata rejects nonzero value through `ERC1967NonPayable`, and every initializer/reinitializer and implementation
  entry point in this project is nonpayable. Normal calls therefore cannot leave Ether trapped. Future payable entry
  points require this disposition to be revisited.
- `unchecked-return` is ignored only for the initial `_grantRole` call in `VillageAccess`. Duplicate grants are
  intentionally idempotent, and initialization does not need to distinguish a new membership from an existing one.

The Aderyn task fails if any other high-severity finding remains in the generated report.

## Visible accepted or informational findings

| Detector | Disposition |
| --- | --- |
| `centralization-risk` | Accepted architecture. Production ownership and default-admin authority belong to the governance Safe; operational roles and upgrade powers are documented in the authority model. |
| `costly-loop` | Accepted and bounded by transaction gas or explicit calendar/batch bounds. Storage writes are the purpose of the affected atomic batch operations. |
| `require-revert-in-loop` | Accepted atomic semantics. A bad booking, cancellation, role grant, or mint entry must roll back its entire batch. |
| `empty-block` | Required OpenZeppelin UUPS authorization-hook shape; access control is expressed by the modifier. |
| `internal-function-used-once` | Retained where named calendar, exposure, or decay helpers improve reviewability and independent testing. |
| `large-numeric-literal` / `literal-instead-of-constant` | Informational numeric-style findings. The values are named domain constants or self-explanatory Gregorian/fixed-point operands. |
| `modifier-used-only-once` | Retained to keep role authorization consistent with the other modules. |
| `redundant-statement` | Deliberate consumption of unused ERC-20 override parameters before unconditional non-transferability reverts. |
| `unused-public-function` | `totalDepositedBalance` remains part of the public accounting API; changing it to `external` has no security benefit. |

Do not globally exclude these detectors. New instances must remain visible and be reviewed on their own merits.
