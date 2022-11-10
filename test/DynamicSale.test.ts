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
      await expect(user.DynamicSale.buy(parseEther(amount))).to.emit(context.DynamicSale, 'SuccessBuy');
    },
  }),
  calculatePrice: (amount: string) => ({
    toEq: async (expected: string) => {
      const cost = await context.DynamicSale.calculatePrice(parseEther(amount));
      expect(cost, `calculatePrice: for(${amount}) toEq(${expected}) Got(${formatEther(cost)})`).to.eq(
        parseEther(expected)
      );
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
    xit('works', async () => {
      const context = await setup();

      const user = setSigner(context.users[0], context);
      await user.helpers.topup('100000');
      await user.helpers.approve('10000');

      await user.buy('1').success();
      await user.testers.balances('1');
    });

    it('starts from last price and increments price', async () => {
      const context = await setup();

      await context.deployer.TDFToken.mint(context.deployer.address, parseEther('2334'));

      const user = setSigner(context.users[0], context);
      await user.helpers.topup('5000000');
      await user.helpers.approve('5000000');

      await user.calculatePrice('100').toEq('28855.65');
      await user.buy('100').success();
      await user.testers.balances('100');

      await user.calculatePrice('100').toEq('47516.93');
      await user.buy('100').success();
      await user.testers.balances('200');
      await user.calculatePrice('100').toEq('78245.59');
      await user.buy('100').success();
      await user.testers.balances('300');
      await user.calculatePrice('100').toEq('128845.64');
    });
  });

  describe('calculatePrice', () => {
    xit('works', async () => {
      const context = await setup();

      const user = setSigner(context.users[0], context);

      await context.deployer.TDFToken.mint(context.deployer.address, parseEther('2433'));

      // await user.calculatePrice('1').toEq('223.12');
      // await user.calculatePrice('5').toEq('1126.77');
      // await user.calculatePrice('10').toEq('2281.98');
      // await user.calculatePrice('20').toEq('4680.66');
      // await user.calculatePrice('30').toEq('7202.0');
      await user.calculatePrice('100').toEq('28855.65');
      // await user.calculatePrice('5000').toEq('28855.641455224455');
    });
  });
});