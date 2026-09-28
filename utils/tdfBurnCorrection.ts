import assert from 'assert';
import {BigNumber, Contract, constants, providers, utils} from 'ethers';

export const TDF_BURN = {
  chainId: 42220,
  diamond: '0x475398EeE0E22cb6fe5403ffA294Fb10Ad989e17',
  token: '0x10CB7F49389787A99b59B2f87dfDd3bba141559f',
  safe: '0x5E810b93c51981eccA16e030Ea1cE8D8b1DEB83b',
  completionSlot: utils.id('closer.tdf.burn-correction.7181b78b.fe3880cf.v1'),
  forkBlock: 78468345,
  total: utils.parseEther('41'),
  sources: [
    {hash: '0x7181b78b54e959b9718e9e9f606b07fa542c061a0e5b3ec56297da5e8d9d466f', block: 78266860},
    {hash: '0xfe3880cf145ce7b0df82b8ef2b9875fef0c63d58a9df230452e8019fa743221e', block: 21132052},
  ],
  targets: [
    {account: '0x39B8eDbC6D6bAB985Bf03B498166DB588c00278e', amount: utils.parseEther('4')},
    {account: '0x5fE4E295A0765Eab77E23711972Fdcce960Dd95B', amount: utils.parseEther('2')},
    {account: '0x2f6b63eA91Ca3E13fcb6911dFee4Af24CdeC37D7', amount: utils.parseEther('5')},
    {account: '0x06f4DB783097c632B888669032B2905F70e08105', amount: utils.parseEther('30')},
  ],
};

export const TDF_BURN_TOKEN_ABI = [
  'function balanceOf(address) view returns (uint256)',
  'function totalSupply() view returns (uint256)',
  'function allowance(address,address) view returns (uint256)',
  'function getDAOContract() view returns (address)',
  'function decimals() view returns (uint8)',
  'function paused() view returns (bool)',
  'event Transfer(address indexed from,address indexed to,uint256 value)',
];

export const TDF_BURN_DIAMOND_ABI = [
  'function owner() view returns (address)',
  'function isTokenTransferPermitted(address,address,uint256) view returns (bool)',
  'function diamondCut((address facetAddress,uint8 action,bytes4[] functionSelectors)[],address,bytes)',
];

const transferInterface = new utils.Interface(TDF_BURN_TOKEN_ABI);
const sameAddress = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

export function tdfTransfers(receipt: providers.TransactionReceipt) {
  return receipt.logs
    .filter(
      (log) => sameAddress(log.address, TDF_BURN.token) && log.topics[0] === transferInterface.getEventTopic('Transfer')
    )
    .map((log) => {
      const event = transferInterface.parseLog(log);
      return {
        from: event.args.from as string,
        to: event.args.to as string,
        amount: event.args.value as BigNumber,
        logIndex: log.logIndex,
      };
    });
}

/** Validate the source evidence independently of the initializer's hardcoded amounts. */
export function validateBurnSources(receipts: providers.TransactionReceipt[]) {
  assert(receipts.length === 2, 'Expected both source receipts');
  receipts.forEach((receipt, index) => {
    const source = TDF_BURN.sources[index];
    assert(receipt && receipt.status === 1, 'Source transaction did not succeed');
    assert(receipt.transactionHash === source.hash, 'Unexpected source transaction');
    assert(receipt.blockNumber === source.block, 'Unexpected source block');
  });

  const first = tdfTransfers(receipts[0]);
  const expected = [
    {index: 43, target: 0, amount: '3'},
    {index: 44, target: 0, amount: '1'},
    {index: 45, target: 1, amount: '2'},
    {index: 46, target: 2, amount: '5'},
  ];
  assert(first.length === expected.length, 'Unexpected first-transaction TDF transfers');
  expected.forEach(({index, target, amount}) => {
    const transfer = first.find((entry) => entry.logIndex === index);
    assert(transfer, `Missing mint at log ${index}`);
    assert(sameAddress(transfer.from, constants.AddressZero), 'Expected a mint');
    assert(sameAddress(transfer.to, TDF_BURN.targets[target].account), 'Unexpected mint recipient');
    assert(transfer.amount.eq(utils.parseEther(amount)), 'Unexpected mint amount');
  });

  const second = tdfTransfers(receipts[1]);
  const selected = second.filter((entry) => sameAddress(entry.to, TDF_BURN.targets[3].account));
  assert(selected.length === 1, 'Expected exactly one transfer to the 30-TDF recipient');
  assert(selected[0].logIndex === 14, 'Unexpected 30-TDF transfer log');
  assert(sameAddress(selected[0].from, TDF_BURN.safe), 'Expected a treasury transfer');
  assert(selected[0].amount.eq(utils.parseEther('30')), 'Unexpected treasury transfer amount');

  return second.filter((entry) => !sameAddress(entry.to, TDF_BURN.targets[3].account)).map((entry) => entry.to);
}

export async function fetchBurnSources(provider: providers.Provider) {
  const receipts = await Promise.all(
    TDF_BURN.sources.map(async (source) => {
      // The public RPC can intermittently return null for these historical receipts.
      // Retry absence only; a returned receipt must still pass every validation below.
      for (let attempt = 0; attempt < 3; attempt++) {
        const receipt = await provider.getTransactionReceipt(source.hash);
        if (receipt) return receipt;
        if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 250));
      }
      throw new Error(`Source receipt unavailable: ${source.hash}`);
    })
  );
  return {receipts, excludedAccounts: validateBurnSources(receipts)};
}

/** Read all execution prerequisites at one block. Chain identity is checked by the CLI. */
export async function readBurnPreflight(provider: providers.Provider, blockNumber?: number) {
  const block = await provider.getBlock(blockNumber === undefined ? 'latest' : blockNumber);
  assert(block, 'Preflight block unavailable');
  const overrides = {blockTag: block.number};
  const token = new Contract(TDF_BURN.token, TDF_BURN_TOKEN_ABI, provider);
  const diamond = new Contract(TDF_BURN.diamond, TDF_BURN_DIAMOND_ABI, provider);
  const [owner, dao, decimals, paused, supply, completion, slot0] = await Promise.all([
    diamond.owner(overrides),
    token.getDAOContract(overrides),
    token.decimals(overrides),
    token.paused(overrides),
    token.totalSupply(overrides),
    provider.getStorageAt(TDF_BURN.diamond, TDF_BURN.completionSlot, block.number),
    provider.getStorageAt(TDF_BURN.diamond, 0, block.number),
  ]);
  assert(sameAddress(owner, TDF_BURN.safe), 'Diamond owner differs from the expected Safe');
  assert(sameAddress(dao, TDF_BURN.diamond), 'Token DAO differs from the expected Diamond');
  assert(decimals === 18, 'Unexpected TDF decimals');
  assert(!paused, 'TDF token is paused');
  assert(BigNumber.from(completion).isZero(), 'Correction is already completed');
  // AppStorage slot 0: initialized (1 byte), paused (1 byte), communityToken (20 bytes).
  const storedToken = BigNumber.from(slot0).shr(16).and(BigNumber.from(2).pow(160).sub(1));
  assert(storedToken.eq(BigNumber.from(TDF_BURN.token)), 'Unexpected Diamond communityToken');

  const targets = await Promise.all(
    TDF_BURN.targets.map(async ({account, amount}) => {
      const [balance, allowance, permitted] = await Promise.all([
        token.balanceOf(account, overrides),
        token.allowance(account, TDF_BURN.diamond, overrides),
        diamond.isTokenTransferPermitted(account, constants.AddressZero, amount, overrides),
      ]);
      assert(balance.gte(amount), `Insufficient wallet balance: ${account}`);
      assert(allowance.eq(constants.MaxUint256), `Unexpected Diamond allowance: ${account}`);
      assert(permitted, `Burn is not permitted: ${account}`);
      return {
        account,
        amount: amount.toString(),
        amountTDF: utils.formatEther(amount),
        balanceBefore: balance.toString(),
        expectedBalanceAfter: balance.sub(amount).toString(),
      };
    })
  );

  return {
    blockNumber: block.number,
    blockHash: block.hash,
    owner,
    targets,
    totalSupplyBefore: supply.toString(),
    expectedTotalSupplyAfter: supply.sub(TDF_BURN.total).toString(),
  };
}

export function burnCorrectionTransaction(initializerAddress: string) {
  const initializer = new utils.Interface(['function execute()']);
  const diamond = new utils.Interface(TDF_BURN_DIAMOND_ABI);
  return {
    to: TDF_BURN.diamond,
    value: '0',
    operation: 0,
    data: diamond.encodeFunctionData('diamondCut', [
      [],
      utils.getAddress(initializerAddress),
      initializer.encodeFunctionData('execute'),
    ]),
  };
}
