import path from 'node:path';
import {getAddress} from 'ethers';
import {submitDeploymentOwnerActions} from '../owner-actions.js';
import {proposeSafeOwnerActions, type SafeProposalOptions} from '../safe-service.js';
import {reconcileExecutedUpgrade} from '../upgrades.js';
import {
  readVillageDeploymentManifest,
  writeVillageDeploymentManifest,
  type ManifestUpgrade,
  type VillageDeploymentManifest,
} from '../village.js';

export interface OwnerSubmitOptions {
  manifestPath: string;
  upgrade?: string;
  safeOptions?: SafeProposalOptions;
}

export interface OwnerSubmitContext {
  ethers: any;
  provider: {request(args: {method: string; params?: readonly unknown[] | object}): Promise<unknown>};
  networkName: string;
}

export async function ownerSubmitCommand(
  options: OwnerSubmitOptions,
  context: OwnerSubmitContext,
): Promise<VillageDeploymentManifest> {
  const manifestPath = path.resolve(options.manifestPath);
  const manifest = await readVillageDeploymentManifest(manifestPath);
  const chainId = Number((await context.ethers.provider.getNetwork()).chainId);
  if (chainId !== manifest.chainId) throw new Error(`Manifest chainId ${manifest.chainId} does not match ${chainId}`);

  if (options.upgrade) {
    const upgrade = selectUpgrade(manifest, options.upgrade);
    // Reconciliation makes this command safe to repeat after either a Safe or EOA executed the prepared call.
    const reconciliation = await reconcileExecutedUpgrade(manifest.contracts, upgrade, context.ethers.provider);
    if (reconciliation.executed) {
      await writeVillageDeploymentManifest(manifestPath, manifest);
      console.log(`Upgrade ${options.upgrade} was already executed and is now reconciled`);
      return manifest;
    }
    if (upgrade.ownerTransaction) {
      if (!options.safeOptions) throw new Error('SAFE_PROPOSER_PRIVATE_KEY is required for a Safe-owned upgrade');
      const virtual = {...manifest, ownerActions: [upgrade.ownerAction], ownerTransaction: upgrade.ownerTransaction};
      const updated = await proposeSafeOwnerActions(virtual, options.safeOptions);
      upgrade.ownerTransaction = updated.ownerTransaction;
    } else {
      await submitEoaUpgrade(upgrade, manifest, context.ethers);
    }
    await writeVillageDeploymentManifest(manifestPath, manifest);
    console.log(`Owner action submitted for upgrade ${options.upgrade}`);
    return manifest;
  }

  const updated = await submitDeploymentOwnerActions(
    manifest,
    {
      ethers: context.ethers,
      safeProvider: context.provider,
      networkName: context.networkName,
    },
    options.safeOptions,
  );
  await writeVillageDeploymentManifest(manifestPath, updated);
  console.log(updated.ownerTransaction?.proposal?.status ?? updated.status);
  return updated;
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
