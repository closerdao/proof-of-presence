import {expect} from 'chai';
import {ZeroAddress} from 'ethers';
import {delayedOwnershipAcceptance, submitOwnershipHandoff} from '../../scripts/deployment/handoff.js';
import type {
  ManualAction,
  PendingOwnerAction,
  PreparedSafeTransaction,
  VillageDeploymentManifest,
} from '../../scripts/deployment/village.js';

const DEPLOYER = '0x0000000000000000000000000000000000000001';
const SAFE = '0x0000000000000000000000000000000000000002';
const FIRST_CONTRACT = '0x0000000000000000000000000000000000000011';
const SECOND_CONTRACT = '0x0000000000000000000000000000000000000012';

function action(acceptAfter?: string): ManualAction {
  return {
    kind: 'ownership-acceptance',
    to: '0x0000000000000000000000000000000000000001',
    contractName: 'VillageAccess',
    functionName: 'acceptDefaultAdminTransfer',
    args: [],
    data: '0x',
    reason: 'Complete ownership handoff',
    recipient: '0x0000000000000000000000000000000000000002',
    acceptAfter,
  };
}

describe('Ownership handoff delay validation', function () {
  it('rejects malformed acceptance timestamps', function () {
    expect(() => delayedOwnershipAcceptance([action('not-a-date')], 1_000)).to.throw(
      "VillageAccess has an unparseable acceptAfter 'not-a-date'",
    );
  });

  it('returns only actions whose valid acceptance timestamp is still in the future', function () {
    expect(delayedOwnershipAcceptance([action('1970-01-01T00:16:39.000Z')], 1_000)).to.equal(undefined);
    const delayed = action('1970-01-01T00:16:41.000Z');
    expect(delayedOwnershipAcceptance([delayed], 1_000)).to.equal(delayed);
  });

  it('re-prepares a Safe handoff from only the actions that remain incomplete', async function () {
    const first = {
      ...action(),
      to: FIRST_CONTRACT,
      contractName: 'FirstContract',
      functionName: 'acceptOwnership',
      recipient: SAFE,
    };
    const second = {
      ...action(),
      to: SECOND_CONTRACT,
      contractName: 'SecondContract',
      functionName: 'acceptOwnership',
      recipient: SAFE,
    };
    const stale = safeTransaction('11', 0);
    const fresh = safeTransaction('22', 1);
    const manifest = {
      schemaVersion: 2,
      villageSlug: 'partial-safe-handoff',
      chainId: 31337,
      configHash: `0x${'00'.repeat(32)}`,
      network: 'default',
      resolvedContracts: [],
      deploymentStart: {blockNumber: '1', blockHash: `0x${'00'.repeat(32)}`},
      contracts: {
        FirstContract: {artifact: 'FirstContract', kind: 'plain', address: FIRST_CONTRACT},
        SecondContract: {artifact: 'SecondContract', kind: 'plain', address: SECOND_CONTRACT},
      },
      ownership: {
        deployer: DEPLOYER,
        finalOwner: {
          type: 'safe',
          address: SAFE,
          expectedOwners: [DEPLOYER],
          expectedThreshold: 1,
        },
      },
      handoffTransaction: stale,
      pendingOwnerActions: [first, second],
      graph: {id: 'test', deploymentId: 'test'},
      status: 'pending-handoff',
    } satisfies VillageDeploymentManifest;
    const submittedActions: PendingOwnerAction[][] = [];
    const contractState = new Map([
      [FIRST_CONTRACT, {owner: SAFE, pendingOwner: ZeroAddress}],
      [SECOND_CONTRACT, {owner: DEPLOYER, pendingOwner: SAFE}],
    ]);

    const updated = await submitOwnershipHandoff(
      manifest,
      {
        ethers: {
          getContractAt: async (_abi: unknown, address: string) => {
            const state = contractState.get(address);
            if (!state) throw new Error(`Unexpected contract ${address}`);
            return {
              owner: async () => state.owner,
              pendingOwner: async () => state.pendingOwner,
            };
          },
        },
        networkName: 'default',
        prepareSafeTransaction: async (_owner, actions) => {
          submittedActions.push([...actions]);
          return fresh;
        },
        proposeSafeTransaction: async (_chainId, transaction) => ({
          status: 'submitted',
          transaction,
        }),
      },
      {provider: {} as never, signer: DEPLOYER},
    );

    expect(submittedActions).to.have.length(1);
    expect(submittedActions[0].map((pending) => pending.contractName)).to.deep.equal(['SecondContract']);
    expect(updated.handoffTransaction).to.deep.equal(fresh);
    expect(updated.pendingOwnerActions.map((pending) => pending.contractName)).to.deep.equal(['SecondContract']);
  });
});

function safeTransaction(hashByte: string, nonce: number): PreparedSafeTransaction {
  return {
    safeAddress: SAFE,
    safeTxHash: `0x${hashByte.repeat(32)}`,
    data: {
      to: SAFE,
      value: '0',
      data: '0x',
      operation: 0,
      safeTxGas: '0',
      baseGas: '0',
      gasPrice: '0',
      gasToken: ZeroAddress,
      refundReceiver: ZeroAddress,
      nonce,
    },
  };
}
