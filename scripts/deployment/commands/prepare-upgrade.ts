import path from 'node:path';
import {getAddress, keccak256, toUtf8Bytes, ZeroAddress} from 'ethers';
import {buildUpgradeImplementationModule} from '../../../ignition/modules/upgrades/UpgradeImplementation.js';
import {prepareSafeOwnerActions} from '../safe-service.js';
import {reconcileExecutedUpgrade} from '../upgrades.js';
import {isSupportedUupsContract, readUpgradeAuthority} from '../uups-contracts.js';
import {
  currentImplementationAddress,
  readVillageDeploymentManifest,
  validateOwnerAuthority,
  writeVillageDeploymentManifest,
  type FinalOwnerConfig,
  type ManifestUpgrade,
  type PendingOwnerAction,
  type VillageDeploymentManifest,
} from '../village.js';
import {validateConnectedManifest} from './validation.js';

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
  if (!isSupportedUupsContract(options.contractName)) {
    throw new Error(`'${options.contractName}' is not a supported UUPS contract`);
  }
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(options.version)) throw new Error('Invalid upgrade version');

  const manifestPath = path.resolve(options.manifestPath);
  const manifest = await readVillageDeploymentManifest(manifestPath);
  const record = manifest.contracts[options.contractName];
  const recordedImplementation = record ? currentImplementationAddress(record) : undefined;
  if (!record || !recordedImplementation) {
    throw new Error(`Manifest has no UUPS deployment for ${options.contractName}`);
  }
  await validateConnectedManifest(manifest, context);
  const manifestImplementation = getAddress(recordedImplementation);
  const liveImplementation = getAddress(await context.upgrades.erc1967.getImplementationAddress(record.address));

  // Reconcile a prepared upgrade that was executed externally before attempting to prepare another candidate.
  const executedCandidate = [...(manifest.upgrades ?? [])]
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
  if (manifest.status !== 'complete') {
    throw new Error('Ownership handoff must be complete before preparing an upgrade');
  }
  const authority = await readUpgradeAuthority(options.contractName, record.address, context.ethers);
  if (authority.pending !== ZeroAddress) {
    throw new Error(`Ownership transfer to ${authority.pending} must complete before preparing an upgrade`);
  }

  const currentArtifact = record.artifact;
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
  const sameVersion = (manifest.upgrades ?? []).find(
    (item) => item.contractName === options.contractName && item.version === options.version,
  );
  if (sameVersion) {
    if (sameVersion.specHash !== specHash)
      throw new Error(`${options.contractName}:${options.version} has a conflicting upgrade spec`);
    console.log(`${options.contractName} upgrade already ${sameVersion.status}: ${sameVersion.newImplementation}`);
    return manifest;
  }
  const otherPrepared = (manifest.upgrades ?? []).find(
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
  const preparedBlock = await context.ethers.provider.getBlock('latest');
  if (!preparedBlock?.hash) throw new Error('Prepared upgrade block has no hash');
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
  // Simulate from the live authority to check authorization and optional migration calldata without changing state.
  await context.ethers.provider.call({from: authority.current, to: record.address, data});
  const owner = await classifyAuthority(authority.current, context);
  const ownerTransaction =
    owner.type === 'safe' ? await prepareSafeOwnerActions(owner, [ownerAction], context.provider) : undefined;
  // Persist only a fully validated, deployed, bytecode-hashed, and successfully simulated candidate.
  const upgrade: ManifestUpgrade = {
    contractName: options.contractName,
    version: options.version,
    nextArtifact: options.implementation,
    deploymentId,
    graphId: module.id,
    previousImplementation: liveImplementation,
    newImplementation,
    status: 'prepared',
    validatedAt: new Date().toISOString(),
    callData,
    specHash,
    implementationCodeHash: keccak256(implementationCode),
    preparedAtBlock: {blockNumber: String(preparedBlock.number), blockHash: preparedBlock.hash},
    ownerAction,
    ownerTransaction,
  };
  manifest.upgrades = [...(manifest.upgrades ?? []), upgrade];
  await writeVillageDeploymentManifest(manifestPath, manifest);
  console.log(`${options.contractName} upgrade prepared: ${newImplementation}`);
  if (!['default', 'localhost'].includes(context.networkName)) {
    console.log(`Verify explicitly: yarn hardhat --network ${context.networkName} ignition verify ${deploymentId}`);
  }
  return manifest;
}

async function classifyAuthority(address: string, context: PrepareUpgradeContext): Promise<FinalOwnerConfig> {
  if ((await context.ethers.provider.getCode(address)) === '0x') return {type: 'eoa', address};
  const safe = await context.ethers.getContractAt(
    ['function getOwners() view returns (address[])', 'function getThreshold() view returns (uint256)'],
    address,
  );
  const owner: FinalOwnerConfig = {
    type: 'safe',
    address,
    expectedOwners: (await safe.getOwners()).map(getAddress),
    expectedThreshold: Number(await safe.getThreshold()),
  };
  await validateOwnerAuthority(owner, context);
  return owner;
}
