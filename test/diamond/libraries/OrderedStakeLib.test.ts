import {expect} from '../../chai-setup';
import {deployments, getUnnamedAccounts, network, ethers} from 'hardhat';
import {StakeLibV2Mock, ERC20TestMock, OrderedStakeLibMock} from '../../../typechain';
import {setupUser, setupUsers, getMock} from '../../utils';
import {parseEther} from 'ethers/lib/utils';
import {addDays, getUnixTime} from 'date-fns';
import {ZERO_ADDRESS} from '../../utils';

const BN = ethers.BigNumber;

const setup = deployments.createFixture(async (hre) => {
  const {deployments, getNamedAccounts} = hre;
  await deployments.fixture();

  const accounts = await getNamedAccounts();
  const users = await getUnnamedAccounts();
  const {deployer} = accounts;

  const contracts = {
    map: <OrderedStakeLibMock>await getMock('OrderedStakeLibMock', deployer, []),
  };

  return {
    ...contracts,
    users: await setupUsers(users, contracts),
    deployer: await setupUser(deployer, contracts),
    accounts,
  };
});

type setupReturnType = Awaited<ReturnType<typeof setup>>;
type TestContext = {user: setupReturnType['deployer']} & setupReturnType;

describe('OrderedStakeLibMock', () => {
  const testers = ({user, map}: TestContext) => ({
    push: async (amount: string, tm: number) => {
      await expect(user.map.push(parseEther(amount), tm))
        .to.emit(map, 'PushBack')
        .withArgs(true);
    },

    _popFront: async (amount: string, tm: number) => {
      await expect(user.map._popFront()).to.emit(map, 'PopFront').withArgs(parseEther(amount), BN.from(tm));
    },
    takeMaxUntil: (tm: number) => ({
      success: {
        toTake: async (amount: string) => {
          const prev = await map.balance();
          await expect(user.map.takeMaxUntil(tm)).to.emit(map, 'Released');
          const after = await map.balance();
          expect(prev.sub(after), `takeMaxUntil toTake=${amount}`).to.eq(parseEther(amount));
        },
      },
    }),

    takeUntil: (amount: string, untilTm: number) => ({
      success: async () => {
        await expect(
          user.map.takeUntil(parseEther(amount), untilTm),
          `takeUntil.success amount=${amount}, untilTm=${untilTm}`
        )
          .to.emit(map, 'Released')
          .withArgs(parseEther(amount), untilTm);
      },
      reverted: {
        notEnoughBalance: async () => {
          await expect(
            user.map.takeUntil(parseEther(amount), untilTm),
            `takeUntil.reverted.notEnoughBalance amount=${amount}, untilTm=${untilTm}`
          ).to.be.revertedWith('NOT_ENOUGH_BALANCE');
        },
        notEnoughUnlockable: async () => {
          await expect(
            user.map.takeUntil(parseEther(amount), untilTm),
            `takeUntil.reverted.notEnoughUnlockable amount=${amount}, untilTm=${untilTm}`
          ).to.be.revertedWith('NOT_ENOUGHT_UNLOCKABLE_BALANCE');
        },
      },
    }),
    test: {
      balanceUntil: (tm: number) => ({
        toEq: async (expected: string) => {
          const val = await map.balanceUntil(tm);
          expect(val, `avaiableUntil timestamp=${tm} expected=${expected}`).to.eq(parseEther(expected));
        },
      }),
      balanceFrom: (tm: number) => ({
        toEq: async (expected: string) => {
          const val = await map.balanceFrom(tm);
          expect(val, `balanceFrom timestamp=${tm} expected=${expected}`).to.eq(parseEther(expected));
        },
      }),
      balance: async (amount: string) => {
        const val = await map.balance();
        expect(val, `balance toEq=${amount}`).to.eq(parseEther(amount));
      },
      deposits: async (examples: [string, number][]) => {
        const deposits = await map.deposits();
        for (let i = 0; i < examples.length; i++) {
          expect(deposits[i], `deposit should exits amount=${examples[i][0]} tm=${examples[i][1]}`).to.not.be.undefined;
          expect(deposits[i].amount, 'deposits amount').to.eq(parseEther(examples[i][0]));
          expect(deposits[i].timestamp, 'deposits timestamp').to.eq(BN.from(examples[i][1]));
        }
      },
    },
  });
  it('push', async () => {
    const context = await setup();
    const {users} = context;
    const {push, test, _popFront} = testers({...context, user: users[0]});

    await push('1', 1);
    await push('3', 3);
    await push('2', 2);
    await test.deposits([
      ['1', 1],
      ['2', 2],
      ['3', 3],
    ]);
    await test.balance('6');
    await push('5', 5);
    await push('4', 4);
    await test.deposits([
      ['1', 1],
      ['2', 2],
      ['3', 3],
      ['4', 4],
      ['5', 5],
    ]);
    await test.balance('15');
    await _popFront('1', 1);
    await _popFront('2', 2);
    await _popFront('3', 3);
    await test.deposits([
      ['4', 4],
      ['5', 5],
    ]);
    await test.balance('9');
    await push('1', 1);
    await test.deposits([
      ['1', 1],
      ['4', 4],
      ['5', 5],
    ]);
    await test.balance('10');
    // Update timestamps
    await push('4', 4);
    await test.balance('14');
    await test.deposits([
      ['1', 1],
      ['8', 4],
      ['5', 5],
    ]);
  });
  it('takeUntil', async () => {
    const context = await setup();
    const {users} = context;
    const {push, test, takeUntil} = testers({...context, user: users[0]});
    // END SETUP
    await takeUntil('1', 1).reverted.notEnoughBalance();
    await push('1', 1);
    await test.deposits([['1', 1]]);
    await test.balance('1');
    await takeUntil('1', 0).reverted.notEnoughUnlockable();
    await push('3', 3);
    await push('2', 2);
    await test.balance('6');
    await test.deposits([
      ['1', 1],
      ['2', 2],
      ['3', 3],
    ]);
    await takeUntil('0.5', 2).success();
    await test.balance('5.5');
    await test.deposits([
      ['0.5', 1],
      ['2', 2],
      ['3', 3],
    ]);
    await takeUntil('0.75', 2).success();
    await test.balance('4.75');
    await test.deposits([
      ['1.75', 2],
      ['3', 3],
    ]);
    await takeUntil('0.75', 1).reverted.notEnoughUnlockable();
    await test.deposits([
      ['1.75', 2],
      ['3', 3],
    ]);
  });
  it('takeMaxUntil', async () => {
    const context = await setup();
    const {users} = context;
    const {push, test, takeMaxUntil} = testers({...context, user: users[0]});
    // END SETUP

    await takeMaxUntil(1).success.toTake('0');
    await push('1', 1);
    await test.deposits([['1', 1]]);
    await test.balance('1');
    await takeMaxUntil(0).success.toTake('0');
    await push('3', 3);
    await push('2', 2);
    await test.balance('6');
    await test.deposits([
      ['1', 1],
      ['2', 2],
      ['3', 3],
    ]);
    await takeMaxUntil(3).success.toTake('6');
    await test.balance('0');

    await push('1', 1);
    await push('3', 3);
    await push('2', 2);
    await test.balance('6');
    await test.deposits([
      ['1', 1],
      ['2', 2],
      ['3', 3],
    ]);
    await push('0.5', 2);
    await test.deposits([
      ['1', 1],
      ['2.5', 2],
      ['3', 3],
    ]);
    await takeMaxUntil(2).success.toTake('3.5');
  });

  it('balanceUntil and balanceFrom', async () => {
    const context = await setup();
    const {users} = context;
    const {push, test} = testers({...context, user: users[0]});
    // END SETUP
    // available
    await test.balanceUntil(1).toEq('0');
    await test.balanceUntil(2).toEq('0');
    await test.balanceUntil(3).toEq('0');
    // locked
    await test.balanceFrom(1).toEq('0');
    await test.balanceFrom(2).toEq('0');
    await test.balanceFrom(3).toEq('0');

    await push('1', 1);
    await push('3', 3);
    await push('2', 2);
    await test.balance('6');
    await test.deposits([
      ['1', 1],
      ['2', 2],
      ['3', 3],
    ]);

    // releasable
    await test.balanceUntil(1).toEq('1');
    await test.balanceUntil(2).toEq('3');
    await test.balanceUntil(3).toEq('6');

    // locked
    await test.balanceFrom(1).toEq('5');
    await test.balanceFrom(2).toEq('3');
    await test.balanceFrom(3).toEq('0');
  });
});
