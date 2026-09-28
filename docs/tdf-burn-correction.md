# One-time 41-TDF correction

This correction burns wallet balances on Celo mainnet (chain ID **42220**). It does not
withdraw or change staked tokens. No user approvals are needed: the configured TDF
Diamond already has unlimited allowance through `TDFToken.allowance()`.

| Recipient                                    | Burn (TDF) | Source                               |
| -------------------------------------------- | ---------: | ------------------------------------ |
| `0x39B8eDbC6D6bAB985Bf03B498166DB588c00278e` |          4 | First receipt, logs 43 and 44: 3 + 1 |
| `0x5fE4E295A0765Eab77E23711972Fdcce960Dd95B` |          2 | First receipt, log 45                |
| `0x2f6b63eA91Ca3E13fcb6911dFee4Af24CdeC37D7` |          5 | First receipt, log 46                |
| `0x06f4DB783097c632B888669032B2905F70e08105` |         30 | Second receipt, log 14 only          |

- First: [0x7181b78b54e959b9718e9e9f606b07fa542c061a0e5b3ec56297da5e8d9d466f](https://celoscan.io/tx/0x7181b78b54e959b9718e9e9f606b07fa542c061a0e5b3ec56297da5e8d9d466f), block 78,266,860. Four mints total 11 TDF.
- Second: [0xfe3880cf145ce7b0df82b8ef2b9875fef0c63d58a9df230452e8019fa743221e](https://celoscan.io/tx/0xfe3880cf145ce7b0df82b8ef2b9875fef0c63d58a9df230452e8019fa743221e), block 21,132,052. This was a treasury transfer, not a mint. All ten other recipients are excluded, including the other 30-TDF recipient.

Fixed bindings:

- Diamond: `0x475398EeE0E22cb6fe5403ffA294Fb10Ad989e17`
- TDF token: `0x10CB7F49389787A99b59B2f87dfDd3bba141559f`
- Owner Safe: `0x5E810b93c51981eccA16e030Ea1cE8D8b1DEB83b`

## Execution design

Deploy `TDFBurnCorrection(diamond, token)`, then execute exactly:

```text
Safe --CALL--> Diamond.diamondCut([], initializer, encodeFunctionData("execute"))
```

No facet selectors are added or replaced. The initializer runs with the Diamond's
storage and calls the token's existing `burnFrom` function for each fixed recipient.
The initializer remains deployed afterward, but `execute()` is not callable through
the Diamond's normal selector dispatch.

The completion flag is stored in the Diamond at
`keccak256("closer.tdf.burn-correction.7181b78b.fe3880cf.v1")`. It leaves `AppStorage`
unchanged and blocks accidental replay, including through a redeployed copy of this
initializer. It is set before token calls; any failure rolls back all burns and the
flag. An owner intentionally using different upgrade code could bypass this guard.

## Build and test

Use the repository's Node version and Yarn. `corepack yarn` can be used when the
installed `yarn` shim has no selected version.

```sh
corepack yarn compile
corepack yarn test
```

The fork test is opt-in and does not run deployment fixtures. Hardhat 2.9 cannot
decode current Celo blocks, so this test uses the existing Hardhat compiler and
Mocha tests against a dedicated [Anvil](https://www.getfoundry.sh/anvil/index.html)
node. No project dependency upgrade is required. Start Anvil in another terminal:

```sh
anvil --host 127.0.0.1 --port 18545 --chain-id 42220 --silent
```

Run the pinned rehearsal:

```sh
TDF_BURN_FORK=1 corepack yarn mocha --no-config --require ts-node/register --require hardhat/register test/diamond/TDFBurnCorrection.fork.test.ts
```

Repeat against a fresh block before execution:

```sh
TDF_BURN_FORK=1 TDF_BURN_FORK_BLOCK=latest corepack yarn mocha --no-config --require ts-node/register --require hardhat/register test/diamond/TDFBurnCorrection.fork.test.ts
```

The default pinned block is 78,468,345. Optional `TDF_BURN_FORK_RPC` selects another
Celo archival RPC, and `TDF_BURN_FORK_NODE` selects a dedicated loopback Anvil URL.
The test resets that local node before and after the rehearsal and impersonates the
Safe only locally. Stop Anvil afterward. Do not set `HARDHAT_DEPLOY_FIXTURE` or use
`yarn fork:test`, which would run the normal deployment fixtures over the fork.

## Prepare the Safe call

First perform a read-only preflight:

```sh
corepack yarn execute celo scripts/prepareTdfBurnCorrection.ts
```

It validates the chain, deployment addresses, both source receipts, current owner,
token/DAO bindings, decimals, completion flag, pause state, transfer permissions,
allowances, and balances. Insufficient funds abort preparation; amounts are never
reduced and recipients are never skipped.

After reviewing the code and successful tests, deploy the initializer explicitly:

```sh
corepack yarn execute celo scripts/prepareTdfBurnCorrection.ts --deploy
```

This command can broadcast **only the initializer deployment** using the configured
deployment signer. It does not submit, sign, or execute the Safe transaction. It is
outside `deploy/`, so ordinary deployments do not trigger it.

The script records the deployment, rechecks current state, simulates the complete
cut as the owner Safe, estimates gas, and writes `cache/tdf-burn-correction.json`.
Use `--output <path>` to choose another output. Without `--deploy`, rerunning it
reuses the recorded initializer and performs only reads and local output writes.

The JSON is a review manifest with raw Safe-call fields, not a Safe Transaction
Builder import file. It includes the initializer code hash, source transactions,
excluded recipients, preflight block/hash, raw amounts and expected balances/supply,
gas estimate, and the `transaction` object (`to`, `value`, `data`, `operation`).
The gas estimate covers the Diamond call; Safe execution overhead is additional.

Before signing:

1. Verify the initializer's source using the repository's explorer verification
   tooling and constructor arguments above; match the deployed bytecode to the
   reviewed artifact. Keep the deployment record and review manifest.
2. Run a fresh fork rehearsal and rerun preparation without `--deploy`.
3. Review the four recipients, total of `41000000000000000000` base units, initializer
   address, and decoded calldata. The cut list must be empty and inner calldata must
   contain only the `execute()` selector.
4. Create the Safe transaction using the manifest's exact `to`, `data`, and value
   `0`. The Safe operation must be **CALL (0)** to the Diamond, not DELEGATECALL.
   Obtain the Safe's required signatures and execute once.

## Verify execution

Confirm the Safe reports successful inner execution (a successful outer receipt
alone is insufficient). The receipt must contain the Diamond's `DiamondCut` and
`TDFBurnCorrectionCompleted(41000000000000000000)` events, plus exactly four TDF
`Transfer(account, address(0), amount)` burn events matching the table.

Verify the completion slot is `1`, the DAO binding is unchanged, and all facet
addresses/selectors remain unchanged. Compare balances and total supply against
the execution state: the total-supply reduction is exactly 41 TDF. If comparing
block boundaries, account for unrelated token movements in the same block rather
than assuming an earlier preflight snapshot is still current. The ten excluded
recipients, treasury, staking balances/bookings, roles, and memberships must remain
unchanged by this correction.

At the original inspected block the last recipient held 30.002 TDF, so its expected
remainder was 0.002 TDF; always use the fresh snapshot for execution. A failed cut
rolls back the flag and burns and can be retried after correcting the prerequisite.
After success, do not execute another correction proposal.
