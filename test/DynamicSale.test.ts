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

const setSigner = (user: User, context: Context) => ({
  address: user.address,
  buy: (amount: string) => ({
    success: async () => {
      await context.deployer.TDFToken.mint(context.deployer.address, parseEther('10000'));
      await expect(user.DynamicSale.buy(parseEther(amount))).to.emit(context.DynamicSale, 'SuccessBuy');
    },
  }),
  calculateTotalCost: (amount: string) => ({
    toEq: async (expected: string) => {
      // await context.deployer.TDFToken.mint(context.deployer.address, parseEther('5500'));
      const resultObj = await context.DynamicSale.calculateTotalCost(parseEther(amount));
      expect(
        resultObj.totalCost,
        `calculateTotalCost: for(${amount}) toEq(${expected}) Got(${formatEther(resultObj.totalCost)})`
      ).to.eq(parseEther(expected));
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
  describe('buy', () => {
    it('works', async () => {
      const context = await setup();

      const user = setSigner(context.users[0], context);
      await user.helpers.topup('100000');
      await user.helpers.approve('10000');

      await user.buy('1').success();
      await user.testers.balances('1');
    });
  });

  describe('calculateTotalCost', () => {
    it('works', async () => {
      const context = await setup();

      const user = setSigner(context.users[0], context);

      await user.helpers.approve('10000');
      
      await context.deployer.TDFToken.mint(context.deployer.address, parseEther('5381'));
      await user.calculateTotalCost('19').toEq('4224.39');
      await context.deployer.TDFToken.mint(context.deployer.address, parseEther('19'));
      await user.calculateTotalCost('100').toEq('22444.71');
      await context.deployer.TDFToken.mint(context.deployer.address, parseEther('100'));
      await user.calculateTotalCost('100').toEq('22799.54');
      await context.deployer.TDFToken.mint(context.deployer.address, parseEther('100'));
      await user.calculateTotalCost('51').toEq('11764.14');
      await context.deployer.TDFToken.mint(context.deployer.address, parseEther('51'));
      await user.calculateTotalCost('9').toEq('2085.56');
      await context.deployer.TDFToken.mint(context.deployer.address, parseEther('9'));
      await user.calculateTotalCost('40').toEq('9303.74');
      await context.deployer.TDFToken.mint(context.deployer.address, parseEther('40'));
      await user.calculateTotalCost('100').toEq('23505.32');
      await context.deployer.TDFToken.mint(context.deployer.address, parseEther('100'));
      await user.calculateTotalCost('100').toEq('23854.19');
      await context.deployer.TDFToken.mint(context.deployer.address, parseEther('100'));
      await user.calculateTotalCost('100').toEq('24199.29');
      await context.deployer.TDFToken.mint(context.deployer.address, parseEther('100'));
      await user.calculateTotalCost('100').toEq('24539.98');
      await context.deployer.TDFToken.mint(context.deployer.address, parseEther('100'));
      await user.calculateTotalCost('100').toEq('24875.76');
    });
  });
});
