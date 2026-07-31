import path from 'node:path';
import {getAddress, id, isAddress, keccak256, ZeroAddress, ZeroHash} from 'ethers';
import {deployVillageIgnitionGraph, isPolicyOnlyDeployment, validateSelectedImplementations} from './ignition.js';
import {prepareSafeOwnerActions, proposeSafeOwnerActions, refreshSafeOwnerActionsStatus} from './safe-service.js';
import {
  readExistingVillageDeploymentManifest,
  writeVillageDeploymentManifest,
  type ManifestContract,
  type ManualAction,
  type PendingOwnerAction,
  type VillageDeploymentManifest,
} from './manifest.js';
import {
  contractSelection,
  graphIdForSpec,
  hashResolvedDeploymentSpec,
  symbolFromSlug,
  titleFromSlug,
  type ContractSelection,
  type FinalOwnerConfig,
  type ResolvedDeploymentSpec,
} from './spec.js';

export {
  parseVillageDeploymentManifest,
  readVillageDeploymentManifest,
  VillageDeploymentManifestSchema,
  writeVillageDeploymentManifest,
  type BlockReference,
  type LogReference,
  type ManifestContract,
  type ManifestUpgrade,
  type ManualAction,
  type PendingOwnerAction,
  type PreparedSafeTransaction,
  type VillageDeploymentManifest,
} from './manifest.js';
export {
  type CitizenNftConfig,
  type CommunityTokenConfig,
  type ContractName,
  type DecayingTokenConfig,
  type DynamicPriceSaleConfig,
  type EoaOwnerConfig,
  type FinalOwnerConfig,
  type ResolvedDeploymentSpec,
  type RoleGrantConfig,
  type SafeOwnerConfig,
  type TdfTransferPolicyConfig,
  TDF_COMMUNITY_TOKEN_MAX_SUPPLY,
  TDF_DEFAULT_CLOSER_FEE_BPS,
  TDF_DYNAMIC_PRICE_SALE_CAP,
  TDF_MAXIMUM_PURCHASE,
  TDF_MAXIMUM_RECIPIENT_BALANCE,
  TDF_MINIMUM_OPERATING_SUPPLY,
  TDF_MINIMUM_PURCHASE,
  TDF_PURCHASE_GRANULARITY,
} from './spec.js';

/** Resolved schema accepted by the deployment engine after input parsing and dependency expansion. */
export type VillageDeploymentConfig = ResolvedDeploymentSpec;
export type NormalizedModules = ContractSelection;

export interface ResolvedRoleGrant {
  role: string;
  roleName: string;
  account: string;
  source: 'module-derived' | 'config';
}

export interface VillageDeploymentContext {
  ethers: any;
  upgrades?: any;
  ignition?: any;
  displayIgnitionUi?: boolean;
  prepareSafeTransaction?: typeof prepareSafeOwnerActions;
  proposeSafeTransaction?: typeof proposeSafeOwnerActions;
  refreshSafeTransaction?: typeof refreshSafeOwnerActionsStatus;
  networkName: string;
  projectRoot?: string;
  ignitionRoot?: string;
  outputRoot?: string;
  writeManifest?: boolean;
}

export interface DeployVillageResult {
  manifest: VillageDeploymentManifest;
  manifestPath: string;
}

const IMPLEMENTATION_SLOT = '0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc';
const OWNABLE_ABI = [
  'function owner() view returns (address)',
  'function pendingOwner() view returns (address)',
  'function transferOwnership(address newOwner)',
  'function acceptOwnership()',
];
const ACCESS_ADMIN_ABI = [
  'function defaultAdmin() view returns (address)',
  'function pendingDefaultAdmin() view returns (address,uint48)',
  'function beginDefaultAdminTransfer(address newAdmin)',
  'function acceptDefaultAdminTransfer()',
  'function hasRole(bytes32,address) view returns (bool)',
  'function getRoleMemberCount(bytes32) view returns (uint256)',
  'function getRoleMember(bytes32,uint256) view returns (address)',
];
const SAFE_READ_ABI = [
  'function getOwners() view returns (address[])',
  'function getThreshold() view returns (uint256)',
];

export const ROLE_IDS = {
  DEFAULT_ADMIN_ROLE: ZeroHash,
  MINTER_ROLE: id('MINTER_ROLE'),
  BOOKING_MANAGER_ROLE: id('BOOKING_MANAGER_ROLE'),
  BOOKING_PLATFORM_ROLE: id('BOOKING_PLATFORM_ROLE'),
  CITIZEN_OPERATOR_ROLE: id('CITIZEN_OPERATOR_ROLE'),
} as const;

const ROLE_NAMES_BY_ID = new Map(Object.entries(ROLE_IDS).map(([name, role]) => [role.toLowerCase(), name]));

/** Boolean selection view derived from the canonical resolved contract set. */
export function normalizeModules(config: VillageDeploymentConfig): NormalizedModules {
  return contractSelection(config);
}

export function resolvedCloserFeeBps(config: VillageDeploymentConfig): number {
  if (config.dynamicPriceSale?.closerFeeBps === undefined) {
    throw new Error('dynamicPriceSale.closerFeeBps is missing from the resolved deployment spec');
  }
  return config.dynamicPriceSale.closerFeeBps;
}

export function manifestPathFor(config: VillageDeploymentConfig, projectRoot: string): string {
  return path.join(projectRoot, 'deployments', 'villages', String(config.chainId), `${config.villageSlug}.json`);
}

export function roleName(role: string): string {
  return ROLE_NAMES_BY_ID.get(role.toLowerCase()) ?? role;
}

export function roleId(role: string): string {
  if (role in ROLE_IDS) return ROLE_IDS[role as keyof typeof ROLE_IDS];
  if (!/^0x[0-9a-fA-F]{64}$/.test(role)) throw new Error(`Unsupported role '${role}'`);
  return role.toLowerCase();
}

export function deriveInitialRoleGrants(
  config: VillageDeploymentConfig,
  modules = normalizeModules(config),
): ResolvedRoleGrant[] {
  // Operational roles required by selected contracts are merged with explicit grants and deduplicated by role/account.
  const grants: ResolvedRoleGrant[] = [];
  const apiOperator = normalizeAddress(config.apiOperator, 'apiOperator');
  if (modules.presenceToken || modules.sweatToken) {
    grants.push(makeRoleGrant('BOOKING_PLATFORM_ROLE', apiOperator, 'module-derived'));
  }
  if (modules.tokenizedStays) grants.push(makeRoleGrant('BOOKING_MANAGER_ROLE', apiOperator, 'module-derived'));
  if (modules.communityToken && config.communityToken?.apiOperatorCanMint) {
    grants.push(makeRoleGrant('MINTER_ROLE', apiOperator, 'module-derived'));
  }
  for (const minter of config.communityToken?.minters ?? []) {
    grants.push(makeRoleGrant('MINTER_ROLE', normalizeAddress(minter, 'communityToken.minters'), 'config'));
  }
  if (modules.citizenNft) {
    for (const operator of config.citizenNft?.operators ?? []) {
      grants.push(makeRoleGrant('CITIZEN_OPERATOR_ROLE', normalizeAddress(operator, 'citizenNft.operators'), 'config'));
    }
  }
  for (const grant of config.initialRoleGrants ?? []) {
    grants.push(makeRoleGrant(grant.role, normalizeAddress(grant.account, 'initialRoleGrants.account'), 'config'));
  }
  return dedupeRoleGrants(grants);
}

export function validateVillageDeploymentConfig(
  config: VillageDeploymentConfig,
  networkChainId?: number,
): {modules: NormalizedModules; initialRoleGrants: ResolvedRoleGrant[]} {
  if (config.schemaVersion !== 2) throw new Error('Deployment spec must use schemaVersion 2');
  if (networkChainId !== undefined && config.chainId !== networkChainId) {
    throw new Error(`Config chainId ${config.chainId} does not match selected network chainId ${networkChainId}`);
  }
  normalizeAddress(config.finalOwner.address, 'finalOwner.address');
  normalizeAddress(config.apiOperator, 'apiOperator');
  const modules = normalizeModules(config);
  const initialRoleGrants = deriveInitialRoleGrants(config, modules);
  if (isPolicyOnlyDeployment(modules) && initialRoleGrants.length > 0) {
    throw new Error('TDFTransferPolicy-only deployment cannot assign VillageAccess roles');
  }
  for (const grant of initialRoleGrants) {
    if (grant.role === ROLE_IDS.DEFAULT_ADMIN_ROLE)
      throw new Error('initialRoleGrants cannot grant DEFAULT_ADMIN_ROLE');
  }
  return {modules, initialRoleGrants};
}

/**
 * Deploys a new graph, or reconciles a same-config deployment already recorded at the canonical manifest path.
 * The config hash prevents an existing deployment path from being silently reused with different settings.
 */
export async function deployVillage(
  config: VillageDeploymentConfig,
  context: VillageDeploymentContext,
): Promise<DeployVillageResult> {
  const projectRoot = context.projectRoot ?? process.cwd();
  const network = await context.ethers.provider.getNetwork();
  const {modules, initialRoleGrants} = validateVillageDeploymentConfig(config, Number(network.chainId));
  const configHash = hashResolvedDeploymentSpec(config);
  const manifestPath = manifestPathFor(config, context.outputRoot ?? projectRoot);
  const existing = await readExistingVillageDeploymentManifest(manifestPath);
  if (existing) {
    if (existing.configHash !== configHash) throw new Error(`Deployment manifest collision at ${manifestPath}`);
    // Reruns audit the recorded deployment against live state instead of submitting the graph again.
    const reconciled = await reconcileManifest(existing, config, context, initialRoleGrants);
    if (context.writeManifest !== false) {
      await writeVillageDeploymentManifest(manifestPath, reconciled);
    }
    return {manifest: reconciled, manifestPath};
  }

  const [deployer] = await context.ethers.getSigners();
  const deployerAddress = normalizeAddress(deployer.address, 'deployer');
  const finalOwner = normalizeAddress(config.finalOwner.address, 'finalOwner.address');
  await validateOwnerAuthority(config.finalOwner, context);

  // The deployer always owns the fresh graph long enough to complete address-dependent configuration.
  await validateSelectedImplementations(context, config.contracts, deployer);
  const deployed = await deployVillageIgnitionGraph(
    config,
    context,
    modules,
    deployerAddress,
    initialRoleGrants,
    deployerAddress,
  );
  const contracts = deployed.contracts;
  await captureCodeProvenance(context, contracts);
  await verifyImplementations(context, contracts);
  await verifyRoles(context, contracts, deployerAddress, initialRoleGrants);

  const ownerActions = await executeOwnerActions(
    buildDeploymentOwnerActions(config, modules, contracts, deployed.instances),
    deployer,
    context,
  );
  if (ownerActions.length > 0) throw new Error('Deployer owner actions did not reach their expected state');
  await verifyRoles(
    context,
    contracts,
    deployerAddress,
    expectedConfiguredRoleGrants(initialRoleGrants, contracts),
    false,
    true,
  );
  await verifyCompleteWiring(context, contracts, config);

  const pendingOwnerActions =
    finalOwner === deployerAddress
      ? []
      : await initiateOwnershipHandoff(contracts, deployer, deployerAddress, finalOwner, context);
  const status: VillageDeploymentManifest['status'] = pendingOwnerActions.length === 0 ? 'complete' : 'pending-handoff';
  if (status === 'complete') await verifyFinalAuthority(contracts, finalOwner, context);

  const manifest: VillageDeploymentManifest = {
    schemaVersion: 2,
    villageSlug: config.villageSlug,
    chainId: config.chainId,
    configHash,
    sourceRevision: process.env.GITHUB_SHA ?? process.env.SOURCE_REVISION,
    network: context.networkName,
    preset: config.preset,
    resolvedContracts: config.contracts,
    deploymentStart: deployed.deploymentStart,
    contracts,
    ownership: {
      deployer: deployerAddress,
      finalOwner: {...config.finalOwner, address: finalOwner},
      handoffInitiatedAt: pendingOwnerActions.length > 0 ? new Date().toISOString() : undefined,
    },
    pendingOwnerActions,
    graph: {
      id: graphIdForSpec(config),
      deploymentId: deployed.deploymentId,
    },
    status,
  };
  if (context.writeManifest !== false) {
    await writeVillageDeploymentManifest(manifestPath, manifest);
  }
  return {manifest, manifestPath};
}

export async function reconcileOwnershipHandoff(
  manifest: VillageDeploymentManifest,
  context: VillageDeploymentContext,
): Promise<VillageDeploymentManifest> {
  const reconciled = structuredClone(manifest);
  await verifyExpectedHandoffState(reconciled, context);
  const incomplete = await pendingOwnershipHandoffActions(reconciled, context);
  if (incomplete.length > 0) {
    reconciled.pendingOwnerActions = incomplete;
    reconciled.status = 'pending-handoff';
    return reconciled;
  }
  await verifyFinalAuthority(reconciled.contracts, reconciled.ownership.finalOwner.address, context);
  reconciled.pendingOwnerActions = [];
  reconciled.status = 'complete';
  return reconciled;
}

export async function pendingOwnershipHandoffActions(
  manifest: VillageDeploymentManifest,
  context: VillageDeploymentContext,
): Promise<ManualAction[]> {
  const incomplete: ManualAction[] = [];
  for (const action of manifest.pendingOwnerActions) {
    if (!(await isHandoffActionComplete(action, context))) incomplete.push(action);
  }
  return incomplete;
}

/** Audits recorded code, proxy slots, authority, roles, and wiring against current onchain state. */
async function reconcileManifest(
  manifest: VillageDeploymentManifest,
  config: VillageDeploymentConfig,
  context: VillageDeploymentContext,
  initialRoleGrants: ResolvedRoleGrant[],
): Promise<VillageDeploymentManifest> {
  const reconciled = structuredClone(manifest);
  for (const [name, record] of Object.entries(reconciled.contracts)) {
    const code = await context.ethers.provider.getCode(record.address);
    if (code === '0x') throw new Error(`Manifest contract ${name} has no runtime code`);
    const hash = keccak256(code);
    if (record.runtimeCodeHash && record.runtimeCodeHash !== hash) throw new Error(`${name} runtime code hash changed`);
    record.runtimeCodeHash = hash;
    const implementationAddress = currentImplementationAddress(record);
    if (implementationAddress) {
      await verifyProxyImplementationSlot(context, record.address, implementationAddress);
      const implementationCode = await context.ethers.provider.getCode(implementationAddress);
      if (implementationCode === '0x') throw new Error(`${name} implementation has no runtime code`);
      const implementationHash = keccak256(implementationCode);
      if (record.implementation?.runtimeCodeHash && record.implementation.runtimeCodeHash !== implementationHash) {
        throw new Error(`${name} implementation runtime code hash changed`);
      }
      record.implementation!.runtimeCodeHash = implementationHash;
    }
  }
  await verifyRoles(
    context,
    reconciled.contracts,
    reconciled.ownership.deployer,
    expectedConfiguredRoleGrants(initialRoleGrants, reconciled.contracts),
    true,
    true,
  );
  await verifyCompleteWiring(context, reconciled.contracts, config);
  const ownership = await reconcileOwnershipHandoff(reconciled, context);
  return ownership;
}

/**
 * Builds the ordered policy configuration that depends on addresses resolved after proxy initialization.
 * When selected, TokenizedStays is included as an operational counterparty so deposits and withdrawals work while
 * transfers are restricted.
 */
function buildDeploymentOwnerActions(
  config: VillageDeploymentConfig,
  modules: NormalizedModules,
  contracts: Record<string, ManifestContract>,
  instances: Record<string, any>,
): PendingOwnerAction[] {
  const actions: PendingOwnerAction[] = [];
  if (modules.dynamicPriceSale) {
    const access = instances.VillageAccess;
    actions.push(
      buildOwnerAction(
        access,
        contracts.VillageAccess.address,
        'VillageAccess',
        'grantRole',
        [ROLE_IDS.MINTER_ROLE, contracts.DynamicPriceSale.address],
        'Grant the DynamicPriceSale permission to mint CommunityToken',
      ),
    );
  }

  const policy = instances.TDFTransferPolicy;
  if (!policy) return actions;
  for (const account of config.tdfTransferPolicy?.allowedCounterparties ?? []) {
    actions.push(
      buildOwnerAction(
        policy,
        contracts.TDFTransferPolicy.address,
        'TDFTransferPolicy',
        'setAllowedCounterparty',
        [normalizeAddress(account, 'tdfTransferPolicy.allowedCounterparties'), true],
        'Configure an allowed TDF counterparty',
      ),
    );
  }
  if (modules.tokenizedStays) {
    const stays = contracts.TokenizedStays.address;
    const configured = new Set(
      (config.tdfTransferPolicy?.allowedCounterparties ?? []).map((value) => getAddress(value)),
    );
    if (!configured.has(stays)) {
      actions.push(
        buildOwnerAction(
          policy,
          contracts.TDFTransferPolicy.address,
          'TDFTransferPolicy',
          'setAllowedCounterparty',
          [stays, true],
          'Allow TokenizedStays deposits and withdrawals',
        ),
      );
    }
  }
  if (config.tdfTransferPolicy?.restrictionsEnabled === false) {
    actions.push(
      buildOwnerAction(
        policy,
        contracts.TDFTransferPolicy.address,
        'TDFTransferPolicy',
        'setTransfersRestricted',
        [false],
        'Explicitly enable ordinary TDF transfers',
      ),
    );
  }
  return actions;
}

/** Executes only actions whose onchain postcondition is still unmet, then verifies every submitted change. */
async function executeOwnerActions(
  actions: PendingOwnerAction[],
  signer: any,
  context: VillageDeploymentContext,
): Promise<PendingOwnerAction[]> {
  for (const action of actions) {
    if (await isOwnerActionComplete(action, context)) continue;
    const transaction = await signer.sendTransaction({to: action.to, data: action.data});
    const receipt = await transaction.wait();
    if (!receipt || Number(receipt.status) !== 1)
      throw new Error(`${action.contractName}.${action.functionName} failed`);
    if (!(await isOwnerActionComplete(action, context))) {
      throw new Error(`${action.contractName}.${action.functionName} did not reach its expected state`);
    }
  }
  return incompleteOwnerActions(actions, context);
}

/**
 * Initiates Ownable2Step and AccessControlDefaultAdminRules transfers.
 * Acceptance must come from the final owner, so the corresponding calls are returned as manual actions.
 */
async function initiateOwnershipHandoff(
  contracts: Record<string, ManifestContract>,
  deployer: any,
  deployerAddress: string,
  finalOwner: string,
  context: VillageDeploymentContext,
): Promise<ManualAction[]> {
  const actions: ManualAction[] = [];
  for (const [name, record] of Object.entries(contracts)) {
    if (name === 'VillageAccess' || record.authority === 'ownerless') continue;
    const ownable = await context.ethers.getContractAt(OWNABLE_ABI, record.address, deployer);
    const owner = getAddress(await ownable.owner());
    const pending = getAddress(await ownable.pendingOwner());
    let transactionHash: string | undefined;
    if (owner === finalOwner) continue;
    if (owner !== deployerAddress) throw new Error(`${name} has unexpected owner ${owner}`);
    if (pending === ZeroAddress) {
      const transaction = await ownable.transferOwnership(finalOwner);
      const receipt = await transaction.wait();
      transactionHash = receipt?.hash ?? transaction.hash;
    } else if (pending !== finalOwner) {
      throw new Error(`${name} pending owner ${pending} does not match ${finalOwner}`);
    }
    if (getAddress(await ownable.pendingOwner()) !== finalOwner)
      throw new Error(`${name} ownership handoff was not initiated`);
    actions.push({
      kind: 'ownership-acceptance',
      to: record.address,
      contractName: name,
      functionName: 'acceptOwnership',
      args: [],
      data: ownable.interface.encodeFunctionData('acceptOwnership'),
      reason: `Accept ownership of ${name}`,
      recipient: finalOwner,
      initiatedTransactionHash: transactionHash,
    });
  }

  const accessRecord = contracts.VillageAccess;
  if (accessRecord) {
    const access = await context.ethers.getContractAt(ACCESS_ADMIN_ABI, accessRecord.address, deployer);
    const current = getAddress(await access.defaultAdmin());
    let [pending, schedule] = await access.pendingDefaultAdmin();
    pending = getAddress(pending);
    let transactionHash: string | undefined;
    if (current !== finalOwner) {
      if (current !== deployerAddress) throw new Error(`VillageAccess has unexpected default admin ${current}`);
      if (pending === ZeroAddress) {
        const transaction = await access.beginDefaultAdminTransfer(finalOwner);
        const receipt = await transaction.wait();
        transactionHash = receipt?.hash ?? transaction.hash;
        [pending, schedule] = await access.pendingDefaultAdmin();
        pending = getAddress(pending);
      }
      if (pending !== finalOwner)
        throw new Error(`VillageAccess pending admin ${pending} does not match ${finalOwner}`);
      actions.push({
        kind: 'ownership-acceptance',
        to: accessRecord.address,
        contractName: 'VillageAccess',
        functionName: 'acceptDefaultAdminTransfer',
        args: [],
        data: access.interface.encodeFunctionData('acceptDefaultAdminTransfer'),
        reason: 'Accept VillageAccess default administration',
        recipient: finalOwner,
        initiatedTransactionHash: transactionHash,
        acceptAfter: new Date(Number(schedule) * 1000).toISOString(),
      });
    }
  }
  return actions;
}

async function verifyExpectedHandoffState(
  manifest: VillageDeploymentManifest,
  context: VillageDeploymentContext,
): Promise<void> {
  const {deployer, finalOwner} = manifest.ownership;
  const finalAddress = getAddress(finalOwner.address);
  for (const [name, record] of Object.entries(manifest.contracts)) {
    if (record.authority === 'ownerless') continue;
    if (name === 'VillageAccess') {
      const access = await context.ethers.getContractAt(ACCESS_ADMIN_ABI, record.address);
      const current = getAddress(await access.defaultAdmin());
      const [pending] = await access.pendingDefaultAdmin();
      if (current === finalAddress) continue;
      if (current !== deployer || getAddress(pending) !== finalAddress) {
        throw new Error('VillageAccess is not in an expected handoff state');
      }
      continue;
    }
    const ownable = await context.ethers.getContractAt(OWNABLE_ABI, record.address);
    const current = getAddress(await ownable.owner());
    const pending = getAddress(await ownable.pendingOwner());
    if (current === finalAddress) continue;
    if (current !== deployer || pending !== finalAddress)
      throw new Error(`${name} is not in an expected handoff state`);
  }
}

async function verifyFinalAuthority(
  contracts: Record<string, ManifestContract>,
  finalOwner: string,
  context: VillageDeploymentContext,
): Promise<void> {
  const expected = getAddress(finalOwner);
  for (const [name, record] of Object.entries(contracts)) {
    if (record.authority === 'ownerless') continue;
    if (name === 'VillageAccess') {
      const access = await context.ethers.getContractAt(ACCESS_ADMIN_ABI, record.address);
      if (getAddress(await access.defaultAdmin()) !== expected) throw new Error('VillageAccess final admin changed');
      const [pending] = await access.pendingDefaultAdmin();
      if (getAddress(pending) !== ZeroAddress) {
        throw new Error('VillageAccess has an unexpected pending default admin');
      }
    } else {
      const ownable = await context.ethers.getContractAt(OWNABLE_ABI, record.address);
      if (getAddress(await ownable.owner()) !== expected) throw new Error(`${name} final owner changed`);
      if (getAddress(await ownable.pendingOwner()) !== ZeroAddress)
        throw new Error(`${name} has an unexpected pending owner`);
    }
  }
}

export async function validateOwnerAuthority(
  owner: FinalOwnerConfig,
  context: VillageDeploymentContext,
): Promise<void> {
  const address = getAddress(owner.address);
  const code = await context.ethers.provider.getCode(address);
  if (owner.type === 'eoa') {
    if (code !== '0x') throw new Error(`EOA final owner ${address} has deployed code`);
    return;
  }
  if (code === '0x') throw new Error(`Safe authority ${address} has no deployed code`);
  const safe = await context.ethers.getContractAt(SAFE_READ_ABI, address);
  let actualOwners: string[];
  let threshold: number;
  try {
    actualOwners = (await safe.getOwners()).map((value: string) => getAddress(value)).sort();
    threshold = Number(await safe.getThreshold());
  } catch {
    throw new Error(`Contract authority ${address} does not expose the required Safe interface`);
  }
  if (threshold < 1 || threshold > actualOwners.length) throw new Error('Safe authority has an invalid threshold');
  const expected = owner.expectedOwners.map(getAddress).sort();
  if (JSON.stringify(expected) !== JSON.stringify(actualOwners)) throw new Error('Safe owners do not match config');
  if (owner.expectedThreshold !== threshold) {
    throw new Error('Safe threshold does not match config');
  }
}

async function verifyRoles(
  context: VillageDeploymentContext,
  contracts: Record<string, ManifestContract>,
  expectedInitialAdmin: string,
  grants: ResolvedRoleGrant[],
  allowAcceptedHandoff = false,
  exact = false,
): Promise<void> {
  if (!contracts.VillageAccess) return;
  const access = await context.ethers.getContractAt(ACCESS_ADMIN_ABI, contracts.VillageAccess.address);
  const admin = getAddress(await access.defaultAdmin());
  if (admin !== expectedInitialAdmin && !allowAcceptedHandoff)
    throw new Error('VillageAccess initial admin is incorrect');
  for (const grant of grants) {
    if (!(await access.hasRole(grant.role, grant.account)))
      throw new Error(`Missing ${grant.roleName} for ${grant.account}`);
  }
  if (!exact) return;

  const expectedByRole = new Map<string, Set<string>>();
  for (const role of Object.values(ROLE_IDS)) {
    if (role !== ROLE_IDS.DEFAULT_ADMIN_ROLE) expectedByRole.set(role.toLowerCase(), new Set());
  }
  for (const grant of grants) {
    const key = grant.role.toLowerCase();
    const accounts = expectedByRole.get(key) ?? new Set<string>();
    accounts.add(getAddress(grant.account));
    expectedByRole.set(key, accounts);
  }
  for (const [role, expectedAccounts] of expectedByRole) {
    const count = Number(await access.getRoleMemberCount(role));
    const actualAccounts = new Set<string>();
    for (let index = 0; index < count; index += 1) {
      actualAccounts.add(getAddress(await access.getRoleMember(role, index)));
    }
    if (
      actualAccounts.size !== expectedAccounts.size ||
      [...actualAccounts].some((account) => !expectedAccounts.has(account))
    ) {
      throw new Error(`${roleName(role)} members do not match the deployment config`);
    }
  }
}

async function verifyImplementations(
  context: VillageDeploymentContext,
  contracts: Record<string, ManifestContract>,
): Promise<void> {
  for (const record of Object.values(contracts)) {
    const implementationAddress = currentImplementationAddress(record);
    if (implementationAddress) {
      await verifyProxyImplementationSlot(context, record.address, implementationAddress);
    }
  }
}

async function verifyProxyImplementationSlot(
  context: VillageDeploymentContext,
  proxyAddress: string,
  expectedImplementation: string,
): Promise<void> {
  const provider = context.ethers.provider;
  const raw = provider.getStorage
    ? await provider.getStorage(proxyAddress, IMPLEMENTATION_SLOT)
    : await provider.getStorageAt(proxyAddress, IMPLEMENTATION_SLOT);
  const actual = getAddress(`0x${raw.slice(-40)}`);
  if (actual !== getAddress(expectedImplementation)) {
    throw new Error(`Proxy ${proxyAddress} points to ${actual}, expected ${expectedImplementation}`);
  }
}

/** Applies the stricter final-state checks used only after every owner action has completed. */
async function verifyCompleteWiring(
  context: VillageDeploymentContext,
  contracts: Record<string, ManifestContract>,
  config: VillageDeploymentConfig,
): Promise<void> {
  await verifyModuleWiring(
    context,
    contracts,
    contracts.TDFTransferPolicy?.address ?? config.communityToken?.transferPolicy ?? ZeroAddress,
    config,
  );
  if (contracts.DynamicPriceSale) {
    const access = await context.ethers.getContractAt(ACCESS_ADMIN_ABI, contracts.VillageAccess.address);
    if (!(await access.hasRole(ROLE_IDS.MINTER_ROLE, contracts.DynamicPriceSale.address))) {
      throw new Error('DynamicPriceSale is missing CommunityToken MINTER_ROLE');
    }
  }
  if (contracts.TDFTransferPolicy) {
    const policy = await context.ethers.getContractAt(
      [
        'function allowedCounterparty(address) view returns (bool)',
        'function transfersRestricted() view returns (bool)',
      ],
      contracts.TDFTransferPolicy.address,
    );
    for (const account of config.tdfTransferPolicy?.allowedCounterparties ?? []) {
      if (!(await policy.allowedCounterparty(account))) throw new Error(`TDF counterparty ${account} is not allowed`);
    }
    if (contracts.TokenizedStays && !(await policy.allowedCounterparty(contracts.TokenizedStays.address))) {
      throw new Error('TokenizedStays is not an allowed TDF counterparty');
    }
    if ((config.tdfTransferPolicy?.restrictionsEnabled ?? true) !== (await policy.transfersRestricted())) {
      throw new Error('TDF restriction state does not match config');
    }
  }
}

async function verifyModuleWiring(
  context: VillageDeploymentContext,
  contracts: Record<string, ManifestContract>,
  expectedPolicy: string,
  config: VillageDeploymentConfig,
): Promise<void> {
  const accessAddress = contracts.VillageAccess?.address ?? ZeroAddress;
  if (contracts.CommunityToken) {
    const token = await context.ethers.getContractAt(
      [
        'function roleAuthority() view returns (address)',
        'function transferPolicy() view returns (address)',
        'function maxSupply() view returns (uint256)',
        'function name() view returns (string)',
        'function symbol() view returns (string)',
      ],
      contracts.CommunityToken.address,
    );
    if (getAddress(await token.roleAuthority()) !== accessAddress) throw new Error('CommunityToken authority mismatch');
    if (getAddress(await token.transferPolicy()) !== getAddress(expectedPolicy))
      throw new Error('CommunityToken policy mismatch');
    if ((await token.maxSupply()) !== BigInt(config.communityToken!.maxSupply!)) {
      throw new Error('CommunityToken max supply mismatch');
    }
    if ((await token.name()) !== (config.communityToken?.name ?? titleFromSlug(config.villageSlug, 'Token'))) {
      throw new Error('CommunityToken name mismatch');
    }
    if ((await token.symbol()) !== (config.communityToken?.symbol ?? symbolFromSlug(config.villageSlug))) {
      throw new Error('CommunityToken symbol mismatch');
    }
  }
  for (const [name, tokenConfig, defaultSuffix, symbolSuffix] of [
    ['VillagePresenceToken', config.presenceToken, 'Presence', 'P'],
    ['VillageSweatToken', config.sweatToken, 'Contribution', 'C'],
  ] as const) {
    if (!contracts[name]) continue;
    const token = await context.ethers.getContractAt(
      [
        'function roleAuthority() view returns (address)',
        'function decayRatePerDay() view returns (uint256)',
        'function name() view returns (string)',
        'function symbol() view returns (string)',
      ],
      contracts[name].address,
    );
    if (getAddress(await token.roleAuthority()) !== accessAddress) throw new Error(`${name} authority mismatch`);
    if ((await token.decayRatePerDay()) !== BigInt(tokenConfig!.decayRatePerDay)) {
      throw new Error(`${name} decay rate mismatch`);
    }
    if ((await token.name()) !== (tokenConfig?.name ?? titleFromSlug(config.villageSlug, defaultSuffix))) {
      throw new Error(`${name} name mismatch`);
    }
    if ((await token.symbol()) !== (tokenConfig?.symbol ?? `${symbolFromSlug(config.villageSlug)}${symbolSuffix}`)) {
      throw new Error(`${name} symbol mismatch`);
    }
  }
  if (contracts.VillageCitizenNFT) {
    const citizenNft = await context.ethers.getContractAt(
      [
        'function roleAuthority() view returns (address)',
        'function baseURI() view returns (string)',
        'function name() view returns (string)',
        'function symbol() view returns (string)',
      ],
      contracts.VillageCitizenNFT.address,
    );
    if (getAddress(await citizenNft.roleAuthority()) !== accessAddress) {
      throw new Error('VillageCitizenNFT authority mismatch');
    }
    if ((await citizenNft.baseURI()) !== config.citizenNft!.baseURI) {
      throw new Error('VillageCitizenNFT base URI mismatch');
    }
    if ((await citizenNft.name()) !== (config.citizenNft?.name ?? titleFromSlug(config.villageSlug, 'Citizen'))) {
      throw new Error('VillageCitizenNFT name mismatch');
    }
    if ((await citizenNft.symbol()) !== (config.citizenNft?.symbol ?? `${config.villageSlug} CIT`)) {
      throw new Error('VillageCitizenNFT symbol mismatch');
    }
  }
  if (contracts.TokenizedStays) {
    const stays = await context.ethers.getContractAt(
      ['function communityToken() view returns (address)', 'function roleAuthority() view returns (address)'],
      contracts.TokenizedStays.address,
    );
    if (getAddress(await stays.communityToken()) !== contracts.CommunityToken.address)
      throw new Error('Stays token mismatch');
    if (getAddress(await stays.roleAuthority()) !== accessAddress) throw new Error('Stays authority mismatch');
  }
  if (contracts.TDFTransferPolicy) {
    const policy = await context.ethers.getContractAt(
      ['function treasury() view returns (address)'],
      contracts.TDFTransferPolicy.address,
    );
    if (getAddress(await policy.treasury()) !== getAddress(config.tdfTransferPolicy!.treasury)) {
      throw new Error('TDF treasury mismatch');
    }
  }
  if (contracts.DynamicPriceSale) {
    const sale = await context.ethers.getContractAt('DynamicPriceSale', contracts.DynamicPriceSale.address);
    const actual = await sale.saleConfiguration();
    const expected = config.dynamicPriceSale!;
    const expectedCurve = contracts.TDFV1BondingCurve?.address ?? getAddress(expected.bondingCurve!);
    const addressFields: Array<[string, string, string]> = [
      ['community token', actual.communityToken, contracts.CommunityToken.address],
      ['quote token', actual.quoteToken, expected.quoteToken],
      ['bonding curve', actual.bondingCurve, expectedCurve],
      ['village treasury', actual.villageTreasury, expected.villageTreasury],
      ['Closer fee recipient', actual.closerFeeRecipient, expected.closerFeeRecipient],
    ];
    for (const [label, value, wanted] of addressFields) {
      if (getAddress(value) !== getAddress(wanted)) throw new Error(`DynamicPriceSale ${label} mismatch`);
    }
    const uintFields: Array<[string, bigint, bigint]> = [
      ['sale cap', actual.saleCap, BigInt(expected.saleCap)],
      ['minimum purchase', actual.minimumPurchase, BigInt(expected.minimumPurchase)],
      ['maximum purchase', actual.maximumPurchase, BigInt(expected.maximumPurchase)],
      ['purchase granularity', actual.purchaseGranularity, BigInt(expected.purchaseGranularity)],
      ['maximum recipient balance', actual.maximumRecipientBalance, BigInt(expected.maximumRecipientBalance)],
      ['Closer fee', actual.closerFeeBps, BigInt(resolvedCloserFeeBps(config))],
    ];
    for (const [label, value, wanted] of uintFields) {
      if (value !== wanted) throw new Error(`DynamicPriceSale ${label} mismatch`);
    }
  }
}

async function incompleteOwnerActions(
  actions: PendingOwnerAction[],
  context: VillageDeploymentContext,
): Promise<PendingOwnerAction[]> {
  const incomplete: PendingOwnerAction[] = [];
  for (const action of actions) if (!(await isOwnerActionComplete(action, context))) incomplete.push(action);
  return incomplete;
}

/**
 * Maps supported owner actions to their authoritative onchain postcondition.
 * A newly introduced action remains pending until its postcondition is handled here.
 */
async function isOwnerActionComplete(action: PendingOwnerAction, context: VillageDeploymentContext): Promise<boolean> {
  if (action.functionName === 'setAllowedCounterparty') {
    const target = await context.ethers.getContractAt(
      ['function allowedCounterparty(address) view returns (bool)'],
      action.to,
    );
    return (await target.allowedCounterparty(action.args[0])) === action.args[1];
  }
  if (action.functionName === 'setTransfersRestricted') {
    const target = await context.ethers.getContractAt(
      ['function transfersRestricted() view returns (bool)'],
      action.to,
    );
    return (await target.transfersRestricted()) === action.args[0];
  }
  if (action.functionName === 'setTransferPolicy') {
    const target = await context.ethers.getContractAt(['function transferPolicy() view returns (address)'], action.to);
    return getAddress(await target.transferPolicy()) === getAddress(action.args[0] as string);
  }
  if (action.functionName === 'grantRole') {
    const target = await context.ethers.getContractAt(
      ['function hasRole(bytes32,address) view returns (bool)'],
      action.to,
    );
    return target.hasRole(action.args[0], action.args[1]);
  }
  if (action.functionName === 'upgradeToAndCall') {
    const raw = await context.ethers.provider.getStorage(action.to, IMPLEMENTATION_SLOT);
    return getAddress(`0x${raw.slice(-40)}`) === getAddress(action.args[0] as string);
  }
  return false;
}

async function isHandoffActionComplete(action: ManualAction, context: VillageDeploymentContext): Promise<boolean> {
  const recipient = getAddress(action.recipient);
  if (action.functionName === 'acceptOwnership') {
    const target = await context.ethers.getContractAt(OWNABLE_ABI, action.to);
    return getAddress(await target.owner()) === recipient;
  }
  if (action.functionName === 'acceptDefaultAdminTransfer') {
    const target = await context.ethers.getContractAt(ACCESS_ADMIN_ABI, action.to);
    return getAddress(await target.defaultAdmin()) === recipient;
  }
  throw new Error(`Unsupported handoff action ${action.contractName}.${action.functionName}`);
}

function buildOwnerAction(
  contract: any,
  to: string,
  contractName: string,
  functionName: string,
  args: unknown[],
  reason: string,
): PendingOwnerAction {
  return {
    to,
    contractName,
    functionName,
    args,
    data: contract.interface.encodeFunctionData(functionName, args),
    reason,
  };
}

function makeRoleGrant(role: string, account: string, source: ResolvedRoleGrant['source']): ResolvedRoleGrant {
  const resolvedRole = roleId(role);
  return {role: resolvedRole, roleName: roleName(resolvedRole), account, source};
}

function dedupeRoleGrants(grants: ResolvedRoleGrant[]): ResolvedRoleGrant[] {
  const seen = new Set<string>();
  return grants.filter((grant) => {
    const key = `${grant.role}:${grant.account}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function expectedConfiguredRoleGrants(
  initialRoleGrants: ResolvedRoleGrant[],
  contracts: Record<string, ManifestContract>,
): ResolvedRoleGrant[] {
  const grants = [...initialRoleGrants];
  if (contracts.DynamicPriceSale) {
    grants.push(makeRoleGrant('MINTER_ROLE', getAddress(contracts.DynamicPriceSale.address), 'module-derived'));
  }
  return dedupeRoleGrants(grants);
}

function normalizeAddress(value: unknown, field: string): string {
  if (typeof value !== 'string' || !isAddress(value)) throw new Error(`${field} must be a valid address`);
  const address = getAddress(value);
  if (address === ZeroAddress) throw new Error(`${field} must not be the zero address`);
  return address;
}

export function currentImplementationAddress(contract: ManifestContract): string | undefined {
  return contract.implementation?.address;
}

/** Captures runtime bytecode hashes for canonical proxy addresses and their implementations separately. */
export async function captureCodeProvenance(
  context: VillageDeploymentContext,
  contracts: Record<string, ManifestContract>,
): Promise<void> {
  for (const [name, record] of Object.entries(contracts)) {
    const code = await context.ethers.provider.getCode(record.address);
    if (code === '0x') throw new Error(`Deployed contract ${name} at ${record.address} has no runtime code`);
    record.runtimeCodeHash = keccak256(code);
    if (record.implementation) {
      const implementationCode = await context.ethers.provider.getCode(record.implementation.address);
      if (implementationCode === '0x') {
        throw new Error(`Implementation for ${name} at ${record.implementation.address} has no runtime code`);
      }
      record.implementation.runtimeCodeHash = keccak256(implementationCode);
    }
  }
}
