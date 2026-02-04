import {expect} from './chai-setup';
import {deployments, getUnnamedAccounts, getNamedAccounts, ethers} from 'hardhat';
import {SweatToken} from '../typechain';
import {setupUser, setupUsers, getMock} from './utils';
import {parseEther, parseUnits} from 'ethers/lib/utils';
import {timeStamp} from 'console';

const ONE_SWEAT_TOKEN = parseUnits('1', 18);
const DAY_IN_SECONDS = 86_400;

const moveTimeToFuture = async (secondsToFuture: number) => {
  await ethers.provider.send('evm_increaseTime', [secondsToFuture]);
  await ethers.provider.send('evm_mine', []);
};

type Context = Awaited<ReturnType<typeof setup>>;
type Signers = Context['users'];

const setup = deployments.createFixture(async () => {
  await deployments.fixture();
  const {deployer, TDFMultisig} = await getNamedAccounts();
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
    TDFMultisig: await setupUser(TDFMultisig, contracts),
  };
});

describe('SweatToken', function () {
  let context: Context;
  let users: Signers;

  describe('Initialization', function () {
    beforeEach(async () => {
      context = await setup();
      ({users} = context);
    });
    it('should have correct decay rate', async function () {
      expect(await context.SweatToken.decayRatePerDay()).to.equal(273_973); // 10%/365
    });
  });

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
    it('should be able to mint high amount', async () => {
      await expect(context.deployer.SweatToken.mint(users[0].address, parseEther('100000')))
        .to.emit(context.SweatToken, 'SweatMinted')
        .withArgs(users[0].address, parseEther('100000'), timeStamp);
    });
    it('should not mint when not Treasury', async () => {
      await expect(context.users[0].SweatToken.mint(users[1].address, parseEther('10'))).to.be.revertedWith(
        'Ownable: caller is not the owner'
      );
    });
  });
  describe('When transferring tokens', () => {
    beforeEach(async () => {
      context = await setup();
      ({users} = context);
    });
    it('should be able to transfer from Treasury', async () => {
      await expect(context.deployer.SweatToken.mint(context.TDFMultisig.address, parseEther('10'))).to.not.be.reverted;
      expect(await context.deployer.SweatToken.balanceOf(users[0].address)).to.eq(parseEther('0'));

      await expect(context.TDFMultisig.SweatToken.transfer(users[0].address, parseEther('5'))).to.not.be.reverted;
      expect(await context.deployer.SweatToken.balanceOf(users[0].address)).to.eq(parseEther('5'));
    });
    it('should revert from contributor addresses', async () => {
      await expect(context.deployer.SweatToken.mint(users[0].address, parseEther('10'))).to.not.be.reverted;

      await expect(context.users[0].SweatToken.transfer(users[0].address, parseEther('5'))).to.be.revertedWith(
        'SweatToken_SweatIsNonTransferable'
      );
    });
  });

  describe('Decay functionality', function () {
    beforeEach(async () => {
      context = await setup();
      ({users} = context);
    });

    it('should mint tokens successfully and maintain balance initially', async function () {
      await context.deployer.SweatToken.mint(users[0].address, ONE_SWEAT_TOKEN);
      expect(await context.SweatToken.balanceOf(users[0].address)).to.equal(ONE_SWEAT_TOKEN);
      expect(await context.SweatToken.nonDecayedBalanceOf(users[0].address)).to.equal(ONE_SWEAT_TOKEN);
      expect(await context.SweatToken.totalSupply()).to.be.equal(ONE_SWEAT_TOKEN);
      expect(await context.SweatToken.nonDecayedTotalSupply()).to.be.equal(ONE_SWEAT_TOKEN);
      expect(await context.SweatToken.lastDecayedBalance(users[0].address)).to.be.equal(ONE_SWEAT_TOKEN);

      const blockNumber = await ethers.provider.getBlockNumber();
      const block = await ethers.provider.getBlock(blockNumber);
      expect(await context.SweatToken.lastDecayTimestamp(users[0].address)).to.be.equal(block.timestamp);
    });

    it('should decay balance after 1 day (linear 10%/365)', async function () {
      await context.deployer.SweatToken.mint(users[0].address, ONE_SWEAT_TOKEN);
      await moveTimeToFuture(DAY_IN_SECONDS);

      // After 1 day with linear decay of 10%/365 = 0.02739726027% per day
      // Balance should be approximately 1 * (1 - 0.0002739726027) = 0.9997260273973
      const expectedBalance = parseUnits('0.9997260273973', 18);
      const actualBalance = await context.SweatToken.balanceOf(users[0].address);

      // Allow small rounding error
      const diff = actualBalance.sub(expectedBalance).abs();
      expect(diff).to.be.lt(parseUnits('0.000001', 18));
    });

    it('should decay balance after 10 days', async function () {
      await context.deployer.SweatToken.mint(users[0].address, ONE_SWEAT_TOKEN);
      await moveTimeToFuture(10 * DAY_IN_SECONDS);

      // After 10 days: balance should decay by ~10 * 0.02739726027% = ~0.2739726027%
      // Using compound: (1 - 0.0002739726027)^10 ≈ 0.9972602785
      const actualBalance = await context.SweatToken.balanceOf(users[0].address);

      // Check that balance has decayed (less than original)
      expect(actualBalance).to.be.lt(ONE_SWEAT_TOKEN);
      // Should be around 0.9972602785 tokens
      expect(actualBalance).to.be.gt(parseUnits('0.997', 18));
      expect(actualBalance).to.be.lt(parseUnits('0.998', 18));
    });

    it('should handle multiple mints with decay', async function () {
      // Mint 1 token
      await context.deployer.SweatToken.mint(users[0].address, ONE_SWEAT_TOKEN);

      // Wait 2 days
      await moveTimeToFuture(2 * DAY_IN_SECONDS);

      // Balance should have decayed
      const balanceAfter2Days = await context.SweatToken.balanceOf(users[0].address);
      expect(balanceAfter2Days).to.be.lt(ONE_SWEAT_TOKEN);

      // Mint another token
      await context.deployer.SweatToken.mint(users[0].address, ONE_SWEAT_TOKEN);

      // Total should be decayed balance + 1 new token
      const totalBalance = await context.SweatToken.balanceOf(users[0].address);
      expect(totalBalance).to.be.gt(balanceAfter2Days.add(ONE_SWEAT_TOKEN).sub(parseUnits('0.001', 18)));
      expect(totalBalance).to.be.lt(balanceAfter2Days.add(ONE_SWEAT_TOKEN).add(parseUnits('0.001', 18)));
    });

    it('should calculate correct totalSupply with decay', async function () {
      // Mint to two users
      await context.deployer.SweatToken.mint(users[0].address, ONE_SWEAT_TOKEN);
      await context.deployer.SweatToken.mint(users[1].address, ONE_SWEAT_TOKEN);

      expect(await context.SweatToken.totalSupply()).to.equal(parseUnits('2', 18));

      // Wait 1 day
      await moveTimeToFuture(DAY_IN_SECONDS);

      // Total supply should have decayed
      const totalSupply = await context.SweatToken.totalSupply();
      expect(totalSupply).to.be.lt(parseUnits('2', 18));
      expect(totalSupply).to.be.gt(parseUnits('1.999', 18));
    });

    it('should allow owner to update decay rate', async function () {
      const newDecayRate = 500_000;
      await context.deployer.SweatToken.setDecayRatePerDay(newDecayRate);
      expect(await context.SweatToken.decayRatePerDay()).to.equal(newDecayRate);
    });

    it('should not allow non-owner to update decay rate', async function () {
      const newDecayRate = 500_000;
      await expect(context.users[0].SweatToken.setDecayRatePerDay(newDecayRate)).to.be.revertedWith(
        'Ownable: caller is not the owner'
      );
    });

    it('should not allow decay rate above maximum', async function () {
      const invalidDecayRate = 5_000_000; // Above MAX_DECAY_RATE_PER_DAY
      await expect(context.deployer.SweatToken.setDecayRatePerDay(invalidDecayRate)).to.be.revertedWith(
        'InvalidDecayRatePerDay'
      );
    });
  });
});
