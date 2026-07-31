import type {VillageDeploymentManifest} from '../village.js';

export interface ConnectedManifestContext {
  ethers: any;
  networkName: string;
}

export async function validateConnectedManifest(
  manifest: VillageDeploymentManifest,
  context: ConnectedManifestContext,
): Promise<void> {
  if (context.networkName !== manifest.network) {
    throw new Error(`Network '${context.networkName}' does not match manifest network '${manifest.network}'`);
  }
  const chainId = Number((await context.ethers.provider.getNetwork()).chainId);
  if (chainId !== manifest.chainId) {
    throw new Error(`Connected chain ${chainId} does not match manifest chain ${manifest.chainId}`);
  }
}
