import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {ZeroAddress, getAddress} from 'ethers';
import type {DeploymentParameters, IgnitionModule} from '@nomicfoundation/ignition-core';
import {buildVillageGraph} from '../../ignition/modules/VillageGraph.js';
import {COMMUNITY_TOKEN_MODULE_ID} from '../../ignition/modules/contracts/CommunityToken.js';
import {DYNAMIC_PRICE_SALE_MODULE_ID} from '../../ignition/modules/contracts/DynamicPriceSale.js';
import {TDF_TRANSFER_POLICY_MODULE_ID} from '../../ignition/modules/contracts/TDFTransferPolicy.js';
import {TOKENIZED_STAYS_MODULE_ID} from '../../ignition/modules/contracts/TokenizedStays.js';
import {VILLAGE_ACCESS_MODULE_ID} from '../../ignition/modules/contracts/VillageAccess.js';
import {VILLAGE_PRESENCE_TOKEN_MODULE_ID} from '../../ignition/modules/contracts/VillagePresenceToken.js';
import {VILLAGE_SWEAT_TOKEN_MODULE_ID} from '../../ignition/modules/contracts/VillageSweatToken.js';
import {VILLAGE_CITIZEN_NFT_MODULE_ID} from '../../ignition/modules/contracts/VillageCitizenNFT.js';
import type {
  ManifestContract,
  BlockReference,
  NormalizedModules,
  ResolvedRoleGrant,
  VillageDeploymentConfig,
  VillageDeploymentContext,
} from './village.js';
import {resolvedCloserFeeBps} from './village.js';
import {graphHashForContracts, graphIdForSpec, symbolFromSlug, titleFromSlug, type ContractName} from './spec.js';
import {isSupportedUupsContract, type UupsContractName} from './uups-contracts.js';

export interface IgnitionVillageDeployment {
  module: IgnitionModule;
  deploymentId: string;
  parameters: DeploymentParameters;
  contracts: Record<string, ManifestContract>;
  instances: Record<string, any>;
  deploymentStart: BlockReference;
}

/** OpenZeppelin validation is the mandatory preflight before Ignition can submit the graph. */
export async function validateSelectedImplementations(
  context: VillageDeploymentContext,
  contracts: readonly ContractName[],
  deployer: unknown,
): Promise<void> {
  const selected = contracts.filter(isSupportedUupsContract);

  if (selected.length > 0 && !context.upgrades?.validateImplementation) {
    throw new Error('OpenZeppelin upgrades validation is required before every Ignition UUPS deployment');
  }
  for (const contractName of selected) {
    const factory = await context.ethers.getContractFactory(contractName, deployer);
    await context.upgrades.validateImplementation(factory, {kind: 'uups'});
  }
}

export function villageIgnitionDeploymentId(config: VillageDeploymentConfig): string {
  // The deployment ID selects Ignition's persistent journal; changing it turns a rerun into a distinct deployment.
  return `village-${config.chainId}-${config.villageSlug}-${graphHashForContracts(config.contracts, config.preset).slice(2)}`;
}

export function buildVillageIgnitionParameters(
  config: VillageDeploymentConfig,
  modules: NormalizedModules,
  initialOwner: string,
  initializerGrants: ResolvedRoleGrant[],
): DeploymentParameters {
  const parameters: DeploymentParameters = {};
  const setParameters = (moduleId: string, values: Record<string, unknown>): void => {
    parameters[moduleId] = {...(parameters[moduleId] ?? {}), ...values} as any;
  };
  if (!isPolicyOnlyDeployment(modules)) {
    setParameters(VILLAGE_ACCESS_MODULE_ID, {
      initialDefaultAdmin: initialOwner,
      initialRoleGrants: initializerGrants.map(({role, account}) => ({role, account})),
    });
  }

  const usesInternalTransferPolicy = modules.communityToken && modules.tdfTransferPolicy;
  // External policies are ordinary parameters. Internally deployed policies are passed as
  // Ignition Futures by the root graph and resolved after deployment below.
  const initializedTransferPolicy =
    usesInternalTransferPolicy || !config.communityToken?.transferPolicy
      ? ZeroAddress
      : getAddress(config.communityToken.transferPolicy);

  if (modules.communityToken) {
    const initialSupply = BigInt(config.communityToken?.initialSupply ?? 0).toString();
    const moduleId = usesInternalTransferPolicy ? graphIdForSpec(config) : COMMUNITY_TOKEN_MODULE_ID;
    setParameters(moduleId, {
      name: config.communityToken?.name ?? titleFromSlug(config.villageSlug, 'Token'),
      symbol: config.communityToken?.symbol ?? symbolFromSlug(config.villageSlug),
      initialSupply,
      maxSupply: BigInt(config.communityToken!.maxSupply!).toString(),
      initialRecipient: BigInt(initialSupply) > 0n ? getAddress(config.communityToken!.initialRecipient!) : ZeroAddress,
      ...(usesInternalTransferPolicy ? {} : {transferPolicy: initializedTransferPolicy}),
      owner: initialOwner,
    });
  }
  if (modules.presenceToken) {
    setParameters(VILLAGE_PRESENCE_TOKEN_MODULE_ID, {
      name: config.presenceToken?.name ?? titleFromSlug(config.villageSlug, 'Presence'),
      symbol: config.presenceToken?.symbol ?? `${symbolFromSlug(config.villageSlug)}P`,
      decayRatePerDay: String(config.presenceToken?.decayRatePerDay),
      owner: initialOwner,
    });
  }
  if (modules.sweatToken) {
    setParameters(VILLAGE_SWEAT_TOKEN_MODULE_ID, {
      name: config.sweatToken?.name ?? titleFromSlug(config.villageSlug, 'Contribution'),
      symbol: config.sweatToken?.symbol ?? `${symbolFromSlug(config.villageSlug)}C`,
      decayRatePerDay: String(config.sweatToken?.decayRatePerDay),
      owner: initialOwner,
    });
  }
  if (modules.citizenNft) {
    setParameters(VILLAGE_CITIZEN_NFT_MODULE_ID, {
      name: config.citizenNft?.name ?? titleFromSlug(config.villageSlug, 'Citizen'),
      symbol: config.citizenNft?.symbol ?? `${config.villageSlug} CIT`,
      baseURI: config.citizenNft!.baseURI,
      owner: initialOwner,
    });
  }
  if (modules.tokenizedStays) {
    setParameters(usesInternalTransferPolicy ? graphIdForSpec(config) : TOKENIZED_STAYS_MODULE_ID, {
      owner: initialOwner,
    });
  }
  if (modules.tdfTransferPolicy) {
    setParameters(TDF_TRANSFER_POLICY_MODULE_ID, {
      treasury: getAddress(config.tdfTransferPolicy!.treasury),
      owner: initialOwner,
    });
  }
  if (modules.dynamicPriceSale) {
    const sale = config.dynamicPriceSale!;
    const moduleId = modules.tdfTransferPolicy ? graphIdForSpec(config) : DYNAMIC_PRICE_SALE_MODULE_ID;
    setParameters(moduleId, {
      quoteToken: getAddress(sale.quoteToken),
      ...(config.preset === 'tdf' ? {} : {bondingCurve: getAddress(sale.bondingCurve!)}),
      villageTreasury: getAddress(sale.villageTreasury),
      closerFeeRecipient: getAddress(sale.closerFeeRecipient),
      closerFeeBps: resolvedCloserFeeBps(config),
      saleCap: BigInt(sale.saleCap).toString(),
      minimumPurchase: BigInt(sale.minimumPurchase).toString(),
      maximumPurchase: BigInt(sale.maximumPurchase).toString(),
      purchaseGranularity: BigInt(sale.purchaseGranularity).toString(),
      maximumRecipientBalance: BigInt(sale.maximumRecipientBalance).toString(),
      owner: initialOwner,
    });
  }
  return parameters;
}

export async function deployVillageIgnitionGraph(
  config: VillageDeploymentConfig,
  context: VillageDeploymentContext,
  modules: NormalizedModules,
  initialOwner: string,
  initializerGrants: ResolvedRoleGrant[],
  deployerAddress: string,
): Promise<IgnitionVillageDeployment> {
  if (!context.ignition?.deploy) throw new Error('Hardhat Ignition is required for every contract deployment');

  const module = buildVillageGraph(config);
  const deploymentId = villageIgnitionDeploymentId(config);
  const parameters = buildVillageIgnitionParameters(config, modules, initialOwner, initializerGrants);
  const beforeDeployment = await context.ethers.provider.getBlock('latest');
  const deployed = await context.ignition.deploy(module, {
    parameters,
    deploymentId,
    defaultSender: deployerAddress,
    displayUi: context.displayIgnitionUi ?? false,
  });
  const deploymentStart = await readIgnitionDeploymentStart(context, deploymentId, Number(beforeDeployment.number));
  const contracts: Record<string, ManifestContract> = {};
  const instances: Record<string, any> = {};

  const addPlain = async (contractName: string, resultKey: string, authority?: 'ownerless'): Promise<void> => {
    const instance = deployed[resultKey];
    contracts[contractName] = {
      artifact: contractName,
      kind: 'plain',
      address: getAddress(await instance.getAddress()),
      authority,
    };
    instances[contractName] = instance;
  };

  const addUups = async (contractName: UupsContractName, resultPrefix: string): Promise<void> => {
    const instance = deployed[resultPrefix];
    const implementation = deployed[`${resultPrefix}Implementation`];
    const proxy = deployed[`${resultPrefix}Proxy`];
    contracts[contractName] = {
      artifact: contractName,
      kind: 'uups',
      address: getAddress(await proxy.getAddress()),
      implementation: {address: getAddress(await implementation.getAddress())},
    };
    // All later callers use the proxy-bound interface. The implementation address is provenance and upgrade metadata.
    instances[contractName] = instance;
  };

  const policyOnly = isPolicyOnlyDeployment(modules);
  if (!policyOnly) {
    await addUups('VillageAccess', 'villageAccess');
  }
  if (modules.tdfTransferPolicy) {
    await addPlain('TDFTransferPolicy', 'tdfTransferPolicy');
  }
  if (modules.communityToken) {
    await addUups('CommunityToken', 'communityToken');
  }
  if (modules.presenceToken) {
    await addUups('VillagePresenceToken', 'villagePresenceToken');
  }
  if (modules.sweatToken) {
    await addUups('VillageSweatToken', 'villageSweatToken');
  }
  if (modules.tokenizedStays) {
    await addUups('TokenizedStays', 'tokenizedStays');
  }
  if (modules.citizenNft) {
    await addUups('VillageCitizenNFT', 'citizenNft');
  }
  if (modules.dynamicPriceSale) {
    if (config.preset === 'tdf') {
      await addPlain('TDFV1BondingCurve', 'tdfBondingCurve', 'ownerless');
    }
    await addUups('DynamicPriceSale', 'dynamicPriceSale');
  }

  return {
    module,
    deploymentId,
    parameters,
    contracts,
    instances,
    deploymentStart,
  };
}

async function readIgnitionDeploymentStart(
  context: VillageDeploymentContext,
  deploymentId: string,
  beforeDeploymentBlock: number,
): Promise<BlockReference> {
  const projectRoot = context.projectRoot ?? process.cwd();
  const configuredRoot = context.ignitionRoot ?? process.env.IGNITION_ROOT ?? 'ignition';
  const journalPath = path.join(
    path.resolve(projectRoot, configuredRoot),
    'deployments',
    deploymentId,
    'journal.jsonl',
  );
  try {
    const confirmations = (await readFile(journalPath, 'utf8'))
      .split('\n')
      .filter(Boolean)
      .map(
        (line) =>
          JSON.parse(line) as {
            type?: string;
            receipt?: {status?: string; blockNumber?: number; blockHash?: string};
          },
      )
      .filter(
        (entry) =>
          entry.type === 'TRANSACTION_CONFIRM' &&
          entry.receipt?.status === 'SUCCESS' &&
          entry.receipt.blockNumber !== undefined &&
          entry.receipt.blockHash !== undefined,
      )
      .sort((left, right) => left.receipt!.blockNumber! - right.receipt!.blockNumber!);
    const first = confirmations[0]?.receipt;
    if (first?.blockNumber !== undefined && first.blockHash) {
      return {blockNumber: String(first.blockNumber), blockHash: first.blockHash};
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }

  // Simulated Hardhat networks don't persist Ignition journals. Their first post-call block is the exact start.
  const firstBlock = await context.ethers.provider.getBlock(beforeDeploymentBlock + 1);
  if (!firstBlock?.hash) {
    throw new Error(`Cannot determine deployment start for Ignition deployment '${deploymentId}'`);
  }
  return {blockNumber: String(firstBlock.number), blockHash: firstBlock.hash};
}

export function isPolicyOnlyDeployment(modules: NormalizedModules): boolean {
  return (
    modules.tdfTransferPolicy &&
    !modules.villageAccess &&
    !modules.communityToken &&
    !modules.presenceToken &&
    !modules.sweatToken &&
    !modules.tokenizedStays &&
    !modules.citizenNft &&
    !modules.dynamicPriceSale
  );
}
