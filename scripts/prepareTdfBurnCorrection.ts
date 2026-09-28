import assert from 'assert';
import {mkdirSync, writeFileSync} from 'fs';
import {dirname, resolve} from 'path';
import {deployments, ethers, getNamedAccounts, network} from 'hardhat';
import {
  TDF_BURN,
  TDF_BURN_DIAMOND_ABI,
  burnCorrectionTransaction,
  fetchBurnSources,
  readBurnPreflight,
} from '../utils/tdfBurnCorrection';

async function main() {
  const args = process.argv.slice(2);
  let deploy = false;
  let output = resolve('cache/tdf-burn-correction.json');
  while (args.length) {
    const arg = args.shift();
    if (arg === '--deploy') {
      deploy = true;
    } else if (arg === '--output') {
      const filename = args.shift();
      assert(filename && !filename.startsWith('--'), '--output requires a filename');
      output = resolve(filename);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  assert(network.name === 'celo', 'Preparation is restricted to --network celo');
  const chainId = Number(await ethers.provider.send('eth_chainId', []));
  assert(chainId === TDF_BURN.chainId, 'RPC must be Celo mainnet (42220)');
  for (const [name, expected] of [
    ['TDFDiamond', TDF_BURN.diamond],
    ['TDFToken', TDF_BURN.token],
  ]) {
    const record = await deployments.get(name);
    assert(record.address.toLowerCase() === expected.toLowerCase(), `Unexpected ${name} deployment`);
  }

  const {excludedAccounts} = await fetchBurnSources(ethers.provider);
  let preflight = await readBurnPreflight(ethers.provider);
  console.log('Validated correction:', JSON.stringify(preflight, null, 2));

  let initializer = await deployments.getOrNull('TDFBurnCorrection');
  if (deploy) {
    const {deployer} = await getNamedAccounts();
    assert(deployer, 'A deployment signer is required with --deploy');
    // Only this explicit flag can broadcast a transaction, and only to deploy the initializer.
    initializer = await deployments.deploy('TDFBurnCorrection', {
      from: deployer,
      args: [TDF_BURN.diamond, TDF_BURN.token],
      log: true,
    });
    preflight = await readBurnPreflight(ethers.provider);
  }
  if (!initializer) {
    console.log('Preflight passed. No initializer is deployed in these records. Use --deploy to deploy it.');
    return;
  }

  const code = await ethers.provider.getCode(initializer.address, preflight.blockNumber);
  assert(code !== '0x', 'Initializer has no deployed code');
  const correction = new ethers.Contract(initializer.address, initializer.abi, ethers.provider);
  const overrides = {blockTag: preflight.blockNumber};
  assert((await correction.expectedDiamond(overrides)) === TDF_BURN.diamond, 'Wrong initializer Diamond');
  assert((await correction.expectedToken(overrides)) === TDF_BURN.token, 'Wrong initializer token');
  assert((await correction.COMPLETION_SLOT(overrides)) === TDF_BURN.completionSlot, 'Wrong completion slot');

  const transaction = burnCorrectionTransaction(initializer.address);
  const diamond = new ethers.Contract(TDF_BURN.diamond, TDF_BURN_DIAMOND_ABI, ethers.provider);
  // callStatic decodes failures; provider.call alone may return revert bytes on some RPCs.
  await diamond.callStatic.diamondCut([], initializer.address, correction.interface.encodeFunctionData('execute'), {
    from: preflight.owner,
    blockTag: preflight.blockNumber,
  });
  const gasEstimate = await ethers.provider.estimateGas({
    to: transaction.to,
    value: ethers.BigNumber.from(transaction.value),
    data: transaction.data,
    from: preflight.owner,
  });

  const payload = {
    chainId,
    safe: preflight.owner,
    initializer: initializer.address,
    initializerCodeHash: ethers.utils.keccak256(code),
    completionSlot: TDF_BURN.completionSlot,
    sources: TDF_BURN.sources,
    excludedAccounts,
    totalBurn: TDF_BURN.total.toString(),
    preflight,
    gasEstimate: gasEstimate.toString(),
    transaction,
  };
  mkdirSync(dirname(output), {recursive: true});
  writeFileSync(output, JSON.stringify(payload, null, 2) + '\n');
  console.log(`Saved reviewed-call data to ${output}`);
  console.log('Safe operation: CALL (0). Value: 0. No Safe transaction has been submitted or executed.');
}

main().catch((error: Error) => {
  console.error(error.message);
  process.exitCode = 1;
});
