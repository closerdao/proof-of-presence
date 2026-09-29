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
The test resets that local node before and after the rehearsal, simulates owner
approvals locally, and executes through the deployed Safe's `execTransaction`.
It checks the exported payload, bytecode verification, and execution verifier in
addition to accounting and replay protection. No real owner keys are needed.
Stop Anvil afterward. Do not set `HARDHAT_DEPLOY_FIXTURE` or use
`yarn fork:test`, which would run the normal deployment fixtures over the fork.

## Prepare and execute in the Safe app

The same script handles compilation, preflight, explicit initializer deployment,
bytecode verification, Safe file export, and post-execution verification. It never
signs, proposes, or sends the Safe burn transaction.

The deployment wallet can be any account funded with CELO. Configure its
`PRIVATE_KEY` locally using the existing environment setup. Safe owners keep their
wallets in the Safe app; their private keys are not needed by the script. The
Diamond call must come from the owner Safe, and the script prints its current
owners and signature threshold in the review manifest.

First perform a read-only preflight:

```sh
corepack yarn execute celo scripts/prepareTdfBurnCorrection.ts
```

It compiles the current source and validates the chain, deployment addresses, both
source receipts, current owner, Safe configuration, token/DAO bindings, decimals,
completion flag, pause state, transfer permissions, allowances, and balances.
Insufficient funds abort preparation; amounts are never reduced and recipients
are never skipped. Historical receipt retrieval can intermittently fail on the
public RPC; retry the command if it reports `Source receipt unavailable`.

After reviewing the code and successful tests, deploy the initializer explicitly:

```sh
corepack yarn execute celo scripts/prepareTdfBurnCorrection.ts --deploy
```

This command can broadcast **only the initializer deployment** using the configured
deployment signer. It does not submit, sign, or execute the Safe transaction. It is
outside `deploy/`, so ordinary deployments do not trigger it.

The script records the deployment, verifies its complete runtime bytecode against
the compiler output (including both immutable constructor bindings), rechecks
current state, simulates the complete cut as the owner Safe, and estimates gas.
It writes two different files:

- `cache/tdf-burn-correction.json`: review manifest with the initializer code hash,
  source transactions, excluded recipients, preflight block/hash, exact amounts,
  expected balances/supply, current Safe owners/threshold/nonce, and raw call fields.
- `cache/tdf-burn-correction.safe.json`: import this checksummed, version-1.0 JSON
  into **Safe Transaction Builder**. It contains exactly one raw transaction on
  chain **42220**, with the Diamond destination, value **0**, and the encoded cut.

Use `--output <path>` to change the manifest path; the Safe file uses the same
prefix with `.safe.json`. The checksum follows the [official Safe import format](https://github.com/safe-global/safe-react-apps/blob/e8cccfb9a1042fa2954087988bae59c3b8c81780/apps/tx-builder/src/lib/checksum.ts).
The gas estimate covers the Diamond call; Safe execution overhead is additional.
The Safe nonce in the manifest is informational, not a reserved queue position.
Without `--deploy`, rerunning preparation reuses the recorded initializer and
performs only chain reads and local compilation/output writes.

Before signing:

1. Use the reviewed source revision. Preparation automatically matches the deployed
   bytecode to the current compiled artifact, including constructor bindings. Explorer
   source publication can additionally be performed using the repository's verification
   tooling. Keep the deployment record and review manifest.
2. Run a fresh fork rehearsal and rerun preparation without `--deploy`.
3. Review the four recipients, total of `41000000000000000000` base units, initializer
   address, and decoded calldata. The cut list must be empty and inner calldata must
   contain only the `execute()` selector.
4. Open the owner Safe above on **Celo**, connect an owner wallet, and open
   **New transaction / Transaction Builder**. Import the `.safe.json` file.
   Keep exactly this one transaction; do not combine it with other actions.
5. Check the Safe transaction uses the manifest's exact `to`, `data`, and value
   `0`. The operation must be **CALL (0)** to the Diamond. Use zero Safe gas
   reimbursement (`gasPrice: 0`, zero `gasToken` and `refundReceiver`); the submitting
   wallet pays the normal network gas. Simulate in Safe if available, collect the
   required owner signatures, and execute once.

## Verify execution

Copy the **on-chain execution transaction hash** from Safe, then run:

```sh
corepack yarn execute celo scripts/prepareTdfBurnCorrection.ts --verify-tx 0xYOUR_EXECUTION_TRANSACTION_HASH
```

This is read-only on chain. It verifies the direct Safe `execTransaction` calldata,
zero-value CALL and refund settings, successful inner execution, exactly four
specified burns, the empty-cut and completion events, matching initializer runtime,
completion flag, owner/DAO bindings, and absence of an installed `execute()` selector.
It writes `cache/tdf-burn-correction.execution.json`. This mode does not need a
deployment signer or local initializer deployment record. Use the chain transaction
hash, not Safe's off-chain proposal hash. Batched/MultiSend or account-abstraction
wrappers are deliberately outside this verifier's supported direct-call workflow.

Verification failure is not a reason to execute the burn again: inspect the receipt
and completion flag first. The verifier proves the specific call and burn evidence;
it does not claim to audit every storage slot in the execution block.

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
