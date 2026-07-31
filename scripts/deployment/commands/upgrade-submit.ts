import path from 'node:path';
import {getAddress} from 'ethers';
import {prepareSafeOwnerActions, proposeSafeOwnerActions, type SafeProposalOptions} from '../safe-service.js';
import {reconcileExecutedUpgrade} from '../upgrades.js';
import {readUpgradeAuthority} from '../uups-contracts.js';
import {
  readVillageDeploymentManifest,
  writeVillageDeploymentManifest,
  type ManifestUpgrade,
  type VillageDeploymentManifest,
} from '../village.js';
import {validateConnectedManifest} from './validation.js';

export interface UpgradeSubmitOptions {
  manifestPath: string;
  upgrade: string;
  safeOptions?: SafeProposalOptions;
}

export interface UpgradeSubmitContext {
  ethers: any;
  networkName: string;
  prepareSafeTransaction?: typeof prepareSafeOwnerActions;
  proposeSafeTransaction?: typeof proposeSafeOwnerActions;
}

export async function upgradeSubmitCommand(
  options: UpgradeSubmitOptions,
  context: UpgradeSubmitContext,
): Promise<VillageDeploymentManifest> {
  const manifestPath = path.resolve(options.manifestPath);
  const manifest = await readVillageDeploymentManifest(manifestPath);
  await validateConnectedManifest(manifest, context);
  const upgrade = selectUpgrade(manifest, options.upgrade);
  const reconciliation = await reconcileExecutedUpgrade(manifest.contracts, upgrade, context.ethers.provider);
  if (reconciliation.executed) {
    await writeVillageDeploymentManifest(manifestPath, manifest);
    console.log(`Upgrade ${options.upgrade} was already executed and is now reconciled`);
    return manifest;
  }

  if (upgrade.ownerTransaction) {
    if (!options.safeOptions) throw new Error('SAFE_PROPOSER_PRIVATE_KEY is required for a Safe-owned upgrade');
    const prepare = context.prepareSafeTransaction ?? prepareSafeOwnerActions;
    const propose = context.proposeSafeTransaction ?? proposeSafeOwnerActions;
    const fresh = await prepare(
      {type: 'safe', address: upgrade.ownerTransaction.safeAddress},
      [upgrade.ownerAction],
      options.safeOptions.provider,
    );
    if (!fresh) throw new Error(`${upgrade.contractName} upgrade has no Safe owner action`);
    let prepared =
      upgrade.ownerTransaction.safeTxHash.toLowerCase() === fresh.safeTxHash.toLowerCase()
        ? upgrade.ownerTransaction
        : fresh;
    let proposal = await propose(manifest.chainId, prepared, options.safeOptions);
    if (proposal.status === 'failed') {
      const failedHash = prepared.safeTxHash;
      const replacement = await prepare(
        {type: 'safe', address: prepared.safeAddress},
        [upgrade.ownerAction],
        options.safeOptions.provider,
      );
      if (!replacement) throw new Error(`${upgrade.contractName} upgrade has no Safe owner action`);
      prepared = replacement;
      if (prepared.safeTxHash.toLowerCase() === failedHash.toLowerCase()) {
        throw new Error('Failed Safe upgrade cannot be retried until the Safe nonce advances');
      }
      proposal = await propose(manifest.chainId, prepared, options.safeOptions);
      if (proposal.status === 'failed') {
        throw new Error(`Replacement Safe upgrade transaction ${prepared.safeTxHash} has already failed`);
      }
    }
    upgrade.ownerTransaction = proposal.transaction;
    console.log(`Safe transaction ${proposal.status}: ${proposal.transaction.safeTxHash}`);
  } else {
    await submitEoaUpgrade(upgrade, manifest, context.ethers);
  }
  await writeVillageDeploymentManifest(manifestPath, manifest);
  console.log(`Upgrade owner action submitted for ${options.upgrade}`);
  return manifest;
}

async function submitEoaUpgrade(
  upgrade: ManifestUpgrade,
  manifest: VillageDeploymentManifest,
  ethers: any,
): Promise<void> {
  const record = manifest.contracts[upgrade.contractName];
  const authority = (await readUpgradeAuthority(upgrade.contractName, record.address, ethers)).current;
  const signers = await ethers.getSigners();
  const signer = signers.find((candidate: {address: string}) => getAddress(candidate.address) === authority);
  if (!signer) throw new Error(`Current upgrade authority ${authority} is not an available Hardhat signer`);
  const transaction = await signer.sendTransaction({to: upgrade.ownerAction.to, data: upgrade.ownerAction.data});
  const receipt = await transaction.wait();
  if (!receipt || Number(receipt.status) !== 1) throw new Error('Upgrade owner action failed');
  const reconciliation = await reconcileExecutedUpgrade(manifest.contracts, upgrade, ethers.provider);
  if (!reconciliation.executed) {
    throw new Error(
      `${upgrade.contractName} upgrade transaction succeeded but the proxy slot still uses ` +
        reconciliation.liveImplementation,
    );
  }
}

function selectUpgrade(manifest: VillageDeploymentManifest, selector: string): ManifestUpgrade {
  const [contractName, version] = selector.split(':');
  const upgrade = manifest.upgrades?.find((item) => item.contractName === contractName && item.version === version);
  if (!upgrade) throw new Error(`Manifest has no upgrade '${selector}'`);
  if (upgrade.status !== 'prepared') throw new Error(`Upgrade '${selector}' is not prepared`);
  return upgrade;
}
