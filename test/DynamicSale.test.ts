import {expect} from './chai-setup';
import {deployments, ethers, getUnnamedAccounts, getNamedAccounts} from 'hardhat';
import {TDFToken, TDFDiamond, DynamicSale, FakeEURToken} from '../typechain';
import {setupUser, setupUsers} from './utils';
import {formatEther, parseEther} from 'ethers/lib/utils';

const setup = deployments.createFixture(async () => {
  await deployments.fixture();
  const {deployer} = await getNamedAccounts();
  const contracts = {
    FakeEURToken: <FakeEURToken>await ethers.getContract('FakeEURToken'),
    TDFToken: <TDFToken>await ethers.getContract('TDFToken'),
    TDFDiamond: <TDFDiamond>await ethers.getContract('TDFDiamond'),
    DynamicSale: <DynamicSale>await ethers.getContract('DynamicSale'),
  };
  const users = await setupUsers(await getUnnamedAccounts(), contracts);
  return {
    ...contracts,
    users,
    deployer: await setupUser(deployer, contracts),
  };
});

type Context = Awaited<ReturnType<typeof setup>>;
type User = Context['deployer'];
type Signer = Awaited<ReturnType<typeof setSigner>>;

const setSigner = (user: User, context: Context) => ({
  address: user.address,
  buy: (amount: string) => ({
    success: async () => {
      await expect(user.DynamicSale.buy(parseEther(amount))).to.emit(context.DynamicSale, 'SuccessBuy');
    },
    fail: async () => {
      await expect(user.DynamicSale.buy(parseEther(amount))).to.be.reverted;
    },
  }),
  calculateTotalCost: (amount: string) => ({
    toEq: async (expectedTotalCost: string, expectedNewPrice: string) => {
      const resultObj = await context.DynamicSale.calculateTotalCost(parseEther(amount));
      expect(
        resultObj.totalCost,
        `calculateTotalCost: for(${amount}) toEq(${expectedTotalCost}) Got(${formatEther(resultObj.totalCost)})`
      ).to.eq(parseEther(expectedTotalCost));
      expect(
        resultObj.newPrice,
        `calculateTotalCost: for(${amount}) toEq(${expectedNewPrice}) Got(${resultObj.newPrice})`
      ).to.eq(expectedNewPrice);
    },
  }),
  testers: {
    balances: async (token: string, quote?: string) => {
      expect(await context.TDFToken.balanceOf(user.address), 'token Balance').to.eq(parseEther(token));
      if (quote) {
        expect(await context.FakeEURToken.balanceOf(user.address), 'quote balance').to.eq(parseEther(quote));
      }
    },
  },
  helpers: {
    topup: async (amount: string) => {
      await user.FakeEURToken.faucet(parseEther(amount));
    },
    approve: async (amount: string) => {
      await user.FakeEURToken.approve(context.DynamicSale.address, parseEther(amount));
    },
  },
});
describe('DynamicSale', () => {
  let context: Context;
  let user: Signer;
  describe('buy', async () => {
    before(async () => {
      context = await setup();

      user = setSigner(context.users[0], context);
      await user.helpers.topup('100000');
      await user.helpers.approve('10000');
      await context.deployer.TDFToken.mint(context.deployer.address, parseEther('10000'));
    });
    it('should buy', async () => {
      await user.buy('1').success();
      await user.testers.balances('1');
    });
    it('should fail on amount to high', async () => {
      await user.buy('101').fail();
    });
  });
  describe('calculateTotalCost', () => {
    before(async () => {
      context = await setup();

      user = setSigner(context.users[0], context);
      await user.helpers.approve('10000');
    });
    it('should calculate cost', async () => {
      await context.deployer.TDFToken.mint(context.deployer.address, parseEther('5381'));
      await user.calculateTotalCost('19').toEq('4224.39', '223');
      await context.deployer.TDFToken.mint(context.deployer.address, parseEther('19'));
      await user.calculateTotalCost('100').toEq('22444.71', '226');
      await context.deployer.TDFToken.mint(context.deployer.address, parseEther('100'));
      await user.calculateTotalCost('100').toEq('22799.54', '230');
      await context.deployer.TDFToken.mint(context.deployer.address, parseEther('100'));
      await user.calculateTotalCost('51').toEq('11764.14', '232');
      await context.deployer.TDFToken.mint(context.deployer.address, parseEther('51'));
      await user.calculateTotalCost('9').toEq('2085.56', '232');
      await context.deployer.TDFToken.mint(context.deployer.address, parseEther('9'));
      await user.calculateTotalCost('40').toEq('9303.74', '233');
      await context.deployer.TDFToken.mint(context.deployer.address, parseEther('40'));
      await user.calculateTotalCost('100').toEq('23505.32', '237');
      await context.deployer.TDFToken.mint(context.deployer.address, parseEther('100'));
      await user.calculateTotalCost('100').toEq('23854.19', '240');
      await context.deployer.TDFToken.mint(context.deployer.address, parseEther('100'));
      await user.calculateTotalCost('100').toEq('24199.29', '244');
      await context.deployer.TDFToken.mint(context.deployer.address, parseEther('100'));
      await user.calculateTotalCost('100').toEq('24539.98', '247');
      await context.deployer.TDFToken.mint(context.deployer.address, parseEther('100'));
      await user.calculateTotalCost('100').toEq('24875.76', '251');
    });
  });
});
