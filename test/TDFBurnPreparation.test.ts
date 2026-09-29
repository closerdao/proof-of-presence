import {expect} from './chai-setup';
import assert from 'assert';
import {providers, utils, constants} from 'ethers';
import {
  TDF_BURN,
  TDF_BURN_DIAMOND_ABI,
  burnCorrectionTransaction,
  fetchBurnSources,
  validateBurnSources,
} from '../utils/tdfBurnCorrection';

const transfer = new utils.Interface(['event Transfer(address indexed from,address indexed to,uint256 value)']);
const makeLog = (from: string, to: string, amount: string, logIndex: number) => ({
  ...transfer.encodeEventLog(transfer.getEvent('Transfer'), [from, to, utils.parseEther(amount)]),
  address: TDF_BURN.token,
  logIndex,
});
const receipts = () =>
  [
    {
      transactionHash: TDF_BURN.sources[0].hash,
      blockNumber: TDF_BURN.sources[0].block,
      status: 1,
      logs: [
        makeLog(constants.AddressZero, TDF_BURN.targets[0].account, '3', 43),
        makeLog(constants.AddressZero, TDF_BURN.targets[0].account, '1', 44),
        makeLog(constants.AddressZero, TDF_BURN.targets[1].account, '2', 45),
        makeLog(constants.AddressZero, TDF_BURN.targets[2].account, '5', 46),
      ],
    },
    {
      transactionHash: TDF_BURN.sources[1].hash,
      blockNumber: TDF_BURN.sources[1].block,
      status: 1,
      logs: [
        makeLog(TDF_BURN.safe, TDF_BURN.targets[3].account, '30', 14),
        makeLog(TDF_BURN.safe, '0xF0f4610ef547E1a5201CD1526565B8a6F92Eb515', '30', 15),
      ],
    },
  ] as providers.TransactionReceipt[];

describe('TDF burn preparation', () => {
  it('retries missing RPC receipts before validating them', async () => {
    const attempts: Record<string, number> = {};
    const provider = {
      getTransactionReceipt: async (hash: string) => {
        attempts[hash] = (attempts[hash] || 0) + 1;
        return attempts[hash] === 1 ? null : receipts().find((receipt) => receipt.transactionHash === hash);
      },
    } as unknown as providers.Provider;
    const evidence = await fetchBurnSources(provider);
    expect(evidence.excludedAccounts).to.deep.eq(['0xF0f4610ef547E1a5201CD1526565B8a6F92Eb515']);
    expect(Object.values(attempts)).to.deep.eq([2, 2]);
  });

  it('fails closed when the source receipts remain unavailable', async () => {
    const provider = {getTransactionReceipt: async () => null} as unknown as providers.Provider;
    await assert.rejects(fetchBurnSources(provider), /Source receipt unavailable/);
  });

  it('validates both source receipts while excluding the other 30-TDF recipient', () => {
    expect(validateBurnSources(receipts())).to.deep.eq(['0xF0f4610ef547E1a5201CD1526565B8a6F92Eb515']);
  });

  it('rejects failed receipts, missing mints, wrong token, amount, sender, and recipient', () => {
    const failed = receipts();
    failed[0].status = 0;
    expect(() => validateBurnSources(failed)).to.throw('did not succeed');
    const missing = receipts();
    missing[0].logs.pop();
    expect(() => validateBurnSources(missing)).to.throw('Unexpected first-transaction');
    const wrongToken = receipts();
    wrongToken[0].logs[0].address = TDF_BURN.diamond;
    expect(() => validateBurnSources(wrongToken)).to.throw('Unexpected first-transaction');
    const wrongAmount = receipts();
    wrongAmount[1].logs[0].data = utils.defaultAbiCoder.encode(['uint256'], [utils.parseEther('31')]);
    expect(() => validateBurnSources(wrongAmount)).to.throw('Unexpected treasury transfer amount');
    const wrongSender = receipts();
    wrongSender[1].logs[0].topics[1] = utils.hexZeroPad(TDF_BURN.diamond, 32);
    expect(() => validateBurnSources(wrongSender)).to.throw('Expected a treasury transfer');
    const wrongRecipient = receipts();
    wrongRecipient[1].logs[0].topics[2] = utils.hexZeroPad(TDF_BURN.targets[0].account, 32);
    expect(() => validateBurnSources(wrongRecipient)).to.throw('Expected exactly one transfer');
  });

  it('rejects duplicate target transfers and incorrect source hashes or log indices', () => {
    const duplicate = receipts();
    duplicate[1].logs.push(duplicate[1].logs[0]);
    expect(() => validateBurnSources(duplicate)).to.throw('Expected exactly one transfer');
    const wrongHash = receipts();
    wrongHash[0].transactionHash = constants.HashZero;
    expect(() => validateBurnSources(wrongHash)).to.throw('Unexpected source transaction');
    const wrongLog = receipts();
    wrongLog[1].logs[0].logIndex = 15;
    expect(() => validateBurnSources(wrongLog)).to.throw('Unexpected 30-TDF transfer log');
  });

  it('encodes exactly one zero-value Safe CALL with an empty cut and argument-free execute()', () => {
    const initializer = '0x1111111111111111111111111111111111111111';
    const tx = burnCorrectionTransaction(initializer);
    const decoded = new utils.Interface(TDF_BURN_DIAMOND_ABI).decodeFunctionData('diamondCut', tx.data);
    expect(tx.to).to.eq(TDF_BURN.diamond);
    expect(tx.value).to.eq('0');
    expect(tx.operation).to.eq(0);
    expect(decoded[0]).to.have.lengthOf(0);
    expect(decoded[1]).to.eq(initializer);
    expect(decoded[2]).to.eq(utils.id('execute()').slice(0, 10));
  });
});
