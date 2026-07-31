import {expect} from 'chai';
import {validateOwnerAuthority} from '../../scripts/deployment/village.js';

const AUTHORITY = '0x00000000000000000000000000000000000000A1';
const OWNER = '0x00000000000000000000000000000000000000B1';

async function rejectionMessage(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  expect.fail('Expected authority validation to reject');
}

describe('Owner authority validation', function () {
  it('accepts an EOA only when it has no deployed code', async function () {
    await validateOwnerAuthority(
      {type: 'eoa', address: AUTHORITY},
      {
        networkName: 'default',
        ethers: {
          provider: {getCode: async () => '0x'},
          getContractAt: async () => {
            throw new Error('Safe interface must not be read for an EOA');
          },
        },
      },
    );
  });

  it('accepts a contract that exposes a valid Safe owner interface', async function () {
    await validateOwnerAuthority(
      {type: 'safe', address: AUTHORITY, expectedOwners: [OWNER], expectedThreshold: 1},
      {
        networkName: 'default',
        ethers: {
          provider: {getCode: async () => '0x6000'},
          getContractAt: async () => ({
            getOwners: async () => [OWNER],
            getThreshold: async () => 1n,
          }),
        },
      },
    );
  });

  it('rejects arbitrary contract authorities before Safe preparation', async function () {
    const message = await rejectionMessage(
      validateOwnerAuthority(
        {type: 'safe', address: AUTHORITY, expectedOwners: [OWNER], expectedThreshold: 1},
        {
          networkName: 'default',
          ethers: {
            provider: {getCode: async () => '0x6000'},
            getContractAt: async () => ({
              getOwners: async () => {
                throw new Error('missing selector');
              },
              getThreshold: async () => 1n,
            }),
          },
        },
      ),
    );
    expect(message).to.include('does not expose the required Safe interface');
  });

  it('rejects Safe owner and threshold mismatches', async function () {
    const context = {
      networkName: 'default',
      ethers: {
        provider: {getCode: async () => '0x6000'},
        getContractAt: async () => ({
          getOwners: async () => [OWNER],
          getThreshold: async () => 1n,
        }),
      },
    };
    expect(
      await rejectionMessage(
        validateOwnerAuthority(
          {
            type: 'safe',
            address: AUTHORITY,
            expectedOwners: ['0x00000000000000000000000000000000000000B2'],
            expectedThreshold: 1,
          },
          context,
        ),
      ),
    ).to.include('Safe owners do not match');
    expect(
      await rejectionMessage(
        validateOwnerAuthority(
          {type: 'safe', address: AUTHORITY, expectedOwners: [OWNER], expectedThreshold: 2},
          context,
        ),
      ),
    ).to.include('Safe threshold does not match');
  });
});
