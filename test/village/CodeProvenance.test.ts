import {expect} from 'chai';
import {captureCodeProvenance, type ManifestContract} from '../../scripts/deployment/village.js';

const PROXY = '0x00000000000000000000000000000000000000A1';
const IMPLEMENTATION = '0x00000000000000000000000000000000000000A2';

async function rejectionMessage(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  expect.fail('Expected code provenance capture to reject');
}

function context(getCode: (address: string) => Promise<string>) {
  return {networkName: 'default', ethers: {provider: {getCode}}};
}

describe('Deployment code provenance', function () {
  it('rejects a canonical contract address without runtime code', async function () {
    const contracts: Record<string, ManifestContract> = {
      Example: {artifact: 'Example', kind: 'plain', address: PROXY},
    };
    const message = await rejectionMessage(
      captureCodeProvenance(
        context(async () => '0x'),
        contracts,
      ),
    );
    expect(message).to.include(`Deployed contract Example at ${PROXY} has no runtime code`);
    expect(contracts.Example.runtimeCodeHash).to.equal(undefined);
  });

  it('rejects an implementation address without runtime code', async function () {
    const contracts: Record<string, ManifestContract> = {
      Example: {
        artifact: 'Example',
        kind: 'uups',
        address: PROXY,
        implementation: {address: IMPLEMENTATION},
      },
    };
    const message = await rejectionMessage(
      captureCodeProvenance(
        context(async (address) => (address === PROXY ? '0x6000' : '0x')),
        contracts,
      ),
    );
    expect(message).to.include(`Implementation for Example at ${IMPLEMENTATION} has no runtime code`);
    expect(contracts.Example.implementation?.runtimeCodeHash).to.equal(undefined);
  });
});
