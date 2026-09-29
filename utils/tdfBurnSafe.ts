import assert from 'assert';
import {BigNumber, Contract, constants, providers, utils} from 'ethers';
import {Artifacts} from 'hardhat/types';
import {verifyBurnInitializer} from './tdfBurnArtifacts';
import {
  TDF_BURN,
  TDF_BURN_DIAMOND_ABI,
  TDF_BURN_TOKEN_ABI,
  burnCorrectionTransaction,
  tdfTransfers,
} from './tdfBurnCorrection';

export const BURN_SAFE_ABI = [
  'function getOwners() view returns (address[])',
  'function getThreshold() view returns (uint256)',
  'function nonce() view returns (uint256)',
  'function execTransaction(address to,uint256 value,bytes data,uint8 operation,uint256 safeTxGas,uint256 baseGas,uint256 gasPrice,address gasToken,address refundReceiver,bytes signatures) payable returns (bool)',
];
const safeInterface = new utils.Interface(BURN_SAFE_ABI);
const diamondInterface = new utils.Interface([
  ...TDF_BURN_DIAMOND_ABI,
  'event DiamondCut((address facetAddress,uint8 action,bytes4[] functionSelectors)[],address,bytes)',
  'event TDFBurnCorrectionCompleted(uint256 totalBurned)',
]);
const sameAddress = (a: string | null | undefined, b: string) => a?.toLowerCase() === b.toLowerCase();

export async function readBurnSafe(provider: providers.Provider, blockTag: providers.BlockTag) {
  const safe = new Contract(TDF_BURN.safe, BURN_SAFE_ABI, provider);
  const [owners, threshold, nonce]: [string[], BigNumber, BigNumber] = await Promise.all([
    safe.getOwners({blockTag}),
    safe.getThreshold({blockTag}),
    safe.nonce({blockTag}),
  ]);
  assert(threshold.gt(0) && threshold.lte(owners.length), 'Unexpected Safe signature threshold');
  return {owners, threshold: threshold.toNumber(), nonce: nonce.toString()};
}

// Safe's version-1.0 batch checksum uses sorted keys plus a key-list prefix.
// Protocol reference: safe-global/safe-react-apps, apps/tx-builder/src/lib/checksum.ts.
function serializeBatch(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(serializeBatch).join(',')}]`;
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record).sort();
    return `{${JSON.stringify(keys)}${keys.map((key) => `${serializeBatch(record[key])},`).join('')}}`;
  }
  return JSON.stringify(value === undefined ? null : value);
}

/** One raw transaction avoids ABI re-encoding and never requests a MultiSend batch. */
export function burnSafeBatch(initializer: string, createdAt = Date.now()) {
  const {to, value, data} = burnCorrectionTransaction(initializer);
  const batch = {
    version: '1.0',
    chainId: String(TDF_BURN.chainId),
    createdAt,
    meta: {
      name: 'One-time 41 TDF burn correction',
      description: 'Burn exactly 4, 2, 5 and 30 TDF from the four reviewed wallets. Empty diamond cut; CALL; value 0.',
      createdFromSafeAddress: TDF_BURN.safe,
    },
    transactions: [{to, value, data}],
  };
  const checksum = utils.id(serializeBatch({...batch, meta: {...batch.meta, name: null}}));
  return {...batch, meta: {...batch.meta, checksum}};
}

/** Validate the transaction itself and its logs, independently of a stale preflight snapshot. */
export function validateBurnExecution(
  transaction: providers.TransactionResponse,
  receipt: providers.TransactionReceipt
) {
  assert(receipt.status === 1, 'Execution transaction reverted');
  assert(
    transaction.hash.toLowerCase() === receipt.transactionHash.toLowerCase(),
    'Receipt does not match transaction'
  );
  assert(transaction.chainId === TDF_BURN.chainId, 'Execution must be on Celo mainnet');
  assert(sameAddress(transaction.to, TDF_BURN.safe), 'Expected a direct transaction to the owner Safe');
  assert(transaction.value.isZero(), 'Unexpected native value sent to Safe');
  const call = safeInterface.decodeFunctionData('execTransaction', transaction.data);
  assert(sameAddress(call.to, TDF_BURN.diamond), 'Safe destination is not the Diamond');
  assert(call.value.isZero() && call.operation === 0, 'Expected a zero-value Safe CALL');
  assert(call.gasPrice.isZero(), 'Unexpected Safe gas reimbursement');
  assert(
    sameAddress(call.gasToken, constants.AddressZero) && sameAddress(call.refundReceiver, constants.AddressZero),
    'Unexpected Safe refund settings'
  );
  const cut = diamondInterface.decodeFunctionData('diamondCut', call.data);
  const initializer = utils.getAddress(cut[1]);
  assert(
    call.data.toLowerCase() === burnCorrectionTransaction(initializer).data.toLowerCase(),
    'Unexpected diamond cut or initializer calldata'
  );

  const successTopic = utils.id('ExecutionSuccess(bytes32,uint256)');
  const failureTopic = utils.id('ExecutionFailure(bytes32,uint256)');
  const safeLogs = receipt.logs.filter((log) => sameAddress(log.address, TDF_BURN.safe));
  assert(!safeLogs.some((log) => log.topics[0] === failureTopic), 'Safe reported ExecutionFailure');
  const successes = safeLogs.filter((log) => log.topics[0] === successTopic);
  assert(successes.length === 1, 'Expected exactly one Safe ExecutionSuccess event');
  // Safe versions differ in whether txHash is indexed; support both encodings.
  const event = new utils.Interface([
    `event ExecutionSuccess(bytes32 ${successes[0].topics.length === 2 ? 'indexed ' : ''}txHash,uint256 payment)`,
  ]).parseLog(successes[0]);
  assert(event.args.payment.isZero(), 'Safe paid an unexpected reimbursement');

  const burns = tdfTransfers(receipt);
  assert(burns.length === TDF_BURN.targets.length, 'Expected exactly four TDF transfers');
  burns.forEach((burn, index) => {
    const target = TDF_BURN.targets[index];
    assert(
      sameAddress(burn.from, target.account) && sameAddress(burn.to, constants.AddressZero),
      'Unexpected burn account'
    );
    assert(burn.amount.eq(target.amount), 'Unexpected burn amount');
  });
  const diamondLogs = receipt.logs.filter((log) => sameAddress(log.address, TDF_BURN.diamond));
  const cuts = diamondLogs.filter((log) => log.topics[0] === diamondInterface.getEventTopic('DiamondCut'));
  assert(cuts.length === 1, 'Expected exactly one DiamondCut event');
  const executedCut = diamondInterface.parseLog(cuts[0]).args;
  assert(
    executedCut[0].length === 0 && sameAddress(executedCut[1], initializer) && executedCut[2] === cut[2],
    'Unexpected executed diamond cut'
  );
  const completions = diamondLogs.filter(
    (log) => log.topics[0] === diamondInterface.getEventTopic('TDFBurnCorrectionCompleted')
  );
  assert(completions.length === 1, 'Expected exactly one correction completion event');
  assert(
    diamondInterface.parseLog(completions[0]).args.totalBurned.eq(TDF_BURN.total),
    'Unexpected completed burn total'
  );
  return {initializer, safeTransactionHash: event.args.txHash as string};
}

export async function verifyBurnExecution(
  provider: providers.Provider,
  artifacts: Pick<Artifacts, 'readArtifact' | 'getBuildInfo'>,
  transactionHash: string
) {
  assert(utils.isHexString(transactionHash, 32), 'Expected an on-chain execution transaction hash');
  assert((await provider.getNetwork()).chainId === TDF_BURN.chainId, 'RPC must be Celo mainnet (42220)');
  const [transaction, receipt] = await Promise.all([
    provider.getTransaction(transactionHash),
    provider.getTransactionReceipt(transactionHash),
  ]);
  assert(transaction && receipt, 'Execution transaction is missing or not mined yet');
  const {initializer, safeTransactionHash} = validateBurnExecution(transaction, receipt);
  const {codeHash} = await verifyBurnInitializer(provider, artifacts, initializer, receipt.blockNumber);
  const blockTag = receipt.blockNumber;
  const diamond = new Contract(
    TDF_BURN.diamond,
    [...TDF_BURN_DIAMOND_ABI, 'function facetAddress(bytes4) view returns (address)'],
    provider
  );
  const token = new Contract(TDF_BURN.token, TDF_BURN_TOKEN_ABI, provider);
  const [completed, owner, dao, selector] = await Promise.all([
    provider.getStorageAt(TDF_BURN.diamond, TDF_BURN.completionSlot, blockTag),
    diamond.owner({blockTag}),
    token.getDAOContract({blockTag}),
    diamond.facetAddress(utils.id('execute()').slice(0, 10), {blockTag}),
  ]);
  assert(BigNumber.from(completed).eq(1), 'Completion flag is not set');
  assert(
    sameAddress(owner, TDF_BURN.safe) && sameAddress(dao, TDF_BURN.diamond),
    'Unexpected owner or token DAO after execution'
  );
  assert(sameAddress(selector, constants.AddressZero), 'Initializer was registered as a facet');
  return {
    transactionHash,
    blockNumber: receipt.blockNumber,
    safeTransactionHash,
    initializer,
    initializerCodeHash: codeHash,
    totalBurnTDF: utils.formatEther(TDF_BURN.total),
    burns: TDF_BURN.targets.map(({account, amount}) => ({account, amountTDF: utils.formatEther(amount)})),
    completionFlag: 1,
  };
}
