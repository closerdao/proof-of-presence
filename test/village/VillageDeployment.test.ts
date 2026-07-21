import {mkdtemp, readFile, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {expect} from 'chai';
import hre from 'hardhat';
import {upgrades as createUpgradesApi} from '@openzeppelin/hardhat-upgrades';
import {OperationType} from '@safe-global/types-kit';
import {parseEther, ZeroAddress} from 'ethers';
import {connection, ethers} from '../hardhat.js';
import {runChildProcess, runTsxWorker} from '../helpers/child-process.js';
import {exportVillageCommand} from '../../scripts/deployment/commands/export-village.js';
import {submitDeploymentOwnerActions} from '../../scripts/deployment/owner-actions.js';
import {
  deployVillage,
  parseVillageDeploymentManifest,
  ROLE_IDS,
  type VillageDeploymentConfig,
} from '../../scripts/deployment/village.js';

const upgradesApi = await createUpgradesApi(hre, connection);

function deploymentContext(outputRoot: string) {
  return {ethers, upgrades: upgradesApi, ignition: connection.ignition, networkName: 'default', outputRoot};
}

async function outputRoot(): Promise<string> {
  return mkdtemp(path.join(tmpdir(), 'village-deployment-'));
}

async function chainId(): Promise<number> {
  return Number((await ethers.provider.getNetwork()).chainId);
}

function baseConfig(
  slug: string,
  owner: string,
  apiOperator: string,
  overrides: Partial<VillageDeploymentConfig> = {},
): VillageDeploymentConfig {
  return {
    schemaVersion: 3,
    villageSlug: slug,
    chainId: 31337,
    deploymentProfile: 'minimal-village',
    ownership: {mode: 'direct', finalOwner: {type: 'eoa', address: owner}},
    modules: [],
    apiOperator,
    ...overrides,
  };
}

describe('Village deployment entrypoint', function () {
  it('prints help for bare npm deploy instead of deploying', async function () {
    const {stdout} = await runChildProcess('npm', ['run', 'deploy', '--silent'], {cwd: process.cwd()});
    expect(stdout).to.include('Bare deploy is intentionally non-transactional');
  });

  it('deploys a direct-owner minimal village with a compact manifest', async function () {
    const [deployer, owner, apiOperator] = await ethers.getSigners();
    const config = baseConfig('direct-minimal-test', owner.address, apiOperator.address, {chainId: await chainId()});
    const context = deploymentContext(await outputRoot());
    const result = await deployVillage(config, context);
    const access = await ethers.getContractAt('VillageAccess', result.manifest.contracts.VillageAccess.address);

    expect(result.manifest.status).to.equal('complete');
    expect(result.manifest.schemaVersion).to.equal(3);
    expect(result.manifest.configSchemaVersion).to.equal(3);
    expect(result.manifest.deploymentKind).to.equal('village');
    expect(result.manifest.ownership).to.include({mode: 'direct', initialOwner: owner.address});
    expect(await access.defaultAdmin()).to.equal(owner.address);
    expect(await access.hasRole(ROLE_IDS.DEFAULT_ADMIN_ROLE, deployer.address)).to.equal(false);
    expect(result.manifest.contracts.VillageAccess.abi).to.be.an('array').and.not.empty;
    expect(result.manifest).not.to.have.property('transactions');
    expect(result.manifest).not.to.have.property('abis');
    expect(result.manifest).not.to.have.property('proxyImplementations');
    expect(result.manifest.deploymentTool).not.to.have.property('selectedFiles');

    expect(() =>
      parseVillageDeploymentManifest({...result.manifest, unexpectedOuterJournal: {step: 'complete'}}),
    ).to.throw('Unrecognized key');
    expect(() => parseVillageDeploymentManifest({...result.manifest, schemaVersion: 2})).to.throw();
    const {deploymentKind: _deploymentKind, ...withoutDeploymentKind} = result.manifest;
    expect(() => parseVillageDeploymentManifest({...withoutDeploymentKind, generation: 'village'})).to.throw();
  });

  it('rejects a conflicting manifest for an existing village deployment', async function () {
    const [deployer, owner, apiOperator] = await ethers.getSigners();
    const config = baseConfig('manifest-collision-test', owner.address, apiOperator.address, {
      chainId: await chainId(),
    });
    const context = deploymentContext(await outputRoot());
    await deployVillage(config, context);

    let collision: Error | undefined;
    try {
      await deployVillage({...config, apiOperator: deployer.address}, context);
    } catch (error) {
      collision = error as Error;
    }
    expect(collision?.message).to.include('Deployment manifest collision');
  });

  it('deploys through the public CLI entrypoint', async function () {
    const [, owner, apiOperator] = await ethers.getSigners();
    const root = await outputRoot();
    const config = baseConfig('cli-village-test', owner.address, apiOperator.address, {chainId: await chainId()});
    const configPath = path.join(root, 'config.json');
    await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`);
    await runTsxWorker(
      'scripts/deploy-village.ts',
      ['--config', configPath, '--network', 'default', '--output-root', root],
      {cwd: process.cwd()},
    );
    const manifestPath = path.join(
      root,
      'deployments',
      'villages',
      String(config.chainId),
      `${config.villageSlug}.json`,
    );
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
    expect(manifest.status).to.equal('complete');
    expect(manifest.contracts.VillageAccess.abi).to.be.an('array').and.not.empty;
  });

  it('derives an export from manifest contract records in-process', async function () {
    const [, owner, apiOperator] = await ethers.getSigners();
    const root = await outputRoot();
    const config = baseConfig('export-village-test', owner.address, apiOperator.address, {chainId: await chainId()});
    const result = await deployVillage(config, deploymentContext(root));
    const exportPath = path.join(root, 'export.json');

    await exportVillageCommand({manifestPath: result.manifestPath, outPath: exportPath});
    const exported = JSON.parse(await readFile(exportPath, 'utf8'));
    expect(exported.schemaVersion).to.equal(2);
    expect(exported.deploymentKind).to.equal('village');
    expect(exported).not.to.have.property('generation');
    expect(exported.contracts.VillageAccess.abi).to.be.an('array').and.not.empty;
  });

  it('keeps deploy:contract as a thin standalone target wrapper', async function () {
    const [, owner, apiOperator, treasury] = await ethers.getSigners();
    const root = await outputRoot();
    const config = baseConfig('standalone-policy-test', owner.address, apiOperator.address, {
      chainId: await chainId(),
      tdfTransferPolicy: {treasury: treasury.address},
    });
    const configPath = path.join(root, 'config.json');
    await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`);
    await runTsxWorker(
      'scripts/deploy-contract.ts',
      ['--contract', 'TDFTransferPolicy', '--config', configPath, '--network', 'default', '--output-root', root],
      {cwd: process.cwd()},
    );
    const manifestPath = path.join(
      root,
      'deployments',
      'contracts',
      String(config.chainId),
      config.villageSlug,
      'tdftransfer-policy.json',
    );
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
    expect(Object.keys(manifest.contracts)).to.deep.equal(['TDFTransferPolicy']);
    expect(manifest.status).to.equal('complete');
    expect(manifest.ownerActions).to.be.empty;
    expect(manifest.contracts.TDFTransferPolicy.constructorArgs).to.deep.equal([treasury.address, owner.address]);
  });

  it('runs OpenZeppelin preflight before calling Ignition', async function () {
    const [, owner, apiOperator] = await ethers.getSigners();
    let ignitionCalled = false;
    const config = baseConfig('unsafe-preflight', owner.address, apiOperator.address, {
      chainId: await chainId(),
      deploymentProfile: 'token-village',
    });
    let failure: Error | undefined;
    try {
      await deployVillage(config, {
        ethers,
        upgrades: {
          validateImplementation: async () => {
            throw new Error('unsafe implementation');
          },
        },
        ignition: {
          deploy: async () => {
            ignitionCalled = true;
          },
        },
        networkName: 'default',
        outputRoot: await outputRoot(),
      });
    } catch (error) {
      failure = error as Error;
    }
    expect(failure?.message).to.equal('unsafe implementation');
    expect(ignitionCalled).to.equal(false);
  });

  it('installs an existing external policy during generic CommunityToken initialization', async function () {
    const [, owner, apiOperator] = await ethers.getSigners();
    const policy = await ethers.deployContract('TransferPolicyMock');
    await policy.waitForDeployment();
    const config = baseConfig('external-policy', owner.address, apiOperator.address, {
      chainId: await chainId(),
      deploymentProfile: 'token-village',
      communityToken: {transferPolicy: await policy.getAddress()},
    });

    const result = await deployVillage(config, deploymentContext(await outputRoot()));
    const token = await ethers.getContractAt('CommunityToken', result.manifest.contracts.CommunityToken.address);

    expect(result.manifest.status).to.equal('complete');
    expect(result.manifest.ownerActions).to.be.empty;
    expect(await token.transferPolicy()).to.equal(await policy.getAddress());
    expect(result.manifest.contracts.CommunityToken.initializerArgs?.[5]).to.equal(await policy.getAddress());
  });

  it('keeps a custom internally wired TDF token restricted until its explicit enable action', async function () {
    const [, owner, apiOperator, treasury, member, other] = await ethers.getSigners();
    const config = baseConfig('custom-internal-policy', owner.address, apiOperator.address, {
      chainId: await chainId(),
      modules: ['communityToken', 'tdfTransferPolicy'],
      communityToken: {
        initialSupply: parseEther('1').toString(),
        initialRecipient: member.address,
      },
      tdfTransferPolicy: {treasury: treasury.address, restrictionsEnabled: false},
    });
    const context = deploymentContext(await outputRoot());

    const result = await deployVillage(config, context);
    const token = await ethers.getContractAt('CommunityToken', result.manifest.contracts.CommunityToken.address);
    const policy = await ethers.getContractAt('TDFTransferPolicy', result.manifest.contracts.TDFTransferPolicy.address);

    expect(result.manifest.status).to.equal('pending-owner-actions');
    expect(result.manifest.ownerActions.map(({functionName}) => functionName)).to.deep.equal([
      'setTransfersRestricted',
    ]);
    expect(await token.transferPolicy()).to.equal(await policy.getAddress());
    expect(await policy.transfersRestricted()).to.equal(true);
    await expect(token.connect(member).transfer(other.address, 1)).to.be.revertedWithCustomError(
      token,
      'TransferBlockedByPolicy',
    );

    const completed = await submitDeploymentOwnerActions(result.manifest, context);
    expect(completed.status).to.equal('complete');
    expect(await policy.transfersRestricted()).to.equal(false);
    await token.connect(member).transfer(other.address, 1);
  });

  it('deploys and completes the direct-owner TDF flow through the public entrypoint', async function () {
    const [, owner, apiOperator, treasury, member, other] = await ethers.getSigners();
    const config = baseConfig('direct-owner-actions', owner.address, apiOperator.address, {
      chainId: await chainId(),
      deploymentProfile: 'tdf',
      communityToken: {
        name: 'TDF Community',
        symbol: 'TDFC',
        initialSupply: parseEther('10').toString(),
        initialRecipient: member.address,
        apiOperatorCanMint: true,
      },
      presenceToken: {decayRatePerDay: 288_617},
      sweatToken: {decayRatePerDay: 288_617},
      tdfTransferPolicy: {treasury: treasury.address},
    });
    const context = deploymentContext(await outputRoot());
    const result = await deployVillage(config, context);
    expect(result.manifest.status).to.equal('pending-owner-actions');
    expect(result.manifest.ownerActions.map(({functionName}) => functionName)).to.deep.equal([
      'setAllowedCounterparty',
    ]);
    const token = await ethers.getContractAt('CommunityToken', result.manifest.contracts.CommunityToken.address);
    const policy = await ethers.getContractAt('TDFTransferPolicy', result.manifest.contracts.TDFTransferPolicy.address);
    expect(await token.transferPolicy()).to.equal(await policy.getAddress());
    expect(result.manifest.contracts.CommunityToken.initializerArgs?.[5]).to.equal(await policy.getAddress());
    expect(await policy.transfersRestricted()).to.equal(true);
    await expect(token.connect(member).transfer(other.address, 1)).to.be.revertedWithCustomError(
      token,
      'TransferBlockedByPolicy',
    );
    await token.connect(member).transfer(treasury.address, parseEther('1'));
    await token.connect(treasury).transfer(member.address, parseEther('1'));

    const completed = await submitDeploymentOwnerActions(result.manifest, context);
    expect(completed.status).to.equal('complete');
    expect(completed.ownerActions).to.be.empty;
    const stays = await ethers.getContractAt('TokenizedStays', completed.contracts.TokenizedStays.address);
    const presence = await ethers.getContractAt(
      'VillagePresenceToken',
      completed.contracts.VillagePresenceToken.address,
    );
    const sweat = await ethers.getContractAt('VillageSweatToken', completed.contracts.VillageSweatToken.address);
    expect(await token.transferPolicy()).to.equal(completed.contracts.TDFTransferPolicy.address);
    expect(await policy.transfersRestricted()).to.equal(true);
    expect(await policy.allowedCounterparty(await stays.getAddress())).to.equal(true);

    await expect(token.connect(member).transfer(other.address, 1)).to.be.revertedWithCustomError(
      token,
      'TransferBlockedByPolicy',
    );
    await token.connect(member).transfer(treasury.address, parseEther('1'));
    await token.connect(treasury).transfer(member.address, parseEther('1'));

    const bookingDayId = (await stays.currentDayId()) + 30n;
    const [year, dayOfYear] = await stays.fromDayId(bookingDayId);
    const price = parseEther('5');
    await expect(
      stays.connect(member).createBookings([{year, dayOfYear, pricePerDate: price}]),
    ).to.be.revertedWithCustomError(token, 'ERC20InsufficientAllowance');
    await token.connect(member).approve(await stays.getAddress(), price);
    await stays.connect(member).createBookings([{year, dayOfYear, pricePerDate: price}]);
    expect(await stays.requiredLockedBalance(member.address)).to.equal(price);
    expect(await stays.depositedBalanceOf(member.address)).to.equal(price);

    await stays.connect(member).cancelBookings([{year, dayOfYear}]);
    await stays.connect(member).withdrawMax();
    expect(await stays.depositedBalanceOf(member.address)).to.equal(0n);
    expect(await token.balanceOf(member.address)).to.equal(parseEther('10'));

    await presence.connect(apiOperator).mint(member.address, parseEther('1'), 0);
    await sweat.connect(apiOperator).mint(member.address, parseEther('2'), 0);
    expect(await presence.nonDecayedBalanceOf(member.address)).to.equal(parseEther('1'));
    expect(await sweat.nonDecayedBalanceOf(member.address)).to.equal(parseEther('2'));
  });

  it('prepares direct Safe owner actions through the Protocol Kit seam', async function () {
    const [deployer, safeOwnerA, safeOwnerB, apiOperator, treasury] = await ethers.getSigners();
    const factory = await ethers.getContractFactory('SafeMock', deployer);
    const safe = await factory.deploy();
    await safe.waitForDeployment();
    await (
      await safe.setup(
        [safeOwnerA.address, safeOwnerB.address],
        2,
        ZeroAddress,
        '0x',
        ZeroAddress,
        ZeroAddress,
        0,
        ZeroAddress,
      )
    ).wait();

    const safeAddress = await safe.getAddress();
    const config = baseConfig('direct-safe-owner-actions', safeAddress, apiOperator.address, {
      chainId: await chainId(),
      ownership: {
        mode: 'direct',
        finalOwner: {
          type: 'safe',
          address: safeAddress,
          expectedOwners: [safeOwnerA.address, safeOwnerB.address],
          expectedThreshold: 2,
        },
      },
      modules: ['tdfTransferPolicy'],
      tdfTransferPolicy: {treasury: treasury.address, restrictionsEnabled: false},
    });
    let prepared = false;
    const result = await deployVillage(config, {
      ...deploymentContext(await outputRoot()),
      safeProvider: {request: async () => undefined},
      prepareSafeTransaction: async (owner, actions) => {
        prepared = true;
        expect(owner.address).to.equal(safeAddress);
        expect(actions.map(({functionName}) => functionName)).to.deep.equal(['setTransfersRestricted']);
        return {
          safeAddress,
          safeTxHash: `0x${'11'.repeat(32)}`,
          data: {
            to: actions[0].to,
            value: '0',
            data: actions[0].data,
            operation: OperationType.Call,
            safeTxGas: '0',
            baseGas: '0',
            gasPrice: '0',
            gasToken: ZeroAddress,
            refundReceiver: ZeroAddress,
            nonce: 0,
          },
        };
      },
    });

    expect(prepared).to.equal(true);
    expect(result.manifest.status).to.equal('pending-owner-actions');
    expect(result.manifest.ownerTransaction).to.include({safeAddress});
    expect(result.manifest.ownerActions).to.have.length(1);
    const policy = await ethers.getContractAt('TDFTransferPolicy', result.manifest.contracts.TDFTransferPolicy.address);
    expect(await policy.transfersRestricted()).to.equal(true);
  });

  it('completes deployer handoff after configuration and records manual acceptance calls', async function () {
    const [deployer, finalOwner, apiOperator, treasury] = await ethers.getSigners();
    const config = baseConfig('handoff-full', finalOwner.address, apiOperator.address, {
      chainId: await chainId(),
      deploymentProfile: 'tdf',
      ownership: {mode: 'deployer-handoff', finalOwner: {type: 'eoa', address: finalOwner.address}},
      communityToken: {name: 'Handoff TDF', symbol: 'HTDF'},
      presenceToken: {decayRatePerDay: 288_617},
      sweatToken: {decayRatePerDay: 288_617},
      tdfTransferPolicy: {treasury: treasury.address},
    });
    const result = await deployVillage(config, deploymentContext(await outputRoot()));

    expect(result.manifest.status).to.equal('complete');
    expect(result.manifest.ownerActions).to.be.empty;
    expect(result.manifest.manualActions).to.have.length(6);
    expect(result.manifest.manualActions.map(({functionName}) => functionName)).to.include.members([
      'acceptOwnership',
      'acceptDefaultAdminTransfer',
    ]);
    expect(result.manifest.manualActions.every(({recipient}) => recipient === finalOwner.address)).to.equal(true);

    const token = await ethers.getContractAt('CommunityToken', result.manifest.contracts.CommunityToken.address);
    const policy = await ethers.getContractAt('TDFTransferPolicy', result.manifest.contracts.TDFTransferPolicy.address);
    expect(await token.owner()).to.equal(deployer.address);
    expect(await token.pendingOwner()).to.equal(finalOwner.address);
    expect(await token.transferPolicy()).to.equal(await policy.getAddress());
    expect(await policy.transfersRestricted()).to.equal(true);
  });

  it('accepts an externally completed handoff on a later deployment reconciliation', async function () {
    const [, finalOwner, apiOperator] = await ethers.getSigners();
    const root = await outputRoot();
    const config = baseConfig('accepted-handoff', finalOwner.address, apiOperator.address, {
      chainId: await chainId(),
      deploymentProfile: 'token-village',
      ownership: {mode: 'deployer-handoff', finalOwner: {type: 'eoa', address: finalOwner.address}},
    });
    const context = deploymentContext(root);
    const first = await deployVillage(config, context);
    const token = await ethers.getContractAt(
      'CommunityToken',
      first.manifest.contracts.CommunityToken.address,
      finalOwner,
    );
    const access = await ethers.getContractAt(
      'VillageAccess',
      first.manifest.contracts.VillageAccess.address,
      finalOwner,
    );
    await (await token.acceptOwnership()).wait();
    await (await access.acceptDefaultAdminTransfer()).wait();

    const second = await deployVillage(config, context);
    expect(second.manifest.status).to.equal('complete');
    expect(await token.owner()).to.equal(finalOwner.address);
    expect(await token.pendingOwner()).to.equal(ZeroAddress);
    expect(await access.defaultAdmin()).to.equal(finalOwner.address);
  });

  it('validates an existing Safe recipient without requiring its signer in handoff mode', async function () {
    const [deployer, safeOwnerA, safeOwnerB, apiOperator] = await ethers.getSigners();
    const factory = await ethers.getContractFactory('SafeMock', deployer);
    const safe = await factory.deploy();
    await safe.waitForDeployment();
    await (
      await safe.setup(
        [safeOwnerA.address, safeOwnerB.address],
        2,
        ZeroAddress,
        '0x',
        ZeroAddress,
        ZeroAddress,
        0,
        ZeroAddress,
      )
    ).wait();
    const config = baseConfig('safe-handoff', await safe.getAddress(), apiOperator.address, {
      chainId: await chainId(),
      ownership: {
        mode: 'deployer-handoff',
        finalOwner: {
          type: 'safe',
          address: await safe.getAddress(),
          expectedOwners: [safeOwnerA.address, safeOwnerB.address],
          expectedThreshold: 2,
        },
      },
    });
    const result = await deployVillage(config, deploymentContext(await outputRoot()));
    expect(result.manifest.status).to.equal('complete');
    expect(result.manifest.manualActions).to.have.length(1);
    expect(result.manifest.manualActions[0].recipient).to.equal(await safe.getAddress());
  });
});
