# Integration

## Consumer boundary

There is currently no generated API/UI descriptor. The repository commits the schema-2 operational manifest and the
real-network Ignition deployment directory. The manifest provides canonical names, proxy/plain addresses, current
implementation addresses and code hashes, but intentionally does not duplicate ABIs or historical ABI revisions.
Compiled ABIs remain in Hardhat/Ignition artifacts.

When an API or UI integration has a concrete release and historical-indexing requirement, define a small projection
for that consumer from these committed records. Do not make the operational deployment manifest grow into a
speculative distribution format.

## Contract clients

Use separate clients for `VillageAccess`, `VillageCitizenNFT`, `CommunityToken`, `DynamicPriceSale`,
`TokenizedStays`, `VillagePresenceToken`, `VillageSweatToken`, `TDFTransferPolicy`, and, for TDF,
`TDFV1BondingCurve`.

VillageCitizenNFT holder discovery is a fixed-block snapshot: read `totalSupply()`, enumerate `tokenByIndex(i)`, and
resolve each `ownerOf(tokenId)`, preferably through multicall. Enumeration order changes after burns, so an index must
never be persisted as token identity. `tokenIdOf(wallet)` returns zero and `citizenshipInfo(wallet)` returns an
all-zero struct when the wallet has no live credential. `locked(tokenId)` is true only for a live token and reverts
after burn. Do not expose transfer or approval controls.

Treat `subjectRef` as an opaque correlation handle generated from a cryptographically secure random source. Never put
personal data, user identifiers, hashes of identifiers, or ciphertext into it. References are public and permanently
single-use. Suspension and revocation both remove the live credential; reapproval requires a fresh token ID and
reference. Lost-wallet recovery is one atomic operator transaction.

The sale exposes two aggregate reads:

- `saleConfiguration()` returns token, quote token, curve, treasury, fee, and fixed launch limits.
- `saleStatus()` returns live total supply, token maximum, effective cap, and remaining capacity.

Use `currentPrice()` for display and `quotePurchase(amount)` for execution preparation. Before
`buy(amount, recipient, maxPayment, deadline)`, approve the DynamicPriceSale for the exact intended quote-token amount.
Use a short deadline and user-approved `maxPayment`; invalidate cached quotes when supply or the bonding curve changes.
The caller is always the payer, while `recipient` receives the CommunityToken. Do not implicitly create an unlimited
approval.

Presence and Sweat are non-transferable. Their `totalSupply()` derives readable balances across holders, so consumers
should prefer indexed/reconciled views to frequent polling and distinguish raw issued value from currently decayed
balance.

## Booking and deposit integration

Booking inputs are `{year, dayOfYear, pricePerDate}`. TokenizedStays records entitlement and deposit state only;
inventory, room assignment, confirmation, check-in, and other product workflow states remain off-chain. Zero-price
dates are valid entitlements.

The booking functions are permissionless and do not authenticate a backend quote: each caller chooses its own dates
and prices. Never treat a successful transaction or indexed `BookingCreated` event as evidence that the backend
approved the price, inventory, or reservation. Validate the authenticated product request off chain before presenting
it as a real stay.

Deposit reads are already supported:

- `depositedBalanceOf(account)` returns the account's total credited deposit, including the portion currently locked.
- `getDepositState(account)` returns the credited deposit, current required locked amount, currently withdrawable
  amount, cached latest booking year, and current maximum booking year.
- `previewCreateBookings(account, bookings)` validates the proposed batch and returns `depositedBalance`,
  `requiredLockedBalanceBefore`, `requiredLockedBalanceAfter`, and `depositDeficit`.

The exact required top-up is:

```text
depositDeficit = max(requiredLockedBalanceAfter - depositedBalance, 0)
```

It is not the booking batch's total price, the account's total deposit, or the resulting locked balance.

For the allowance flow:

1. Call `previewCreateBookings` immediately before authorization.
2. If `depositDeficit` is zero, call `createBookings` without approval.
3. Otherwise replace the TokenizedStays allowance with exactly `depositDeficit`; do not add it to an old allowance.
4. Re-run the preview after approval, because another transaction may have changed deposits or bookings.
5. Submit `createBookings`. The contract calculates the live deficit and transfers only that amount.

For the EIP-2612 flow, sign exactly the previewed nonzero deficit with a short deadline, then call
`createBookingsWithPermit(bookings, deadline, v, r, s)`. The function deliberately has no caller-supplied permit
amount: it recalculates the live deficit and uses that value in `permit`. If a relayer already submitted the signature,
or if `permit` fails for any other reason, the call continues when any existing allowance still covers the live
deficit. Without sufficient allowance, a stale or invalid signature reverts the complete booking transaction
atomically. A zero-deficit batch uses `createBookings`, not the permit entry point.

The API should return the contract preview to the UI instead of independently recreating locking arithmetic. The UI
may display it but must refresh it around wallet authorization. Any residual allowance from a replaced/dropped flow
should be visible and revocable.

## Event and upgrade handling

Index events using `(chainId, contract, transactionHash, logIndex)`, with chain finality and reorg rollback. Start from
the manifest's `deploymentStart`. Because the manifest does not embed historical ABIs, pair each proxy's reviewed
source artifacts with its reconciled manifest upgrade records and on-chain `Upgraded` events. For each log, choose the
last contract revision active at or before the log's exact block/transaction/log position.

Relevant TokenizedStays events include booking creation/cancellation/pruning, deposit/withdrawal, balance
reconciliation, and orphan recovery. Citizenship history comes from `CitizenshipIssued`,
`CitizenshipOperatorBurned`, `CitizenshipSelfBurned`, and `CitizenshipRecovered` together with ERC-721 `Transfer`.
Index `Locked` for ERC-5192 consumers and refresh live token metadata after `BatchMetadataUpdate`.

The proxy address stays stable across upgrades. Never use only the latest ABI to decode all history, and never treat
an API operator role as upgrade authority.
