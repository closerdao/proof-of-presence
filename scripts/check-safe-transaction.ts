#!/usr/bin/env tsx
import path from 'node:path';
import hre from 'hardhat';
import {refreshDeploymentOwnerActions} from './deployment/owner-actions.js';
import {refreshSafeOwnerActionsStatus} from './deployment/safe-service.js';
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
  upgrade?: string;
}

function parseArgs(argv: string[]): Args {
  const args: Args = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--manifest') args.manifest = argv[++i];
    else if (arg === '--network') args.network = argv[++i];
    else if (arg === '--tx-service-url') args.txServiceUrl = argv[++i];
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
      'Usage: npm run owner:status -- --manifest <manifest.json> --network <network> [--upgrade contract:version]',
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
    if (chainId !== manifest.chainId) {
      throw new Error(`Connected chain ${chainId} does not match manifest chain ${manifest.chainId}`);
    }
    if (args.upgrade) {
      const upgrade = selectUpgrade(manifest, args.upgrade);
      if (upgrade.ownerTransaction) {
        const virtual = {...manifest, ownerActions: [upgrade.ownerAction], ownerTransaction: upgrade.ownerTransaction};
        const refreshed = await refreshSafeOwnerActionsStatus(virtual, {
          apiKey: process.env.SAFE_API_KEY,
          txServiceUrl: args.txServiceUrl ?? process.env.SAFE_TX_SERVICE_URL,
        });
        upgrade.ownerTransaction = refreshed.ownerTransaction;
      }
      // Transaction Service state is retained for operators; the proxy slot remains authoritative for execution.
      const reconciliation = await reconcileExecutedUpgrade(manifest.contracts, upgrade, connection.ethers.provider);
      if (upgrade.ownerTransaction?.serviceStatus?.status === 'executed' && !reconciliation.executed) {
        throw new Error(
          `Safe service reports ${upgrade.contractName} upgrade executed but the proxy slot still uses ` +
            reconciliation.liveImplementation,
        );
      }
      await writeVillageDeploymentManifest(manifestPath, manifest);
      console.log(`${upgrade.status}: ${reconciliation.liveImplementation}`);
      return;
    }
    const updated = await refreshDeploymentOwnerActions(
      manifest,
      {ethers: connection.ethers, networkName: connection.networkName},
      manifest.ownerTransaction
        ? {apiKey: process.env.SAFE_API_KEY, txServiceUrl: args.txServiceUrl ?? process.env.SAFE_TX_SERVICE_URL}
        : undefined,
    );
    await writeVillageDeploymentManifest(manifestPath, updated);
    console.log(updated.status);
  } finally {
    await connection.close();
  }
}

function selectUpgrade(manifest: VillageDeploymentManifest, selector: string): ManifestUpgrade {
  const [contractName, version] = selector.split(':');
  const upgrade = manifest.upgradeHistory?.find(
    (item) => item.contractName === contractName && item.version === version,
  );
  if (!upgrade) throw new Error(`Manifest has no upgrade '${selector}'`);
  return upgrade;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
