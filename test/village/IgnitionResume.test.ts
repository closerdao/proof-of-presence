import {spawn, execFile as execFileCallback} from 'node:child_process';
import {mkdtemp, readFile, unlink, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {promisify} from 'node:util';
import {expect} from 'chai';
import {Contract, HDNodeWallet, JsonRpcProvider, Mnemonic} from 'ethers';

const execFile = promisify(execFileCallback);
const mnemonic = Mnemonic.fromPhrase('test test test test test test test test test test test junk');

function account(index: number): string {
  return HDNodeWallet.fromMnemonic(mnemonic, `m/44'/60'/0'/0/${index}`).address;
}

describe('Ignition HTTP-network recovery', function () {
  it('resumes the same deployment ID without redeploying contracts', async function () {
    this.timeout(90_000);
    const root = await mkdtemp(path.join(tmpdir(), 'village-ignition-resume-'));
    const ignitionRoot = path.join(root, 'ignition');
    const port = 18_545;
    const env = {
      ...process.env,
      // Hardhat watches build-info while serving the node. Polling keeps this
      // integration test reliable in CI environments with low fd limits.
      CHOKIDAR_USEPOLLING: process.env.CHOKIDAR_USEPOLLING ?? '1',
      IGNITION_ROOT: ignitionRoot,
      LOCALHOST_RPC_URL: `http://127.0.0.1:${port}`,
      LOCALHOST_MNEMONIC: mnemonic.phrase,
    };
    const node = spawn('npx', ['--no-install', 'hardhat', 'node', '--hostname', '127.0.0.1', '--port', String(port)], {
      cwd: process.cwd(),
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    try {
      await waitForNode(node);
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
      const command = [
        'run',
        'deploy:village',
        '--silent',
        '--',
        '--config',
        configPath,
        '--network',
        'localhost',
        '--output-root',
        root,
      ];

      await execFile('npm', command, {cwd: process.cwd(), env});
      const manifestPath = path.join(root, 'deployments', 'villages', '31337', 'ignition-resume-test.json');
      const first = JSON.parse(await readFile(manifestPath, 'utf8'));
      const journalPath = path.join(ignitionRoot, 'deployments', first.deploymentTool.deploymentId, 'journal.jsonl');
      const firstJournal = await readFile(journalPath, 'utf8');
      const firstConfirmations = firstJournal.split('"TRANSACTION_CONFIRM"').length - 1;

      // Simulate a worker crash after Ignition completed but before the product
      // manifest was durably published.
      await unlink(manifestPath);
      await execFile('npm', command, {cwd: process.cwd(), env});
      const resumed = JSON.parse(await readFile(manifestPath, 'utf8'));
      const resumedJournal = await readFile(journalPath, 'utf8');
      const resumedConfirmations = resumedJournal.split('"TRANSACTION_CONFIRM"').length - 1;

      expect(resumed.contracts.VillageAccess.address).to.equal(first.contracts.VillageAccess.address);
      expect(resumed.deploymentTool.deploymentId).to.equal(first.deploymentTool.deploymentId);
      expect(first.contracts.VillageAccess.runtimeCodeHash).to.match(/^0x[0-9a-f]{64}$/);
      expect(first).not.to.have.property('transactions');
      expect(resumedConfirmations).to.equal(firstConfirmations);
      expect(firstConfirmations).to.be.greaterThan(0);

      const upgradeCommand = [
        'run',
        'upgrade:prepare',
        '--silent',
        '--',
        '--manifest',
        manifestPath,
        '--contract',
        'VillageAccess',
        '--implementation',
        'VillageAccessUpgradeMock',
        '--version',
        'upgrade-test',
        '--network',
        'localhost',
      ];
      await execFile('npm', upgradeCommand, {cwd: process.cwd(), env});
      const prepared = JSON.parse(await readFile(manifestPath, 'utf8'));
      expect(prepared.upgradeHistory[0]).to.include({
        contractName: 'VillageAccess',
        version: 'upgrade-test',
        status: 'prepared',
      });
      expect(prepared.upgradeHistory[0].implementationCodeHash).to.match(/^0x[0-9a-f]{64}$/);

      const wrongChainManifestPath = path.join(root, 'wrong-chain-manifest.json');
      const wrongChainManifest = `${JSON.stringify({...prepared, chainId: 42220}, null, 2)}\n`;
      await writeFile(wrongChainManifestPath, wrongChainManifest);
      for (const upgradeArgs of [[], ['--upgrade', 'VillageAccess:upgrade-test']]) {
        let statusError: (Error & {stderr?: string}) | undefined;
        try {
          await execFile(
            'npm',
            [
              'run',
              'owner:status',
              '--silent',
              '--',
              '--manifest',
              wrongChainManifestPath,
              '--network',
              'localhost',
              ...upgradeArgs,
            ],
            {cwd: process.cwd(), env},
          );
        } catch (caught) {
          statusError = caught as Error & {stderr?: string};
        }
        expect(`${statusError?.message ?? ''}\n${statusError?.stderr ?? ''}`).to.include(
          'Connected chain 31337 does not match manifest chain 42220',
        );
        expect(await readFile(wrongChainManifestPath, 'utf8')).to.equal(wrongChainManifest);
      }

      const provider = new JsonRpcProvider(env.LOCALHOST_RPC_URL);
      const owner = HDNodeWallet.fromMnemonic(mnemonic, `m/44'/60'/0'/0/1`).connect(provider);
      const access = new Contract(
        prepared.contracts.VillageAccess.address,
        ['function upgradeToAndCall(address newImplementation,bytes data)'],
        owner,
      );
      await (await access.upgradeToAndCall(prepared.upgradeHistory[0].newImplementation, '0x')).wait();
      await execFile('npm', upgradeCommand, {cwd: process.cwd(), env});
      const executed = JSON.parse(await readFile(manifestPath, 'utf8'));
      expect(executed.upgradeHistory[0].status).to.equal('executed');
      expect(executed.contracts.VillageAccess.implementationAddress).to.equal(
        executed.upgradeHistory[0].newImplementation,
      );
      expect(executed.contracts.VillageAccess.implementationRuntimeCodeHash).to.equal(
        executed.upgradeHistory[0].implementationCodeHash,
      );

      const eoaUpgradeCommand = upgradeCommand.map((argument) =>
        argument === 'upgrade-test' ? 'eoa-submit-test' : argument,
      );
      await execFile('npm', eoaUpgradeCommand, {cwd: process.cwd(), env});
      await execFile(
        'npm',
        [
          'run',
          'owner:submit',
          '--silent',
          '--',
          '--manifest',
          manifestPath,
          '--network',
          'localhost',
          '--upgrade',
          'VillageAccess:eoa-submit-test',
        ],
        {cwd: process.cwd(), env},
      );
      const eoaExecuted = JSON.parse(await readFile(manifestPath, 'utf8'));
      const eoaUpgrade = eoaExecuted.upgradeHistory.find(
        (upgrade: {version: string}) => upgrade.version === 'eoa-submit-test',
      );
      expect(eoaUpgrade.status).to.equal('executed');
      expect(eoaExecuted.contracts.VillageAccess.implementationAddress).to.equal(eoaUpgrade.newImplementation);
      expect(eoaExecuted.contracts.VillageAccess.implementationRuntimeCodeHash).to.equal(
        eoaUpgrade.implementationCodeHash,
      );

      const nextUpgradeCommand = upgradeCommand.map((argument) =>
        argument === 'upgrade-test' ? 'unreconciled-test' : argument,
      );
      await execFile('npm', nextUpgradeCommand, {cwd: process.cwd(), env});
      const nextPrepared = JSON.parse(await readFile(manifestPath, 'utf8'));
      const unreconciled = nextPrepared.upgradeHistory.find(
        (upgrade: {version: string}) => upgrade.version === 'unreconciled-test',
      );
      await (await access.upgradeToAndCall(unreconciled.newImplementation, '0x')).wait();

      // Simulate external state drift by discarding the prepared history entry
      // after its candidate was executed on-chain.
      nextPrepared.upgradeHistory = nextPrepared.upgradeHistory.filter(
        (upgrade: {version: string}) => upgrade.version !== 'unreconciled-test',
      );
      const staleManifest = `${JSON.stringify(nextPrepared, null, 2)}\n`;
      await writeFile(manifestPath, staleManifest);
      const driftedUpgradeCommand = upgradeCommand.map((argument) =>
        argument === 'upgrade-test' ? 'must-not-deploy' : argument,
      );

      let driftError: Error | undefined;
      try {
        await execFile('npm', driftedUpgradeCommand, {cwd: process.cwd(), env});
      } catch (caught) {
        driftError = caught as Error;
      }
      expect(driftError?.message).to.include('does not match manifest');
      expect(await readFile(manifestPath, 'utf8')).to.equal(staleManifest);

      const forbiddenDeploymentId = 'upgrade-31337-ignition-resume-test-village-access-must-not-deploy';
      let forbiddenJournalExists = true;
      try {
        await readFile(path.join(ignitionRoot, 'deployments', forbiddenDeploymentId, 'journal.jsonl'));
      } catch {
        forbiddenJournalExists = false;
      }
      expect(forbiddenJournalExists).to.equal(false);
    } finally {
      if (node.exitCode === null && node.signalCode === null) {
        node.kill('SIGTERM');
        await new Promise<void>((resolve) => node.once('close', () => resolve()));
      }
    }
  });
});

function waitForNode(child: ReturnType<typeof spawn>): Promise<void> {
  return new Promise((resolve, reject) => {
    let output = '';
    const timeout = setTimeout(() => reject(new Error(`Hardhat node did not start:\n${output}`)), 10_000);
    const onData = (chunk: Buffer): void => {
      output += chunk.toString();
      if (output.includes('Started HTTP') || output.includes('JSON-RPC server')) {
        clearTimeout(timeout);
        resolve();
      }
    };
    child.stdout?.on('data', onData);
    child.stderr?.on('data', onData);
    child.once('exit', (code) => {
      clearTimeout(timeout);
      reject(new Error(`Hardhat node exited with ${code}:\n${output}`));
    });
  });
}
