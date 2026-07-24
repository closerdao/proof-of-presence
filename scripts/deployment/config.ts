import {isAddress} from 'ethers';
import {z} from 'zod';
import type {VillageDeploymentConfig} from './village.js';

const address = z.string().refine(isAddress, 'must be a valid Ethereum address');
const nonZeroAddress = address.refine((value) => !/^0x0{40}$/i.test(value), 'must not be the zero address');
// Decimal strings preserve values above JavaScript's safe-integer range; small hand-written configs may still use numbers.
const uint = z.union([z.number().int().nonnegative(), z.string().regex(/^\d+$/, 'must be an unsigned integer')]);
const role = z.string().min(1);
const moduleName = z.enum([
  'communityToken',
  'presenceToken',
  'sweatToken',
  'tokenizedStays',
  'tdfTransferPolicy',
  'dynamicPriceSale',
]);

const eoaOwner = z.strictObject({
  type: z.literal('eoa'),
  address: nonZeroAddress,
});

const safeOwner = z.strictObject({
  type: z.literal('safe'),
  address: nonZeroAddress,
  expectedOwners: z.array(nonZeroAddress).optional(),
  expectedThreshold: z.number().int().positive().optional(),
});

const finalOwner = z.discriminatedUnion('type', [eoaOwner, safeOwner]);

/**
 * Strict, versioned schema for untrusted deployment input.
 * Unknown fields are rejected so removed options cannot silently look effective in a production config.
 */
export const VillageDeploymentConfigSchema = z.strictObject({
  schemaVersion: z.literal(4),
  villageSlug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  chainId: z.number().int().positive(),
  deploymentProfile: z.enum(['minimal-village', 'token-village', 'tokenized-stays-village', 'tdf']),
  ownership: z.strictObject({
    mode: z.enum(['direct', 'deployer-handoff']).default('direct'),
    finalOwner,
  }),
  modules: z.array(moduleName).default([]),
  apiOperator: nonZeroAddress,
  communityToken: z
    .strictObject({
      name: z.string().min(1).optional(),
      symbol: z.string().min(1).optional(),
      initialSupply: uint.optional(),
      maxSupply: uint.optional(),
      initialRecipient: nonZeroAddress.optional(),
      transferPolicy: nonZeroAddress.optional(),
      apiOperatorCanMint: z.boolean().optional(),
      minters: z.array(nonZeroAddress).optional(),
    })
    .optional(),
  presenceToken: z
    .strictObject({name: z.string().min(1).optional(), symbol: z.string().min(1).optional(), decayRatePerDay: uint})
    .optional(),
  sweatToken: z
    .strictObject({name: z.string().min(1).optional(), symbol: z.string().min(1).optional(), decayRatePerDay: uint})
    .optional(),
  tdfTransferPolicy: z
    .strictObject({
      treasury: nonZeroAddress,
      allowedCounterparties: z.array(nonZeroAddress).optional(),
      restrictionsEnabled: z.boolean().optional(),
    })
    .optional(),
  dynamicPriceSale: z
    .strictObject({
      quoteToken: nonZeroAddress,
      bondingCurve: nonZeroAddress.optional(),
      villageTreasury: nonZeroAddress,
      closerFeeRecipient: nonZeroAddress,
      closerFeeBps: z.number().int().min(0).max(10_000).optional(),
      saleCap: uint,
      minimumPurchase: uint,
      maximumPurchase: uint,
      purchaseGranularity: uint,
      maximumRecipientBalance: uint,
    })
    .optional(),
  initialRoleGrants: z.array(z.strictObject({role, account: nonZeroAddress})).optional(),
});

export function parseVillageDeploymentConfig(value: unknown): VillageDeploymentConfig {
  return VillageDeploymentConfigSchema.parse(value) as VillageDeploymentConfig;
}
