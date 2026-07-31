import {mkdtemp, readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {expect} from 'chai';
import hre from 'hardhat';
import {upgrades as createUpgradesApi} from '@openzeppelin/hardhat-upgrades';
import {MaxUint256, ZeroAddress, ZeroHash} from 'ethers';
import {connection, ethers} from '../hardhat.js';
import {parseTdfDeploymentConfig, parseVillageDeploymentConfig} from '../../scripts/deployment/spec.js';
import {deployVillage, parseVillageDeploymentManifest, ROLE_IDS} from '../../scripts/deployment/village.js';
import {TDF_MINIMUM_OPERATING_SUPPLY} from '../../scripts/deployment/spec.js';

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

describe('Village deployment interface', function () {
  it('deploys a resolved graph and writes only the slim operational manifest', async function () {
    const [deployer, operator] = await ethers.getSigners();
    const spec = parseVillageDeploymentConfig({
      schemaVersion: 2,
      villageSlug: 'slim-manifest-test',
      chainId: await chainId(),
      contracts: ['VillageAccess'],
      finalOwner: {type: 'eoa', address: deployer.address},
      apiOperator: operator.address,
    });
    const result = await deployVillage(spec, deploymentContext(await outputRoot()));
    const access = await ethers.getContractAt('VillageAccess', result.manifest.contracts.VillageAccess.address);

    expect(result.manifest.schemaVersion).to.equal(2);
    expect(result.manifest.status).to.equal('complete');
    expect(result.manifest.resolvedContracts).to.deep.equal(['VillageAccess']);
    expect(result.manifest.contracts.VillageAccess).to.include({
      artifact: 'VillageAccess',
      kind: 'uups',
    });
    expect(result.manifest.contracts.VillageAccess.implementation?.address).to.match(/^0x[0-9A-Fa-f]{40}$/);
    expect(result.manifest.graph.id).to.match(/^VillageGraph_v2_[0-9a-f]{64}$/);
    expect(result.manifest.graph.deploymentId).to.include('slim-manifest-test');
    expect(await access.defaultAdmin()).to.equal(deployer.address);

    const persisted = JSON.parse(await readFile(result.manifestPath, 'utf8'));
    expect(persisted).not.to.have.any.keys(
      'deploymentProfile',
      'modules',
      'compiler',
      'openzeppelinVersion',
      'verification',
      'roles',
      'productAliases',
    );
    expect(persisted.contracts.VillageAccess).not.to.have.any.keys(
      'abi',
      'revisions',
      'initializerArgs',
      'constructorArgs',
    );
    expect(() => parseVillageDeploymentManifest({...persisted, schemaVersion: 1})).to.throw();
    expect(() => parseVillageDeploymentManifest({...persisted, unexpected: true})).to.throw('Unrecognized key');
    expect(() =>
      parseVillageDeploymentManifest({
        ...persisted,
        handoffTransaction: {
          safeAddress: deployer.address,
          safeTxHash: ZeroHash,
          data: {
            to: deployer.address,
            value: '0',
            data: '0x',
            operation: 1,
            safeTxGas: '0',
            baseGas: '0',
            gasPrice: '0',
            gasToken: ZeroAddress,
            refundReceiver: ZeroAddress,
            nonce: 0,
          },
        },
      }),
    ).to.throw();
  });

  it('deploys an explicit contract with dependencies auto-added and configured roles', async function () {
    const [deployer, operator, citizenOperator] = await ethers.getSigners();
    const spec = parseVillageDeploymentConfig({
      schemaVersion: 2,
      villageSlug: 'citizen-dependency-test',
      chainId: await chainId(),
      contracts: ['VillageCitizenNFT'],
      finalOwner: {type: 'eoa', address: deployer.address},
      apiOperator: operator.address,
      citizenNft: {
        baseURI: 'ipfs://citizens/',
        operators: [citizenOperator.address],
      },
    });
    const {manifest} = await deployVillage(spec, deploymentContext(await outputRoot()));
    expect(manifest.resolvedContracts).to.deep.equal(['VillageAccess', 'VillageCitizenNFT']);
    expect(Object.keys(manifest.contracts)).to.have.members(['VillageAccess', 'VillageCitizenNFT']);
    const access = await ethers.getContractAt('VillageAccess', manifest.contracts.VillageAccess.address);
    const citizen = await ethers.getContractAt('VillageCitizenNFT', manifest.contracts.VillageCitizenNFT.address);
    expect(await citizen.roleAuthority()).to.equal(await access.getAddress());
    expect(await access.hasRole(ROLE_IDS.CITIZEN_OPERATOR_ROLE, citizenOperator.address)).to.equal(true);
  });

  it('deploys a standalone contract through the generic interface', async function () {
    const [deployer, operator, treasury] = await ethers.getSigners();
    const spec = parseVillageDeploymentConfig({
      schemaVersion: 2,
      villageSlug: 'standalone-policy-test',
      chainId: await chainId(),
      contracts: ['TDFTransferPolicy'],
      finalOwner: {type: 'eoa', address: deployer.address},
      apiOperator: operator.address,
      tdfTransferPolicy: {treasury: treasury.address},
    });
    const {manifest} = await deployVillage(spec, deploymentContext(await outputRoot()));
    expect(manifest.resolvedContracts).to.deep.equal(['TDFTransferPolicy']);
    expect(Object.keys(manifest.contracts)).to.deep.equal(['TDFTransferPolicy']);
  });

  it('deploys explicitly selected VillageAccess alongside TDFTransferPolicy', async function () {
    const [deployer, operator, treasury] = await ethers.getSigners();
    const spec = parseVillageDeploymentConfig({
      schemaVersion: 2,
      villageSlug: 'access-and-policy-test',
      chainId: await chainId(),
      contracts: ['VillageAccess', 'TDFTransferPolicy'],
      finalOwner: {type: 'eoa', address: deployer.address},
      apiOperator: operator.address,
      tdfTransferPolicy: {treasury: treasury.address},
      initialRoleGrants: [{role: 'MINTER_ROLE', account: operator.address}],
    });
    const {manifest} = await deployVillage(spec, deploymentContext(await outputRoot()));
    expect(manifest.resolvedContracts).to.deep.equal(['TDFTransferPolicy', 'VillageAccess']);
    expect(Object.keys(manifest.contracts)).to.have.members(['TDFTransferPolicy', 'VillageAccess']);
    const access = await ethers.getContractAt('VillageAccess', manifest.contracts.VillageAccess.address);
    expect(await access.hasRole(ROLE_IDS.MINTER_ROLE, operator.address)).to.equal(true);
  });

  it('deploys the same contract graph independently for different villages', async function () {
    const [deployer, operator] = await ethers.getSigners();
    const makeSpec = (slug: string) =>
      parseVillageDeploymentConfig({
        schemaVersion: 2,
        villageSlug: slug,
        chainId: 31337,
        contracts: ['CommunityToken'],
        finalOwner: {type: 'eoa', address: deployer.address},
        apiOperator: operator.address,
        communityToken: {maxSupply: MaxUint256.toString()},
      });
    const root = await outputRoot();
    const first = await deployVillage(makeSpec('first-village'), deploymentContext(root));
    const second = await deployVillage(makeSpec('second-village'), deploymentContext(root));
    expect(first.manifest.graph.id).to.equal(second.manifest.graph.id);
    expect(first.manifest.graph.deploymentId).not.to.equal(second.manifest.graph.deploymentId);
    expect(first.manifest.contracts.VillageAccess.address).not.to.equal(
      second.manifest.contracts.VillageAccess.address,
    );
    expect(first.manifest.contracts.CommunityToken.address).not.to.equal(
      second.manifest.contracts.CommunityToken.address,
    );
  });

  it('reconciles same-spec reruns and rejects a changed spec for the same village', async function () {
    const [deployer, operator, otherOperator] = await ethers.getSigners();
    const input = {
      schemaVersion: 2 as const,
      villageSlug: 'manifest-collision-test',
      chainId: await chainId(),
      contracts: ['VillageAccess'] as const,
      finalOwner: {type: 'eoa' as const, address: deployer.address},
      apiOperator: operator.address,
    };
    const context = deploymentContext(await outputRoot());
    const first = await deployVillage(parseVillageDeploymentConfig(input), context);
    const rerun = await deployVillage(parseVillageDeploymentConfig(input), context);
    expect(rerun.manifest.contracts.VillageAccess.address).to.equal(first.manifest.contracts.VillageAccess.address);
    let failure: Error | undefined;
    try {
      await deployVillage(parseVillageDeploymentConfig({...input, apiOperator: otherOperator.address}), context);
    } catch (error) {
      failure = error as Error;
    }
    expect(failure?.message).to.include('Deployment manifest collision');
  });

  it('rejects unexpected members of security-relevant roles during reconciliation', async function () {
    const [deployer, operator] = await ethers.getSigners();
    const spec = parseVillageDeploymentConfig({
      schemaVersion: 2,
      villageSlug: 'role-drift-test',
      chainId: await chainId(),
      contracts: ['VillageAccess'],
      finalOwner: {type: 'eoa', address: deployer.address},
      apiOperator: operator.address,
    });
    const context = deploymentContext(await outputRoot());
    const first = await deployVillage(spec, context);
    const access = await ethers.getContractAt(
      'VillageAccess',
      first.manifest.contracts.VillageAccess.address,
      deployer,
    );
    await (await access.grantRole(ROLE_IDS.MINTER_ROLE, operator.address)).wait();

    let failure: Error | undefined;
    try {
      await deployVillage(spec, context);
    } catch (error) {
      failure = error as Error;
    }
    expect(failure?.message).to.include('MINTER_ROLE members do not match');
  });

  it('clears completed ownership actions when the deployment command is rerun', async function () {
    const [, finalOwner, operator] = await ethers.getSigners();
    const input = {
      schemaVersion: 2 as const,
      villageSlug: 'rerun-completed-handoff-test',
      chainId: await chainId(),
      contracts: ['VillageAccess'] as const,
      finalOwner: {type: 'eoa' as const, address: finalOwner.address},
      apiOperator: operator.address,
    };
    const root = await outputRoot();
    const context = deploymentContext(root);
    const first = await deployVillage(parseVillageDeploymentConfig(input), context);
    expect(first.manifest.status).to.equal('pending-handoff');
    expect(first.manifest.pendingOwnerActions).to.have.length(1);

    const access = await ethers.getContractAt('VillageAccess', first.manifest.contracts.VillageAccess.address);
    await (await access.connect(finalOwner).acceptDefaultAdminTransfer()).wait();

    const rerun = await deployVillage(parseVillageDeploymentConfig(input), context);
    expect(rerun.manifest.status).to.equal('complete');
    expect(rerun.manifest.pendingOwnerActions).to.deep.equal([]);
    const persisted = JSON.parse(await readFile(rerun.manifestPath, 'utf8'));
    expect(persisted.status).to.equal('complete');
    expect(persisted.pendingOwnerActions).to.deep.equal([]);
  });

  it('links an internally deployed transfer policy without intermediate profile Modules', async function () {
    const [deployer, operator, treasury] = await ethers.getSigners();
    const spec = parseVillageDeploymentConfig({
      schemaVersion: 2,
      villageSlug: 'internal-policy-test',
      chainId: await chainId(),
      contracts: ['TokenizedStays', 'TDFTransferPolicy'],
      finalOwner: {type: 'eoa', address: deployer.address},
      apiOperator: operator.address,
      communityToken: {maxSupply: MaxUint256.toString()},
      tdfTransferPolicy: {treasury: treasury.address},
    });
    const {manifest} = await deployVillage(spec, deploymentContext(await outputRoot()));
    const token = await ethers.getContractAt('CommunityToken', manifest.contracts.CommunityToken.address);
    const stays = await ethers.getContractAt('TokenizedStays', manifest.contracts.TokenizedStays.address);
    expect(await token.transferPolicy()).to.equal(manifest.contracts.TDFTransferPolicy.address);
    expect(await stays.communityToken()).to.equal(manifest.contracts.CommunityToken.address);
  });

  it('applies and deploys the full TDF preset through the same engine', async function () {
    const [deployer, operator, recipient, treasury, feeRecipient] = await ethers.getSigners();
    const quote = await (await ethers.getContractFactory('QuoteTokenMock')).deploy(18);
    const spec = parseTdfDeploymentConfig({
      schemaVersion: 2,
      villageSlug: 'tdf-full-preset-test',
      chainId: await chainId(),
      finalOwner: {type: 'eoa', address: deployer.address},
      apiOperator: operator.address,
      communityToken: {
        initialSupply: TDF_MINIMUM_OPERATING_SUPPLY.toString(),
        initialRecipient: recipient.address,
      },
      citizenNft: {baseURI: 'ipfs://citizens/'},
      presenceToken: {decayRatePerDay: '288617'},
      sweatToken: {decayRatePerDay: '288617'},
      tdfTransferPolicy: {treasury: treasury.address},
      dynamicPriceSale: {
        quoteToken: await quote.getAddress(),
        villageTreasury: treasury.address,
        closerFeeRecipient: feeRecipient.address,
      },
    });
    const {manifest} = await deployVillage(spec, deploymentContext(await outputRoot()));
    expect(manifest.preset).to.equal('tdf');
    expect(manifest.resolvedContracts).to.have.length(8);
    expect(manifest.contracts.TDFV1BondingCurve).to.include({
      artifact: 'TDFV1BondingCurve',
      kind: 'plain',
      authority: 'ownerless',
    });
    const sale = await ethers.getContractAt('DynamicPriceSale', manifest.contracts.DynamicPriceSale.address);
    const configuration = await sale.saleConfiguration();
    expect(configuration.bondingCurve).to.equal(manifest.contracts.TDFV1BondingCurve.address);
  });
});
