import {expect} from '../chai-setup';
import {deployments, ethers, getNamedAccounts, getUnnamedAccounts} from 'hardhat';
import {IDiamondCut, TDFDiamond, TDFTreasuryMigration} from '../../typechain';

const setup = deployments.createFixture(async () => {
  await deployments.fixture();
  const {deployer, TDFMultisig} = await getNamedAccounts();
  const [newTreasury] = await getUnnamedAccounts();
  const migrationDeployment = await deployments.deploy('TDFTreasuryMigration', {
    from: deployer,
    log: false,
  });
  const diamond = (await ethers.getContract('TDFDiamond', deployer)) as TDFDiamond;
  const diamondCut = (await ethers.getContractAt(
    'IDiamondCut',
    diamond.address,
    await ethers.getSigner(deployer)
  )) as IDiamondCut;
  const migration = (await ethers.getContractAt(
    'TDFTreasuryMigration',
    migrationDeployment.address
  )) as TDFTreasuryMigration;
  const migrationAtDiamond = (await ethers.getContractAt(
    'TDFTreasuryMigration',
    diamond.address
  )) as TDFTreasuryMigration;

  return {diamond, diamondCut, migration, migrationAtDiamond, newTreasury, TDFMultisig};
});

describe('TDFTreasuryMigration', () => {
  it('moves the transfer permission to the new treasury via diamondCut', async () => {
    const {diamond, diamondCut, migration, migrationAtDiamond, newTreasury, TDFMultisig} = await setup();
    const recipient = ethers.Wallet.createRandom().address;

    expect(await diamond.isTokenTransferPermitted(TDFMultisig, recipient, 1)).to.eq(true);
    expect(await diamond.isTokenTransferPermitted(newTreasury, recipient, 1)).to.eq(false);

    const migrationData = migration.interface.encodeFunctionData('migrate', [newTreasury]);
    await expect(diamondCut.diamondCut([], migration.address, migrationData))
      .to.emit(migrationAtDiamond, 'TDFTreasuryMigrated')
      .withArgs(TDFMultisig, newTreasury);

    expect(await diamond.isTokenTransferPermitted(TDFMultisig, recipient, 1)).to.eq(false);
    expect(await diamond.isTokenTransferPermitted(newTreasury, recipient, 1)).to.eq(true);
  });

  it('rejects a zero treasury', async () => {
    const {diamondCut, migration} = await setup();
    const migrationData = migration.interface.encodeFunctionData('migrate', [ethers.constants.AddressZero]);

    await expect(diamondCut.diamondCut([], migration.address, migrationData)).to.be.revertedWith(
      'TDFTreasuryMigration: zero treasury'
    );
  });
});
