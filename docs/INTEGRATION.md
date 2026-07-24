# Integration

## Consumer boundary

Downstream API and UI code should consume a derived export, not Ignition state and not hand-maintained addresses. Build
one from a reconciled deployment manifest:

```sh
yarn export:village -- --manifest <manifest.json> --out <export.json>
```

The export uses schema version `3` and contains:

- `deploymentKind`, `deploymentProfile`, village slug, chain ID, and network;
- proxy/plain-contract addresses and implementation addresses where applicable;
- the ABI for each contract;
- display-only product aliases.

The deployment manifest remains the operator source of truth for ownership, roles, pending actions, verification,
runtime code hashes, upgrades, config hash, and Ignition provenance.

Consumers must:

- reject unsupported `schemaVersion` values;
- require the connected chain ID to equal the export's `chainId`;
- use proxy addresses for upgradeable contracts;
- key deployments by chain, village/profile, and immutable manifest history;
- activate direct-owner deployments only after `status` is `complete`;
- independently confirm deployer-handoff acceptances before activation;
- never infer a schema or deployment kind from an address or ABI.

## Contract clients

Use separate clients for `VillageAccess`, `CommunityToken`, `DynamicPriceSale`, `TokenizedStays`,
`VillagePresenceToken`, `VillageSweatToken`, `TDFTransferPolicy`, and, for TDF, `TDFV1BondingCurve`.

The sale intentionally exposes two compact aggregate reads instead of one getter per stored field:

- `saleConfiguration()` returns token, quote token, curve, treasury, fee, and fixed launch limits.
- `saleStatus()` returns live total supply, token maximum, effective cap, and remaining capacity.

Use `currentPrice()` for display and `quotePurchase(amount)` for execution preparation. A quote returns total payment,
inclusive Closer fee, village proceeds, post-purchase price, and the supply used for the quote. The Closer fee is
`floor(totalPayment * closerFeeBps / 10_000)` and is deducted from the curve cost. For example, a 5% fee on a
100-unit curve cost routes 5 units to Closer and 95 to the village.

Before `buy(amount, recipient, maxPayment, deadline)`, the caller must approve the DynamicPriceSale to spend enough
of the quote token. The caller is always the payer; `recipient` only chooses who receives newly minted
CommunityToken. There is no `buyFrom` or relayed payer authorization. Use a short deadline and a user-approved
`maxPayment`; after any `BondingCurveChanged` event, invalidate cached quotes. A supply-changing mint or burn can also
change the price between quote and execution, in which case `maxPayment` provides the intended protection.
For TDF, burns remain price-affecting but the transfer policy rejects any burn that would leave less than the
5,381 TDF operating supply needed by the complete configured purchase range.

Supported quote tokens are ordinary non-rebasing, non-fee-on-transfer ERC-20s. A failed quote-token transfer or token
mint rolls the whole purchase back. Do not treat the TDF curve's 200,000-token mathematical boundary as available
supply: read `saleStatus()` and CommunityToken `maxSupply()` instead.

Booking inputs are `{year, dayOfYear, pricePerDate}`. TokenizedStays records entitlement and deposit state only;
inventory, room assignment, confirmation, check-in, and other product workflow states remain off-chain. Zero-price
dates are valid entitlements and must not be treated as missing.

For TokenizedStays CommunityToken deposits, prefer an exact, short-lived EIP-2612 permit. An exact `approve` is the
compatibility fallback. DynamicPriceSale uses quote-token `approve` plus `buy`; it does not combine permit execution
with a purchase. Do not create an unlimited approval implicitly.

Presence and Sweat are non-transferable. Their `totalSupply()` derives readable balances across holders, so consumers
should avoid frequent polling and prefer indexed/reconciled views.

## Event and upgrade handling

Index events using `(chainId, contract, transactionHash, logIndex)`, with chain finality and reorg rollback. Relevant
TokenizedStays events include booking creation/cancellation/pruning, deposit/withdrawal, balance reconciliation, and
orphan recovery.

Keep immutable manifest history across upgrades. The proxy address stays stable; the implementation address and
effective ABI revision are auditable through `upgradeHistory` and the chain's ERC-1967 slot. An API operator role
must never be treated as upgrade authority.

## Deployment automation

An automated deployment worker should:

1. generate and validate schema-4 config;
2. use a clean immutable source revision;
3. invoke the supported deployment wrapper with a dedicated deployer;
4. persist the stable Ignition deployment ID and logs;
5. resume after interruption instead of creating a second deployment;
6. use a separate Safe proposer credential for owner actions;
7. reconcile on-chain state before publishing the manifest/export;
8. retain journals and manifests in durable storage.

Private keys must never be accepted from browser or HTTP deployment input.
