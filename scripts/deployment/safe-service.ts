import * as SafeApiKitModule from '@safe-global/api-kit';
import * as SafeProtocolKitModule from '@safe-global/protocol-kit';
import {HttpError} from '@safe-global/api-kit';
import {EthSafeTransaction} from '@safe-global/protocol-kit';
import type {ProposeTransactionProps, SafeApiKitConfig} from '@safe-global/api-kit';
import type {SafeConfig} from '@safe-global/protocol-kit';
import type {MetaTransactionData, SafeTransactionData} from '@safe-global/types-kit';
import {getAddress} from 'ethers';
import type {
  PendingOwnerAction,
  PreparedSafeTransaction,
  SafeOwnerConfig,
  VillageDeploymentManifest,
} from './village.js';

interface SafeServiceTransaction {
  safe: string;
  safeTxHash: string;
  confirmationsRequired: number;
  isExecuted: boolean;
  isSuccessful: boolean | null;
  transactionHash: string | null;
  executionDate: string | null;
}

interface SafeServiceConfirmations {
  count: number;
  results: Array<{owner: string}>;
}

interface SafeApiKitInstance {
  getTransaction(safeTxHash: string): Promise<SafeServiceTransaction>;
  getTransactionConfirmations(safeTxHash: string): Promise<SafeServiceConfirmations>;
  proposeTransaction(config: ProposeTransactionProps): Promise<void>;
}

interface SafeProtocolKitInstance {
  createTransaction(config: {transactions: MetaTransactionData[]; onlyCalls?: boolean}): Promise<EthSafeTransaction>;
  getTransactionHash(transaction: EthSafeTransaction): Promise<string>;
  getSafeProvider(): {getSignerAddress(): Promise<string | undefined>};
  getOwners(): Promise<string[]>;
  signHash(hash: string): Promise<{data: string}>;
}

const SafeApiKit = (
  SafeApiKitModule as unknown as {
    default: new (config: SafeApiKitConfig) => SafeApiKitInstance;
  }
).default;
const Safe = (
  SafeProtocolKitModule as unknown as {
    default: {init(config: SafeConfig): Promise<SafeProtocolKitInstance>};
  }
).default;

export interface SafeProposalOptions {
  provider: {request(args: {method: string; params?: readonly unknown[] | object}): Promise<unknown>} | string;
  signer: string;
  apiKey?: string;
  txServiceUrl?: string;
  origin?: string;
}

export interface SafeServiceOptions {
  apiKey?: string;
  txServiceUrl?: string;
  client?: SafeApiKitInstance;
}

/**
 * Uses Protocol Kit as the single source of Safe batching, nonce selection, and hashing.
 * The actions become one atomic call-only Safe transaction; no delegate calls are permitted.
 */
export async function prepareSafeOwnerActions(
  owner: SafeOwnerConfig,
  actions: PendingOwnerAction[],
  provider: SafeProposalOptions['provider'],
): Promise<PreparedSafeTransaction | undefined> {
  if (actions.length === 0) return undefined;
  const safeAddress = getAddress(owner.address);
  const protocolKit = await Safe.init({provider, safeAddress});
  const transactions: MetaTransactionData[] = actions.map(({to, data}) => ({to: getAddress(to), value: '0', data}));
  const transaction = await protocolKit.createTransaction({transactions, onlyCalls: true});
  return {
    safeAddress,
    safeTxHash: await protocolKit.getTransactionHash(transaction),
    data: transaction.data as SafeTransactionData,
  };
}

/** Proposes, but never executes, an already prepared Safe owner-action transaction. */
export async function proposeSafeOwnerActions(
  manifest: VillageDeploymentManifest,
  options: SafeProposalOptions,
): Promise<VillageDeploymentManifest> {
  const prepared = manifest.ownerTransaction;
  if (!prepared || manifest.ownerActions.length === 0) {
    throw new Error('Manifest has no pending Safe owner-action transaction to propose');
  }

  const safeAddress = getAddress(prepared.safeAddress);
  const protocolKit = await Safe.init({provider: options.provider, signer: options.signer, safeAddress});
  const safeTransaction = new EthSafeTransaction(prepared.data);
  const calculatedHash = await protocolKit.getTransactionHash(safeTransaction);
  if (calculatedHash.toLowerCase() !== prepared.safeTxHash.toLowerCase()) {
    throw new Error(`Prepared Safe transaction hash mismatch: expected ${prepared.safeTxHash}, got ${calculatedHash}`);
  }

  const apiKit = new SafeApiKit({
    chainId: BigInt(manifest.chainId),
    apiKey: options.apiKey,
    txServiceUrl: options.txServiceUrl,
  });
  try {
    // Looking up the prepared hash first makes repeated proposal commands idempotent.
    const existing = await apiKit.getTransaction(prepared.safeTxHash);
    const confirmations = await apiKit.getTransactionConfirmations(prepared.safeTxHash);
    return withServiceStatus(
      withProposal(manifest, {
        status: 'already-submitted',
        submittedAt: new Date().toISOString(),
        txServiceUrl: options.txServiceUrl,
        origin: options.origin,
      }),
      existing,
      confirmations,
    );
  } catch (error) {
    if (!(error instanceof HttpError) || error.statusCode !== 404) throw error;
  }

  const senderAddress = await protocolKit.getSafeProvider().getSignerAddress();
  if (!senderAddress) throw new Error('Safe proposer signer address could not be resolved');
  const normalizedSender = getAddress(senderAddress);
  const owners = (await protocolKit.getOwners()).map(getAddress);
  if (!owners.includes(normalizedSender)) throw new Error(`${normalizedSender} is not an owner of ${safeAddress}`);

  const signature = await protocolKit.signHash(prepared.safeTxHash);
  await apiKit.proposeTransaction({
    safeAddress,
    safeTransactionData: prepared.data,
    safeTxHash: prepared.safeTxHash,
    senderAddress: normalizedSender,
    senderSignature: signature.data,
    origin: options.origin,
  });

  const proposed = withProposal(manifest, {
    status: 'submitted',
    senderAddress: normalizedSender,
    submittedAt: new Date().toISOString(),
    txServiceUrl: options.txServiceUrl,
    origin: options.origin,
  });
  try {
    return withServiceStatus(
      proposed,
      await apiKit.getTransaction(prepared.safeTxHash),
      await apiKit.getTransactionConfirmations(prepared.safeTxHash),
    );
  } catch (error) {
    if (error instanceof HttpError && error.statusCode === 404) return proposed;
    throw error;
  }
}

/**
 * Records a Transaction Service snapshot for operator visibility.
 * Callers must still reconcile action postconditions onchain before marking the deployment complete.
 */
export async function refreshSafeOwnerActionsStatus(
  manifest: VillageDeploymentManifest,
  options: SafeServiceOptions,
): Promise<VillageDeploymentManifest> {
  const prepared = manifest.ownerTransaction;
  if (!prepared) throw new Error('Manifest has no prepared Safe owner-action transaction');
  const apiKit =
    options.client ??
    new SafeApiKit({
      chainId: BigInt(manifest.chainId),
      apiKey: options.apiKey,
      txServiceUrl: options.txServiceUrl,
    });
  return withServiceStatus(
    manifest,
    await apiKit.getTransaction(prepared.safeTxHash),
    await apiKit.getTransactionConfirmations(prepared.safeTxHash),
  );
}

function withProposal(
  manifest: VillageDeploymentManifest,
  proposal: NonNullable<PreparedSafeTransaction['proposal']>,
): VillageDeploymentManifest {
  return {
    ...manifest,
    ownerTransaction: manifest.ownerTransaction ? {...manifest.ownerTransaction, proposal} : undefined,
  };
}

/** Validates the service response belongs to the prepared transaction before attaching its advisory status. */
function withServiceStatus(
  manifest: VillageDeploymentManifest,
  transaction: SafeServiceTransaction,
  confirmations: SafeServiceConfirmations,
): VillageDeploymentManifest {
  const prepared = manifest.ownerTransaction;
  if (!prepared) throw new Error('Manifest has no prepared Safe owner-action transaction');
  if (transaction.safeTxHash.toLowerCase() !== prepared.safeTxHash.toLowerCase()) {
    throw new Error(`Safe Transaction Service returned an unexpected transaction hash ${transaction.safeTxHash}`);
  }
  if (getAddress(transaction.safe) !== getAddress(prepared.safeAddress)) {
    throw new Error(`Safe Transaction Service returned an unexpected Safe address ${transaction.safe}`);
  }

  const confirmationsSubmitted = new Set(confirmations.results.map(({owner}) => getAddress(owner))).size;
  const isSuccessful = transaction.isSuccessful ?? undefined;
  const status = transaction.isExecuted
    ? isSuccessful === false
      ? 'failed'
      : 'executed'
    : confirmationsSubmitted >= transaction.confirmationsRequired
      ? 'ready-to-execute'
      : 'awaiting-confirmations';

  return {
    ...manifest,
    ownerTransaction: {
      ...prepared,
      serviceStatus: {
        status,
        checkedAt: new Date().toISOString(),
        confirmationsSubmitted,
        confirmationsRequired: transaction.confirmationsRequired,
        isExecuted: transaction.isExecuted,
        isSuccessful,
        executionTransactionHash: transaction.transactionHash ?? undefined,
        executionDate: transaction.executionDate ?? undefined,
      },
    },
  };
}
