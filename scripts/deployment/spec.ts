import {getAddress, isAddress, keccak256, toUtf8Bytes, ZeroAddress} from 'ethers';
import {z} from 'zod';
import {canonicalJsonStringify} from './canonical-json.js';
import {CONTRACT_NAMES, CONTRACT_REGISTRY, type ContractName} from './contract-registry.js';

export {CONTRACT_NAMES, type ContractName} from './contract-registry.js';
export type DeploymentPreset = 'tdf';

export const TDF_CONTRACTS = [...CONTRACT_NAMES] as const;
export const MAX_DECAY_RATE_PER_DAY = 4_399_711n;
const UINT256_MAX = 2n ** 256n - 1n;
export const TDF_COMMUNITY_TOKEN_MAX_SUPPLY = 18_600n * 10n ** 18n;
export const TDF_DYNAMIC_PRICE_SALE_CAP = 15_097_500_000_000_000_000_000n;
export const TDF_MINIMUM_PURCHASE = 1n * 10n ** 18n;
export const TDF_MAXIMUM_PURCHASE = 100n * 10n ** 18n;
export const TDF_PURCHASE_GRANULARITY = 1n * 10n ** 18n;
export const TDF_MAXIMUM_RECIPIENT_BALANCE = 915n * 10n ** 18n;
export const TDF_MINIMUM_OPERATING_SUPPLY = 5_381n * 10n ** 18n;
export const TDF_DEFAULT_CLOSER_FEE_BPS = 500;

export function titleFromSlug(slug: string, suffix: string): string {
  return `${slug
    .split('-')
    .map((part) => part.slice(0, 1).toUpperCase() + part.slice(1))
    .join(' ')} ${suffix}`;
}

export function symbolFromSlug(slug: string): string {
  return slug
    .split('-')
    .map((part) => part.slice(0, 3).toUpperCase())
    .join('')
    .slice(0, 10);
}

const address = z
  .string()
  .refine(isAddress, 'must be a valid Ethereum address')
  .transform((value) => getAddress(value));
const nonZeroAddress = address.refine((value) => value !== ZeroAddress, 'must not be the zero address');
const uint = z
  .string({error: 'must be an unsigned integer encoded as a decimal string'})
  .regex(/^\d+$/, 'must be an unsigned integer encoded as a decimal string')
  .refine((value) => decimalStringAtMost(value, UINT256_MAX), 'must fit in a uint256');
const role = z.string().min(1);
const contractName = z.enum(CONTRACT_NAMES);

const eoaOwner = z.strictObject({
  type: z.literal('eoa'),
  address: nonZeroAddress,
});

const safeOwner = z
  .strictObject({
    type: z.literal('safe'),
    address: nonZeroAddress,
    expectedOwners: z.array(nonZeroAddress).min(1),
    expectedThreshold: z.number().int().positive(),
  })
  .superRefine((owner, context) => {
    if (new Set(owner.expectedOwners).size !== owner.expectedOwners.length) {
      context.addIssue({
        code: 'custom',
        path: ['expectedOwners'],
        message: 'must not contain duplicate owners',
      });
    }
    if (owner.expectedThreshold > owner.expectedOwners.length) {
      context.addIssue({
        code: 'custom',
        path: ['expectedThreshold'],
        message: 'must not exceed the number of expected owners',
      });
    }
  });

const finalOwner = z.discriminatedUnion('type', [eoaOwner, safeOwner]);
const roleGrant = z.strictObject({role, account: nonZeroAddress});
const citizenNft = z.strictObject({
  name: z.string().min(1).optional(),
  symbol: z.string().min(1).optional(),
  baseURI: z.string().min(1),
  operators: z.array(nonZeroAddress).optional(),
});
const decayingToken = z.strictObject({
  name: z.string().min(1).optional(),
  symbol: z.string().min(1).optional(),
  decayRatePerDay: uint.refine(
    (value) => decimalStringAtMost(value, MAX_DECAY_RATE_PER_DAY),
    `must not exceed ${MAX_DECAY_RATE_PER_DAY}`,
  ),
});

function decimalStringAtMost(value: string, maximum: bigint): boolean {
  return /^\d+$/.test(value) && BigInt(value) <= maximum;
}
const tdfTransferPolicy = z.strictObject({
  treasury: nonZeroAddress,
  allowedCounterparties: z.array(nonZeroAddress).optional(),
  restrictionsEnabled: z.boolean().optional(),
});

const commonFields = {
  schemaVersion: z.literal(2),
  villageSlug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  chainId: z.number().int().positive(),
  finalOwner,
  apiOperator: nonZeroAddress,
  citizenNft: citizenNft.optional(),
  presenceToken: decayingToken.optional(),
  sweatToken: decayingToken.optional(),
  tdfTransferPolicy: tdfTransferPolicy.optional(),
  initialRoleGrants: z.array(roleGrant).optional(),
};

export const VillageDeploymentConfigSchema = z.strictObject({
  ...commonFields,
  contracts: z.array(contractName).min(1),
  communityToken: z
    .strictObject({
      name: z.string().min(1).optional(),
      symbol: z.string().min(1).optional(),
      initialSupply: uint.optional(),
      maxSupply: uint,
      initialRecipient: nonZeroAddress.optional(),
      transferPolicy: nonZeroAddress.optional(),
      apiOperatorCanMint: z.boolean().optional(),
      minters: z.array(nonZeroAddress).optional(),
    })
    .optional(),
  dynamicPriceSale: z
    .strictObject({
      quoteToken: nonZeroAddress,
      bondingCurve: nonZeroAddress,
      villageTreasury: nonZeroAddress,
      closerFeeRecipient: nonZeroAddress,
      closerFeeBps: z.number().int().min(0).max(10_000),
      saleCap: uint,
      minimumPurchase: uint,
      maximumPurchase: uint,
      purchaseGranularity: uint,
      maximumRecipientBalance: uint,
    })
    .optional(),
});

export const TdfDeploymentConfigSchema = z.strictObject({
  ...commonFields,
  communityToken: z.strictObject({
    name: z.string().min(1).optional(),
    symbol: z.string().min(1).optional(),
    initialSupply: uint,
    initialRecipient: nonZeroAddress,
    apiOperatorCanMint: z.boolean().optional(),
    minters: z.array(nonZeroAddress).optional(),
  }),
  citizenNft,
  presenceToken: decayingToken,
  sweatToken: decayingToken,
  tdfTransferPolicy,
  dynamicPriceSale: z.strictObject({
    quoteToken: nonZeroAddress,
    villageTreasury: nonZeroAddress,
    closerFeeRecipient: nonZeroAddress,
  }),
});

export type VillageDeploymentInput = z.infer<typeof VillageDeploymentConfigSchema>;
export type TdfDeploymentInput = z.infer<typeof TdfDeploymentConfigSchema>;
export type FinalOwnerConfig = z.infer<typeof finalOwner>;
export type EoaOwnerConfig = Extract<FinalOwnerConfig, {type: 'eoa'}>;
export type SafeOwnerConfig = Extract<FinalOwnerConfig, {type: 'safe'}>;
export type CommunityTokenConfig = ResolvedDeploymentSpec['communityToken'];
export type CitizenNftConfig = z.infer<typeof citizenNft>;
export type DecayingTokenConfig = z.infer<typeof decayingToken>;
export type TdfTransferPolicyConfig = z.infer<typeof tdfTransferPolicy>;
export type DynamicPriceSaleConfig = ResolvedDeploymentSpec['dynamicPriceSale'];
export type RoleGrantConfig = z.infer<typeof roleGrant>;

export interface ResolvedDeploymentSpec extends Omit<
  VillageDeploymentInput,
  'contracts' | 'communityToken' | 'dynamicPriceSale'
> {
  requestedContracts: ContractName[];
  contracts: ContractName[];
  preset?: DeploymentPreset;
  communityToken?: {
    name?: string;
    symbol?: string;
    initialSupply?: string;
    maxSupply: string;
    initialRecipient?: string;
    transferPolicy?: string;
    apiOperatorCanMint?: boolean;
    minters?: string[];
  };
  dynamicPriceSale?: {
    quoteToken: string;
    bondingCurve?: string;
    villageTreasury: string;
    closerFeeRecipient: string;
    closerFeeBps: number;
    saleCap: string;
    minimumPurchase: string;
    maximumPurchase: string;
    purchaseGranularity: string;
    maximumRecipientBalance: string;
  };
}

export interface ContractSelection {
  villageAccess: boolean;
  communityToken: boolean;
  presenceToken: boolean;
  sweatToken: boolean;
  tokenizedStays: boolean;
  tdfTransferPolicy: boolean;
  citizenNft: boolean;
  dynamicPriceSale: boolean;
}

export function parseVillageDeploymentConfig(value: unknown): ResolvedDeploymentSpec {
  const input = VillageDeploymentConfigSchema.parse(value);
  const contracts = resolveContractDependencies(input.contracts);
  const spec: ResolvedDeploymentSpec = {
    ...input,
    requestedContracts: canonicalContractOrder(input.contracts),
    contracts,
  };
  validateResolvedDeploymentSpec(spec);
  return spec;
}

export function parseTdfDeploymentConfig(value: unknown): ResolvedDeploymentSpec {
  const input = TdfDeploymentConfigSchema.parse(value);
  const spec: ResolvedDeploymentSpec = {
    ...input,
    preset: 'tdf',
    requestedContracts: [...TDF_CONTRACTS],
    contracts: [...TDF_CONTRACTS],
    communityToken: {
      ...input.communityToken,
      maxSupply: TDF_COMMUNITY_TOKEN_MAX_SUPPLY.toString(),
    },
    dynamicPriceSale: {
      ...input.dynamicPriceSale,
      closerFeeBps: TDF_DEFAULT_CLOSER_FEE_BPS,
      saleCap: TDF_DYNAMIC_PRICE_SALE_CAP.toString(),
      minimumPurchase: TDF_MINIMUM_PURCHASE.toString(),
      maximumPurchase: TDF_MAXIMUM_PURCHASE.toString(),
      purchaseGranularity: TDF_PURCHASE_GRANULARITY.toString(),
      maximumRecipientBalance: TDF_MAXIMUM_RECIPIENT_BALANCE.toString(),
    },
  };
  validateResolvedDeploymentSpec(spec);
  return spec;
}

export function resolveContractDependencies(requested: readonly ContractName[]): ContractName[] {
  const resolved = new Set<ContractName>();
  const visit = (name: ContractName): void => {
    for (const dependency of CONTRACT_REGISTRY[name].dependencies) visit(dependency);
    resolved.add(name);
  };
  for (const name of requested) visit(name);
  return canonicalContractOrder(resolved);
}

export function dependencyAdditions(spec: ResolvedDeploymentSpec): ContractName[] {
  const requested = new Set(spec.requestedContracts);
  return spec.contracts.filter((name) => !requested.has(name));
}

export function contractSelection(spec: ResolvedDeploymentSpec): ContractSelection {
  const selected = new Set(spec.contracts);
  return {
    villageAccess: selected.has('VillageAccess'),
    communityToken: selected.has('CommunityToken'),
    presenceToken: selected.has('VillagePresenceToken'),
    sweatToken: selected.has('VillageSweatToken'),
    tokenizedStays: selected.has('TokenizedStays'),
    tdfTransferPolicy: selected.has('TDFTransferPolicy'),
    citizenNft: selected.has('VillageCitizenNFT'),
    dynamicPriceSale: selected.has('DynamicPriceSale'),
  };
}

export function graphHashForContracts(contracts: readonly ContractName[], preset?: DeploymentPreset): string {
  return keccak256(
    toUtf8Bytes(
      canonicalJsonStringify({
        schemaVersion: 2,
        contracts: canonicalContractOrder(contracts),
        preset,
      }),
    ),
  );
}

export function graphIdForSpec(spec: ResolvedDeploymentSpec): string {
  return `VillageGraph_v2_${graphHashForContracts(spec.contracts, spec.preset).slice(2)}`;
}

export function hashResolvedDeploymentSpec(spec: ResolvedDeploymentSpec): string {
  return keccak256(toUtf8Bytes(canonicalJsonStringify(spec)));
}

function canonicalContractOrder(contracts: Iterable<ContractName>): ContractName[] {
  const selected = new Set(contracts);
  return CONTRACT_NAMES.filter((name) => selected.has(name));
}

function validateResolvedDeploymentSpec(spec: ResolvedDeploymentSpec): void {
  const selected = new Set(spec.contracts);
  requireConfig(selected, 'CommunityToken', 'communityToken', spec.communityToken);
  requireConfig(selected, 'VillageCitizenNFT', 'citizenNft', spec.citizenNft);
  requireConfig(selected, 'VillagePresenceToken', 'presenceToken', spec.presenceToken);
  requireConfig(selected, 'VillageSweatToken', 'sweatToken', spec.sweatToken);
  requireConfig(selected, 'TDFTransferPolicy', 'tdfTransferPolicy', spec.tdfTransferPolicy);
  requireConfig(selected, 'DynamicPriceSale', 'dynamicPriceSale', spec.dynamicPriceSale);

  if (!selected.has('VillageAccess') && (spec.initialRoleGrants?.length ?? 0) > 0) {
    throw new Error('initialRoleGrants require VillageAccess');
  }

  const initialSupply = BigInt(spec.communityToken?.initialSupply ?? 0);
  if (selected.has('CommunityToken')) {
    const maxSupply = BigInt(spec.communityToken!.maxSupply);
    if (maxSupply <= 0n) throw new Error('communityToken.maxSupply must be greater than zero');
    if (initialSupply > maxSupply) throw new Error('communityToken.initialSupply cannot exceed maxSupply');
    if (initialSupply > 0n && !spec.communityToken?.initialRecipient) {
      throw new Error('communityToken.initialRecipient is required when initialSupply is non-zero');
    }
    if (spec.communityToken?.transferPolicy && selected.has('TDFTransferPolicy')) {
      throw new Error('communityToken.transferPolicy cannot be set when TDFTransferPolicy is deployed');
    }
  }

  if (selected.has('DynamicPriceSale')) {
    const sale = spec.dynamicPriceSale!;
    const maxSupply = BigInt(spec.communityToken!.maxSupply);
    const saleCap = BigInt(sale.saleCap);
    const minimumPurchase = BigInt(sale.minimumPurchase);
    const maximumPurchase = BigInt(sale.maximumPurchase);
    const purchaseGranularity = BigInt(sale.purchaseGranularity);
    const maximumRecipientBalance = BigInt(sale.maximumRecipientBalance);
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
  }

  if (spec.preset === 'tdf' && initialSupply < TDF_MINIMUM_OPERATING_SUPPLY) {
    throw new Error(
      `tdf initial supply must be at least ${TDF_MINIMUM_OPERATING_SUPPLY} so every configured purchase can be quoted`,
    );
  }
}

function requireConfig(
  selected: ReadonlySet<ContractName>,
  contract: ContractName,
  field: string,
  value: unknown,
): void {
  if (selected.has(contract) && value === undefined) {
    throw new Error(`${field} configuration is required when ${contract} is selected`);
  }
  if (!selected.has(contract) && value !== undefined) {
    throw new Error(`${field} configuration is unused because ${contract} is not selected`);
  }
}
