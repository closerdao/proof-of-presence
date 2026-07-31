# Threat model

This document records the V2 trust boundary and the design limitations accepted for the initial audit. It is part of
the protocol specification: changing one of these assumptions requires a security review.

## Trusted authorities

The final owner/default admin is fully trusted governance. Depending on the module, it can upgrade implementations,
pause operations, replace the shared role authority, change the CommunityToken supply ceiling and transfer policy,
change decaying-token rates, recover orphaned escrow tokens, or replace sale pricing and payment recipients.
Compromise or malicious use of that authority can invalidate protocol economics even when contract invariants remain
intact. Production ownership should therefore be a reviewed Safe with independently controlled signers.

Operational roles are trusted within their narrower powers:

- `MINTER_ROLE` can mint CommunityToken and burn it from any account without allowance.
- `BOOKING_MANAGER_ROLE` can cancel another account's future bookings and can mint or burn Presence/Sweat points.
- `BOOKING_PLATFORM_ROLE` can mint or burn Presence/Sweat points.
- `CITIZEN_OPERATOR_ROLE` can issue, burn, and recover citizenship credentials.

The owner can also mint and burn Presence/Sweat points. Role holders that supply `daysAgo` mint or burn buckets are
trusted to supply truthful data; the contracts do not authenticate those ages against external records.

## Untrusted callers and external components

`TokenizedStays.createBookings` and `createBookingsWithPermit` are permissionless self-service escrow operations.
The caller chooses its own dates and `pricePerDate`, including zero. An on-chain booking is therefore not proof of a
real price, available inventory, confirmation, or entitlement to accommodation. Applications must authenticate and
validate booking requests off chain before treating them as product state. The contract only records per-account
date locks and secures the caller-selected CommunityToken exposure.

`DynamicPriceSale` buyers are untrusted. The caller pays the quote token and may select any recipient. The configured
quote token is assumed to implement ordinary ERC-20 accounting without transfer fees or rebasing. The bonding curve
is governance-selected trusted code. On initialization and replacement, the sale checks ERC-165 support, quote-token
decimals, the current live supply, and the currently feasible minimum/maximum configured quote boundaries. Those
checks catch incompatible and immediately unusable curves; they do not prove the economic correctness of every point
in an arbitrary curve.

`TokenizedStays` similarly assumes its fixed CommunityToken asset is non-rebasing and non-fee-on-transfer. Contracts
configured as role authorities or transfer policies are expected to implement their advertised semantics.

## Accepted design limitations

The following are known and accepted for V2:

- The Presence/Sweat decay rate remains mutable. A rate change does not checkpoint all holders or record rate epochs,
  so accounts checkpointed at different times can receive different effective applications of old and new rates.
  Governance must treat a post-launch rate change as an exceptional economic action and communicate the resulting
  path dependence. An index/epoch model is deferred.
- Presence/Sweat `totalSupply()` scans an append-only historical holder set and is intended for off-chain reads, not
  state-changing contract composition.
- CommunityToken governance can replace or disable the TDF transfer policy. Doing so can remove the TDF burn floor
  that protects the historical curve's operating range. This is intentional governance power, not an immutable
  protocol guarantee.
- Deployment Safe validation requires code plus `getOwners()`/`getThreshold()` responses and exact configured
  membership/threshold. It does not attest a particular Safe proxy, singleton, or Safe release. Operators must verify
  that identity independently before approving a production config.
- The TDF curve deliberately preserves the production V1 pricing formula and quote vectors. This is economic formula
  compatibility only; V2 does not preserve the V1 Diamond storage layout or migrate live V1 state.

All V2 deployment schemas and initial storage layouts start at their current definitions. There is no earlier
production V2 deployment to upgrade in place. The existing production V1 deployment is separate, and a transition of
its balances, bookings, memberships, roles, or authority requires an independently reviewed migration procedure.
