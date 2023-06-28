import {expect} from './chai-setup';
import {deployments, getUnnamedAccounts, getNamedAccounts, ethers} from 'hardhat';
import {SweatToken} from '../typechain';
import {setupUser, setupUsers, getMock} from './utils';
import {parseEther} from 'ethers/lib/utils';
import {timeStamp} from 'console';

type Context = Awaited<ReturnType<typeof setup>>;
type Signers = Context['users'];

const setup = deployments.createFixture(async () => {
  await deployments.fixture();
  const {deployer} = await getNamedAccounts();
  const contracts = {
    SweatToken: <SweatToken>await ethers.getContractOrNull('SweatToken')
      ? <SweatToken>await ethers.getContract('SweatToken')
      : <SweatToken>await getMock('SweatToken', deployer, []),
  };
  const users = await setupUsers(await getUnnamedAccounts(), contracts);
  return {
    ...contracts,
    users,
    deployer: await setupUser(deployer, contracts),
  };
});

describe('SweatToken', function () {
  let context: Context;
  let users: Signers;

  describe('when minting tokens', () => {
    beforeEach(async () => {
      context = await setup();
      ({users} = context);
    });

    it('should be able to mint', async () => {
      await expect(context.deployer.SweatToken.mint(users[0].address, parseEther('10')))
        .to.emit(context.SweatToken, 'SweatMinted')
        .withArgs(users[0].address, parseEther('10'), timeStamp);
    });

    it('should not mint when not Treasury', async () => {
      await expect(context.users[0].SweatToken.mint(users[1].address, parseEther('10'))).to.be.revertedWith(
        'Ownable: caller is not the owner'
      );
    });
    it('should revert when mint amount exceeds max supply', async () => {
      await expect(context.deployer.SweatToken.mint(users[0].address, parseEther('3710'))).to.not.be.reverted;

      await expect(context.deployer.SweatToken.mint(users[1].address, parseEther('11'))).to.be.revertedWith(
        'SweatToken_MintAmountExceedsMaxSupply'
      );
    });
    it('should not mint when max supply reached', async () => {
      await expect(context.deployer.SweatToken.mint(users[0].address, parseEther('3720'))).to.not.be.reverted;

      await expect(context.deployer.SweatToken.mint(users[1].address, parseEther('10'))).to.be.revertedWith(
        'SweatToken_MaxSweatSupplyReached'
      );
    });
  });
  describe('When transferring tokens', () => {
    beforeEach(async () => {
      context = await setup();
      ({users} = context);
    });
    it('should revert', async () => {
      await expect(context.deployer.SweatToken.mint(users[0].address, parseEther('10'))).to.not.be.reverted;

      await expect(context.users[0].SweatToken.transfer(users[0].address, parseEther('5'))).to.be.revertedWith(
        'SweatToken_SweatIsNonTransferable'
      );
    });
  });
});
