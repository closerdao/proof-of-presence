import path from 'node:path';
import {submitOwnershipHandoff} from '../handoff.js';
import type {SafeProposalOptions} from '../safe-service.js';
import {
  readVillageDeploymentManifest,
  writeVillageDeploymentManifest,
  type VillageDeploymentManifest,
} from '../village.js';
import {validateConnectedManifest} from './validation.js';

export interface OwnerSubmitOptions {
  manifestPath: string;
  safeOptions?: SafeProposalOptions;
}

export interface OwnerSubmitContext {
  ethers: any;
  networkName: string;
}

export async function ownerSubmitCommand(
  options: OwnerSubmitOptions,
  context: OwnerSubmitContext,
): Promise<VillageDeploymentManifest> {
  const manifestPath = path.resolve(options.manifestPath);
  const manifest = await readVillageDeploymentManifest(manifestPath);
  await validateConnectedManifest(manifest, context);

  const updated = await submitOwnershipHandoff(
    manifest,
    {ethers: context.ethers, networkName: context.networkName},
    options.safeOptions,
  );
  await writeVillageDeploymentManifest(manifestPath, updated);
  console.log(updated.status);
  return updated;
}
