import {expect} from '../../chai-setup';
import {deployments, getUnnamedAccounts, network, ethers} from 'hardhat';
import {StakeLibV2Mock, ERC20TestMock, OrderedStakeLibMock} from '../../../typechain';
import {setupUser, setupUsers, getMock} from '../../utils';
import {formatEther, parseEther} from 'ethers/lib/utils';
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
    pushFront: async (amount: string, tm: number) => {
      await expect(user.map.pushFront(parseEther(amount), tm))
        .to.emit(map, 'PushFront')
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
    takeAt: (amount: string, tm: number) => ({
      success: async () => {
        const prev = await map.balance();
        await expect(user.map.takeAt(parseEther(amount), tm)).to.emit(map, 'Released');
        const after = await map.balance();
        expect(prev.sub(after), `takeAt toTake=${amount} at(${tm})`).to.eq(parseEther(amount));
      },
      reverted: {
        notFound: async () => {
          await expect(
            user.map.takeAt(parseEther(amount), tm),
            `takeAt reverted notFound amount(${amount}) at(${tm})`
          ).to.be.revertedWith('NotFound');
        },
        notEnough: async () => {
          await expect(
            user.map.takeAt(parseEther(amount), tm),
            `takeAt notEnough amount(${amount}) at(${tm})`
          ).to.be.revertedWith('InsufficientDeposit');
        },
      },
    }),
    moveFront: (amount: string, from: number, to: number) => ({
      success: async () => {
        await expect(user.map.moveFront(parseEther(amount), from, to))
          .to.emit(map, 'Moved')
          .withArgs(parseEther(amount), from, to);
      },
      reverted: {
        empty: async () => {
          await expect(user.map.moveFront(parseEther(amount), from, to)).to.be.revertedWith('Empty');
        },
        outOfBounds: async () => {
          await expect(user.map.moveFront(parseEther(amount), from, to)).to.be.revertedWith('OutOfBounds');
        },
        wrongRange: async () => {
          await expect(user.map.moveFront(parseEther(amount), from, to)).to.be.revertedWith('WrongRange');
        },
      },
    }),
    moveBack: (amount: string, from: number, to: number) => ({
      success: async () => {
        await expect(user.map.moveBack(parseEther(amount), from, to))
          .to.emit(map, 'Moved')
          .withArgs(parseEther(amount), from, to);
      },
      reverted: {
        empty: async () => {
          await expect(user.map.moveBack(parseEther(amount), from, to)).to.be.revertedWith('Empty');
        },
        outOfBounds: async () => {
          await expect(user.map.moveBack(parseEther(amount), from, to)).to.be.revertedWith('OutOfBounds');
        },
        wrongRange: async () => {
          await expect(user.map.moveBack(parseEther(amount), from, to)).to.be.revertedWith('WrongRange');
        },
      },
    }),
    moveFrontRanged: (amount: string, from: number, to: number) => ({
      success: async () => {
        await expect(user.map.moveFrontRanged(parseEther(amount), from, to))
          .to.emit(map, 'Moved')
          .withArgs(parseEther(amount), from, to);
      },
      reverted: {
        empty: async () => {
          await expect(
            user.map.moveFrontRanged(parseEther(amount), from, to),
            `moveFrontRanged.reverted.notEnoughBalance amount=${amount}, from=${from}, to=${to}`
          ).to.be.revertedWith('Empty');
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
      balance: () => ({
        toEq: async (amount: string) => {
          const val = await map.balance();
          expect(val, `balance toEq(${amount}) but Got(${formatEther(val)})`).to.eq(parseEther(amount));
        },
      }),
      deposits: async (examples: [string, number][], debug = false) => {
        const deposits = await map.deposits();
        if (debug) {
          console.log(deposits.map((e) => `amount: ${formatEther(e.amount)}, tm: ${e.timestamp}`));
        }
        for (let i = 0; i < examples.length; i++) {
          expect(deposits[i], `deposit should exits amount=${examples[i][0]} tm=${examples[i][1]}`).to.not.be.undefined;
          const amount = deposits[i].amount;
          const exAmount = parseEther(examples[i][0]);
          expect(
            amount,
            `deposits amount at(${deposits[i].timestamp}) toEq(${examples[i][0]}) but Got(${formatEther(amount)})`
          ).to.eq(exAmount);
          expect(deposits[i].timestamp, 'deposits timestamp').to.eq(BN.from(examples[i][1]));
        }
      },
    },
  });

  describe('moveFrontRanged', () => {
    it('success', async () => {
      const context = await setup();
      const {users} = context;
      const {push, test, moveFrontRanged} = testers({...context, user: users[0]});

      await push('1', 10);
      await push('1', 30);
      await push('1', 20);
      await push('1', 40);
      await push('1', 50);
      await test.deposits([
        ['1', 10],
        ['1', 20],
        ['1', 30],
        ['1', 40],
        ['1', 50],
      ]);
      await test.balance().toEq('5');
      await moveFrontRanged('1', 33, 22).success();
      await test.deposits([
        ['1', 10],
        ['1', 20],
        ['1', 22],
        ['1', 40],
        ['1', 50],
      ]);
      await test.balance().toEq('5');
      await moveFrontRanged('0.5', 55, 22).success();
      await test.deposits([
        ['1', 10],
        ['1', 20],
        ['1.5', 22],
        ['1', 40],
        ['0.5', 50],
      ]);
      await test.balance().toEq('5');
      await moveFrontRanged('2', 45, 22).success();
      await test.deposits([
        ['1', 10],
        ['1', 20],
        ['2.5', 22],
        ['0.5', 50],
      ]);
      await test.balance().toEq('5');
      await moveFrontRanged('2', 45, 7).success();
      await test.deposits([
        ['2', 7],
        ['1', 10],
        ['1', 20],
        ['0.5', 22],
        ['0.5', 50],
      ]);
      await test.balance().toEq('5');
    });
    it('optimistic success', async () => {
      const context = await setup();
      const {users} = context;
      const {push, test, moveFrontRanged} = testers({...context, user: users[0]});

      await push('1', 10);
      await push('1', 20);
      await push('1', 30);
      await push('1', 40);
      await push('1', 50);
      await test.balance().toEq('5');
      await moveFrontRanged('4', 30, 4).success();
      await test.deposits([
        ['3', 4],
        ['1', 40],
        ['1', 50],
      ]);
      await test.balance().toEq('5');
      await moveFrontRanged('3', 50, 40).success();
      await test.deposits([
        ['3', 4],
        ['2', 40],
      ]);
      await test.balance().toEq('5');
    });
    it('reverts', async () => {
      const context = await setup();
      const {users} = context;
      const {push, test, moveFrontRanged} = testers({...context, user: users[0]});

      await push('1', 10);
      await push('1', 20);
      await push('1', 30);
      await push('1', 40);
      await push('1', 50);
      await moveFrontRanged('3', 7, 4).reverted.empty();
      await test.balance().toEq('5');
    });
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
    await test.balance().toEq('6');
    await push('5', 5);
    await push('4', 4);
    await test.deposits([
      ['1', 1],
      ['2', 2],
      ['3', 3],
      ['4', 4],
      ['5', 5],
    ]);
    await test.balance().toEq('15');
    await _popFront('1', 1);
    await _popFront('2', 2);
    await _popFront('3', 3);
    await test.deposits([
      ['4', 4],
      ['5', 5],
    ]);
    await test.balance().toEq('9');
    await push('1', 1);
    await test.deposits([
      ['1', 1],
      ['4', 4],
      ['5', 5],
    ]);
    await test.balance().toEq('10');
    // Update timestamps
    await push('4', 4);
    await test.balance().toEq('14');
    await test.deposits([
      ['1', 1],
      ['8', 4],
      ['5', 5],
    ]);
  });
  it('pushFront', async () => {
    const context = await setup();
    const {users} = context;
    const {pushFront, test, _popFront} = testers({...context, user: users[0]});

    await pushFront('1', 1);
    await pushFront('3', 3);
    await pushFront('2', 2);
    await test.deposits([
      ['1', 1],
      ['2', 2],
      ['3', 3],
    ]);
    await test.balance().toEq('6');
    await pushFront('5', 5);
    await pushFront('4', 4);
    await test.deposits([
      ['1', 1],
      ['2', 2],
      ['3', 3],
      ['4', 4],
      ['5', 5],
    ]);
    await test.balance().toEq('15');
    await _popFront('1', 1);
    await _popFront('2', 2);
    await _popFront('3', 3);
    await test.deposits([
      ['4', 4],
      ['5', 5],
    ]);
    await test.balance().toEq('9');
    await pushFront('1', 1);
    await test.deposits([
      ['1', 1],
      ['4', 4],
      ['5', 5],
    ]);
    await test.balance().toEq('10');
    // Update timestamps
    await pushFront('4', 4);
    await test.balance().toEq('14');
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
    await test.balance().toEq('1');
    await takeUntil('1', 0).reverted.notEnoughUnlockable();
    await push('3', 3);
    await push('2', 2);
    await test.balance().toEq('6');
    await test.deposits([
      ['1', 1],
      ['2', 2],
      ['3', 3],
    ]);
    await takeUntil('0.5', 2).success();
    await test.balance().toEq('5.5');
    await test.deposits([
      ['0.5', 1],
      ['2', 2],
      ['3', 3],
    ]);
    await takeUntil('0.75', 2).success();
    await test.balance().toEq('4.75');
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
  it('takeAt', async () => {
    const context = await setup();
    const {users} = context;
    const {push, test, takeAt} = testers({...context, user: users[0]});
    // END SETUP

    await push('1', 10);
    await push('1', 20);
    await push('1', 30);

    await takeAt('1', 10).success();

    await test.deposits([
      ['1', 20],
      ['1', 30],
    ]);
    await test.balance().toEq('2');
    await takeAt('1', 29).reverted.notFound();
    await test.deposits([
      ['1', 20],
      ['1', 30],
    ]);
    await takeAt('2', 30).reverted.notEnough();
    await takeAt('0.5', 20).success();
    await takeAt('0.5', 30).success();
    await test.deposits([
      ['0.5', 20],
      ['0.5', 30],
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
    await test.balance().toEq('1');
    await takeMaxUntil(0).success.toTake('0');
    await push('3', 3);
    await push('2', 2);
    await test.balance().toEq('6');
    await test.deposits([
      ['1', 1],
      ['2', 2],
      ['3', 3],
    ]);
    await takeMaxUntil(3).success.toTake('6');
    await test.balance().toEq('0');

    await push('1', 1);
    await push('3', 3);
    await push('2', 2);
    await test.balance().toEq('6');
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
    await test.balance().toEq('6');
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
  describe('moveFront', () => {
    it('reverted', async () => {
      const context = await setup();
      const {users} = context;
      const {moveFront, push, test} = testers({...context, user: users[0]});
      await moveFront('1', 100, 1).reverted.empty();
      await moveFront('3', 1, 10).reverted.wrongRange();
      await push('1', 10);
      await push('1', 20);
      await push('1', 30);
      await moveFront('3', 10, 1).success();
      await test.deposits([
        ['1', 1],
        ['1', 20],
        ['1', 30],
      ]);
      await test.balance().toEq('3');
    });
    it('whole amount to new bucket', async () => {
      const context = await setup();
      const {users} = context;
      const {moveFront, push, test} = testers({...context, user: users[0]});
      await push('1', 10);
      await push('1', 20);
      await push('1', 30);
      // Move whole amount to new bucket
      await moveFront('1', 30, 23).success();
      await test.deposits([
        ['1', 10],
        ['1', 20],
        ['1', 23],
      ]);
      await test.balance().toEq('3');

      await moveFront('1', 20, 11).success();
      await test.deposits([
        ['1', 10],
        ['1', 11],
        ['1', 23],
      ]);
      await test.balance().toEq('3');
    });
    it('partial amount to new bucket', async () => {
      const context = await setup();
      const {users} = context;
      const {moveFront, push, test} = testers({...context, user: users[0]});
      await push('1', 10);
      await push('1', 20);
      await push('1', 30);

      // Move part of bucket to new bucket
      await test.deposits([
        ['1', 10],
        ['1', 20],
        ['1', 30],
      ]);
      await test.balance().toEq('3');

      await moveFront('0.5', 30, 24).success();
      await test.deposits([
        ['1', 10],
        ['1', 20],
        ['0.5', 24],
        ['0.5', 30],
      ]);
      await test.balance().toEq('3');

      await moveFront('0.5', 30, 23).success();
      await test.deposits([
        ['1', 10],
        ['1', 20],
        ['0.5', 23],
        ['0.5', 24],
      ]);
      await test.balance().toEq('3');
    });
    it('bigger amount to new bucket', async () => {
      const context = await setup();
      const {users} = context;
      const {moveFront, push, test} = testers({...context, user: users[0]});
      await push('1', 10);
      await push('1', 20);
      await push('1', 30);

      // Move part of bucket to new bucket
      await test.deposits([
        ['1', 10],
        ['1', 20],
        ['1', 30],
      ]);
      await moveFront('1.5', 30, 19).success();
      await test.deposits([
        ['1', 10],
        ['1.5', 19],
        ['0.5', 20],
      ]);
      await moveFront('1', 20, 10).success();
      await test.deposits([
        ['2', 10],
        ['1', 19],
      ]);
      await moveFront('3', 19, 9).success();
      await test.deposits([['3', 9]]);
      await test.balance().toEq('3');
    });
  });
  describe('moveBack', () => {
    it('reverted', async () => {
      const context = await setup();
      const {users} = context;
      const {moveBack, push, test} = testers({...context, user: users[0]});
      await moveBack('1', 1, 100).reverted.empty();
      await moveBack('3', 10, 1).reverted.wrongRange();
      await push('1', 10);
      await push('1', 20);
      await push('1', 30);
      await moveBack('3', 30, 40).success();
      await test.deposits([
        ['1', 10],
        ['1', 20],
        ['1', 40],
      ]);
      await test.balance().toEq('3');
    });
    it('whole amount to new bucket', async () => {
      const context = await setup();
      const {users} = context;
      const {moveBack, push, test} = testers({...context, user: users[0]});
      await push('1', 10);
      await push('1', 20);
      await push('1', 30);
      // Move whole amount to new bucket
      await moveBack('1', 10, 23).success();
      await test.deposits([
        ['1', 20],
        ['1', 23],
        ['1', 30],
      ]);
      await test.balance().toEq('3');

      await moveBack('1', 20, 24).success();
      await test.deposits([
        ['1', 23],
        ['1', 24],
        ['1', 30],
      ]);
      await test.balance().toEq('3');
    });
    it('partial amount to new bucket', async () => {
      const context = await setup();
      const {users} = context;
      const {moveBack, push, test} = testers({...context, user: users[0]});
      await push('1', 10);
      await push('1', 20);
      await push('1', 30);

      // Move part of bucket to new bucket
      await test.deposits([
        ['1', 10],
        ['1', 20],
        ['1', 30],
      ]);
      await test.balance().toEq('3');

      await moveBack('0.5', 20, 24).success();
      await test.deposits([
        ['1', 10],
        ['0.5', 20],
        ['0.5', 24],
        ['1', 30],
      ]);
      await test.balance().toEq('3');

      await moveBack('0.5', 10, 30).success();
      await test.deposits([
        ['0.5', 10],
        ['0.5', 20],
        ['0.5', 24],
        ['1.5', 30],
      ]);
      await test.balance().toEq('3');
    });
    it('bigger amount to new bucket', async () => {
      const context = await setup();
      const {users} = context;
      const {moveBack, push, test} = testers({...context, user: users[0]});
      await push('1', 10);
      await push('1', 20);
      await push('1', 30);

      // Move part of bucket to new bucket
      await test.deposits([
        ['1', 10],
        ['1', 20],
        ['1', 30],
      ]);
      await moveBack('1.5', 10, 30).success();
      await test.deposits([
        ['0.5', 20],
        ['2.5', 30],
      ]);
      await moveBack('1', 20, 31).success();
      await test.deposits([
        ['2', 30],
        ['1', 31],
      ]);
      await moveBack('3', 30, 33).success();
      await test.deposits([['3', 33]]);
      await test.balance().toEq('3');
    });
  });

  describe('cancel behaviour at data structure level', () => {
    describe('Case 1: No reservations in the future', () => {
      xit('remove one', async () => {
        const context = await setup();
        const {users} = context;
        const {push, test} = testers({...context, user: users[0]});
        await push('1', 10);
        await push('1', 20);
        await push('1', 30);

        // map.takeAt(amount, at)
      });
      xit('remove sequenced group', async () => {
        // for loop
        // map.takeAt(amount, at)
      });
      xit('remove bunch separated with time periods in between', async () => {
        // same, iterator
      });
    });
  });
});
