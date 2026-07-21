import path from 'node:path';
import {refreshDeploymentOwnerActions} from '../owner-actions.js';
import {refreshSafeOwnerActionsStatus} from '../safe-service.js';
import {reconcileExecutedUpgrade} from '../upgrades.js';
import {
  readVillageDeploymentManifest,
  writeVillageDeploymentManifest,
  type ManifestUpgrade,
  type VillageDeploymentManifest,
} from '../village.js';

export interface OwnerStatusOptions {
  manifestPath: string;
  upgrade?: string;
  apiKey?: string;
  txServiceUrl?: string;
}

export interface OwnerStatusContext {
  ethers: any;
  networkName: string;
}

export async function ownerStatusCommand(
  options: OwnerStatusOptions,
  context: OwnerStatusContext,
): Promise<VillageDeploymentManifest> {
  const manifestPath = path.resolve(options.manifestPath);
  const manifest = await readVillageDeploymentManifest(manifestPath);
  const chainId = Number((await context.ethers.provider.getNetwork()).chainId);
  if (chainId !== manifest.chainId) {
    throw new Error(`Connected chain ${chainId} does not match manifest chain ${manifest.chainId}`);
  }
  if (options.upgrade) {
    const upgrade = selectUpgrade(manifest, options.upgrade);
    if (upgrade.ownerTransaction) {
      const virtual = {...manifest, ownerActions: [upgrade.ownerAction], ownerTransaction: upgrade.ownerTransaction};
      const refreshed = await refreshSafeOwnerActionsStatus(virtual, {
        apiKey: options.apiKey,
        txServiceUrl: options.txServiceUrl,
      });
      upgrade.ownerTransaction = refreshed.ownerTransaction;
    }
    // Transaction Service state is retained for operators; the proxy slot remains authoritative for execution.
    const reconciliation = await reconcileExecutedUpgrade(manifest.contracts, upgrade, context.ethers.provider);
    if (upgrade.ownerTransaction?.serviceStatus?.status === 'executed' && !reconciliation.executed) {
      throw new Error(
        `Safe service reports ${upgrade.contractName} upgrade executed but the proxy slot still uses ` +
          reconciliation.liveImplementation,
      );
    }
    await writeVillageDeploymentManifest(manifestPath, manifest);
    console.log(`${upgrade.status}: ${reconciliation.liveImplementation}`);
    return manifest;
  }
  const updated = await refreshDeploymentOwnerActions(
    manifest,
    {ethers: context.ethers, networkName: context.networkName},
    manifest.ownerTransaction ? {apiKey: options.apiKey, txServiceUrl: options.txServiceUrl} : undefined,
  );
  await writeVillageDeploymentManifest(manifestPath, updated);
  console.log(updated.status);
  return updated;
}

function selectUpgrade(manifest: VillageDeploymentManifest, selector: string): ManifestUpgrade {
  const [contractName, version] = selector.split(':');
  const upgrade = manifest.upgradeHistory?.find(
    (item) => item.contractName === contractName && item.version === version,
  );
  if (!upgrade) throw new Error(`Manifest has no upgrade '${selector}'`);
  return upgrade;
}
