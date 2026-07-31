# Remaining work

Last reconciled: 2026-07-31

The V2 contracts and local deployment/upgrade workflows are implemented and covered by automated checks. The release
is not audit-ready until the V1 transition scope and the real-network operational rehearsals below are complete.

## Pre-audit release blockers

- Design the production V1-to-V2 transition in a separate branch: enumerate live V1 balances, bookings, memberships,
  roles, authorities, and sale state; define snapshot/reconciliation rules, duplicate-claim prevention, activation,
  rollback, and user communication; add tests and rehearse it. Integrate and include that design in the audit scope
  before treating V2 as a replacement for the live Celo deployment.
- Rehearse built-in Ignition verification on Celo Sepolia, including plain contracts, proxies, implementations, and
  provider-specific retry behavior.
- Rehearse the real EOA-to-Safe ownership handoff and a Safe-owned UUPS upgrade with nonempty migration calldata using
  the separate prepare, submit, and status commands. Record both implementation reconciliation and the explicit
  migration-state postcondition.
- Prove that a clean operator environment can restore the reviewed config, matching Ignition directory, and existing
  manifest and resume/reconcile without redeploying.
- Run the standard release suite plus deep fuzz/invariant, coverage, Aderyn, Wake, Slither, dependency, artifact, and
  targeted mutation gates against the final integrated revision. Triage every delta, freeze the audit commit, and
  obtain an independent audit.

## Consumer integration

No API/UI descriptor is generated today. This is not part of the current pre-audit implementation scope. When a
concrete consumer release exists:

- define the smallest versioned projection it needs from committed manifests and Hardhat/Ignition artifacts;
- decide whether historical ABI revisions are actually required for indexing;
- verify chain, deployed code, critical wiring, roles, pause state, and proxy implementations at activation;
- keep transaction retry/finality/reorg handling and application workflow state outside the deployment manifest.

## Product and rollout

- Decide whether the UI ever offers persistent token approval; prefer permit-first or exact approvals.
- Integrate CitizenNFT and DynamicPriceSale only when their product flows are ready.
- Separate and rotate deployer, Safe proposer, and API operator secrets; bound gas funding.
- Operate one audited pilot village with explicit success and error-budget criteria before broader rollout.
