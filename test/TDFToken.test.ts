import {expect} from './chai-setup';
import {ethers, deployments, getUnnamedAccounts, getNamedAccounts} from 'hardhat';
import {DAOAllowTransfersMock, TDFTokenTest, TDFDiamond} from '../typechain';
import {setupUser, setupUsers, getMock} from './utils';
import {MAX_UINT256, ZERO_ADDRESS} from '../utils';
import {parseEther} from 'ethers/lib/utils';

const setup = deployments.createFixture(async () => {
  await deployments.fixture();
  const {TDFTokenBeneficiary, deployer} = await getNamedAccounts();
  const contracts = {
    TDFTokenTest: <TDFTokenTest>await ethers.getContract('TDFTokenTest'),
    TDFDiamond: <TDFDiamond>await ethers.getContract('TDFDiamond'),
    DAOMock: <DAOAllowTransfersMock>await getMock('DAOAllowTransfersMock', deployer, []),
  };
  const users = await setupUsers(await getUnnamedAccounts(), contracts);
  return {
    ...contracts,
    users,
    deployer: await setupUser(deployer, contracts),
    TDFTokenBeneficiary: await setupUser(TDFTokenBeneficiary, contracts),
  };
});

describe('TDFTokenTest', function () {
  describe('Mocking all transfer approving', () => {
    const setMock = async (): Promise<ReturnType<typeof setup>> => {
      const context = await setup();
      const {DAOMock, deployer} = context;
      await deployer.TDFTokenTest.setDAOContract(DAOMock.address);
      return context;
    };
    it('when only allowed transfers are allowed', async () => {
      // mint
      const {deployer, users, TDFTokenTest, DAOMock} = await setMock();
      await expect(deployer.TDFTokenTest.mint(users[0].address, parseEther('10'))).to.be.revertedWith('DAO');
      await deployer.DAOMock.addPermit(ZERO_ADDRESS, users[0].address, MAX_UINT256);
      await expect(deployer.TDFTokenTest.mint(users[0].address, parseEther('10'))).to.emit(TDFTokenTest, 'Transfer');

      await expect(users[0].TDFTokenTest.transfer(DAOMock.address, parseEther('1'))).to.be.revertedWith('DAO');

      await deployer.DAOMock.addPermit(users[0].address, DAOMock.address, MAX_UINT256);
      await expect(users[0].TDFTokenTest.transfer(DAOMock.address, parseEther('1'))).to.emit(TDFTokenTest, 'Transfer');
      expect(await TDFTokenTest.balanceOf(DAOMock.address)).to.eq(parseEther('1'));
      await expect(users[0].TDFTokenTest.transfer(DAOMock.address, parseEther('1'))).to.emit(TDFTokenTest, 'Transfer');
    });

    it('DAO contract has max allowance to move funds', async () => {
      const {deployer, users, TDFTokenTest, DAOMock} = await setMock();
      await expect(deployer.TDFTokenTest.mint(users[0].address, parseEther('10'))).to.be.revertedWith('DAO');
      await deployer.DAOMock.addPermit(ZERO_ADDRESS, users[0].address, MAX_UINT256);
      await expect(deployer.TDFTokenTest.mint(users[0].address, parseEther('10'))).to.emit(TDFTokenTest, 'Transfer');

      await expect(
        users[9].DAOMock.doTransferFrom(TDFTokenTest.address, users[0].address, users[9].address, parseEther('1'))
      ).to.be.revertedWith('DAO');
      await deployer.DAOMock.addPermit(users[0].address, users[9].address, MAX_UINT256);
      await expect(
        users[9].DAOMock.doTransferFrom(TDFTokenTest.address, users[0].address, users[9].address, parseEther('1'))
      ).to.emit(TDFTokenTest, 'Transfer');

      expect(await TDFTokenTest.allowance(users[0].address, DAOMock.address)).to.eq(MAX_UINT256);
      expect(await TDFTokenTest.allowance(users[1].address, DAOMock.address)).to.eq(MAX_UINT256);
      expect(await TDFTokenTest.allowance(users[2].address, DAOMock.address)).to.eq(MAX_UINT256);
    });
  });
  describe('TDFDiamond transfer permitter', () => {
    it('Allowed Transfers', async () => {
      const {deployer, users, TDFTokenTest, TDFDiamond} = await setup();
      // minting
      await expect(deployer.TDFTokenTest.mint(users[0].address, parseEther('10'))).to.emit(TDFTokenTest, 'Transfer');
      expect(await TDFTokenTest.balanceOf(users[0].address)).to.eq(parseEther('10'));
      // Burning
      await expect(users[0].TDFTokenTest.burn(parseEther('1')))
        .to.emit(TDFTokenTest, 'Transfer')
        .withArgs(users[0].address, ZERO_ADDRESS, parseEther('1'));
      expect(await TDFTokenTest.balanceOf(users[0].address)).to.eq(parseEther('9'));

      // Send to DAO
      expect(await TDFTokenTest.balanceOf(TDFDiamond.address)).to.eq(parseEther('0'));
      await expect(users[0].TDFTokenTest.transfer(TDFDiamond.address, parseEther('1')))
        .to.emit(TDFTokenTest, 'Transfer')
        .withArgs(users[0].address, TDFDiamond.address, parseEther('1'));
      expect(await TDFTokenTest.balanceOf(TDFDiamond.address)).to.eq(parseEther('1'));
    });
    it('Not allowed transfers', async () => {
      const {deployer, users, TDFTokenTest} = await setup();
      // minting
      await expect(deployer.TDFTokenTest.mint(users[0].address, parseEther('10'))).to.emit(TDFTokenTest, 'Transfer');
      await expect(users[10].TDFTokenTest.transfer(users[1].address, parseEther('1'))).to.be.revertedWith('DAO');
      await expect(users[10].TDFTokenTest.transfer(users[2].address, parseEther('1'))).to.be.revertedWith('DAO');
      await expect(users[10].TDFTokenTest.transfer(users[3].address, parseEther('1'))).to.be.revertedWith('DAO');
      await expect(users[10].TDFTokenTest.transfer(users[4].address, parseEther('1'))).to.be.revertedWith('DAO');
    });
  });
});
