import {ZeroAddress, getAddress} from 'ethers';
import type {DeploymentParameters, IgnitionModule} from '@nomicfoundation/ignition-core';
import {COMMUNITY_TOKEN_MODULE_ID} from '../../ignition/modules/contracts/CommunityToken.js';
import {TDF_TRANSFER_POLICY_MODULE_ID} from '../../ignition/modules/contracts/TDFTransferPolicy.js';
import {TOKENIZED_STAYS_MODULE_ID} from '../../ignition/modules/contracts/TokenizedStays.js';
import {VILLAGE_ACCESS_MODULE_ID} from '../../ignition/modules/contracts/VillageAccess.js';
import {VILLAGE_PRESENCE_TOKEN_MODULE_ID} from '../../ignition/modules/contracts/VillagePresenceToken.js';
import {VILLAGE_SWEAT_TOKEN_MODULE_ID} from '../../ignition/modules/contracts/VillageSweatToken.js';
import {TDF_COMMUNITY_TOKEN_MODULE_ID} from '../../ignition/modules/profiles/TdfCommunityToken.js';
import {TDF_TOKENIZED_STAYS_MODULE_ID} from '../../ignition/modules/profiles/TdfTokenizedStays.js';
import {selectVillageProfileModule} from '../../ignition/modules/profiles/select.js';
import type {
  ManifestContract,
  NormalizedModules,
  ResolvedRoleGrant,
  VillageDeploymentConfig,
  VillageDeploymentContext,
} from './village.js';

export const UUPS_CONTRACTS = [
  'VillageAccess',
  'CommunityToken',
  'VillagePresenceToken',
  'VillageSweatToken',
  'TokenizedStays',
] as const;

type UupsContractName = (typeof UUPS_CONTRACTS)[number];

export interface IgnitionVillageDeployment {
  module: IgnitionModule;
  moduleIds: string[];
  deploymentId: string;
  parameters: DeploymentParameters;
  contracts: Record<string, ManifestContract>;
  instances: Record<string, any>;
  initializedTransferPolicy: string;
}

/** OpenZeppelin validation is the mandatory preflight before Ignition can submit the graph. */
export async function validateSelectedImplementations(
  context: VillageDeploymentContext,
  modules: NormalizedModules,
  deployer: unknown,
): Promise<void> {
  const selected: UupsContractName[] = [];
  if (!isPolicyOnlyDeployment(modules)) selected.push('VillageAccess');
  if (modules.communityToken) selected.push('CommunityToken');
  if (modules.presenceToken) selected.push('VillagePresenceToken');
  if (modules.sweatToken) selected.push('VillageSweatToken');
  if (modules.tokenizedStays) selected.push('TokenizedStays');

  if (!context.upgrades?.validateImplementation) {
    throw new Error('OpenZeppelin upgrades validation is required before every V2 Ignition UUPS deployment');
  }
  for (const contractName of selected) {
    const factory = await context.ethers.getContractFactory(contractName, deployer);
    await context.upgrades.validateImplementation(factory, {kind: 'uups'});
  }
}

export function villageIgnitionDeploymentId(config: VillageDeploymentConfig): string {
  // The deployment ID selects Ignition's persistent journal; changing it turns a rerun into a distinct deployment.
  return `village-${config.chainId}-${config.villageSlug}-${config.deploymentProfile}`;
}

export function buildVillageIgnitionParameters(
  config: VillageDeploymentConfig,
  modules: NormalizedModules,
  initialOwner: string,
  initializerGrants: ResolvedRoleGrant[],
): {parameters: DeploymentParameters; initializedTransferPolicy: string} {
  const parameters: DeploymentParameters = {};
  if (!isPolicyOnlyDeployment(modules)) {
    parameters[VILLAGE_ACCESS_MODULE_ID] = {
      initialDefaultAdmin: initialOwner,
      initialRoleGrants: initializerGrants.map(({role, account}) => ({role, account})),
    };
  }

  const usesInternalTransferPolicy = modules.communityToken && modules.tdfTransferPolicy;
  // External policies are ordinary parameters. Internally deployed policies are passed as
  // Ignition Futures by the TDF composition Module and resolved after deployment below.
  const initializedTransferPolicy =
    usesInternalTransferPolicy || !config.communityToken?.transferPolicy
      ? ZeroAddress
      : getAddress(config.communityToken.transferPolicy);

  if (modules.communityToken) {
    const initialSupply = BigInt(config.communityToken?.initialSupply ?? 0).toString();
    const moduleId = usesInternalTransferPolicy ? TDF_COMMUNITY_TOKEN_MODULE_ID : COMMUNITY_TOKEN_MODULE_ID;
    parameters[moduleId] = {
      name: config.communityToken?.name ?? titleFromSlug(config.villageSlug, 'Token'),
      symbol: config.communityToken?.symbol ?? symbolFromSlug(config.villageSlug),
      initialSupply,
      initialRecipient: BigInt(initialSupply) > 0n ? getAddress(config.communityToken!.initialRecipient!) : ZeroAddress,
      ...(usesInternalTransferPolicy ? {} : {transferPolicy: initializedTransferPolicy}),
      owner: initialOwner,
    };
  }
  if (modules.presenceToken) {
    parameters[VILLAGE_PRESENCE_TOKEN_MODULE_ID] = {
      name: config.presenceToken?.name ?? titleFromSlug(config.villageSlug, 'Presence'),
      symbol: config.presenceToken?.symbol ?? `${symbolFromSlug(config.villageSlug)}P`,
      decayRatePerDay: String(config.presenceToken?.decayRatePerDay),
      owner: initialOwner,
    };
  }
  if (modules.sweatToken) {
    parameters[VILLAGE_SWEAT_TOKEN_MODULE_ID] = {
      name: config.sweatToken?.name ?? titleFromSlug(config.villageSlug, 'Contribution'),
      symbol: config.sweatToken?.symbol ?? `${symbolFromSlug(config.villageSlug)}C`,
      decayRatePerDay: String(config.sweatToken?.decayRatePerDay),
      owner: initialOwner,
    };
  }
  if (modules.tokenizedStays) {
    parameters[usesInternalTransferPolicy ? TDF_TOKENIZED_STAYS_MODULE_ID : TOKENIZED_STAYS_MODULE_ID] = {
      owner: initialOwner,
    };
  }
  if (modules.tdfTransferPolicy) {
    parameters[TDF_TRANSFER_POLICY_MODULE_ID] = {
      treasury: getAddress(config.tdfTransferPolicy!.treasury),
      owner: initialOwner,
    };
  }
  return {parameters, initializedTransferPolicy};
}

export async function deployVillageIgnitionGraph(
  config: VillageDeploymentConfig,
  context: VillageDeploymentContext,
  modules: NormalizedModules,
  initialOwner: string,
  initializerGrants: ResolvedRoleGrant[],
  deployerAddress: string,
): Promise<IgnitionVillageDeployment> {
  if (!context.ignition?.deploy) throw new Error('Hardhat Ignition is required for every V2 contract deployment');

  const module = selectVillageProfileModule(modules);
  // A caller override is used by standalone-contract deployment; normal village reruns must retain the derived ID.
  const deploymentId = context.deploymentIdOverride ?? villageIgnitionDeploymentId(config);
  const {parameters, initializedTransferPolicy: configuredTransferPolicy} = buildVillageIgnitionParameters(
    config,
    modules,
    initialOwner,
    initializerGrants,
  );
  const deployed = await context.ignition.deploy(module, {
    parameters,
    deploymentId,
    defaultSender: deployerAddress,
    displayUi: context.displayIgnitionUi ?? false,
  });
  const contracts: Record<string, ManifestContract> = {};
  const instances: Record<string, any> = {};

  const addPlain = async (contractName: string, resultKey: string, constructorArgs: unknown[]): Promise<void> => {
    const instance = deployed[resultKey];
    contracts[contractName] = {
      name: contractName,
      deploymentName: `${config.villageSlug}_${contractName}`,
      address: getAddress(await instance.getAddress()),
      constructorArgs,
      abi: JSON.parse(instance.interface.formatJson()) as unknown[],
    };
    instances[contractName] = instance;
  };

  const addUups = async (
    contractName: UupsContractName,
    resultPrefix: string,
    initializerArgs: unknown[],
  ): Promise<void> => {
    const instance = deployed[resultPrefix];
    const implementation = deployed[`${resultPrefix}Implementation`];
    const proxy = deployed[`${resultPrefix}Proxy`];
    contracts[contractName] = {
      name: contractName,
      deploymentName: `${config.villageSlug}_${contractName}`,
      address: getAddress(await proxy.getAddress()),
      implementationAddress: getAddress(await implementation.getAddress()),
      initializerArgs,
      abi: JSON.parse(instance.interface.formatJson()) as unknown[],
    };
    // All later callers use the proxy-bound interface. The implementation address is provenance and upgrade metadata.
    instances[contractName] = instance;
  };

  const policyOnly = isPolicyOnlyDeployment(modules);
  if (!policyOnly) {
    await addUups('VillageAccess', 'villageAccess', [
      initialOwner,
      initializerGrants.map(({role, account}) => ({role, account})),
    ]);
  }
  const accessAddress = contracts.VillageAccess?.address ?? ZeroAddress;
  if (modules.tdfTransferPolicy) {
    await addPlain('TDFTransferPolicy', 'tdfTransferPolicy', [
      getAddress(config.tdfTransferPolicy!.treasury),
      initialOwner,
    ]);
  }
  const initializedTransferPolicy =
    modules.communityToken && contracts.TDFTransferPolicy
      ? contracts.TDFTransferPolicy.address
      : configuredTransferPolicy;
  if (modules.communityToken) {
    const initialSupply = BigInt(config.communityToken?.initialSupply ?? 0).toString();
    await addUups('CommunityToken', 'communityToken', [
      config.communityToken?.name ?? titleFromSlug(config.villageSlug, 'Token'),
      config.communityToken?.symbol ?? symbolFromSlug(config.villageSlug),
      initialSupply,
      BigInt(initialSupply) > 0n ? getAddress(config.communityToken!.initialRecipient!) : ZeroAddress,
      accessAddress,
      initializedTransferPolicy,
      initialOwner,
    ]);
  }
  if (modules.presenceToken) {
    await addUups('VillagePresenceToken', 'villagePresenceToken', [
      config.presenceToken?.name ?? titleFromSlug(config.villageSlug, 'Presence'),
      config.presenceToken?.symbol ?? `${symbolFromSlug(config.villageSlug)}P`,
      accessAddress,
      String(config.presenceToken?.decayRatePerDay),
      initialOwner,
    ]);
  }
  if (modules.sweatToken) {
    await addUups('VillageSweatToken', 'villageSweatToken', [
      config.sweatToken?.name ?? titleFromSlug(config.villageSlug, 'Contribution'),
      config.sweatToken?.symbol ?? `${symbolFromSlug(config.villageSlug)}C`,
      accessAddress,
      String(config.sweatToken?.decayRatePerDay),
      initialOwner,
    ]);
  }
  if (modules.tokenizedStays) {
    await addUups('TokenizedStays', 'tokenizedStays', [contracts.CommunityToken.address, accessAddress, initialOwner]);
  }

  return {
    module,
    moduleIds: collectModuleIds(module),
    deploymentId,
    parameters,
    contracts,
    instances,
    initializedTransferPolicy,
  };
}

export function isPolicyOnlyDeployment(modules: NormalizedModules): boolean {
  return (
    modules.tdfTransferPolicy &&
    !modules.communityToken &&
    !modules.presenceToken &&
    !modules.sweatToken &&
    !modules.tokenizedStays
  );
}

function collectModuleIds(module: IgnitionModule): string[] {
  const ids = new Set<string>();
  const visit = (current: IgnitionModule): void => {
    ids.add(current.id);
    for (const child of current.submodules) visit(child);
  };
  visit(module);
  return [...ids].sort();
}

function titleFromSlug(slug: string, suffix: string): string {
  return `${slug
    .split('-')
    .map((part) => part.slice(0, 1).toUpperCase() + part.slice(1))
    .join(' ')} ${suffix}`;
}

function symbolFromSlug(slug: string): string {
  return slug
    .split('-')
    .map((part) => part.slice(0, 3).toUpperCase())
    .join('')
    .slice(0, 10);
}
