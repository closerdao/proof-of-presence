import {expect} from './chai-setup';
import {ethers, deployments, getUnnamedAccounts, getNamedAccounts} from 'hardhat';
import {IERC20, DAOAllowTransfersMock, TDFToken} from '../typechain';
import {setupUser, setupUsers, getMock} from './utils';
import {MAX_UINT256, ZERO_ADDRESS} from '../utils';
import {parseEther} from 'ethers/lib/utils';

const setup = deployments.createFixture(async () => {
  await deployments.fixture();
  const {TDFTokenBeneficiary, deployer} = await getNamedAccounts();
  const contracts = {
    TDFToken: <TDFToken>await ethers.getContract('TDFToken'),
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

describe('TDFToken', function () {
  describe('Mocking all transfer approving', () => {
    const setMock = async (): Promise<ReturnType<typeof setup>> => {
      const context = await setup();
      const {DAOMock, deployer} = context;
      await deployer.TDFToken.setDAOContract(DAOMock.address);
      return context;
    };
    it('when only allowed transfers are allowed', async () => {
      // mint
      const {deployer, users, TDFToken, DAOMock} = await setMock();
      await expect(deployer.TDFToken.mint(users[0].address, parseEther('10'))).to.be.revertedWith('DAO');
      await deployer.DAOMock.addPermit(ZERO_ADDRESS, users[0].address, MAX_UINT256);
      await expect(deployer.TDFToken.mint(users[0].address, parseEther('10'))).to.emit(TDFToken, 'Transfer');

      await expect(users[0].TDFToken.transfer(DAOMock.address, parseEther('1'))).to.be.revertedWith('DAO');

      await deployer.DAOMock.addPermit(users[0].address, DAOMock.address, MAX_UINT256);
      await expect(users[0].TDFToken.transfer(DAOMock.address, parseEther('1'))).to.emit(TDFToken, 'Transfer');
      expect(await TDFToken.balanceOf(DAOMock.address)).to.eq(parseEther('1'));
      await expect(users[0].TDFToken.transfer(DAOMock.address, parseEther('1'))).to.emit(TDFToken, 'Transfer');
    });

    it('DAO contract has max allowance to move funds', async () => {
      const {deployer, users, TDFToken, DAOMock} = await setMock();
      await expect(deployer.TDFToken.mint(users[0].address, parseEther('10'))).to.be.revertedWith('DAO');
      await deployer.DAOMock.addPermit(ZERO_ADDRESS, users[0].address, MAX_UINT256);
      await expect(deployer.TDFToken.mint(users[0].address, parseEther('10'))).to.emit(TDFToken, 'Transfer');

      await expect(
        users[9].DAOMock.doTransferFrom(TDFToken.address, users[0].address, users[9].address, parseEther('1'))
      ).to.be.revertedWith('DAO');
      await deployer.DAOMock.addPermit(users[0].address, users[9].address, MAX_UINT256);
      await expect(
        users[9].DAOMock.doTransferFrom(TDFToken.address, users[0].address, users[9].address, parseEther('1'))
      ).to.emit(TDFToken, 'Transfer');

      expect(await TDFToken.allowance(users[0].address, DAOMock.address)).to.eq(MAX_UINT256);
      expect(await TDFToken.allowance(users[1].address, DAOMock.address)).to.eq(MAX_UINT256);
      expect(await TDFToken.allowance(users[2].address, DAOMock.address)).to.eq(MAX_UINT256);
    });
  });
  describe('Default DAO', () => {
    const setMock = async (): Promise<ReturnType<typeof setup>> => {
      const context = await setup();
      const {DAOMock, deployer} = context;
      await deployer.TDFToken.setDAOContract(DAOMock.address);
      return context;
    };
    it('when only allowed transfers are allowed', async () => {
      // mint
      const {deployer, users, TDFToken, DAOMock} = await setMock();
      await expect(deployer.TDFToken.mint(users[0].address, parseEther('10'))).to.be.revertedWith('DAO');
      await deployer.DAOMock.addPermit(ZERO_ADDRESS, users[0].address, MAX_UINT256);
      await expect(deployer.TDFToken.mint(users[0].address, parseEther('10'))).to.emit(TDFToken, 'Transfer');
      await expect(users[0].TDFToken.transfer(DAOMock.address, parseEther('1'))).to.be.revertedWith('DAO');
      await deployer.DAOMock.addPermit(users[0].address, DAOMock.address, MAX_UINT256);
      await expect(users[0].TDFToken.transfer(DAOMock.address, parseEther('1'))).to.emit(TDFToken, 'Transfer');
      expect(await TDFToken.balanceOf(DAOMock.address)).to.eq(parseEther('1'));
    });
    it('DAO transfering to user works');
    it('minting from owner is allowed');
    it('minting from DAO is allowed');
    it('rest of transfers are not allowed');
  });
  xit('transfer fails', async function () {
    const {users} = await setup();
    await expect(users[0].TDFToken.transfer(users[1].address, 1)).to.be.revertedWith('NOT_ENOUGH_TOKENS');
  });

  xit('transfer succeed', async function () {
    const {users, TDFTokenBeneficiary, TDFToken} = await setup();
    await TDFTokenBeneficiary.TDFToken.transfer(users[1].address, 1);

    await expect(TDFTokenBeneficiary.TDFToken.transfer(users[1].address, 1))
      .to.emit(TDFToken, 'Transfer')
      .withArgs(TDFTokenBeneficiary.address, users[1].address, 1);
  });
});
