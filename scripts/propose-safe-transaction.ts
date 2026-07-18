#!/usr/bin/env tsx
import path from 'node:path';
import {getAddress} from 'ethers';
import hre from 'hardhat';
import {submitDeploymentOwnerActions} from './deployment/owner-actions.js';
import {proposeSafeOwnerActions} from './deployment/safe-service.js';
import {reconcileExecutedUpgrade} from './deployment/upgrades.js';
import {
  readVillageDeploymentManifest,
  writeVillageDeploymentManifest,
  type ManifestUpgrade,
  type VillageDeploymentManifest,
} from './deployment/village.js';

interface Args {
  manifest?: string;
  network?: string;
  txServiceUrl?: string;
  origin?: string;
  upgrade?: string;
}

function parseArgs(argv: string[]): Args {
  const args: Args = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--manifest') args.manifest = argv[++i];
    else if (arg === '--network') args.network = argv[++i];
    else if (arg === '--tx-service-url') args.txServiceUrl = argv[++i];
    else if (arg === '--origin') args.origin = argv[++i];
    else if (arg === '--upgrade') args.upgrade = argv[++i];
    else if (arg === '--help' || arg === '-h') return args;
    else throw new Error(`Unknown argument '${arg}'`);
  }
  return args;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (!args.manifest || !args.network) {
    console.log(
      'Usage: npm run owner:submit -- --manifest <manifest.json> --network <network> [--upgrade contract:version]',
    );
    if (!process.argv.includes('--help') && !process.argv.includes('-h'))
      throw new Error('--manifest and --network are required');
    return;
  }
  const manifestPath = path.resolve(args.manifest);
  const manifest = await readVillageDeploymentManifest(manifestPath);
  const connection = await hre.network.create(args.network);
  try {
    const chainId = Number((await connection.ethers.provider.getNetwork()).chainId);
    if (chainId !== manifest.chainId) throw new Error(`Manifest chainId ${manifest.chainId} does not match ${chainId}`);
    const safeOptions = process.env.SAFE_PROPOSER_PRIVATE_KEY
      ? {
          provider: connection.provider,
          signer: process.env.SAFE_PROPOSER_PRIVATE_KEY,
          apiKey: process.env.SAFE_API_KEY,
          txServiceUrl: args.txServiceUrl ?? process.env.SAFE_TX_SERVICE_URL,
          origin: args.origin ?? 'Closer village owner action',
        }
      : undefined;

    if (args.upgrade) {
      const upgrade = selectUpgrade(manifest, args.upgrade);
      // Reconciliation makes this command safe to repeat after either a Safe or EOA executed the prepared call.
      const reconciliation = await reconcileExecutedUpgrade(manifest.contracts, upgrade, connection.ethers.provider);
      if (reconciliation.executed) {
        await writeVillageDeploymentManifest(manifestPath, manifest);
        console.log(`Upgrade ${args.upgrade} was already executed and is now reconciled`);
        return;
      }
      if (upgrade.ownerTransaction) {
        if (!safeOptions) throw new Error('SAFE_PROPOSER_PRIVATE_KEY is required for a Safe-owned upgrade');
        const virtual = {...manifest, ownerActions: [upgrade.ownerAction], ownerTransaction: upgrade.ownerTransaction};
        const updated = await proposeSafeOwnerActions(virtual, safeOptions);
        upgrade.ownerTransaction = updated.ownerTransaction;
      } else {
        await submitEoaUpgrade(upgrade, manifest, connection.ethers);
      }
      await writeVillageDeploymentManifest(manifestPath, manifest);
      console.log(`Owner action submitted for upgrade ${args.upgrade}`);
      return;
    }

    const updated = await submitDeploymentOwnerActions(
      manifest,
      {
        ethers: connection.ethers,
        safeProvider: connection.provider,
        networkName: connection.networkName,
      },
      safeOptions,
    );
    await writeVillageDeploymentManifest(manifestPath, updated);
    console.log(updated.ownerTransaction?.proposal?.status ?? updated.status);
  } finally {
    await connection.close();
  }
}

async function submitEoaUpgrade(
  upgrade: ManifestUpgrade,
  manifest: VillageDeploymentManifest,
  ethers: any,
): Promise<void> {
  const record = manifest.contracts[upgrade.contractName];
  const authority = await currentAuthority(upgrade.contractName, record.address, ethers);
  const signers = await ethers.getSigners();
  const signer = signers.find((candidate: {address: string}) => getAddress(candidate.address) === authority);
  if (!signer) throw new Error(`Current upgrade authority ${authority} is not an available Hardhat signer`);
  const transaction = await signer.sendTransaction({to: upgrade.ownerAction.to, data: upgrade.ownerAction.data});
  const receipt = await transaction.wait();
  if (!receipt || Number(receipt.status) !== 1) throw new Error('Upgrade owner action failed');
  // A successful receipt is insufficient: the ERC-1967 slot and implementation bytecode are the execution proof.
  const reconciliation = await reconcileExecutedUpgrade(manifest.contracts, upgrade, ethers.provider);
  if (!reconciliation.executed) {
    throw new Error(
      `${upgrade.contractName} upgrade transaction succeeded but the proxy slot still uses ` +
        reconciliation.liveImplementation,
    );
  }
}

async function currentAuthority(contractName: string, address: string, ethers: any): Promise<string> {
  const contract = await ethers.getContractAt(
    contractName === 'VillageAccess'
      ? ['function defaultAdmin() view returns (address)']
      : ['function owner() view returns (address)'],
    address,
  );
  return getAddress(contractName === 'VillageAccess' ? await contract.defaultAdmin() : await contract.owner());
}

function selectUpgrade(manifest: VillageDeploymentManifest, selector: string): ManifestUpgrade {
  const [contractName, version] = selector.split(':');
  const upgrade = manifest.upgradeHistory?.find(
    (item) => item.contractName === contractName && item.version === version,
  );
  if (!upgrade) throw new Error(`Manifest has no upgrade '${selector}'`);
  if (upgrade.status !== 'prepared') throw new Error(`Upgrade '${selector}' is not prepared`);
  return upgrade;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
