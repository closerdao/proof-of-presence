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
    fail: async (revertMsg: string) => {
      await expect(context.DynamicSale.calculateTotalCost(parseEther(amount))).to.be.revertedWith(revertMsg);
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
    mintTDF: async (amount: number) => {
      for (let i = 0; i < amount; i += 100) {
        await context.deployer.TDFToken.mint(context.deployer.address, parseEther('100'));
      }
    },
  },
});
describe('DynamicSale', () => {
  let context: Context;
  let user: Signer;
  describe('buy', async () => {
    beforeEach(async () => {
      context = await setup();

      user = setSigner(context.users[0], context);
      await user.helpers.topup('100000000');

      await user.helpers.approve('1000000');
      await context.deployer.TDFToken.mint(context.deployer.address, parseEther('10000'));
      await context.deployer.DynamicSale.setMaxLiquidSupply(parseEther('70000'));
    });
    it('should buy', async () => {
      await user.buy('1').success();
      await user.testers.balances('1');
    });
    it('should buy max amount per wallet', async () => {
      await user.buy('100').success();
      await user.testers.balances('100');
    });
    it('should fail on amount + balance > max amount per wallet', async () => {
      // Buy 900 tokens
      for (let i = 0; i < 9; i++) {
        await user.buy('100').success();
      }
      await user.testers.balances('900');
      await user.buy('16').fail();
    });
    it('should fail on buy amount > 100', async () => {
      await user.buy('101').fail();
    });
  });
  describe('calculateTotalCost', () => {
    before(async () => {
      context = await setup();

      user = setSigner(context.users[0], context);
      await user.helpers.approve('10000');
    });
    describe('with supply of 10k', () => {
      it('calculates the correct total cost for the next buy of 100 units', async () => {
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
        await context.deployer.TDFToken.mint(context.deployer.address, parseEther('100'));
        await user.calculateTotalCost('100').toEq('25206.2', '253');
        await user.helpers.mintTDF(3800);
        await user.calculateTotalCost('100').toEq('33588.26', '337');
      });
    });
    describe('with supply of 20k', () => {
      it('calculates the correct total cost for the next purchase of 100 units', async () => {
        await user.helpers.mintTDF(10000);
        await user.calculateTotalCost('100').toEq('39491.53', '395');
      });
    });
    describe('with supply of 30k', () => {
      it('calculates the correct total cost for the next purchase of 100 units', async () => {
        await user.helpers.mintTDF(10000);
        await user.calculateTotalCost('100').toEq('40824.45', '409');
      });
    });
    describe('with supply of 40k', () => {
      it('calculates the correct total cost for the next purchase of 100 units', async () => {
        await user.helpers.mintTDF(10000);
        await user.calculateTotalCost('100').toEq('41321.63', '413');
      });
    });
    describe('with supply of 50k', () => {
      it('calculates the correct total cost for the next purchase of 100 units', async () => {
        await user.helpers.mintTDF(10000);
        await user.calculateTotalCost('100').toEq('41559.25', '416');
      });
    });
    describe('with supply of 60k', () => {
      it('calculates the correct total cost for the next purchase of 100 units', async () => {
        await user.helpers.mintTDF(10000);
        await user.calculateTotalCost('100').toEq('41690.87', '417');
      });
    });
    describe('with supply of 70k', () => {
      it('calculates the correct total cost for the next purchase of 100 units', async () => {
        await user.helpers.mintTDF(10000);
        await user.calculateTotalCost('100').toEq('41771.28', '418');
      });
    });
    describe('with supply of 80k', () => {
      it('calculates the correct total cost for the next purchase of 100 units', async () => {
        await user.helpers.mintTDF(10000);
        await user.calculateTotalCost('100').toEq('41823.96', '419');
      });
    });
    describe('with supply of 90k', () => {
      it('calculates the correct total cost for the next purchase of 100 units', async () => {
        await user.helpers.mintTDF(10000);
        await user.calculateTotalCost('100').toEq('41860.34', '419');
      });
    });
    describe('with supply of 100k', () => {
      it('calculates the correct total cost for the next purchase of 100 units', async () => {
        await user.helpers.mintTDF(10000);
        await user.calculateTotalCost('100').toEq('41886.51', '419');
      });
    });
    describe('with supply of 110k', () => {
      it('calculates the correct total cost for the next purchase of 100 units', async () => {
        await user.helpers.mintTDF(10000);
        await user.calculateTotalCost('100').toEq('41905.95', '420');
      });
    });
    describe('with supply of 120k', () => {
      it('calculates the correct total cost for the next purchase of 100 units', async () => {
        await user.helpers.mintTDF(10000);
        await user.calculateTotalCost('100').toEq('41920.8', '420');
      });
    });
    describe('with supply of 130k', () => {
      it('calculates the correct total cost for the next purchase of 100 units', async () => {
        await user.helpers.mintTDF(10000);
        await user.calculateTotalCost('100').toEq('41932.39', '420');
      });
    });
    describe('with supply of 140k', () => {
      it('calculates the correct total cost for the next purchase of 100 units', async () => {
        await user.helpers.mintTDF(10000);
        await user.calculateTotalCost('100').toEq('41941.61', '420');
      });
    });
    describe('with supply of 150k', () => {
      it('calculates the correct total cost for the next purchase of 100 units', async () => {
        await user.helpers.mintTDF(10000);
        await user.calculateTotalCost('100').toEq('41949.07', '420');
      });
    });
    describe('with supply of 160k', () => {
      it('calculates the correct total cost for the next purchase of 100 units', async () => {
        await user.helpers.mintTDF(10000);
        await user.calculateTotalCost('100').toEq('41955.18', '420');
      });
    });
    describe('with supply of 170k', () => {
      it('calculates the correct total cost for the next purchase of 100 units', async () => {
        await user.helpers.mintTDF(10000);
        await user.calculateTotalCost('100').toEq('41960.25', '420');
      });
    });
    describe('with supply of 180k', () => {
      it('calculates the correct total cost for the next purchase of 100 units', async () => {
        await user.helpers.mintTDF(10000);
        await user.calculateTotalCost('100').toEq('41964.51', '420');
      });
    });
    describe('with supply of 190k', () => {
      it('calculates the correct total cost for the next purchase of 100 units', async () => {
        await user.helpers.mintTDF(10000);
        await user.calculateTotalCost('100').toEq('41968.12', '420');
      });
    });
    describe('with supply of 200k', () => {
      it('reverts if trying to calculate costs for additional purchase', async () => {
        await user.helpers.mintTDF(10000);
        await user.calculateTotalCost('100').fail('DynamicSale: totalSupply limit reached');
      });
    });
  });
});
