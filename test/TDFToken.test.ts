import {expect} from './chai-setup';
import {ethers, deployments, getUnnamedAccounts, getNamedAccounts} from 'hardhat';
import {DAOAllowTransfersMock, TDFToken, TDFDiamond} from '../typechain';
import {setupUser, setupUsers, getMock} from './utils';
import {MAX_UINT256, ZERO_ADDRESS} from '../utils';
import {parseEther} from 'ethers/lib/utils';

const setup = deployments.createFixture(async () => {
  await deployments.fixture();
  const {TDFMultisig, deployer} = await getNamedAccounts();
  const contracts = {
    TDFToken: <TDFToken>await ethers.getContract('TDFToken'),
    TDFDiamond: <TDFDiamond>await ethers.getContract('TDFDiamond'),
    DAOMock: <DAOAllowTransfersMock>await getMock('DAOAllowTransfersMock', deployer, []),
  };
  const users = await setupUsers(await getUnnamedAccounts(), contracts);
  return {
    ...contracts,
    users,
    deployer: await setupUser(deployer, contracts),
    TDFMultisig: await setupUser(TDFMultisig, contracts),
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
  describe('TDFDiamond transfer permitter', () => {
    it('Allowed Transfers', async () => {
      const {deployer, users, TDFToken, TDFDiamond, TDFMultisig} = await setup();
      // minting
      await expect(deployer.TDFToken.mint(users[0].address, parseEther('10'))).to.emit(TDFToken, 'Transfer');
      expect(await TDFToken.balanceOf(users[0].address)).to.eq(parseEther('10'));
      // Burning
      await expect(users[0].TDFToken.burn(parseEther('1')))
        .to.emit(TDFToken, 'Transfer')
        .withArgs(users[0].address, ZERO_ADDRESS, parseEther('1'));
      expect(await TDFToken.balanceOf(users[0].address)).to.eq(parseEther('9'));

      // Send to DAO
      expect(await TDFToken.balanceOf(TDFDiamond.address)).to.eq(parseEther('0'));
      await expect(users[0].TDFToken.transfer(TDFDiamond.address, parseEther('1')))
        .to.emit(TDFToken, 'Transfer')
        .withArgs(users[0].address, TDFDiamond.address, parseEther('1'));
      expect(await TDFToken.balanceOf(TDFDiamond.address)).to.eq(parseEther('1'));

      // Transfer from Treasury to holders
      expect(await TDFToken.balanceOf(TDFMultisig.address)).to.eq(parseEther('0'));
      expect(await TDFToken.balanceOf(users[5].address)).to.eq(parseEther('0'));
      expect(await TDFToken.balanceOf(users[6].address)).to.eq(parseEther('0'));
      await expect(deployer.TDFToken.mint(TDFMultisig.address, parseEther('10')))
        .to.emit(TDFToken, 'Transfer')
        .withArgs(ZERO_ADDRESS, TDFMultisig.address, parseEther('10'));
      expect(await TDFToken.balanceOf(TDFMultisig.address)).to.eq(parseEther('10'));
      await expect(TDFMultisig.TDFToken.transfer(users[5].address, parseEther('5')))
        .to.emit(TDFToken, 'Transfer')
        .withArgs(TDFMultisig.address, users[5].address, parseEther('5'));
      await expect(TDFMultisig.TDFToken.transfer(users[6].address, parseEther('5')))
        .to.emit(TDFToken, 'Transfer')
        .withArgs(TDFMultisig.address, users[6].address, parseEther('5'));
      expect(await TDFToken.balanceOf(users[5].address)).to.eq(parseEther('5'));
      expect(await TDFToken.balanceOf(users[6].address)).to.eq(parseEther('5'));
    });
    it('Not allowed transfers', async () => {
      const {deployer, users, TDFToken} = await setup();
      // minting
      await expect(deployer.TDFToken.mint(users[10].address, parseEther('10'))).to.emit(TDFToken, 'Transfer');
      await expect(users[10].TDFToken.transfer(users[1].address, parseEther('1'))).to.be.revertedWith('DAO');
      await expect(users[10].TDFToken.transfer(users[2].address, parseEther('1'))).to.be.revertedWith('DAO');
      await expect(users[10].TDFToken.transfer(users[3].address, parseEther('1'))).to.be.revertedWith('DAO');
      await expect(users[10].TDFToken.transfer(users[4].address, parseEther('1'))).to.be.revertedWith('DAO');
    });
  });
});
