import {mkdir, readFile, rename, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {getAddress, id, isAddress, keccak256, toUtf8Bytes, ZeroAddress, ZeroHash} from 'ethers';
import type {SafeTransactionData} from '@safe-global/types-kit';
import {z} from 'zod';
import {deployVillageIgnitionGraph, isPolicyOnlyDeployment, validateSelectedImplementations} from './ignition.js';
import {prepareSafeOwnerActions} from './safe-service.js';

export type DeploymentProfile = 'minimal-village' | 'token-village' | 'tokenized-stays-village' | 'tdf';
export type OwnershipMode = 'direct' | 'deployer-handoff';

export interface EoaOwnerConfig {
  type: 'eoa';
  address: string;
}

export interface SafeOwnerConfig {
  type: 'safe';
  address: string;
  expectedOwners?: string[];
  expectedThreshold?: number;
}

export type FinalOwnerConfig = EoaOwnerConfig | SafeOwnerConfig;

export interface OwnershipConfig {
  mode: OwnershipMode;
  finalOwner: FinalOwnerConfig;
}

export interface VillageDeploymentConfig {
  schemaVersion: 4;
  villageSlug: string;
  chainId: number;
  deploymentProfile: DeploymentProfile;
  ownership: OwnershipConfig;
  modules: string[];
  apiOperator: string;
  communityToken?: CommunityTokenConfig;
  presenceToken?: DecayingTokenConfig;
  sweatToken?: DecayingTokenConfig;
  tdfTransferPolicy?: TdfTransferPolicyConfig;
  dynamicPriceSale?: DynamicPriceSaleConfig;
  initialRoleGrants?: RoleGrantConfig[];
}

export interface CommunityTokenConfig {
  name?: string;
  symbol?: string;
  initialSupply?: string | number;
  maxSupply?: string | number;
  initialRecipient?: string;
  transferPolicy?: string;
  apiOperatorCanMint?: boolean;
  minters?: string[];
}

export interface DecayingTokenConfig {
  name?: string;
  symbol?: string;
  decayRatePerDay: string | number;
}

export interface TdfTransferPolicyConfig {
  treasury: string;
  allowedCounterparties?: string[];
  restrictionsEnabled?: boolean;
}

export interface DynamicPriceSaleConfig {
  quoteToken: string;
  bondingCurve?: string;
  villageTreasury: string;
  closerFeeRecipient: string;
  closerFeeBps?: number;
  saleCap: string | number;
  minimumPurchase: string | number;
  maximumPurchase: string | number;
  purchaseGranularity: string | number;
  maximumRecipientBalance: string | number;
}

export interface RoleGrantConfig {
  role: string;
  account: string;
}

export interface NormalizedModules {
  communityToken: boolean;
  presenceToken: boolean;
  sweatToken: boolean;
  tokenizedStays: boolean;
  tdfTransferPolicy: boolean;
  dynamicPriceSale: boolean;
}

export interface ResolvedRoleGrant {
  role: string;
  roleName: string;
  account: string;
  source: 'module-derived' | 'config';
}

export interface PendingOwnerAction {
  to: string;
  contractName: string;
  functionName: string;
  args: unknown[];
  data: string;
  reason: string;
}

export interface ManualAction extends PendingOwnerAction {
  kind: 'ownership-acceptance';
  recipient: string;
  initiatedTransactionHash?: string;
  acceptAfter?: string;
}

export interface ManifestContract {
  name: string;
  deploymentName: string;
  address: string;
  implementationAddress?: string;
  constructorArgs?: unknown[];
  initializerArgs?: unknown[];
  abi: unknown[];
  runtimeCodeHash?: string;
  implementationRuntimeCodeHash?: string;
  authority?: 'ownerless';
}

export interface PreparedSafeTransaction {
  safeAddress: string;
  safeTxHash: string;
  data: SafeTransactionData;
  proposal?: {
    status: 'submitted' | 'already-submitted';
    senderAddress?: string;
    submittedAt: string;
    txServiceUrl?: string;
    origin?: string;
  };
  serviceStatus?: {
    status: 'awaiting-confirmations' | 'ready-to-execute' | 'executed' | 'failed';
    checkedAt: string;
    confirmationsSubmitted: number;
    confirmationsRequired: number;
    isExecuted: boolean;
    isSuccessful?: boolean;
    executionTransactionHash?: string;
    executionDate?: string;
  };
}

export interface ManifestUpgrade {
  contractName: string;
  version: string;
  nextArtifact: string;
  deploymentId: string;
  moduleId: string;
  previousImplementation: string;
  newImplementation: string;
  status: 'prepared' | 'executed' | 'superseded';
  validatedAt: string;
  callData: string;
  specHash: string;
  implementationCodeHash: string;
  ownerAction: PendingOwnerAction;
  ownerTransaction?: PreparedSafeTransaction;
  verification?: unknown;
}

/**
 * Durable deployment record consumed by operators and downstream tooling.
 * It summarizes configured and observed onchain state; Ignition's journal remains the source for transaction resumption.
 */
export interface VillageDeploymentManifest {
  schemaVersion: 4;
  deploymentKind: 'village' | 'profile';
  villageSlug: string;
  chainId: number;
  configSchemaVersion: 4;
  configHash: string;
  sourceRevision?: string;
  network: string;
  deploymentProfile: DeploymentProfile;
  modules: NormalizedModules;
  contracts: Record<string, ManifestContract>;
  compiler: {solidity: string};
  openzeppelinVersion: string;
  ownership: {
    mode: OwnershipMode;
    deployer: string;
    initialOwner: string;
    finalOwner: FinalOwnerConfig;
    handoffInitiatedAt?: string;
  };
  apiOperator: string;
  roles: {initialGrants: ResolvedRoleGrant[]; apiOperatorGrants: ResolvedRoleGrant[]};
  ownerActions: PendingOwnerAction[];
  ownerTransaction?: PreparedSafeTransaction;
  manualActions: ManualAction[];
  verification: {attempts: unknown[]};
  deploymentTool: {
    name: 'hardhat-ignition';
    deploymentId: string;
    moduleIds: string[];
    versions: Record<string, string>;
  };
  status: 'complete' | 'pending-owner-actions';
  productAliases?: Record<string, string>;
  upgradeHistory?: ManifestUpgrade[];
}

export interface VillageDeploymentContext {
  ethers: any;
  upgrades?: any;
  ignition?: any;
  displayIgnitionUi?: boolean;
  safeProvider?: {request(args: {method: string; params?: readonly unknown[] | object}): Promise<unknown>};
  prepareSafeTransaction?: typeof prepareSafeOwnerActions;
  networkName: string;
  projectRoot?: string;
  outputRoot?: string;
  manifestPathOverride?: string;
  deploymentIdOverride?: string;
  writeManifest?: boolean;
}

export interface DeployVillageResult {
  manifest: VillageDeploymentManifest;
  manifestPath: string;
}

const manifestAddress = z.string().refine(isAddress, 'must be a valid Ethereum address');
const manifestHash = z.string().regex(/^0x[0-9a-fA-F]{64}$/, 'must be a 32-byte hex value');
const manifestHex = z.string().regex(/^0x(?:[0-9a-fA-F]{2})*$/, 'must be an even-length hex value');
const manifestOwner = z.discriminatedUnion('type', [
  z.strictObject({type: z.literal('eoa'), address: manifestAddress}),
  z.strictObject({
    type: z.literal('safe'),
    address: manifestAddress,
    expectedOwners: z.array(manifestAddress).optional(),
    expectedThreshold: z.number().int().positive().optional(),
  }),
]);
const manifestModules = z.strictObject({
  communityToken: z.boolean(),
  presenceToken: z.boolean(),
  sweatToken: z.boolean(),
  tokenizedStays: z.boolean(),
  tdfTransferPolicy: z.boolean(),
  dynamicPriceSale: z.boolean(),
});
const manifestOwnerAction = z.strictObject({
  to: manifestAddress,
  contractName: z.string().min(1),
  functionName: z.string().min(1),
  args: z.array(z.unknown()),
  data: manifestHex,
  reason: z.string().min(1),
});
const manifestManualAction = z.strictObject({
  kind: z.literal('ownership-acceptance'),
  to: manifestAddress,
  contractName: z.string().min(1),
  functionName: z.string().min(1),
  args: z.array(z.unknown()),
  data: manifestHex,
  reason: z.string().min(1),
  recipient: manifestAddress,
  initiatedTransactionHash: manifestHash.optional(),
  acceptAfter: z.string().min(1).optional(),
});
const manifestSafeTransaction = z.strictObject({
  safeAddress: manifestAddress,
  safeTxHash: manifestHash,
  data: z.strictObject({
    to: manifestAddress,
    value: z.string(),
    data: manifestHex,
    operation: z.number().int(),
    safeTxGas: z.string(),
    baseGas: z.string(),
    gasPrice: z.string(),
    gasToken: manifestAddress,
    refundReceiver: manifestAddress,
    nonce: z.number().int().nonnegative(),
  }),
  proposal: z
    .strictObject({
      status: z.enum(['submitted', 'already-submitted']),
      senderAddress: manifestAddress.optional(),
      submittedAt: z.string().min(1),
      txServiceUrl: z.string().min(1).optional(),
      origin: z.string().min(1).optional(),
    })
    .optional(),
  serviceStatus: z
    .strictObject({
      status: z.enum(['awaiting-confirmations', 'ready-to-execute', 'executed', 'failed']),
      checkedAt: z.string().min(1),
      confirmationsSubmitted: z.number().int().nonnegative(),
      confirmationsRequired: z.number().int().nonnegative(),
      isExecuted: z.boolean(),
      isSuccessful: z.boolean().optional(),
      executionTransactionHash: manifestHash.optional(),
      executionDate: z.string().min(1).optional(),
    })
    .optional(),
});
const manifestContract = z.strictObject({
  name: z.string().min(1),
  deploymentName: z.string().min(1),
  address: manifestAddress,
  implementationAddress: manifestAddress.optional(),
  constructorArgs: z.array(z.unknown()).optional(),
  initializerArgs: z.array(z.unknown()).optional(),
  abi: z.array(z.unknown()),
  runtimeCodeHash: manifestHash.optional(),
  implementationRuntimeCodeHash: manifestHash.optional(),
  authority: z.literal('ownerless').optional(),
});
const manifestRoleGrant = z.strictObject({
  role: manifestHash,
  roleName: z.string().min(1),
  account: manifestAddress,
  source: z.enum(['module-derived', 'config']),
});
const manifestUpgrade = z.strictObject({
  contractName: z.string().min(1),
  version: z.string().min(1),
  nextArtifact: z.string().min(1),
  deploymentId: z.string().min(1),
  moduleId: z.string().min(1),
  previousImplementation: manifestAddress,
  newImplementation: manifestAddress,
  status: z.enum(['prepared', 'executed', 'superseded']),
  validatedAt: z.string().min(1),
  callData: manifestHex,
  specHash: manifestHash,
  implementationCodeHash: manifestHash,
  ownerAction: manifestOwnerAction,
  ownerTransaction: manifestSafeTransaction.optional(),
  verification: z.unknown().optional(),
});

/** Strict schema for persisted deployment state; Ignition remains the transaction journal. */
export const VillageDeploymentManifestSchema = z.strictObject({
  schemaVersion: z.literal(4),
  deploymentKind: z.enum(['village', 'profile']),
  villageSlug: z.string().min(1),
  chainId: z.number().int().positive(),
  configSchemaVersion: z.literal(4),
  configHash: manifestHash,
  sourceRevision: z.string().min(1).optional(),
  network: z.string().min(1),
  deploymentProfile: z.enum(['minimal-village', 'token-village', 'tokenized-stays-village', 'tdf']),
  modules: manifestModules,
  contracts: z.record(z.string(), manifestContract),
  compiler: z.strictObject({solidity: z.string().min(1)}),
  openzeppelinVersion: z.string().min(1),
  ownership: z.strictObject({
    mode: z.enum(['direct', 'deployer-handoff']),
    deployer: manifestAddress,
    initialOwner: manifestAddress,
    finalOwner: manifestOwner,
    handoffInitiatedAt: z.string().min(1).optional(),
  }),
  apiOperator: manifestAddress,
  roles: z.strictObject({
    initialGrants: z.array(manifestRoleGrant),
    apiOperatorGrants: z.array(manifestRoleGrant),
  }),
  ownerActions: z.array(manifestOwnerAction),
  ownerTransaction: manifestSafeTransaction.optional(),
  manualActions: z.array(manifestManualAction),
  verification: z.strictObject({attempts: z.array(z.unknown())}),
  deploymentTool: z.strictObject({
    name: z.literal('hardhat-ignition'),
    deploymentId: z.string().min(1),
    moduleIds: z.array(z.string().min(1)),
    versions: z.record(z.string(), z.string()),
  }),
  status: z.enum(['complete', 'pending-owner-actions']),
  productAliases: z.record(z.string(), z.string()).optional(),
  upgradeHistory: z.array(manifestUpgrade).optional(),
});

export function parseVillageDeploymentManifest(value: unknown): VillageDeploymentManifest {
  return VillageDeploymentManifestSchema.parse(value) as VillageDeploymentManifest;
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
} as const;

const ROLE_NAMES_BY_ID = new Map(Object.entries(ROLE_IDS).map(([name, role]) => [role.toLowerCase(), name]));
export const TDF_COMMUNITY_TOKEN_MAX_SUPPLY = 18_600n * 10n ** 18n;
export const TDF_DYNAMIC_PRICE_SALE_CAP = 15_097_500_000_000_000_000_000n;
export const TDF_MINIMUM_PURCHASE = 1n * 10n ** 18n;
export const TDF_MAXIMUM_PURCHASE = 100n * 10n ** 18n;
export const TDF_PURCHASE_GRANULARITY = 1n * 10n ** 18n;
export const TDF_MAXIMUM_RECIPIENT_BALANCE = 915n * 10n ** 18n;
/**
 * 5,381 TDF is the lowest historical V1 quote-vector supply and safely supports the complete
 * configured 1–100 TDF whole-token purchase range. The curve's nominal 4,109 domain is unchanged.
 */
export const TDF_MINIMUM_OPERATING_SUPPLY = 5_381n * 10n ** 18n;
export const TDF_DEFAULT_CLOSER_FEE_BPS = 500;

const MODULE_NAMES = [
  'communityToken',
  'presenceToken',
  'sweatToken',
  'tokenizedStays',
  'tdfTransferPolicy',
  'dynamicPriceSale',
] as const;
/** Combines explicitly selected modules with the modules implied by a named deployment profile. */
export function normalizeModules(config: VillageDeploymentConfig): NormalizedModules {
  const modules: NormalizedModules = {
    communityToken: false,
    presenceToken: false,
    sweatToken: false,
    tokenizedStays: false,
    tdfTransferPolicy: false,
    dynamicPriceSale: false,
  };
  for (const moduleName of config.modules) {
    if (!MODULE_NAMES.includes(moduleName as (typeof MODULE_NAMES)[number])) {
      throw new Error(`Unsupported village module '${moduleName}'`);
    }
    modules[moduleName as keyof NormalizedModules] = true;
  }
  if (config.deploymentProfile === 'token-village') modules.communityToken = true;
  if (config.deploymentProfile === 'tokenized-stays-village') {
    modules.communityToken = true;
    modules.tokenizedStays = true;
  }
  if (config.deploymentProfile === 'tdf') {
    for (const key of MODULE_NAMES) modules[key] = true;
  }
  return modules;
}

export function deploymentKind(profile: DeploymentProfile): 'village' | 'profile' {
  return profile === 'tdf' ? 'profile' : 'village';
}

export function resolvedCloserFeeBps(config: VillageDeploymentConfig): number {
  const configured = config.dynamicPriceSale?.closerFeeBps;
  if (configured !== undefined) return configured;
  if (config.deploymentProfile === 'tdf') return TDF_DEFAULT_CLOSER_FEE_BPS;
  throw new Error('dynamicPriceSale.closerFeeBps is required outside the TDF profile');
}

export function manifestPathFor(config: VillageDeploymentConfig, projectRoot: string): string {
  return config.deploymentProfile === 'tdf'
    ? path.join(projectRoot, 'deployments', 'profiles', 'tdf', String(config.chainId), `${config.villageSlug}.json`)
    : path.join(projectRoot, 'deployments', 'villages', String(config.chainId), `${config.villageSlug}.json`);
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
  // Operational roles required by selected modules are merged with explicit grants and deduplicated by role/account.
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
  for (const grant of config.initialRoleGrants ?? []) {
    grants.push(makeRoleGrant(grant.role, normalizeAddress(grant.account, 'initialRoleGrants.account'), 'config'));
  }
  return dedupeRoleGrants(grants);
}

export function validateVillageDeploymentConfig(
  config: VillageDeploymentConfig,
  networkChainId?: number,
): {modules: NormalizedModules; initialRoleGrants: ResolvedRoleGrant[]} {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(config.villageSlug)) {
    throw new Error(`villageSlug '${config.villageSlug}' is not a stable lowercase deployment slug`);
  }
  if (networkChainId !== undefined && config.chainId !== networkChainId) {
    throw new Error(`Config chainId ${config.chainId} does not match selected network chainId ${networkChainId}`);
  }
  normalizeAddress(config.ownership.finalOwner.address, 'ownership.finalOwner.address');
  normalizeAddress(config.apiOperator, 'apiOperator');
  const modules = normalizeModules(config);
  if (modules.tokenizedStays && !modules.communityToken) throw new Error('tokenizedStays requires communityToken');
  if (modules.dynamicPriceSale && !modules.communityToken) {
    throw new Error('dynamicPriceSale requires communityToken');
  }
  if (config.deploymentProfile === 'tdf' && !config.tdfTransferPolicy?.treasury) {
    throw new Error('tdf requires tdfTransferPolicy.treasury');
  }
  if (modules.communityToken) {
    const initialSupply = BigInt(config.communityToken?.initialSupply ?? 0);
    if (config.communityToken?.maxSupply === undefined) {
      throw new Error('communityToken.maxSupply is required when communityToken is selected');
    }
    const maxSupply = BigInt(config.communityToken.maxSupply);
    if (initialSupply < 0n) throw new Error('communityToken.initialSupply must not be negative');
    if (maxSupply <= 0n) throw new Error('communityToken.maxSupply must be greater than zero');
    if (initialSupply > maxSupply) throw new Error('communityToken.initialSupply cannot exceed maxSupply');
    if (initialSupply > 0n)
      normalizeAddress(config.communityToken?.initialRecipient, 'communityToken.initialRecipient');
    if (config.communityToken?.transferPolicy) {
      normalizeAddress(config.communityToken.transferPolicy, 'communityToken.transferPolicy');
      if (modules.tdfTransferPolicy) {
        throw new Error('communityToken.transferPolicy cannot be set when the deployed TDFTransferPolicy is selected');
      }
    }
    if (config.deploymentProfile === 'tdf' && maxSupply !== TDF_COMMUNITY_TOKEN_MAX_SUPPLY) {
      throw new Error(`tdf requires communityToken.maxSupply ${TDF_COMMUNITY_TOKEN_MAX_SUPPLY}`);
    }
  }
  if (modules.presenceToken && config.presenceToken?.decayRatePerDay === undefined) {
    throw new Error('presenceToken.decayRatePerDay is required when presenceToken is selected');
  }
  if (modules.sweatToken && config.sweatToken?.decayRatePerDay === undefined) {
    throw new Error('sweatToken.decayRatePerDay is required when sweatToken is selected');
  }
  if (modules.tdfTransferPolicy) {
    normalizeAddress(config.tdfTransferPolicy?.treasury, 'tdfTransferPolicy.treasury');
    for (const account of config.tdfTransferPolicy?.allowedCounterparties ?? []) {
      normalizeAddress(account, 'tdfTransferPolicy.allowedCounterparties');
    }
  }
  if (modules.dynamicPriceSale) {
    const sale = config.dynamicPriceSale;
    if (!sale) throw new Error('dynamicPriceSale configuration is required when the module is selected');
    normalizeAddress(sale.quoteToken, 'dynamicPriceSale.quoteToken');
    normalizeAddress(sale.villageTreasury, 'dynamicPriceSale.villageTreasury');
    normalizeAddress(sale.closerFeeRecipient, 'dynamicPriceSale.closerFeeRecipient');
    const closerFeeBps = resolvedCloserFeeBps(config);
    if (!Number.isInteger(closerFeeBps) || closerFeeBps < 0 || closerFeeBps > 10_000) {
      throw new Error('dynamicPriceSale.closerFeeBps must be an integer from 0 through 10000');
    }
    if (config.deploymentProfile === 'tdf') {
      if (sale.bondingCurve) {
        throw new Error('tdf deploys TDFV1BondingCurve automatically; dynamicPriceSale.bondingCurve must be omitted');
      }
    } else {
      normalizeAddress(sale.bondingCurve, 'dynamicPriceSale.bondingCurve');
    }

    const saleCap = BigInt(sale.saleCap);
    const minimumPurchase = BigInt(sale.minimumPurchase);
    const maximumPurchase = BigInt(sale.maximumPurchase);
    const purchaseGranularity = BigInt(sale.purchaseGranularity);
    const maximumRecipientBalance = BigInt(sale.maximumRecipientBalance);
    const initialSupply = BigInt(config.communityToken?.initialSupply ?? 0);
    const maxSupply = BigInt(config.communityToken!.maxSupply!);
    if (saleCap <= 0n || saleCap > maxSupply) {
      throw new Error(
        'dynamicPriceSale.saleCap must be greater than zero and no greater than communityToken.maxSupply',
      );
    }
    if (
      minimumPurchase <= 0n ||
      maximumPurchase < minimumPurchase ||
      purchaseGranularity <= 0n ||
      minimumPurchase % purchaseGranularity !== 0n ||
      maximumPurchase % purchaseGranularity !== 0n ||
      maximumRecipientBalance < minimumPurchase
    ) {
      throw new Error('dynamicPriceSale purchase limits are inconsistent');
    }
    if (initialSupply > saleCap || minimumPurchase > saleCap - initialSupply) {
      throw new Error('dynamicPriceSale launch supply does not leave room for the minimum purchase');
    }
    if (config.deploymentProfile === 'tdf') {
      if (
        saleCap !== TDF_DYNAMIC_PRICE_SALE_CAP ||
        minimumPurchase !== TDF_MINIMUM_PURCHASE ||
        maximumPurchase !== TDF_MAXIMUM_PURCHASE ||
        purchaseGranularity !== TDF_PURCHASE_GRANULARITY ||
        maximumRecipientBalance !== TDF_MAXIMUM_RECIPIENT_BALANCE
      ) {
        throw new Error('tdf dynamicPriceSale limits must match the locked TDF launch configuration');
      }
      if (initialSupply < TDF_MINIMUM_OPERATING_SUPPLY) {
        throw new Error(
          `tdf initial supply must be at least ${TDF_MINIMUM_OPERATING_SUPPLY} so every configured purchase can be quoted`,
        );
      }
    }
  }
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
  const configHash = hashDeploymentConfig(config);
  const manifestPath = context.manifestPathOverride ?? manifestPathFor(config, context.outputRoot ?? projectRoot);
  const existing = await readExistingManifest(manifestPath);
  if (existing) {
    if (existing.configHash !== configHash) throw new Error(`Deployment manifest collision at ${manifestPath}`);
    // Reruns audit the recorded deployment against live state instead of submitting the graph again.
    const reconciled = await reconcileManifest(existing, config, context, initialRoleGrants);
    if (context.writeManifest !== false) await writeVillageDeploymentManifest(manifestPath, reconciled);
    return {manifest: reconciled, manifestPath};
  }

  const [deployer] = await context.ethers.getSigners();
  const deployerAddress = normalizeAddress(deployer.address, 'deployer');
  const finalOwner = normalizeAddress(config.ownership.finalOwner.address, 'ownership.finalOwner.address');
  if (config.ownership.mode === 'deployer-handoff' && finalOwner === deployerAddress) {
    throw new Error('deployer-handoff final owner must differ from the deployer');
  }
  await validateFinalOwner(config.ownership.finalOwner, context);
  if (config.ownership.mode === 'direct' && config.ownership.finalOwner.type === 'eoa') {
    await requireConfiguredSigner(finalOwner, context);
  }
  const initialOwner = config.ownership.mode === 'direct' ? finalOwner : deployerAddress;

  // Handoff mode lets the deployer finish configuration before surrendering authority; direct mode leaves it to finalOwner.
  await validateSelectedImplementations(context, modules, deployer);
  const deployed = await deployVillageIgnitionGraph(
    config,
    context,
    modules,
    initialOwner,
    initialRoleGrants,
    deployerAddress,
  );
  const contracts = deployed.contracts;
  await addCodeProvenance(context, contracts);
  await verifyImplementations(context, contracts);
  await verifyRoles(context, contracts, initialOwner, initialRoleGrants);

  let ownerActions = buildDeploymentOwnerActions(config, modules, contracts, deployed.instances);
  let ownerTransaction: PreparedSafeTransaction | undefined;
  let manualActions: ManualAction[] = [];
  let status: VillageDeploymentManifest['status'];

  if (config.ownership.mode === 'deployer-handoff') {
    ownerActions = await executeOwnerActions(ownerActions, deployer, context);
    if (ownerActions.length > 0) throw new Error('Deployer owner actions did not reach their expected state');
    await verifyCompleteWiring(context, contracts, config);
    manualActions = await initiateOwnershipHandoff(contracts, deployer, deployerAddress, finalOwner, context);
    // "complete" means deployment and deployer-controlled wiring are complete; acceptance steps remain explicit manual actions.
    status = 'complete';
  } else {
    ownerActions = await incompleteOwnerActions(ownerActions, context);
    await verifyModuleWiring(context, contracts, deployed.initializedTransferPolicy, config);
    if (config.ownership.finalOwner.type === 'safe' && ownerActions.length > 0) {
      if (!context.safeProvider) throw new Error('Safe owner actions require an EIP-1193 provider');
      const prepare = context.prepareSafeTransaction ?? prepareSafeOwnerActions;
      ownerTransaction = await prepare(config.ownership.finalOwner, ownerActions, context.safeProvider);
    }
    status = ownerActions.length === 0 ? 'complete' : 'pending-owner-actions';
    if (status === 'complete') await verifyCompleteWiring(context, contracts, config);
  }

  const manifest: VillageDeploymentManifest = {
    schemaVersion: 4,
    deploymentKind: deploymentKind(config.deploymentProfile),
    villageSlug: config.villageSlug,
    chainId: config.chainId,
    configSchemaVersion: 4,
    configHash,
    sourceRevision: process.env.GITHUB_SHA ?? process.env.SOURCE_REVISION,
    network: context.networkName,
    deploymentProfile: config.deploymentProfile,
    modules,
    contracts,
    compiler: {solidity: '0.8.35'},
    openzeppelinVersion: await readOpenZeppelinVersion(projectRoot),
    ownership: {
      mode: config.ownership.mode,
      deployer: deployerAddress,
      initialOwner,
      finalOwner: {...config.ownership.finalOwner, address: finalOwner},
      handoffInitiatedAt: manualActions.length > 0 ? new Date().toISOString() : undefined,
    },
    apiOperator: normalizeAddress(config.apiOperator, 'apiOperator'),
    roles: {
      initialGrants: initialRoleGrants,
      apiOperatorGrants: initialRoleGrants.filter(
        ({account}) => account === normalizeAddress(config.apiOperator, 'apiOperator'),
      ),
    },
    ownerActions,
    ownerTransaction,
    manualActions,
    verification: {attempts: []},
    deploymentTool: {
      name: 'hardhat-ignition',
      deploymentId: deployed.deploymentId,
      moduleIds: deployed.moduleIds,
      versions: await readPackageVersions(projectRoot),
    },
    status,
    productAliases: modules.sweatToken ? {VillageSweatToken: 'ContributionToken'} : undefined,
  };
  if (context.writeManifest !== false) await writeVillageDeploymentManifest(manifestPath, manifest);
  return {manifest, manifestPath};
}

export async function buildSafeOwnerTransaction(
  context: VillageDeploymentContext,
  owner: FinalOwnerConfig,
  _ownerAddress: string,
  actions: PendingOwnerAction[],
): Promise<PreparedSafeTransaction | undefined> {
  if (owner.type !== 'safe' || actions.length === 0) return undefined;
  if (!context.safeProvider) throw new Error('Safe owner actions require an EIP-1193 provider');
  return (context.prepareSafeTransaction ?? prepareSafeOwnerActions)(owner, actions, context.safeProvider);
}

export async function reconcileOwnerActions(
  manifest: VillageDeploymentManifest,
  context: VillageDeploymentContext,
): Promise<VillageDeploymentManifest> {
  if (manifest.ownership.mode !== 'direct') return manifest;
  // Receipts and Safe service status are advisory; completion is derived from each action's onchain postcondition.
  const ownerActions = await incompleteOwnerActions(manifest.ownerActions, context);
  const status = ownerActions.length === 0 ? 'complete' : 'pending-owner-actions';
  let ownerTransaction = manifest.ownerTransaction;
  if (ownerActions.length === 0) ownerTransaction = undefined;
  return {...manifest, ownerActions, ownerTransaction, status};
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
    if (record.implementationAddress)
      await verifyProxyImplementationSlot(context, record.address, record.implementationAddress);
  }
  await verifyRoles(context, reconciled.contracts, reconciled.ownership.initialOwner, initialRoleGrants, true);
  if (reconciled.ownership.mode === 'deployer-handoff') {
    await verifyExpectedHandoffState(reconciled, context);
    await verifyCompleteWiring(context, reconciled.contracts, config);
    reconciled.status = 'complete';
    return reconciled;
  }
  await verifyDirectAuthority(reconciled.contracts, reconciled.ownership.finalOwner.address, context);
  const ownerActions = await incompleteOwnerActions(reconciled.ownerActions, context);
  reconciled.ownerActions = ownerActions;
  reconciled.status = ownerActions.length === 0 ? 'complete' : 'pending-owner-actions';
  if (ownerActions.length === 0) reconciled.ownerTransaction = undefined;
  const expectedPolicy = ownerActions.some(({functionName}) => functionName === 'setTransferPolicy')
    ? ZeroAddress
    : (reconciled.contracts.TDFTransferPolicy?.address ?? config.communityToken?.transferPolicy ?? ZeroAddress);
  if (ownerActions.length === 0) await verifyCompleteWiring(context, reconciled.contracts, config);
  else await verifyModuleWiring(context, reconciled.contracts, expectedPolicy, config);
  return reconciled;
}

/**
 * Builds the ordered policy configuration that depends on addresses resolved after proxy initialization.
 * TokenizedStays is always included as an operational counterparty so deposits and withdrawals work while transfers are restricted.
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

async function verifyDirectAuthority(
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
    } else {
      const ownable = await context.ethers.getContractAt(OWNABLE_ABI, record.address);
      if (getAddress(await ownable.owner()) !== expected) throw new Error(`${name} final owner changed`);
      if (getAddress(await ownable.pendingOwner()) !== ZeroAddress)
        throw new Error(`${name} has an unexpected pending owner`);
    }
  }
}

async function validateFinalOwner(owner: FinalOwnerConfig, context: VillageDeploymentContext): Promise<void> {
  const address = getAddress(owner.address);
  const code = await context.ethers.provider.getCode(address);
  if (owner.type === 'eoa') {
    if (code !== '0x') throw new Error(`EOA final owner ${address} has deployed code`);
    return;
  }
  if (code === '0x') throw new Error(`Safe final owner ${address} has no deployed code`);
  const safe = await context.ethers.getContractAt(SAFE_READ_ABI, address);
  const actualOwners = (await safe.getOwners()).map((value: string) => getAddress(value)).sort();
  const threshold = Number(await safe.getThreshold());
  if (threshold < 1 || threshold > actualOwners.length) throw new Error('Safe final owner has an invalid threshold');
  if (owner.expectedOwners) {
    const expected = owner.expectedOwners.map(getAddress).sort();
    if (JSON.stringify(expected) !== JSON.stringify(actualOwners)) throw new Error('Safe owners do not match config');
  }
  if (owner.expectedThreshold !== undefined && owner.expectedThreshold !== threshold) {
    throw new Error('Safe threshold does not match config');
  }
}

async function requireConfiguredSigner(address: string, context: VillageDeploymentContext): Promise<void> {
  const signers = await context.ethers.getSigners();
  if (!signers.some((signer: {address: string}) => getAddress(signer.address) === address)) {
    throw new Error(`Direct EOA owner ${address} is not available among configured Hardhat signers`);
  }
}

async function verifyRoles(
  context: VillageDeploymentContext,
  contracts: Record<string, ManifestContract>,
  expectedInitialAdmin: string,
  grants: ResolvedRoleGrant[],
  allowAcceptedHandoff = false,
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
}

async function verifyImplementations(
  context: VillageDeploymentContext,
  contracts: Record<string, ManifestContract>,
): Promise<void> {
  for (const record of Object.values(contracts)) {
    if (record.implementationAddress)
      await verifyProxyImplementationSlot(context, record.address, record.implementationAddress);
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
      ],
      contracts.CommunityToken.address,
    );
    if (getAddress(await token.roleAuthority()) !== accessAddress) throw new Error('CommunityToken authority mismatch');
    if (getAddress(await token.transferPolicy()) !== getAddress(expectedPolicy))
      throw new Error('CommunityToken policy mismatch');
    if ((await token.maxSupply()) !== BigInt(config.communityToken!.maxSupply!)) {
      throw new Error('CommunityToken max supply mismatch');
    }
  }
  for (const name of ['VillagePresenceToken', 'VillageSweatToken']) {
    if (!contracts[name]) continue;
    const token = await context.ethers.getContractAt(
      ['function roleAuthority() view returns (address)'],
      contracts[name].address,
    );
    if (getAddress(await token.roleAuthority()) !== accessAddress) throw new Error(`${name} authority mismatch`);
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

function normalizeAddress(value: unknown, field: string): string {
  if (typeof value !== 'string' || !isAddress(value)) throw new Error(`${field} must be a valid address`);
  const address = getAddress(value);
  if (address === ZeroAddress) throw new Error(`${field} must not be the zero address`);
  return address;
}

/** Hashes a canonical representation so object key order cannot change deployment identity. */
function hashDeploymentConfig(config: VillageDeploymentConfig): string {
  return keccak256(toUtf8Bytes(stableStringify(config)));
}

function stableStringify(value: unknown): string {
  // Undefined object fields are omitted like JSON.stringify; array order remains significant by design.
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => left.localeCompare(right));
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

async function readExistingManifest(manifestPath: string): Promise<VillageDeploymentManifest | undefined> {
  try {
    return parseVillageDeploymentManifest(JSON.parse(await readFile(manifestPath, 'utf8')));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  }
}

export async function readVillageDeploymentManifest(manifestPath: string): Promise<VillageDeploymentManifest> {
  const manifest = await readExistingManifest(manifestPath);
  if (!manifest) throw new Error(`Deployment manifest does not exist at ${manifestPath}`);
  return manifest;
}

export async function writeVillageDeploymentManifest(
  manifestPath: string,
  manifest: VillageDeploymentManifest,
): Promise<void> {
  const validated = parseVillageDeploymentManifest(manifest);
  await mkdir(path.dirname(manifestPath), {recursive: true});
  // A same-directory rename avoids exposing partially written JSON to readers.
  const temporaryPath = `${manifestPath}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(validated, null, 2)}\n`);
  await rename(temporaryPath, manifestPath);
}

/** Captures runtime bytecode hashes for canonical proxy addresses and their implementations separately. */
async function addCodeProvenance(
  context: VillageDeploymentContext,
  contracts: Record<string, ManifestContract>,
): Promise<void> {
  for (const record of Object.values(contracts)) {
    record.runtimeCodeHash = keccak256(await context.ethers.provider.getCode(record.address));
    if (record.implementationAddress) {
      record.implementationRuntimeCodeHash = keccak256(
        await context.ethers.provider.getCode(record.implementationAddress),
      );
    }
  }
}

async function readOpenZeppelinVersion(projectRoot: string): Promise<string> {
  const packageJson = JSON.parse(await readFile(path.join(projectRoot, 'package.json'), 'utf8'));
  return (
    packageJson.devDependencies?.['@openzeppelin/contracts'] ??
    packageJson.dependencies?.['@openzeppelin/contracts'] ??
    'unknown'
  );
}

async function readPackageVersions(projectRoot: string): Promise<Record<string, string>> {
  const packageJson = JSON.parse(await readFile(path.join(projectRoot, 'package.json'), 'utf8'));
  const all = {...packageJson.dependencies, ...packageJson.devDependencies};
  return {
    hardhat: all.hardhat ?? 'unknown',
    hardhatIgnition: all['@nomicfoundation/hardhat-ignition'] ?? 'unknown',
    openzeppelinContracts: all['@openzeppelin/contracts'] ?? 'unknown',
    openzeppelinUpgrades: all['@openzeppelin/hardhat-upgrades'] ?? 'unknown',
    safeProtocolKit: all['@safe-global/protocol-kit'] ?? 'unknown',
    safeApiKit: all['@safe-global/api-kit'] ?? 'unknown',
  };
}
