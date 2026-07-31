import path from 'node:path';
import {refreshOwnershipHandoff} from '../handoff.js';
import {
  readVillageDeploymentManifest,
  writeVillageDeploymentManifest,
  type VillageDeploymentManifest,
} from '../village.js';
import {validateConnectedManifest} from './validation.js';

export interface OwnerStatusOptions {
  manifestPath: string;
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
  await validateConnectedManifest(manifest, context);
  const safeServiceOptions =
    manifest.handoffTransaction && (options.apiKey || options.txServiceUrl)
      ? {apiKey: options.apiKey, txServiceUrl: options.txServiceUrl}
      : undefined;
  const updated = await refreshOwnershipHandoff(
    manifest,
    {ethers: context.ethers, networkName: context.networkName},
    safeServiceOptions,
  );
  await writeVillageDeploymentManifest(manifestPath, updated);
  console.log(updated.status);
  return updated;
}
