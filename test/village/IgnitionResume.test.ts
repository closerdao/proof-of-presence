import {mkdtemp, readFile, unlink, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {expect} from 'chai';
import {HDNodeWallet, Mnemonic} from 'ethers';
import hre from 'hardhat';
import {runTsxWorker} from '../helpers/child-process.js';

const mnemonic = Mnemonic.fromPhrase('test test test test test test test test test test test junk');

function account(index: number): string {
  return HDNodeWallet.fromMnemonic(mnemonic, `m/44'/60'/0'/0/${index}`).address;
}

describe('Ignition HTTP-network recovery', function () {
  it('recreates a missing product manifest from the existing Ignition journal', async function () {
    const root = await mkdtemp(path.join(tmpdir(), 'village-ignition-resume-'));
    const ignitionRoot = path.join(root, 'ignition');
    const server = await hre.network.createServer(
      {network: 'default', override: {accounts: {mnemonic: mnemonic.phrase}}},
      '127.0.0.1',
      0,
    );
    const {address, port} = await server.listen();
    const env = {
      ...process.env,
      IGNITION_ROOT: ignitionRoot,
      LOCALHOST_RPC_URL: `http://${address}:${port}`,
      LOCALHOST_MNEMONIC: mnemonic.phrase,
    };

    try {
      const config = {
        schemaVersion: 3,
        villageSlug: 'ignition-resume-test',
        chainId: 31337,
        deploymentProfile: 'token-village',
        ownership: {mode: 'direct', finalOwner: {type: 'eoa', address: account(1)}},
        modules: [],
        apiOperator: account(2),
      };
      const configPath = path.join(root, 'config.json');
      await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`);
      const workerArgs = ['--config', configPath, '--network', 'localhost', '--output-root', root];

      await runTsxWorker('scripts/deploy-village.ts', workerArgs, {cwd: process.cwd(), env});
      const manifestPath = path.join(root, 'deployments', 'villages', '31337', 'ignition-resume-test.json');
      const first = JSON.parse(await readFile(manifestPath, 'utf8'));
      const journalPath = path.join(ignitionRoot, 'deployments', first.deploymentTool.deploymentId, 'journal.jsonl');
      const firstJournal = await readFile(journalPath, 'utf8');
      const firstConfirmations = firstJournal.split('"TRANSACTION_CONFIRM"').length - 1;

      // Simulate a worker crash after Ignition completed but before the product
      // manifest was durably published.
      await unlink(manifestPath);
      await runTsxWorker('scripts/deploy-village.ts', workerArgs, {cwd: process.cwd(), env});
      const resumed = JSON.parse(await readFile(manifestPath, 'utf8'));
      const resumedJournal = await readFile(journalPath, 'utf8');
      const resumedConfirmations = resumedJournal.split('"TRANSACTION_CONFIRM"').length - 1;

      expect(resumed.contracts.VillageAccess.address).to.equal(first.contracts.VillageAccess.address);
      expect(resumed.contracts.CommunityToken.address).to.equal(first.contracts.CommunityToken.address);
      expect(resumed.deploymentTool.deploymentId).to.equal(first.deploymentTool.deploymentId);
      expect(resumedConfirmations).to.equal(firstConfirmations);
      expect(firstConfirmations).to.be.greaterThan(0);
    } finally {
      await server.close();
    }
  });
});
