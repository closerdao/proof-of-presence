import {getAddress} from 'ethers';
import {
  proposeSafeOwnerActions,
  refreshSafeOwnerActionsStatus,
  type SafeProposalOptions,
  type SafeServiceOptions,
} from './safe-service.js';
import {reconcileOwnerActions, type VillageDeploymentContext, type VillageDeploymentManifest} from './village.js';

/**
 * Submits direct-ownership configuration actions through the configured final owner.
 * Safe submissions only create a proposal; EOA submissions execute immediately and are then reconciled onchain.
 */
export async function submitDeploymentOwnerActions(
  manifest: VillageDeploymentManifest,
  context: VillageDeploymentContext,
  safeOptions?: SafeProposalOptions,
): Promise<VillageDeploymentManifest> {
  if (manifest.ownerActions.length === 0) return {...manifest, status: 'complete'};
  if (manifest.ownership.mode !== 'direct') {
    throw new Error('Deployer-handoff configuration actions are executed by the deployment runner');
  }
  const owner = manifest.ownership.finalOwner;
  if (owner.type === 'safe') {
    if (!safeOptions) throw new Error('Safe proposal options are required for a Safe owner');
    return proposeSafeOwnerActions(manifest, safeOptions);
  }

  const ownerAddress = getAddress(owner.address);
  const signers = await context.ethers.getSigners();
  const signer = signers.find((candidate: {address: string}) => getAddress(candidate.address) === ownerAddress);
  if (!signer) throw new Error(`Direct EOA owner ${ownerAddress} is not available among configured Hardhat signers`);
  for (const action of manifest.ownerActions) {
    const transaction = await signer.sendTransaction({to: action.to, data: action.data});
    const receipt = await transaction.wait();
    if (!receipt || Number(receipt.status) !== 1)
      throw new Error(`${action.contractName}.${action.functionName} failed`);
  }
  return reconcileOwnerActions(manifest, context);
}

/** Refreshes Safe observability when available, then derives completion from the contracts themselves. */
export async function refreshDeploymentOwnerActions(
  manifest: VillageDeploymentManifest,
  context: VillageDeploymentContext,
  safeOptions?: SafeServiceOptions,
): Promise<VillageDeploymentManifest> {
  let refreshed = manifest;
  if (manifest.ownership.finalOwner.type === 'safe' && manifest.ownerTransaction && safeOptions) {
    refreshed = await refreshSafeOwnerActionsStatus(manifest, safeOptions);
  }
  return reconcileOwnerActions(refreshed, context);
}
