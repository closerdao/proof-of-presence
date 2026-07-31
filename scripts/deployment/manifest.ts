import {mkdir, readFile, rename, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {isAddress} from 'ethers';
import type {SafeTransactionData} from '@safe-global/types-kit';
import {z} from 'zod';
import {CONTRACT_NAMES, type ContractName, type DeploymentPreset, type FinalOwnerConfig} from './spec.js';

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

export interface BlockReference {
  blockNumber: string;
  blockHash: string;
}

export interface LogReference extends BlockReference {
  transactionHash: string;
  transactionIndex: number;
  logIndex: number;
}

export interface ManifestContract {
  artifact: string;
  kind: 'uups' | 'plain';
  address: string;
  runtimeCodeHash?: string;
  implementation?: {
    address: string;
    runtimeCodeHash?: string;
  };
  authority?: 'ownerless';
}

export interface PreparedSafeTransaction {
  safeAddress: string;
  safeTxHash: string;
  data: SafeTransactionData;
}

export interface ManifestUpgrade {
  contractName: string;
  version: string;
  nextArtifact: string;
  deploymentId: string;
  graphId: string;
  previousImplementation: string;
  newImplementation: string;
  status: 'prepared' | 'executed';
  validatedAt: string;
  callData: string;
  specHash: string;
  implementationCodeHash: string;
  preparedAtBlock: BlockReference;
  executedAt?: LogReference;
  ownerAction: PendingOwnerAction;
  ownerTransaction?: PreparedSafeTransaction;
}

export interface VillageDeploymentManifest {
  schemaVersion: 2;
  villageSlug: string;
  chainId: number;
  configHash: string;
  sourceRevision?: string;
  network: string;
  preset?: DeploymentPreset;
  resolvedContracts: ContractName[];
  deploymentStart: BlockReference;
  contracts: Record<string, ManifestContract>;
  ownership: {
    deployer: string;
    finalOwner: FinalOwnerConfig;
    handoffInitiatedAt?: string;
  };
  handoffTransaction?: PreparedSafeTransaction;
  pendingOwnerActions: ManualAction[];
  graph: {
    id: string;
    deploymentId: string;
  };
  status: 'complete' | 'pending-handoff';
  upgrades?: ManifestUpgrade[];
}

const manifestAddress = z.string().refine(isAddress, 'must be a valid Ethereum address');
const manifestHash = z.string().regex(/^0x[0-9a-fA-F]{64}$/, 'must be a 32-byte hex value');
const manifestHex = z.string().regex(/^0x(?:[0-9a-fA-F]{2})*$/, 'must be an even-length hex value');
const manifestBlockNumber = z.string().regex(/^\d+$/, 'must be a decimal block number');
const manifestBlockReference = z.strictObject({
  blockNumber: manifestBlockNumber,
  blockHash: manifestHash,
});
const manifestLogReference = manifestBlockReference.extend({
  transactionHash: manifestHash,
  transactionIndex: z.number().int().nonnegative(),
  logIndex: z.number().int().nonnegative(),
});
const manifestSafeOwner = z
  .strictObject({
    type: z.literal('safe'),
    address: manifestAddress,
    expectedOwners: z.array(manifestAddress).min(1),
    expectedThreshold: z.number().int().positive(),
  })
  .superRefine((owner, context) => {
    const normalizedOwners = owner.expectedOwners.map((value) => value.toLowerCase());
    if (new Set(normalizedOwners).size !== normalizedOwners.length) {
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
const manifestOwner = z.discriminatedUnion('type', [
  z.strictObject({type: z.literal('eoa'), address: manifestAddress}),
  manifestSafeOwner,
]);
const manifestOwnerAction = z.strictObject({
  to: manifestAddress,
  contractName: z.string().min(1),
  functionName: z.string().min(1),
  args: z.array(z.unknown()),
  data: manifestHex,
  reason: z.string().min(1),
});
const manifestManualAction = manifestOwnerAction.extend({
  kind: z.literal('ownership-acceptance'),
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
    operation: z.literal(0),
    safeTxGas: z.string(),
    baseGas: z.string(),
    gasPrice: z.string(),
    gasToken: manifestAddress,
    refundReceiver: manifestAddress,
    nonce: z.number().int().nonnegative(),
  }),
});
const manifestContract = z.strictObject({
  artifact: z.string().min(1),
  kind: z.enum(['uups', 'plain']),
  address: manifestAddress,
  runtimeCodeHash: manifestHash.optional(),
  implementation: z
    .strictObject({
      address: manifestAddress,
      runtimeCodeHash: manifestHash.optional(),
    })
    .optional(),
  authority: z.literal('ownerless').optional(),
});
const manifestUpgrade = z.strictObject({
  contractName: z.string().min(1),
  version: z.string().min(1),
  nextArtifact: z.string().min(1),
  deploymentId: z.string().min(1),
  graphId: z.string().min(1),
  previousImplementation: manifestAddress,
  newImplementation: manifestAddress,
  status: z.enum(['prepared', 'executed']),
  validatedAt: z.string().min(1),
  callData: manifestHex,
  specHash: manifestHash,
  implementationCodeHash: manifestHash,
  preparedAtBlock: manifestBlockReference,
  executedAt: manifestLogReference.optional(),
  ownerAction: manifestOwnerAction,
  ownerTransaction: manifestSafeTransaction.optional(),
});

/** Strict schema for operational state. Ignition remains the transaction journal. */
export const VillageDeploymentManifestSchema = z.strictObject({
  schemaVersion: z.literal(2),
  villageSlug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  chainId: z.number().int().positive(),
  configHash: manifestHash,
  sourceRevision: z.string().min(1).optional(),
  network: z.string().min(1),
  preset: z.literal('tdf').optional(),
  resolvedContracts: z.array(z.enum(CONTRACT_NAMES)).min(1),
  deploymentStart: manifestBlockReference,
  contracts: z.record(z.string(), manifestContract),
  ownership: z.strictObject({
    deployer: manifestAddress,
    finalOwner: manifestOwner,
    handoffInitiatedAt: z.string().min(1).optional(),
  }),
  handoffTransaction: manifestSafeTransaction.optional(),
  pendingOwnerActions: z.array(manifestManualAction),
  graph: z.strictObject({
    id: z.string().min(1),
    deploymentId: z.string().min(1),
  }),
  status: z.enum(['complete', 'pending-handoff']),
  upgrades: z.array(manifestUpgrade).optional(),
});

export function parseVillageDeploymentManifest(value: unknown): VillageDeploymentManifest {
  return VillageDeploymentManifestSchema.parse(value);
}

export async function readVillageDeploymentManifest(manifestPath: string): Promise<VillageDeploymentManifest> {
  try {
    return parseVillageDeploymentManifest(JSON.parse(await readFile(manifestPath, 'utf8')));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new Error(`Deployment manifest does not exist at ${manifestPath}`);
    }
    throw error;
  }
}

export async function readExistingVillageDeploymentManifest(
  manifestPath: string,
): Promise<VillageDeploymentManifest | undefined> {
  try {
    return parseVillageDeploymentManifest(JSON.parse(await readFile(manifestPath, 'utf8')));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  }
}

export async function writeVillageDeploymentManifest(
  manifestPath: string,
  manifest: VillageDeploymentManifest,
): Promise<void> {
  const validated = parseVillageDeploymentManifest(manifest);
  await mkdir(path.dirname(manifestPath), {recursive: true});
  const temporaryPath = `${manifestPath}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(validated, null, 2)}\n`);
  await rename(temporaryPath, manifestPath);
}
