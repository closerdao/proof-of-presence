#!/usr/bin/env tsx
import path from 'node:path';
import {getAddress, keccak256, toUtf8Bytes, ZeroAddress} from 'ethers';
import hre from 'hardhat';
import {upgrades} from '@openzeppelin/hardhat-upgrades';
import {buildUpgradeImplementationModule} from '../ignition/modules/upgrades/UpgradeImplementation.js';
import {prepareSafeOwnerActions} from './deployment/safe-service.js';
import {reconcileExecutedUpgrade} from './deployment/upgrades.js';
import {
  readVillageDeploymentManifest,
  writeVillageDeploymentManifest,
  type FinalOwnerConfig,
  type ManifestUpgrade,
  type PendingOwnerAction,
} from './deployment/village.js';
import {verifyIgnitionDeployment} from './deployment/verification.js';

const UUPS_CONTRACTS = new Set([
  'VillageAccess',
  'CommunityToken',
  'VillagePresenceToken',
  'VillageSweatToken',
  'TokenizedStays',
]);

interface Args {
  manifest?: string;
  contract?: string;
  implementation?: string;
  version?: string;
  network?: string;
  call?: string;
  callArgs?: string;
}

function parseArgs(argv: string[]): Args {
  const args: Args = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--manifest') args.manifest = argv[++i];
    else if (arg === '--contract') args.contract = argv[++i];
    else if (arg === '--implementation') args.implementation = argv[++i];
    else if (arg === '--version') args.version = argv[++i];
    else if (arg === '--network') args.network = argv[++i];
    else if (arg === '--call') args.call = argv[++i];
    else if (arg === '--call-args') args.callArgs = argv[++i];
    else if (arg === '--help' || arg === '-h') return args;
    else throw new Error(`Unknown argument '${arg}'`);
  }
  return args;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (!args.manifest || !args.contract || !args.implementation || !args.version) {
    console.log(`Usage: npm run upgrade:prepare -- --manifest <file> --contract <name>
  --implementation <artifact> --version <version> [--network <network>]
  [--call <function>] [--call-args '<json-array>']`);
    if (!process.argv.includes('--help') && !process.argv.includes('-h')) {
      throw new Error('--manifest, --contract, --implementation, and --version are required');
    }
    return;
  }
  if (!UUPS_CONTRACTS.has(args.contract)) throw new Error(`'${args.contract}' is not a supported UUPS contract`);
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(args.version)) throw new Error('Invalid upgrade version');

  const manifestPath = path.resolve(args.manifest);
  const manifest = await readVillageDeploymentManifest(manifestPath);
  const record = manifest.contracts[args.contract];
  if (!record?.implementationAddress) throw new Error(`Manifest has no UUPS deployment for ${args.contract}`);
  const networkName = args.network ?? manifest.network;
  if (networkName !== manifest.network) throw new Error(`Network '${networkName}' does not match manifest`);

  const connection = await hre.network.create(networkName);
  try {
    const chainId = Number((await connection.ethers.provider.getNetwork()).chainId);
    if (chainId !== manifest.chainId) throw new Error(`Connected chain ${chainId} does not match manifest`);
    const upgradesApi = await upgrades(hre, connection);
    const manifestImplementation = getAddress(record.implementationAddress);
    const liveImplementation = getAddress(await upgradesApi.erc1967.getImplementationAddress(record.address));

    // Reconcile a prepared upgrade that was executed externally before attempting to prepare another candidate.
    const executedCandidate = [...(manifest.upgradeHistory ?? [])]
      .reverse()
      .find(
        (item) =>
          item.contractName === args.contract &&
          item.status === 'prepared' &&
          getAddress(item.newImplementation) === liveImplementation,
      );
    if (liveImplementation !== manifestImplementation) {
      if (!executedCandidate) {
        throw new Error(
          `${args.contract} live implementation ${liveImplementation} does not match manifest ${manifestImplementation}`,
        );
      }
      const reconciliation = await reconcileExecutedUpgrade(
        manifest.contracts,
        executedCandidate,
        connection.ethers.provider,
      );
      if (!reconciliation.executed) {
        throw new Error(`${args.contract} live implementation did not execute the matching prepared upgrade`);
      }
      await writeVillageDeploymentManifest(manifestPath, manifest);
      console.log(`${args.contract} upgrade reconciled: ${liveImplementation}`);
      return;
    }

    const previous = [...(manifest.upgradeHistory ?? [])]
      .reverse()
      .find(
        (item) =>
          item.contractName === args.contract &&
          item.status === 'executed' &&
          getAddress(item.newImplementation) === liveImplementation,
      );
    const currentArtifact = previous?.nextArtifact ?? args.contract;
    const currentFactory = await connection.ethers.getContractFactory(currentArtifact);
    const nextFactory = await connection.ethers.getContractFactory(args.implementation);
    const callArgs = args.callArgs ? JSON.parse(args.callArgs) : [];
    if (!Array.isArray(callArgs)) throw new Error('--call-args must be a JSON array');
    if (!args.call && callArgs.length > 0) throw new Error('--call-args requires --call');
    const callData = args.call ? nextFactory.interface.encodeFunctionData(args.call, callArgs) : '0x';
    // The spec hash makes retries of the same release idempotent while rejecting a changed artifact or migration call.
    const specHash = keccak256(
      toUtf8Bytes(JSON.stringify([args.contract, args.implementation, args.version, liveImplementation, callData])),
    );
    const sameVersion = (manifest.upgradeHistory ?? []).find(
      (item) => item.contractName === args.contract && item.version === args.version,
    );
    if (sameVersion) {
      if (sameVersion.specHash !== specHash)
        throw new Error(`${args.contract}:${args.version} has a conflicting upgrade spec`);
      console.log(`${args.contract} upgrade already ${sameVersion.status}: ${sameVersion.newImplementation}`);
      return;
    }
    const otherPrepared = (manifest.upgradeHistory ?? []).find(
      (item) => item.contractName === args.contract && item.status === 'prepared',
    );
    if (otherPrepared) throw new Error(`${args.contract} already has prepared upgrade '${otherPrepared.version}'`);

    // Validate storage and UUPS compatibility before spending gas on the candidate implementation.
    await upgradesApi.validateUpgrade(currentFactory, nextFactory, {kind: 'uups'});
    const module = buildUpgradeImplementationModule(args.contract, args.implementation, args.version);
    const contractSlug = args.contract.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();
    const deploymentId = `upgrade-${manifest.chainId}-${manifest.villageSlug}-${contractSlug}-${args.version}`;
    const {implementation} = await connection.ignition.deploy(module, {deploymentId, displayUi: true});
    const newImplementation = getAddress(await implementation.getAddress());
    const implementationCode = await connection.ethers.provider.getCode(newImplementation);
    if (implementationCode === '0x') throw new Error('Ignition implementation deployment has no runtime code');
    // Close the preparation race: the validation baseline is invalid if another upgrade moved the proxy meanwhile.
    if (getAddress(await upgradesApi.erc1967.getImplementationAddress(record.address)) !== liveImplementation) {
      throw new Error(`${args.contract} implementation changed while preparing the upgrade`);
    }

    const data = nextFactory.interface.encodeFunctionData('upgradeToAndCall', [newImplementation, callData]);
    const ownerAction: PendingOwnerAction = {
      to: record.address,
      contractName: args.contract,
      functionName: 'upgradeToAndCall',
      args: [newImplementation, callData],
      data,
      reason: `Upgrade ${args.contract} to release ${args.version}`,
    };
    const authority = await readAuthority(args.contract, record.address, connection.ethers);
    if (authority.pending !== ZeroAddress) {
      console.warn(
        `Warning: ownership transfer to ${authority.pending} is pending; current authority is ${authority.current}`,
      );
    }
    // Simulate from the live authority to check authorization and optional migration calldata without changing state.
    await connection.ethers.provider.call({from: authority.current, to: record.address, data});
    const owner = await classifyAuthority(authority.current, connection.ethers);
    const ownerTransaction =
      owner.type === 'safe' ? await prepareSafeOwnerActions(owner, [ownerAction], connection.provider) : undefined;
    const verification = await verifyIgnitionDeployment(networkName, deploymentId);
    // Persist only a fully validated, deployed, bytecode-hashed, and successfully simulated candidate.
    const upgrade: ManifestUpgrade = {
      contractName: args.contract,
      version: args.version,
      nextArtifact: args.implementation,
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
    console.log(`${args.contract} upgrade prepared: ${newImplementation}`);
  } finally {
    await connection.close();
  }
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

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
