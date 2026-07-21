import {expect} from 'chai';
import {OperationType} from '@safe-global/types-kit';
import {refreshSafeOwnerActionsStatus} from '../../scripts/deployment/safe-service.js';
import type {VillageDeploymentManifest} from '../../scripts/deployment/village.js';

const SAFE = '0x00000000000000000000000000000000000000A1';
const OTHER_SAFE = '0x00000000000000000000000000000000000000A2';
const SAFE_TX_HASH = `0x${'11'.repeat(32)}`;

function manifest(): VillageDeploymentManifest {
  return {
    chainId: 42220,
    ownerActions: [{to: SAFE, contractName: 'Test', functionName: 'test', args: [], data: '0x', reason: 'test'}],
    ownerTransaction: {
      safeAddress: SAFE,
      safeTxHash: SAFE_TX_HASH,
      data: {
        to: SAFE,
        value: '0',
        data: '0x',
        operation: OperationType.Call,
        safeTxGas: '0',
        baseGas: '0',
        gasPrice: '0',
        gasToken: '0x0000000000000000000000000000000000000000',
        refundReceiver: '0x0000000000000000000000000000000000000000',
        nonce: 0,
      },
    },
  } as unknown as VillageDeploymentManifest;
}

function client(overrides: Record<string, unknown> = {}) {
  return {
    getTransaction: async () => ({
      safe: SAFE,
      safeTxHash: SAFE_TX_HASH,
      confirmationsRequired: 2,
      isExecuted: false,
      isSuccessful: null,
      transactionHash: null,
      executionDate: null,
      ...overrides,
    }),
    getTransactionConfirmations: async () => ({
      count: 1,
      results: [{owner: '0x00000000000000000000000000000000000000B1'}],
    }),
    proposeTransaction: async () => undefined,
  };
}

async function expectRejected(promise: Promise<unknown>, message: string): Promise<void> {
  try {
    await promise;
    expect.fail(`Expected '${message}'`);
  } catch (error) {
    expect(error instanceof Error ? error.message : String(error)).to.include(message);
  }
}

describe('Safe owner-action status', function () {
  it('tracks confirmation readiness without deciding on-chain completion', async function () {
    const awaiting = await refreshSafeOwnerActionsStatus(manifest(), {client: client()});
    expect(awaiting.ownerTransaction?.serviceStatus).to.include({
      status: 'awaiting-confirmations',
      confirmationsSubmitted: 1,
      confirmationsRequired: 2,
    });

    const readyClient = client();
    readyClient.getTransactionConfirmations = async () => ({
      count: 2,
      results: [
        {owner: '0x00000000000000000000000000000000000000B1'},
        {owner: '0x00000000000000000000000000000000000000B2'},
      ],
    });
    const ready = await refreshSafeOwnerActionsStatus(manifest(), {client: readyClient});
    expect(ready.ownerTransaction?.serviceStatus?.status).to.equal('ready-to-execute');
  });

  it('records successful and failed service execution state', async function () {
    const executed = await refreshSafeOwnerActionsStatus(manifest(), {
      client: client({isExecuted: true, isSuccessful: true, transactionHash: `0x${'22'.repeat(32)}`}),
    });
    expect(executed.ownerTransaction?.serviceStatus?.status).to.equal('executed');
    const failed = await refreshSafeOwnerActionsStatus(manifest(), {
      client: client({isExecuted: true, isSuccessful: false}),
    });
    expect(failed.ownerTransaction?.serviceStatus?.status).to.equal('failed');
  });

  it('rejects responses for another Safe or transaction', async function () {
    await expectRejected(
      refreshSafeOwnerActionsStatus(manifest(), {client: client({safe: OTHER_SAFE})}),
      'unexpected Safe address',
    );
    await expectRejected(
      refreshSafeOwnerActionsStatus(manifest(), {client: client({safeTxHash: `0x${'33'.repeat(32)}`})}),
      'unexpected transaction hash',
    );
  });
});
