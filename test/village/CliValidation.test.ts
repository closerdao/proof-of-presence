import {spawn} from 'node:child_process';
import {closeSync, mkdtempSync, openSync, readFileSync} from 'node:fs';
import {mkdtemp, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {expect} from 'chai';

function runWorker(script: string, args: readonly string[]): Promise<{code: number | null; output: string}> {
  return new Promise((resolve, reject) => {
    const outputDirectory = mkdtempSync(path.join(tmpdir(), 'cli-validation-output-'));
    const outputPath = path.join(outputDirectory, 'worker.log');
    const outputDescriptor = openSync(outputPath, 'w');
    const child = spawn(process.execPath, ['--import', 'tsx', script, ...args], {
      cwd: process.cwd(),
      timeout: 30_000,
      stdio: ['ignore', outputDescriptor, outputDescriptor],
    });
    child.on('error', (error) => {
      closeSync(outputDescriptor);
      reject(error);
    });
    child.on('close', (code) => {
      closeSync(outputDescriptor);
      resolve({code, output: readFileSync(outputPath, 'utf8')});
    });
  });
}

async function rejectionMessage(promise: Promise<{code: number | null; output: string}>): Promise<string> {
  const result = await promise;
  expect(result.code).not.to.equal(0);
  return result.output;
}

describe('Deployment CLI validation', function () {
  for (const [name, args, expected] of [
    ['unknown argument', ['--typo'], "Unknown argument '--typo'"],
    ['missing config value', ['--config'], '--config requires a value'],
    ['trailing argument', ['--config', 'unused.json', '--typo'], "Unknown argument '--typo'"],
  ] as const) {
    it(`rejects ${name}`, async function () {
      const message = await rejectionMessage(runWorker('scripts/deploy-village.ts', args));
      expect(message).to.include(expected);
    });
  }

  for (const [script, option] of [
    ['scripts/check-safe-transaction.ts', '--tx-service-url'],
    ['scripts/propose-safe-transaction.ts', '--origin'],
    ['scripts/prepare-upgrade.ts', '--call-args'],
    ['scripts/submit-upgrade.ts', '--origin'],
    ['scripts/check-upgrade.ts', '--tx-service-url'],
  ] as const) {
    it(`rejects a missing value for ${option} in ${script}`, async function () {
      const message = await rejectionMessage(runWorker(script, [option]));
      expect(message).to.include(`${option} requires a value`);
    });
  }

  it('does not consume another option as a CLI value', async function () {
    const message = await rejectionMessage(
      runWorker('scripts/submit-upgrade.ts', ['--manifest', '--upgrade', 'VillageAccess:v2']),
    );
    expect(message).to.include('--manifest requires a value');
  });

  it('rejects legacy profile/module configuration before connecting to a network', async function () {
    const root = await mkdtemp(path.join(tmpdir(), 'legacy-deployment-config-'));
    const configPath = path.join(root, 'config.json');
    await writeFile(
      configPath,
      `${JSON.stringify({
        schemaVersion: 1,
        villageSlug: 'legacy-config',
        chainId: 31337,
        deploymentProfile: 'token-village',
        modules: [],
        finalOwner: {type: 'eoa', address: '0x0000000000000000000000000000000000000001'},
        apiOperator: '0x0000000000000000000000000000000000000002',
      })}\n`,
    );
    const message = await rejectionMessage(runWorker('scripts/deploy-village.ts', ['--config', configPath]));
    expect(message).to.match(/schemaVersion|Unrecognized key/);
  });

  it('rejects attempts to override the TDF contract set', async function () {
    const root = await mkdtemp(path.join(tmpdir(), 'tdf-deployment-config-'));
    const configPath = path.join(root, 'config.json');
    await writeFile(
      configPath,
      `${JSON.stringify({
        schemaVersion: 2,
        villageSlug: 'tdf-config',
        chainId: 31337,
        contracts: ['VillageAccess'],
        finalOwner: {type: 'eoa', address: '0x0000000000000000000000000000000000000001'},
        apiOperator: '0x0000000000000000000000000000000000000002',
        communityToken: {
          initialSupply: '5381000000000000000000',
          initialRecipient: '0x0000000000000000000000000000000000000003',
        },
        citizenNft: {baseURI: 'ipfs://citizens/'},
        presenceToken: {decayRatePerDay: '1'},
        sweatToken: {decayRatePerDay: '1'},
        tdfTransferPolicy: {treasury: '0x0000000000000000000000000000000000000004'},
        dynamicPriceSale: {
          quoteToken: '0x0000000000000000000000000000000000000005',
          villageTreasury: '0x0000000000000000000000000000000000000004',
          closerFeeRecipient: '0x0000000000000000000000000000000000000006',
        },
      })}\n`,
    );
    const message = await rejectionMessage(runWorker('scripts/deploy-tdf.ts', ['--config', configPath]));
    expect(message).to.include('Unrecognized key');
  });
});
