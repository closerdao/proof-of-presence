import assert from 'assert';
import {mkdirSync, writeFileSync} from 'fs';
import {dirname, resolve} from 'path';
import {artifacts, deployments, ethers, getNamedAccounts, network, run} from 'hardhat';
import {verifyBurnInitializer} from '../utils/tdfBurnArtifacts';
import {burnSafeBatch, readBurnSafe, verifyBurnExecution} from '../utils/tdfBurnSafe';
import {
  TDF_BURN,
  TDF_BURN_DIAMOND_ABI,
  burnCorrectionTransaction,
  fetchBurnSources,
  readBurnPreflight,
} from '../utils/tdfBurnCorrection';

export function parseBurnArguments(argv: string[]) {
  const args = [...argv];
  let deploy = false;
  let output = resolve('cache/tdf-burn-correction.json');
  let verifyTx: string | undefined;
  let help = false;
  const seen = new Set<string>();
  while (args.length) {
    const arg = args.shift() as string;
    assert(!seen.has(arg), `Duplicate argument: ${arg}`);
    seen.add(arg);
    if (arg === '--deploy') {
      deploy = true;
    } else if (arg === '--output') {
      const filename = args.shift();
      assert(filename && !filename.startsWith('--'), '--output requires a filename');
      output = resolve(filename);
    } else if (arg === '--verify-tx') {
      verifyTx = args.shift();
      assert(verifyTx && ethers.utils.isHexString(verifyTx, 32), '--verify-tx requires an on-chain transaction hash');
    } else if (arg === '--help') {
      help = true;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  assert(!(deploy && verifyTx), '--deploy cannot be combined with --verify-tx');
  return {deploy, output, verifyTx, help};
}

function saveJSON(path: string, value: unknown) {
  mkdirSync(dirname(path), {recursive: true});
  writeFileSync(path, JSON.stringify(value, null, 2) + '\n');
}

export async function prepareTdfBurnCorrection(args = process.argv.slice(2)) {
  const {deploy, output, verifyTx, help} = parseBurnArguments(args);
  if (help) {
    console.log(`Usage: corepack yarn execute celo scripts/prepareTdfBurnCorrection.ts [options]
  (no flags)         Compile and validate; export files if an initializer is recorded.
  --deploy           Deploy/reuse the initializer, validate it, and export a Safe import file.
  --verify-tx HASH   Read-only verification of the mined Safe execution transaction.
  --output PATH      Review manifest path (default: cache/tdf-burn-correction.json).
                     Safe import: <path without .json>.safe.json
                     Execution report: <path without .json>.execution.json
Owners approve and execute only in the Safe app. This script never signs or sends the burn.`);
    return;
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

  await run('compile');
  const outputPrefix = output.replace(/\.json$/i, '');
  if (verifyTx) {
    const report = await verifyBurnExecution(ethers.provider, artifacts, verifyTx);
    const reportPath = `${outputPrefix}.execution.json`;
    saveJSON(reportPath, report);
    console.log('Verified Safe execution:', JSON.stringify(report, null, 2));
    console.log(`Saved execution report to ${reportPath}`);
    return;
  }

  const {excludedAccounts} = await fetchBurnSources(ethers.provider);
  let preflight = await readBurnPreflight(ethers.provider);
  let safeState = await readBurnSafe(ethers.provider, preflight.blockNumber);
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
    safeState = await readBurnSafe(ethers.provider, preflight.blockNumber);
  }
  if (!initializer) {
    console.log('Preflight passed. No initializer is deployed in these records. Use --deploy to deploy it.');
    return;
  }

  const {contract: correction, codeHash} = await verifyBurnInitializer(
    ethers.provider,
    artifacts,
    initializer.address,
    preflight.blockNumber
  );

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
    safeState,
    initializer: initializer.address,
    initializerCodeHash: codeHash,
    completionSlot: TDF_BURN.completionSlot,
    sources: TDF_BURN.sources,
    excludedAccounts,
    totalBurn: TDF_BURN.total.toString(),
    preflight,
    gasEstimate: gasEstimate.toString(),
    transaction,
  };
  const safePath = `${outputPrefix}.safe.json`;
  saveJSON(output, payload);
  saveJSON(safePath, burnSafeBatch(initializer.address));
  console.log(`Saved reviewed-call data to ${output}`);
  console.log(`Import ${safePath} into Safe Transaction Builder on Celo for ${TDF_BURN.safe}.`);
  console.log(
    `Required owner approvals: ${safeState.threshold} of ${safeState.owners.length}. Current Safe nonce: ${safeState.nonce}.`
  );
  console.log(
    'Keep exactly this one transaction; verify CALL, value 0, and zero Safe gas reimbursement before signing.'
  );
  console.log('Safe operation: CALL (0). Value: 0. No Safe transaction has been submitted or executed.');
  return payload;
}

if (require.main === module) {
  prepareTdfBurnCorrection().catch((error: Error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
