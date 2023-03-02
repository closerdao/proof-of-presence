import {expect} from './chai-setup';
import {deployments, ethers, getUnnamedAccounts, getNamedAccounts} from 'hardhat';
import {TDFToken, TDFDiamond, DynamicSale, FakeEURToken, TDFToken__factory} from '../typechain';
import {setupUser, setupUsers} from './utils';
import {formatEther, parseEther} from 'ethers/lib/utils';
import dynamicPriceMock from './dynamic-token-price-from-amount.json';

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
      await expect(user.DynamicSale.buy(parseEther(amount))).to.emit(context.DynamicSale, 'SuccessBuy');
    },
  }),
  calculateTotalCost: (amount: string) => ({
    toEq: async (expected: string) => {
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

describe.only('DynamicSale', () => {
  describe('buy', () => {
    it.skip('works', async () => {
      const context = await setup();

      const user = setSigner(context.users[0], context);
      await user.helpers.topup('100000');
      await user.helpers.approve('10000');

      await user.buy('1').success();
      await user.testers.balances('1');
    });

    it('starts from last price and increments price', async () => {
      console.log('TEST');
      // const context = await setup();

      // await context.deployer.TDFToken.mint(context.deployer.address, parseEther('4109'));

      // const user = setSigner(context.users[0], context);
      // await user.helpers.topup('5000000');
      // await user.helpers.approve('5000000');

      // console.log(await context.deployer.TDFToken.totalSupply());

      // await user.calculateTotalCost('100').toEq('18960.23');
      // await user.buy('100').success();
      // await user.testers.balances('100');

      // await user.calculateTotalCost('100').toEq('60466.72');
      // await user.buy('100').success();
      // await user.testers.balances('200');
      // await user.calculateTotalCost('100').toEq('78245.59');
      // await user.buy('100').success();
      // await user.testers.balances('300');
      // await user.calculateTotalCost('100').toEq('128845.64');
    });
  });

  describe('calculateTotalCost', () => {
    it.only('works', async () => {
      const context = await setup();

      const user = setSigner(context.users[0], context);

      await context.deployer.TDFToken.mint(context.deployer.address, parseEther('2433'));

      await Promise.all(
        dynamicPriceMock.map(async (item) => {
          await user.calculateTotalCost(item.amount).toEq(item.price);
          return item;
        })
      );
    });
  });
});
