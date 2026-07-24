import {mkdtemp, readFile, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {expect} from 'chai';
import hre from 'hardhat';
import {upgrades as createUpgradesApi} from '@openzeppelin/hardhat-upgrades';
import {connection, ethers} from '../hardhat.js';
import {ownerStatusCommand} from '../../scripts/deployment/commands/owner-status.js';
import {ownerSubmitCommand} from '../../scripts/deployment/commands/owner-submit.js';
import {prepareUpgradeCommand} from '../../scripts/deployment/commands/prepare-upgrade.js';
import {
  deployVillage,
  readVillageDeploymentManifest,
  writeVillageDeploymentManifest,
  type VillageDeploymentConfig,
} from '../../scripts/deployment/village.js';

const upgradesApi = await createUpgradesApi(hre, connection);

function upgradeContext() {
  return {
    ethers,
    upgrades: upgradesApi,
    ignition: connection.ignition,
    provider: connection.provider,
    networkName: 'default',
  };
}

async function deployAccess(slug: string) {
  const [, owner, apiOperator] = await ethers.getSigners();
  const outputRoot = await mkdtemp(path.join(tmpdir(), 'village-command-'));
  const chainId = Number((await ethers.provider.getNetwork()).chainId);
  const config: VillageDeploymentConfig = {
    schemaVersion: 4,
    villageSlug: slug,
    chainId,
    deploymentProfile: 'minimal-village',
    ownership: {mode: 'direct', finalOwner: {type: 'eoa', address: owner.address}},
    modules: [],
    apiOperator: apiOperator.address,
  };
  const result = await deployVillage(config, {
    ethers,
    upgrades: upgradesApi,
    ignition: connection.ignition,
    networkName: 'default',
    outputRoot,
  });
  return {...result, owner};
}

async function prepare(manifestPath: string, version: string) {
  return prepareUpgradeCommand(
    {
      manifestPath,
      contractName: 'VillageAccess',
      implementation: 'VillageAccessUpgradeMock',
      version,
    },
    upgradeContext(),
  );
}

describe('Deployment commands', function () {
  it('prepares an upgrade with its implementation code hash', async function () {
    const {manifestPath} = await deployAccess('command-prepare-upgrade');
    const manifest = await prepare(manifestPath, 'prepared-test');

    expect(manifest.upgradeHistory).to.have.length(1);
    expect(manifest.upgradeHistory![0]).to.include({
      contractName: 'VillageAccess',
      version: 'prepared-test',
      status: 'prepared',
    });
    expect(manifest.upgradeHistory![0].implementationCodeHash).to.match(/^0x[0-9a-f]{64}$/);
  });

  it('rejects owner status on the wrong chain without rewriting the manifest', async function () {
    const {manifestPath} = await deployAccess('command-wrong-chain');
    const manifest = await readVillageDeploymentManifest(manifestPath);
    const wrongChainPath = path.join(path.dirname(manifestPath), 'wrong-chain.json');
    const wrongChain = `${JSON.stringify({...manifest, chainId: 42220}, null, 2)}\n`;
    await writeFile(wrongChainPath, wrongChain);

    for (const upgrade of [undefined, 'VillageAccess:prepared-test']) {
      let failure: Error | undefined;
      try {
        await ownerStatusCommand({manifestPath: wrongChainPath, upgrade}, {ethers, networkName: 'default'});
      } catch (error) {
        failure = error as Error;
      }
      expect(failure?.message).to.include('Connected chain 31337 does not match manifest chain 42220');
      expect(await readFile(wrongChainPath, 'utf8')).to.equal(wrongChain);
    }
  });

  it('reconciles an externally executed prepared upgrade', async function () {
    const {manifestPath, owner} = await deployAccess('command-reconcile-upgrade');
    const prepared = await prepare(manifestPath, 'external-execution');
    const upgrade = prepared.upgradeHistory![0];
    const access = await ethers.getContractAt('VillageAccess', prepared.contracts.VillageAccess.address, owner);
    await (await access.upgradeToAndCall(upgrade.newImplementation, '0x')).wait();

    const reconciled = await prepare(manifestPath, 'next-release');
    expect(reconciled.upgradeHistory![0].status).to.equal('executed');
    expect(reconciled.contracts.VillageAccess.implementationAddress).to.equal(upgrade.newImplementation);
    expect(reconciled.contracts.VillageAccess.implementationRuntimeCodeHash).to.equal(upgrade.implementationCodeHash);
  });

  it('submits and reconciles a prepared EOA-owned upgrade', async function () {
    const {manifestPath} = await deployAccess('command-submit-upgrade');
    await prepare(manifestPath, 'eoa-submit');

    const executed = await ownerSubmitCommand(
      {manifestPath, upgrade: 'VillageAccess:eoa-submit'},
      {ethers, provider: connection.provider, networkName: 'default'},
    );
    const upgrade = executed.upgradeHistory![0];
    expect(upgrade.status).to.equal('executed');
    expect(executed.contracts.VillageAccess.implementationAddress).to.equal(upgrade.newImplementation);
    expect(executed.contracts.VillageAccess.implementationRuntimeCodeHash).to.equal(upgrade.implementationCodeHash);
  });

  it('rejects untracked implementation drift before deploying another candidate', async function () {
    const {manifestPath, owner} = await deployAccess('command-drift-upgrade');
    const prepared = await prepare(manifestPath, 'untracked-execution');
    const upgrade = prepared.upgradeHistory![0];
    const access = await ethers.getContractAt('VillageAccess', prepared.contracts.VillageAccess.address, owner);
    await (await access.upgradeToAndCall(upgrade.newImplementation, '0x')).wait();

    prepared.upgradeHistory = [];
    await writeVillageDeploymentManifest(manifestPath, prepared);
    const staleManifest = await readFile(manifestPath, 'utf8');
    let ignitionCalled = false;
    let failure: Error | undefined;
    try {
      await prepareUpgradeCommand(
        {
          manifestPath,
          contractName: 'VillageAccess',
          implementation: 'VillageAccessUpgradeMock',
          version: 'must-not-deploy',
        },
        {
          ...upgradeContext(),
          ignition: {
            deploy: async () => {
              ignitionCalled = true;
              throw new Error('unexpected deployment');
            },
          },
        },
      );
    } catch (error) {
      failure = error as Error;
    }

    expect(failure?.message).to.include('does not match manifest');
    expect(ignitionCalled).to.equal(false);
    expect(await readFile(manifestPath, 'utf8')).to.equal(staleManifest);
  });
});
