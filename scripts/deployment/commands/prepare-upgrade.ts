import path from 'node:path';
import {getAddress, keccak256, toUtf8Bytes, ZeroAddress} from 'ethers';
import {buildUpgradeImplementationModule} from '../../../ignition/modules/upgrades/UpgradeImplementation.js';
import {prepareSafeOwnerActions} from '../safe-service.js';
import {reconcileExecutedUpgrade} from '../upgrades.js';
import {
  readVillageDeploymentManifest,
  writeVillageDeploymentManifest,
  type FinalOwnerConfig,
  type ManifestUpgrade,
  type PendingOwnerAction,
  type VillageDeploymentManifest,
} from '../village.js';
import {verifyIgnitionDeployment} from '../verification.js';

const UUPS_CONTRACTS = new Set([
  'VillageAccess',
  'CommunityToken',
  'VillagePresenceToken',
  'VillageSweatToken',
  'TokenizedStays',
]);

export interface PrepareUpgradeOptions {
  manifestPath: string;
  contractName: string;
  implementation: string;
  version: string;
  call?: string;
  callArgs?: string;
}

export interface PrepareUpgradeContext {
  ethers: any;
  upgrades: any;
  ignition: any;
  provider: {request(args: {method: string; params?: readonly unknown[] | object}): Promise<unknown>};
  networkName: string;
}

export async function prepareUpgradeCommand(
  options: PrepareUpgradeOptions,
  context: PrepareUpgradeContext,
): Promise<VillageDeploymentManifest> {
  if (!UUPS_CONTRACTS.has(options.contractName)) {
    throw new Error(`'${options.contractName}' is not a supported UUPS contract`);
  }
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(options.version)) throw new Error('Invalid upgrade version');

  const manifestPath = path.resolve(options.manifestPath);
  const manifest = await readVillageDeploymentManifest(manifestPath);
  const record = manifest.contracts[options.contractName];
  if (!record?.implementationAddress) throw new Error(`Manifest has no UUPS deployment for ${options.contractName}`);
  if (context.networkName !== manifest.network) {
    throw new Error(`Network '${context.networkName}' does not match manifest`);
  }

  const chainId = Number((await context.ethers.provider.getNetwork()).chainId);
  if (chainId !== manifest.chainId) throw new Error(`Connected chain ${chainId} does not match manifest`);
  const manifestImplementation = getAddress(record.implementationAddress);
  const liveImplementation = getAddress(await context.upgrades.erc1967.getImplementationAddress(record.address));

  // Reconcile a prepared upgrade that was executed externally before attempting to prepare another candidate.
  const executedCandidate = [...(manifest.upgradeHistory ?? [])]
    .reverse()
    .find(
      (item) =>
        item.contractName === options.contractName &&
        item.status === 'prepared' &&
        getAddress(item.newImplementation) === liveImplementation,
    );
  if (liveImplementation !== manifestImplementation) {
    if (!executedCandidate) {
      throw new Error(
        `${options.contractName} live implementation ${liveImplementation} does not match manifest ${manifestImplementation}`,
      );
    }
    const reconciliation = await reconcileExecutedUpgrade(
      manifest.contracts,
      executedCandidate,
      context.ethers.provider,
    );
    if (!reconciliation.executed) {
      throw new Error(`${options.contractName} live implementation did not execute the matching prepared upgrade`);
    }
    await writeVillageDeploymentManifest(manifestPath, manifest);
    console.log(`${options.contractName} upgrade reconciled: ${liveImplementation}`);
    return manifest;
  }

  const previous = [...(manifest.upgradeHistory ?? [])]
    .reverse()
    .find(
      (item) =>
        item.contractName === options.contractName &&
        item.status === 'executed' &&
        getAddress(item.newImplementation) === liveImplementation,
    );
  const currentArtifact = previous?.nextArtifact ?? options.contractName;
  const currentFactory = await context.ethers.getContractFactory(currentArtifact);
  const nextFactory = await context.ethers.getContractFactory(options.implementation);
  const callArgs = options.callArgs ? JSON.parse(options.callArgs) : [];
  if (!Array.isArray(callArgs)) throw new Error('--call-args must be a JSON array');
  if (!options.call && callArgs.length > 0) throw new Error('--call-args requires --call');
  const callData = options.call ? nextFactory.interface.encodeFunctionData(options.call, callArgs) : '0x';
  // The spec hash makes retries of the same release idempotent while rejecting a changed artifact or migration call.
  const specHash = keccak256(
    toUtf8Bytes(
      JSON.stringify([options.contractName, options.implementation, options.version, liveImplementation, callData]),
    ),
  );
  const sameVersion = (manifest.upgradeHistory ?? []).find(
    (item) => item.contractName === options.contractName && item.version === options.version,
  );
  if (sameVersion) {
    if (sameVersion.specHash !== specHash)
      throw new Error(`${options.contractName}:${options.version} has a conflicting upgrade spec`);
    console.log(`${options.contractName} upgrade already ${sameVersion.status}: ${sameVersion.newImplementation}`);
    return manifest;
  }
  const otherPrepared = (manifest.upgradeHistory ?? []).find(
    (item) => item.contractName === options.contractName && item.status === 'prepared',
  );
  if (otherPrepared) throw new Error(`${options.contractName} already has prepared upgrade '${otherPrepared.version}'`);

  // Validate storage and UUPS compatibility before spending gas on the candidate implementation.
  await context.upgrades.validateUpgrade(currentFactory, nextFactory, {kind: 'uups'});
  const module = buildUpgradeImplementationModule(options.contractName, options.implementation, options.version);
  const contractSlug = options.contractName.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();
  const deploymentId = `upgrade-${manifest.chainId}-${manifest.villageSlug}-${contractSlug}-${options.version}`;
  const {implementation} = await context.ignition.deploy(module, {deploymentId, displayUi: true});
  const newImplementation = getAddress(await implementation.getAddress());
  const implementationCode = await context.ethers.provider.getCode(newImplementation);
  if (implementationCode === '0x') throw new Error('Ignition implementation deployment has no runtime code');
  // Close the preparation race: the validation baseline is invalid if another upgrade moved the proxy meanwhile.
  if (getAddress(await context.upgrades.erc1967.getImplementationAddress(record.address)) !== liveImplementation) {
    throw new Error(`${options.contractName} implementation changed while preparing the upgrade`);
  }

  const data = nextFactory.interface.encodeFunctionData('upgradeToAndCall', [newImplementation, callData]);
  const ownerAction: PendingOwnerAction = {
    to: record.address,
    contractName: options.contractName,
    functionName: 'upgradeToAndCall',
    args: [newImplementation, callData],
    data,
    reason: `Upgrade ${options.contractName} to release ${options.version}`,
  };
  const authority = await readAuthority(options.contractName, record.address, context.ethers);
  if (authority.pending !== ZeroAddress) {
    console.warn(
      `Warning: ownership transfer to ${authority.pending} is pending; current authority is ${authority.current}`,
    );
  }
  // Simulate from the live authority to check authorization and optional migration calldata without changing state.
  await context.ethers.provider.call({from: authority.current, to: record.address, data});
  const owner = await classifyAuthority(authority.current, context.ethers);
  const ownerTransaction =
    owner.type === 'safe' ? await prepareSafeOwnerActions(owner, [ownerAction], context.provider) : undefined;
  const verification = await verifyIgnitionDeployment(context.networkName, deploymentId);
  // Persist only a fully validated, deployed, bytecode-hashed, and successfully simulated candidate.
  const upgrade: ManifestUpgrade = {
    contractName: options.contractName,
    version: options.version,
    nextArtifact: options.implementation,
    deploymentId,
    moduleId: module.id,
    previousImplementation: liveImplementation,
    newImplementation,
    status: 'prepared',
    validatedAt: new Date().toISOString(),
    callData,
    specHash,
    implementationCodeHash: keccak256(implementationCode),
    ownerAction,
    ownerTransaction,
    verification,
  };
  manifest.upgradeHistory = [...(manifest.upgradeHistory ?? []), upgrade];
  await writeVillageDeploymentManifest(manifestPath, manifest);
  console.log(`${options.contractName} upgrade prepared: ${newImplementation}`);
  return manifest;
}

async function readAuthority(
  contractName: string,
  address: string,
  ethers: any,
): Promise<{current: string; pending: string}> {
  if (contractName === 'VillageAccess') {
    const access = await ethers.getContractAt(
      [
        'function defaultAdmin() view returns (address)',
        'function pendingDefaultAdmin() view returns (address,uint48)',
      ],
      address,
    );
    const [pending] = await access.pendingDefaultAdmin();
    return {current: getAddress(await access.defaultAdmin()), pending: getAddress(pending)};
  }
  const ownable = await ethers.getContractAt(
    ['function owner() view returns (address)', 'function pendingOwner() view returns (address)'],
    address,
  );
  return {current: getAddress(await ownable.owner()), pending: getAddress(await ownable.pendingOwner())};
}

async function classifyAuthority(address: string, ethers: any): Promise<FinalOwnerConfig> {
  return (await ethers.provider.getCode(address)) === '0x' ? {type: 'eoa', address} : {type: 'safe', address};
}
