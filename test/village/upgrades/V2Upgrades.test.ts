import {expect} from 'chai';
import {id, parseEther, ZeroAddress, ZeroHash} from 'ethers';
import hre from 'hardhat';
import {upgrades} from '@openzeppelin/hardhat-upgrades';
import {connection, ethers} from '../../hardhat-compat.js';
import type {RuntimeContract} from '../../../utils/runtimeContract.js';

type Contract = RuntimeContract;

const MINTER_ROLE = id('MINTER_ROLE');
const BOOKING_MANAGER_ROLE = id('BOOKING_MANAGER_ROLE');

async function deployImplementation(name: string, signer: any): Promise<Contract> {
  const factory = await ethers.getContractFactory(name, signer);
  const implementation = (await factory.deploy()) as Contract;
  await implementation.waitForDeployment();
  return implementation;
}

async function deployProxy(name: string, args: unknown[], signer: any): Promise<Contract> {
  const factory = await ethers.getContractFactory(name, signer);
  const implementation = await factory.deploy();
  await implementation.waitForDeployment();
  const proxyFactory = await ethers.getContractFactory('ERC1967ProxyForTest', signer);
  const proxy = await proxyFactory.deploy(
    await implementation.getAddress(),
    factory.interface.encodeFunctionData('initialize', args),
  );
  await proxy.waitForDeployment();
  return (await ethers.getContractAt(name, await proxy.getAddress(), signer)) as Contract;
}

async function setupVillageAccess() {
  const [deployer, owner, manager, minter, member, other] = await ethers.getSigners();
  const access = await deployProxy(
    'VillageAccess',
    [
      owner.address,
      [
        {role: MINTER_ROLE, account: minter.address},
        {role: BOOKING_MANAGER_ROLE, account: manager.address},
      ],
    ],
    deployer,
  );
  return {access, deployer, owner, manager, minter, member, other};
}

describe('V2 upgrades', function () {
  it('locks every production implementation against direct initialization', async function () {
    const [deployer, owner] = await ethers.getSigners();
    const access = await deployProxy('VillageAccess', [owner.address, []], deployer);
    const accessAddress = await access.getAddress();
    const token = await deployProxy(
      'CommunityToken',
      ['Token', 'TOK', 0, ZeroAddress, accessAddress, ZeroAddress, owner.address],
      deployer,
    );
    const cases: Array<[string, unknown[]]> = [
      ['VillageAccess', [owner.address, []]],
      ['CommunityToken', ['Token', 'TOK', 0, ZeroAddress, accessAddress, ZeroAddress, owner.address]],
      ['VillagePresenceToken', ['Presence', 'PRES', accessAddress, 288_617, owner.address]],
      ['VillageSweatToken', ['Sweat', 'SWT', accessAddress, 288_617, owner.address]],
      ['TokenizedStays', [await token.getAddress(), accessAddress, owner.address]],
    ];

    for (const [name, args] of cases) {
      const factory = await ethers.getContractFactory(name, deployer);
      const implementation = await factory.deploy();
      await implementation.waitForDeployment();
      await expect(implementation.initialize(...args)).to.be.revertedWithCustomError(
        implementation,
        'InvalidInitialization',
      );
    }
  });

  it('preserves VillageAccess custom hierarchy and restricts upgrades to the default admin', async function () {
    const {access, deployer, owner, manager, minter, member, other} = await setupVillageAccess();
    const futureRole = id('FUTURE_ROLE');
    await access.connect(owner).setRoleAdmin(futureRole, MINTER_ROLE);
    await access.connect(minter).grantRole(futureRole, other.address);
    await access.connect(owner).beginDefaultAdminTransfer(member.address);
    const pendingAdmin = await access.pendingDefaultAdmin();

    const next = await deployImplementation('VillageAccessV2Mock', deployer);
    await expect(access.connect(manager).upgradeToAndCall(await next.getAddress(), '0x'))
      .to.be.revertedWithCustomError(access, 'AccessControlUnauthorizedAccount')
      .withArgs(manager.address, ZeroHash);
    await access.connect(owner).upgradeToAndCall(await next.getAddress(), '0x');

    const upgraded = (await ethers.getContractAt('VillageAccessV2Mock', await access.getAddress(), owner)) as Contract;
    expect(await upgraded.version()).to.equal('village-access-v2');
    expect(await upgraded.defaultAdmin()).to.equal(owner.address);
    expect(await upgraded.pendingDefaultAdmin()).to.deep.equal(pendingAdmin);
    expect(await upgraded.getRoleAdmin(futureRole)).to.equal(MINTER_ROLE);
    expect(await upgraded.hasRole(futureRole, other.address)).to.equal(true);
  });

  it('executes reinitializer calldata atomically while preserving CommunityToken state', async function () {
    const {access, deployer, owner, minter, member} = await setupVillageAccess();
    const policy = await deployImplementation('TransferPolicyMock', deployer);
    const token = await deployProxy(
      'CommunityToken',
      ['Token', 'TOK', 0, ZeroAddress, await access.getAddress(), ZeroAddress, owner.address],
      deployer,
    );
    await token.connect(minter).mint(member.address, parseEther('10'));
    await token.connect(owner).setTransferPolicy(await policy.getAddress());
    const next = await deployImplementation('CommunityTokenV2Mock', deployer);
    const migration = next.interface.encodeFunctionData('initializeV2', [42, false]);

    await token.connect(owner).upgradeToAndCall(await next.getAddress(), migration);
    const upgraded = (await ethers.getContractAt('CommunityTokenV2Mock', await token.getAddress(), owner)) as Contract;
    expect(await upgraded.balanceOf(member.address)).to.equal(parseEther('10'));
    expect(await upgraded.roleAuthority()).to.equal(await access.getAddress());
    expect(await upgraded.transferPolicy()).to.equal(await policy.getAddress());
    expect(await upgraded.v2Value()).to.equal(42n);
    await expect(upgraded.initializeV2(43, false)).to.be.revertedWithCustomError(upgraded, 'InvalidInitialization');

    const fresh = await deployProxy(
      'CommunityToken',
      ['Fresh', 'FRH', 0, ZeroAddress, await access.getAddress(), ZeroAddress, owner.address],
      deployer,
    );
    const upgradesApi = await upgrades(hre, connection);
    const implementationBefore = await upgradesApi.erc1967.getImplementationAddress(await fresh.getAddress());
    const rejectedMigration = next.interface.encodeFunctionData('initializeV2', [99, true]);
    await expect(
      fresh.connect(owner).upgradeToAndCall(await next.getAddress(), rejectedMigration),
    ).to.be.revertedWithCustomError(next, 'MigrationRejected');
    expect(await upgradesApi.erc1967.getImplementationAddress(await fresh.getAddress())).to.equal(implementationBefore);
  });

  it('preserves the shared decaying-token storage through a representative PresenceToken upgrade', async function () {
    const {access, deployer, owner, manager, member} = await setupVillageAccess();
    const token = await deployProxy(
      'VillagePresenceToken',
      ['Presence', 'PRES', await access.getAddress(), 288_617, owner.address],
      deployer,
    );
    await token.connect(manager).mint(member.address, parseEther('2'), 0);
    const checkpoint = await token.decayCheckpointTimestamp(member.address);
    const next = await deployImplementation('PresenceTokenV2Mock', deployer);

    await expect(token.connect(manager).upgradeToAndCall(await next.getAddress(), '0x'))
      .to.be.revertedWithCustomError(token, 'OwnableUnauthorizedAccount')
      .withArgs(manager.address);
    await token.connect(owner).upgradeToAndCall(await next.getAddress(), '0x');
    const upgraded = (await ethers.getContractAt('PresenceTokenV2Mock', await token.getAddress(), owner)) as Contract;
    expect(await upgraded.nonDecayedBalanceOf(member.address)).to.equal(parseEther('2'));
    expect(await upgraded.roleAuthority()).to.equal(await access.getAddress());
    expect(await upgraded.isHolder(member.address)).to.equal(true);
    expect(await upgraded.holders(0)).to.equal(member.address);
    expect(await upgraded.decayCheckpointBalance(member.address)).to.equal(parseEther('2'));
    expect(await upgraded.decayCheckpointTimestamp(member.address)).to.equal(checkpoint);
    expect(await upgraded.decayRatePerDay()).to.equal(288_617n);
  });

  it('preserves booking records and deposits through a TokenizedStays upgrade', async function () {
    const {access, deployer, owner, minter, member} = await setupVillageAccess();
    const token = await deployProxy(
      'CommunityToken',
      ['Token', 'TOK', 0, ZeroAddress, await access.getAddress(), ZeroAddress, owner.address],
      deployer,
    );
    await token.connect(minter).mint(member.address, parseEther('10'));
    const stays = await deployProxy(
      'TokenizedStays',
      [await token.getAddress(), await access.getAddress(), owner.address],
      deployer,
    );
    await token.connect(member).approve(await stays.getAddress(), parseEther('10'));
    const [year, dayOfYear] = await stays.fromDayId((await stays.currentDayId()) + 30n);
    await stays.connect(member).createBookings([{year, dayOfYear, pricePerDate: parseEther('5')}]);
    const next = await deployImplementation('TokenizedStaysV2Mock', deployer);

    await stays.connect(owner).upgradeToAndCall(await next.getAddress(), '0x');
    const upgraded = (await ethers.getContractAt('TokenizedStaysV2Mock', await stays.getAddress(), owner)) as Contract;
    expect(await upgraded.depositedBalanceOf(member.address)).to.equal(parseEther('5'));
    expect(await upgraded.totalDepositedBalance()).to.equal(parseEther('5'));
    expect(await upgraded.communityToken()).to.equal(await token.getAddress());
    expect(await upgraded.roleAuthority()).to.equal(await access.getAddress());
    expect(await upgraded.bookingCountForYear(member.address, year)).to.equal(1n);
    expect(await upgraded.latestBookedYear(member.address)).to.equal(year);
    const [exists, booking] = await upgraded.getBooking(member.address, year, dayOfYear);
    expect(exists).to.equal(true);
    expect(booking.pricePerDate).to.equal(parseEther('5'));
  });

  it('supports a contract-owned upgrade through one forwarding call', async function () {
    const {access, deployer, minter, member} = await setupVillageAccess();
    const [, safeOwner] = await ethers.getSigners();
    const safeFactory = await ethers.getContractFactory('SafeMock', deployer);
    const safe = await safeFactory.deploy();
    await safe.waitForDeployment();
    await safe.setup([safeOwner.address], 1, ZeroAddress, '0x', ZeroAddress, ZeroAddress, 0, ZeroAddress);
    const token = await deployProxy(
      'CommunityToken',
      ['Safe Token', 'SAFE', 0, ZeroAddress, await access.getAddress(), ZeroAddress, await safe.getAddress()],
      deployer,
    );
    await token.connect(minter).mint(member.address, 7n);
    const next = await deployImplementation('CommunityTokenV2Mock', deployer);
    const data = token.interface.encodeFunctionData('upgradeToAndCall', [await next.getAddress(), '0x']);

    await safe.connect(safeOwner).execute(await token.getAddress(), data);
    const upgraded = (await ethers.getContractAt(
      'CommunityTokenV2Mock',
      await token.getAddress(),
      safeOwner,
    )) as Contract;
    expect(await upgraded.version()).to.equal('community-token-v2');
    expect(await upgraded.balanceOf(member.address)).to.equal(7n);
  });

  it('detects a type mutation in the production CommunityToken ERC-7201 namespace', async function () {
    const upgradesApi = await upgrades(hre, connection);
    const current = await ethers.getContractFactory('CommunityToken');
    const incompatible = await ethers.getContractFactory('CommunityTokenIncompatibleV2Mock');
    let validationError: unknown;
    try {
      await upgradesApi.validateUpgrade(current, incompatible, {kind: 'uups'});
    } catch (error) {
      validationError = error;
    }

    expect(validationError).to.be.instanceOf(Error);
    const message = (validationError as Error).message;
    expect(message).to.include('New storage layout is incompatible');
    expect(message).to.include('roleAuthority');
    expect(message).to.match(/IAccessControl[\s\S]*uint256|uint256[\s\S]*IAccessControl/);
  });
});
