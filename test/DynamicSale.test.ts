import {expect} from './chai-setup';
import {deployments, ethers, getUnnamedAccounts, getNamedAccounts} from 'hardhat';
import {TDFToken, TDFDiamond, DynamicSale, FakeEURToken} from '../typechain';
import {setupUser, setupUsers} from './utils';
import {parseEther} from 'ethers/lib/utils';

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
  buy: (amount: string) => ({
    success: async () => {
      await expect(user.DynamicSale.buy(parseEther(amount))).to.emit(context.DynamicSale, 'SuccessBuy');
    },
  }),
  testers: {
    balances: async (token: string, quote: string) => {
      expect(await context.TDFToken.balanceOf(user.address), 'token Balance').to.eq(parseEther(token));
      expect(await context.FakeEURToken.balanceOf(user.address), 'quote balance').to.eq(parseEther(quote));
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
      await user.helpers.topup('10000');
      await user.helpers.approve('10');

      await user.buy('1').success();
      await user.testers.balances('1', '9999');
    });
  });
});
