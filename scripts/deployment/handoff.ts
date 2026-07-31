import {getAddress} from 'ethers';
import {
  prepareSafeOwnerActions,
  proposeSafeOwnerActions,
  refreshSafeOwnerActionsStatus,
  type SafeProposalOptions,
  type SafeServiceOptions,
} from './safe-service.js';
import {
  pendingOwnershipHandoffActions,
  reconcileOwnershipHandoff,
  type ManualAction,
  type VillageDeploymentContext,
  type VillageDeploymentManifest,
} from './village.js';

export function delayedOwnershipAcceptance(
  actions: readonly ManualAction[],
  currentTimestamp: number,
): ManualAction | undefined {
  return actions.find((action) => {
    if (!action.acceptAfter) return false;
    const acceptAfter = Date.parse(action.acceptAfter);
    if (Number.isNaN(acceptAfter)) {
      throw new Error(`${action.contractName} has an unparseable acceptAfter '${action.acceptAfter}'`);
    }
    return acceptAfter / 1000 > currentTimestamp;
  });
}

/** Submits only final ownership/default-admin acceptances; deployment configuration is already complete. */
export async function submitOwnershipHandoff(
  manifest: VillageDeploymentManifest,
  context: VillageDeploymentContext,
  safeOptions?: SafeProposalOptions,
): Promise<VillageDeploymentManifest> {
  const reconciled = await reconcileOwnershipHandoff(manifest, context);
  if (reconciled.status === 'complete') return reconciled;
  const actions = await pendingOwnershipHandoffActions(reconciled, context);
  const owner = reconciled.ownership.finalOwner;

  if (owner.type === 'safe') {
    if (!safeOptions) throw new Error('Safe proposal options are required for a Safe handoff');
    const prepare = context.prepareSafeTransaction ?? prepareSafeOwnerActions;
    const fresh = await prepare(owner, actions, safeOptions.provider);
    if (!fresh) throw new Error('Deployment has no pending ownership handoff actions');
    let prepared =
      reconciled.handoffTransaction?.safeTxHash.toLowerCase() === fresh.safeTxHash.toLowerCase()
        ? reconciled.handoffTransaction
        : fresh;
    const propose = context.proposeSafeTransaction ?? proposeSafeOwnerActions;
    let proposal = await propose(reconciled.chainId, prepared, safeOptions);
    if (proposal.status === 'failed') {
      const failedHash = prepared.safeTxHash;
      const replacement = await prepare(owner, actions, safeOptions.provider);
      if (!replacement) throw new Error('Deployment has no pending ownership handoff actions');
      prepared = replacement;
      if (prepared.safeTxHash.toLowerCase() === failedHash.toLowerCase()) {
        throw new Error('Failed Safe handoff cannot be retried until the Safe nonce advances');
      }
      proposal = await propose(reconciled.chainId, prepared, safeOptions);
      if (proposal.status === 'failed') {
        throw new Error(`Replacement Safe handoff transaction ${prepared.safeTxHash} has already failed`);
      }
    }
    console.log(`Safe transaction ${proposal.status}: ${prepared.safeTxHash}`);
    return {
      ...reconciled,
      handoffTransaction: proposal.transaction,
    };
  }

  const ownerAddress = getAddress(owner.address);
  const signers = await context.ethers.getSigners();
  const signer = signers.find((candidate: {address: string}) => getAddress(candidate.address) === ownerAddress);
  if (!signer) throw new Error(`Final EOA owner ${ownerAddress} is not available among configured Hardhat signers`);

  const latestBlock = await context.ethers.provider.getBlock('latest');
  if (!latestBlock) throw new Error('Could not read the latest block to evaluate ownership acceptance delays');
  const currentTimestamp = Number(latestBlock.timestamp);
  const delayed = delayedOwnershipAcceptance(actions, currentTimestamp);
  if (delayed) {
    throw new Error(`${delayed.contractName} ownership cannot be accepted before ${delayed.acceptAfter}`);
  }
  for (const action of actions) {
    const transaction = await signer.sendTransaction({to: action.to, data: action.data});
    const receipt = await transaction.wait();
    if (!receipt || Number(receipt.status) !== 1) {
      throw new Error(`${action.contractName}.${action.functionName} failed`);
    }
  }
  return reconcileOwnershipHandoff(reconciled, context);
}

/** Refreshes optional Safe service metadata, then derives handoff completion from live contract authority. */
export async function refreshOwnershipHandoff(
  manifest: VillageDeploymentManifest,
  context: VillageDeploymentContext,
  safeOptions?: SafeServiceOptions,
): Promise<VillageDeploymentManifest> {
  let current = manifest;
  if (manifest.handoffTransaction && safeOptions) {
    const refresh = context.refreshSafeTransaction ?? refreshSafeOwnerActionsStatus;
    const status = await refresh(manifest.chainId, manifest.handoffTransaction, safeOptions);
    console.log(`Safe transaction ${status.status}: ${manifest.handoffTransaction.safeTxHash}`);
    if (status.status === 'failed') current = {...manifest, handoffTransaction: undefined};
  }
  return reconcileOwnershipHandoff(current, context);
}
