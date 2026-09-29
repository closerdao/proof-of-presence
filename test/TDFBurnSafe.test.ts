import {expect} from './chai-setup';
import {BigNumber, constants, providers, utils} from 'ethers';
import {parseBurnArguments} from '../scripts/prepareTdfBurnCorrection';
import {BURN_SAFE_ABI, burnSafeBatch, validateBurnExecution} from '../utils/tdfBurnSafe';
import {TDF_BURN, TDF_BURN_DIAMOND_ABI, burnCorrectionTransaction} from '../utils/tdfBurnCorrection';

const initializer = '0x1111111111111111111111111111111111111111';
const safe = new utils.Interface(BURN_SAFE_ABI);
const events = new utils.Interface([
  'event ExecutionSuccess(bytes32 indexed txHash,uint256 payment)',
  'event ExecutionFailure(bytes32 indexed txHash,uint256 payment)',
  'event Transfer(address indexed from,address indexed to,uint256 value)',
  'event DiamondCut((address facetAddress,uint8 action,bytes4[] functionSelectors)[],address,bytes)',
  'event TDFBurnCorrectionCompleted(uint256 totalBurned)',
]);
const eventLog = (name: string, address: string, values: unknown[]) =>
  ({address, ...events.encodeEventLog(events.getEvent(name), values)} as providers.Log);

function execution() {
  const transaction = {
    hash: utils.id('execution'),
    chainId: 42220,
    to: TDF_BURN.safe,
    value: BigNumber.from(0),
    data: safe.encodeFunctionData('execTransaction', [
      TDF_BURN.diamond,
      0,
      burnCorrectionTransaction(initializer).data,
      0,
      0,
      0,
      0,
      constants.AddressZero,
      constants.AddressZero,
      '0x',
    ]),
  } as providers.TransactionResponse;
  const receipt = {
    transactionHash: transaction.hash,
    status: 1,
    logs: [
      eventLog('DiamondCut', TDF_BURN.diamond, [[], initializer, utils.id('execute()').slice(0, 10)]),
      ...TDF_BURN.targets.map(({account, amount}) =>
        eventLog('Transfer', TDF_BURN.token, [account, constants.AddressZero, amount])
      ),
      eventLog('TDFBurnCorrectionCompleted', TDF_BURN.diamond, [TDF_BURN.total]),
      eventLog('ExecutionSuccess', TDF_BURN.safe, [utils.id('safe transaction'), 0]),
    ],
  } as providers.TransactionReceipt;
  return {transaction, receipt};
}

describe('TDF burn Safe workflow', () => {
  it('exports one raw zero-value Celo transaction with the intended Safe and empty diamond cut', () => {
    const batch = burnSafeBatch(initializer, 1700000000000);
    expect(batch.version).to.eq('1.0');
    expect(batch.chainId).to.eq('42220');
    expect(batch.meta.createdFromSafeAddress).to.eq(TDF_BURN.safe);
    expect(batch.transactions).to.have.lengthOf(1);
    const tx = batch.transactions[0];
    expect(tx.to).to.eq(TDF_BURN.diamond);
    expect(tx.value).to.eq('0');
    expect(Object.keys(tx).sort()).to.deep.eq(['data', 'to', 'value']);
    const cut = new utils.Interface(TDF_BURN_DIAMOND_ABI).decodeFunctionData('diamondCut', tx.data);
    expect(cut[0]).to.have.lengthOf(0);
    expect(cut[1]).to.eq(initializer);
    expect(cut[2]).to.eq(utils.id('execute()').slice(0, 10));
    // Independently checked with Safe's validateChecksum at e8cccfb9a1042fa2954087988bae59c3b8c81780.
    expect(batch.meta.checksum).to.eq('0xda5b55f833971e43d687d591fead47e9db22acdbe4609a9d78f42039e9d2d20f');
  });

  it('requires an explicit deployment flag and rejects mixed or malformed command modes', () => {
    expect(parseBurnArguments([]).deploy).to.eq(false);
    expect(parseBurnArguments(['--deploy']).deploy).to.eq(true);
    expect(parseBurnArguments(['--help']).help).to.eq(true);
    expect(() => parseBurnArguments(['--deploy', '--verify-tx', utils.id('tx')])).to.throw('cannot be combined');
    expect(() => parseBurnArguments(['--verify-tx', '--deploy'])).to.throw('transaction hash');
    expect(() => parseBurnArguments(['--output', '--deploy'])).to.throw('filename');
    expect(() => parseBurnArguments(['--deploy', '--deploy'])).to.throw('Duplicate');
    expect(() => parseBurnArguments(['--execute'])).to.throw('Unknown argument');
  });

  it('verifies the exact Safe execution with either supported success-event encoding', () => {
    const {transaction, receipt} = execution();
    expect(validateBurnExecution(transaction, receipt).initializer).to.eq(initializer);
    const unindexed = new utils.Interface(['event ExecutionSuccess(bytes32 txHash,uint256 payment)']);
    receipt.logs[6] = {
      ...receipt.logs[6],
      ...unindexed.encodeEventLog(unindexed.getEvent('ExecutionSuccess'), [utils.id('safe transaction'), 0]),
    };
    expect(validateBurnExecution(transaction, receipt).safeTransactionHash).to.eq(utils.id('safe transaction'));
  });

  it('rejects a failed inner Safe execution even if the outer receipt succeeds', () => {
    const {transaction, receipt} = execution();
    receipt.logs[6] = eventLog('ExecutionFailure', TDF_BURN.safe, [utils.id('safe transaction'), 0]);
    expect(() => validateBurnExecution(transaction, receipt)).to.throw('ExecutionFailure');
    receipt.status = 0;
    expect(() => validateBurnExecution(transaction, receipt)).to.throw('reverted');
  });

  it('rejects a different chain, destination, operation, native value, or reimbursement', () => {
    const {transaction, receipt} = execution();
    expect(() => validateBurnExecution({...transaction, chainId: 1}, receipt)).to.throw('Celo');
    expect(() => validateBurnExecution({...transaction, to: TDF_BURN.diamond}, receipt)).to.throw('owner Safe');
    expect(() => validateBurnExecution({...transaction, value: BigNumber.from(1)}, receipt)).to.throw('native value');
    for (const [index, value, message] of [
      [0, TDF_BURN.token, 'destination'],
      [1, 1, 'zero-value'],
      [3, 1, 'zero-value'],
      [6, 1, 'reimbursement'],
    ] as const) {
      const args = [...safe.decodeFunctionData('execTransaction', transaction.data)];
      args[index] = value;
      expect(() =>
        validateBurnExecution({...transaction, data: safe.encodeFunctionData('execTransaction', args)}, receipt)
      ).to.throw(message);
    }
  });

  it('rejects changed initializer calldata and facet modifications', () => {
    const {transaction, receipt} = execution();
    const diamond = new utils.Interface(TDF_BURN_DIAMOND_ABI);
    const args = [...safe.decodeFunctionData('execTransaction', transaction.data)];
    for (const call of [
      diamond.encodeFunctionData('diamondCut', [[], initializer, '0x12345678']),
      diamond.encodeFunctionData('diamondCut', [
        [[initializer, 0, ['0x12345678']]],
        initializer,
        utils.id('execute()').slice(0, 10),
      ]),
    ]) {
      args[2] = call;
      expect(() =>
        validateBurnExecution({...transaction, data: safe.encodeFunctionData('execTransaction', args)}, receipt)
      ).to.throw('Unexpected diamond cut');
    }
  });

  it('rejects wrong recipients, amounts, extra token transfers, and missing completion evidence', () => {
    for (const [log, message] of [
      [
        eventLog('Transfer', TDF_BURN.token, [TDF_BURN.safe, constants.AddressZero, TDF_BURN.targets[0].amount]),
        'burn account',
      ],
      [
        eventLog('Transfer', TDF_BURN.token, [
          TDF_BURN.targets[0].account,
          constants.AddressZero,
          utils.parseEther('5'),
        ]),
        'burn amount',
      ],
    ] as const) {
      const {transaction, receipt} = execution();
      receipt.logs[1] = log;
      expect(() => validateBurnExecution(transaction, receipt)).to.throw(message);
    }
    const extra = execution();
    extra.receipt.logs.push(extra.receipt.logs[1]);
    expect(() => validateBurnExecution(extra.transaction, extra.receipt)).to.throw('exactly four');
    const missing = execution();
    missing.receipt.logs.splice(5, 1);
    expect(() => validateBurnExecution(missing.transaction, missing.receipt)).to.throw('completion event');
    const wrongCut = execution();
    wrongCut.receipt.logs[0] = eventLog('DiamondCut', TDF_BURN.diamond, [
      [],
      TDF_BURN.safe,
      utils.id('execute()').slice(0, 10),
    ]);
    expect(() => validateBurnExecution(wrongCut.transaction, wrongCut.receipt)).to.throw('executed diamond cut');
  });
});
