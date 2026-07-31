import {expect} from 'chai';
import {OperationType} from '@safe-global/types-kit';
import {refreshSafeOwnerActionsStatus} from '../../scripts/deployment/safe-service.js';
import type {PreparedSafeTransaction} from '../../scripts/deployment/village.js';

const SAFE = '0x00000000000000000000000000000000000000A1';
const OTHER_SAFE = '0x00000000000000000000000000000000000000A2';
const SAFE_TX_HASH = `0x${'11'.repeat(32)}`;

function prepared(): PreparedSafeTransaction {
  return {
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
  };
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
  let failure: unknown;
  try {
    await promise;
  } catch (error) {
    failure = error;
  }
  if (failure === undefined) expect.fail(`Expected rejection including '${message}'`);
  expect(failure instanceof Error ? failure.message : String(failure)).to.include(message);
}

describe('Safe owner-action status', function () {
  it('tracks confirmation readiness without deciding on-chain completion', async function () {
    const awaiting = await refreshSafeOwnerActionsStatus(42220, prepared(), {client: client()});
    expect(awaiting).to.include({
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
    const ready = await refreshSafeOwnerActionsStatus(42220, prepared(), {client: readyClient});
    expect(ready.status).to.equal('ready-to-execute');
  });

  it('records successful and failed service execution state', async function () {
    const executed = await refreshSafeOwnerActionsStatus(42220, prepared(), {
      client: client({isExecuted: true, isSuccessful: true, transactionHash: `0x${'22'.repeat(32)}`}),
    });
    expect(executed.status).to.equal('executed');
    const failed = await refreshSafeOwnerActionsStatus(42220, prepared(), {
      client: client({isExecuted: true, isSuccessful: false}),
    });
    expect(failed.status).to.equal('failed');
  });

  it('rejects responses for another Safe or transaction', async function () {
    await expectRejected(
      refreshSafeOwnerActionsStatus(42220, prepared(), {client: client({safe: OTHER_SAFE})}),
      'unexpected Safe address',
    );
    await expectRejected(
      refreshSafeOwnerActionsStatus(42220, prepared(), {
        client: client({safeTxHash: `0x${'33'.repeat(32)}`}),
      }),
      'unexpected transaction hash',
    );
  });
});
