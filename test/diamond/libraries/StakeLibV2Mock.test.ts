import {expect} from '../../chai-setup';
import {deployments, getUnnamedAccounts, network, ethers} from 'hardhat';
import {StakeLibV2Mock, ERC20TestMock} from '../../../typechain';
import {setupUser, setupUsers, getMock} from '../../utils';
import {parseEther} from 'ethers/lib/utils';
import {addDays, getUnixTime} from 'date-fns';
import {ZERO_ADDRESS} from '../../utils';

const BN = ethers.BigNumber;

const buildDate = (offset: number) => {
  const initDate = Date.now();
  return getUnixTime(addDays(initDate, offset));
};

const setup = deployments.createFixture(async (hre) => {
  const {deployments, getNamedAccounts} = hre;
  await deployments.fixture();

  const accounts = await getNamedAccounts();
  const users = await getUnnamedAccounts();
  const {deployer} = accounts;

  const token = <ERC20TestMock>await getMock('ERC20TestMock', deployer, []);

  const contracts = {
    token: token,
    stake: <StakeLibV2Mock>await getMock('StakeLibV2Mock', deployer, [token.address]),
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

const setupTest = (context: TestContext) => {
  const {token, user, stake} = context;
  return {
    test: {
      balances: async (TK: string, tkU: string, u: string) => {
        expect(await token.balanceOf(stake.address), `balances: staking Contract owns token`).to.eq(parseEther(TK));
        expect(await stake.balanceOf(user.address), `balances: user amount staked`).to.eq(parseEther(tkU));
        expect(await token.balanceOf(user.address), 'balances: user amount of token').to.eq(parseEther(u));
      },

      deposits: async (examples: [string, number][]) => {
        const deposits = await stake.depositsFor(user.address);
        for (let i = 0; i < deposits.length; i++) {
          expect(deposits[i].amount, 'deposits amount').to.eq(parseEther(examples[i][0]));
          expect(deposits[i].timestamp, 'deposits timestamp').to.eq(BN.from(examples[i][1]));
        }
      },
      stake: async (locked: string, unlocked: string) => {
        expect(await stake.locked(user.address), 'stake: locked stake').to.eq(parseEther(locked));
        expect(await stake.unlocked(user.address), 'stake: unlocked stake').to.eq(parseEther(unlocked));
      },
    },
    tokenManagement: tokenManagement(context),
    restakeOrDepositAtFor: async (a: string, tm: number) => {
      await expect(user.stake.restakeOrDepositAtFor(user.address, parseEther(a), tm)).to.emit(
        stake,
        'RestakeOrDepositedAtForStatus'
      );
    },
    deposit: {
      success: async (amount: string) => {
        await expect(user.stake.deposit(parseEther(amount)))
          .to.emit(stake, 'DepositedTokens')
          .withArgs(user.address, parseEther(amount));
      },
    },
    withdrawMax: {
      success: async (amount: string) => {
        await expect(user.stake.withdrawMax(), `withdrawMax.success ${amount}`)
          .to.emit(stake, 'WithdrawnTokens')
          .withArgs(user.address, parseEther(amount));
      },
      none: async () => {
        await expect(user.stake.withdrawMax(), `withdrawMax.none`).to.not.emit(stake, 'WithdrawnTokens');
      },
    },
    withdraw: (amount: string) => ({
      success: async () => {
        await expect(user.stake.withdraw(parseEther(amount)), `withdraw.success ${amount}`)
          .to.emit(stake, 'WithdrawnTokens')
          .withArgs(user.address, parseEther(amount));
      },
      reverted: {
        unlockable: async () => {
          await expect(
            user.stake.withdraw(parseEther(amount)),
            `withdraw.reverted.unlockable ${amount}`
          ).to.be.revertedWith('NOT_ENOUGHT_UNLOCKABLE_BALANCE');
        },
        noBalance: async () => {
          await expect(
            user.stake.withdraw(parseEther(amount)),
            `withdraw.reverted.noBalance ${amount}`
          ).to.be.revertedWith('NOT_ENOUGH_BALANCE');
        },
      },
    }),
  };
};

const tokenManagement = ({token, user, stake}: TestContext) => {
  return {
    topUp: async (amount: string) => {
      await expect(user.token.faucet(parseEther(amount)))
        .to.emit(token, 'Transfer')
        .withArgs(ZERO_ADDRESS, user.address, parseEther(amount));
    },
    approve: async (amount: string) => {
      await expect(user.token.approve(stake.address, parseEther(amount)))
        .to.emit(token, 'Approval')
        .withArgs(user.address, stake.address, parseEther(amount));
      expect(await token.allowance(user.address, stake.address)).to.eq(parseEther(amount));
    },
  };
};

describe('StakeLibV2Mock', () => {
  it('_pushBackOrdered', async () => {
    const context = await setup();
    const {users, stake} = context;
    const {test, deposit, tokenManagement} = setupTest({...context, user: users[0]});

    const pushBack = async (amount: string, tm: number) => {
      await expect(users[0].stake._pushBackOrdered(parseEther(amount), tm))
        .to.emit(stake, 'PushBack')
        .withArgs(true);
    };

    const popFront = async (amount: string, tm: number) => {
      await expect(users[0].stake._popFront()).to.emit(stake, 'PopFront').withArgs(parseEther(amount), BN.from(tm));
    };
    const balance = async (amount: string) => {
      const val = await stake.balanceOf(users[0].address);
      expect(val).to.eq(parseEther(amount));
    };

    await pushBack('1', 1);
    await pushBack('3', 3);
    await pushBack('2', 2);
    await test.deposits([
      ['1', 1],
      ['2', 2],
      ['3', 3],
    ]);
    await balance('6');
    await pushBack('5', 5);
    await pushBack('4', 4);
    await test.deposits([
      ['1', 1],
      ['2', 2],
      ['3', 3],
      ['4', 4],
      ['5', 5],
    ]);
    await balance('15');
    await popFront('1', 1);
    await popFront('2', 2);
    await popFront('3', 3);
    await test.deposits([
      ['4', 4],
      ['5', 5],
    ]);
    await balance('9');
    await pushBack('1', 1);
    await test.deposits([
      ['1', 1],
      ['4', 4],
      ['5', 5],
    ]);
    await balance('10');
    // Update timestamps
    await pushBack('4', 4);
    await balance('14');
    await test.deposits([
      ['1', 1],
      ['8', 4],
      ['5', 5],
    ]);
  });
  it('deposit', async () => {
    const context = await setup();
    const {users} = context;
    const user = users[0];
    const {test, deposit, tokenManagement} = setupTest({...context, user});
    await tokenManagement.topUp('1000');
    await tokenManagement.approve('1000');

    // END Setup
    await deposit.success('1');
    await test.balances('1', '1', '999');
  });

  it('withdraw', async () => {
    // BEGIN Setup
    const context = await setup();
    const {users, stake, token, deployer} = context;
    const user = users[0];
    const {test, deposit, withdraw, tokenManagement} = setupTest({...context, user});
    await tokenManagement.topUp('1000');
    await tokenManagement.approve('2');
    // END Setup
    await withdraw('1').reverted.noBalance();

    ///////////////////////////////////////////////
    //                DAY 0
    // --------------------------------------------
    //
    ///////////////////////////////////////////////
    await deposit.success('1');
    await test.balances('1', '1', '999');
    await withdraw('1').reverted.unlockable();

    ///////////////////////////////////////////////
    //                DAY 1
    // --------------------------------------------
    //
    ///////////////////////////////////////////////
    await incDays(1);
    await withdraw('1').success();
  });
  xit('restakeOrDepositAt', async () => {
    // const context = await setup();
    // const {users, stake, token, deployer} = context;
    // const user = users[0];
    // const {test, restakeOrDepositAtFor, withdraw, withdrawMax} = setupTest({...context, user});
    // await user.token.faucet(parseEther('10000'));
    // expect(await token.balanceOf(user.address), 'user to have initial balance').to.eq(parseEther('10000'));
    // await test.balances('0', '0', '10000');
    // // await user.TDFToken.approve(deployer.address, parseEther('10'));
    // await user.token.approve(stake.address, parseEther('10'));
    // let initLockAt = buildDate(3);
    // ///////////////////////////////////////////////
    // //                DAY 0
    // // --------------------------------------------
    // // With 0 stake, restake transfers Token to contract
    // ///////////////////////////////////////////////
    // await restakeOrDepositAtFor('1', initLockAt);
    // await test.balances('1', '1', '9999');
    // await test.deposits([['1', initLockAt]]);
    // await test.stake('1', '0');
    // ///////////////////////////////////////////////
    // //                DAY 1
    // // --------------------------------------------
    // // Can not unstake since we staked in the future
    // ///////////////////////////////////////////////
    // await incDays(1);
    // await withdraw.reverted('0.5');
    // await test.balances('1', '1', '9999');
    // await test.deposits([['1', initLockAt]]);
    // await test.stake('1', '0');
    // ///////////////////////////////////////////////
    // //                DAY 4
    // // --------------------------------------------
    // // Can withdraw 1
    // //
    // ///////////////////////////////////////////////
    // await incDays(4);
    // await withdraw.success('0.5');
    // await test.balances('0.5', '0.5', '9999.5');
    // await test.deposits([['0.5', initLockAt]]);
    // await test.stake('0', '0.5');
    // // ------ Can reStake to the future current staked
    // initLockAt = buildDate(6);
    // await restakeOrDepositAtFor('0.5', initLockAt);
    // await test.balances('0.5', '0.5', '9999.5');
    // await test.deposits([['0.5', initLockAt]]);
    // await test.stake('0.5', '0');
    // // can not unstake
    // await withdrawMax.none();
    // await test.balances('0.5', '0.5', '9999.5');
    // await test.deposits([['0.5', initLockAt]]);
    // await test.stake('0.5', '0');
    // ///////////////////////////////////////////////
    // //                DAY 4 - CONT Restake locked
    // // --------------------------------------------
    // // mixed restake (token transfer, restake)
    // // locked 0.5
    // ///////////////////////////////////////////////
    // initLockAt = buildDate(8);
    // await restakeOrDepositAtFor('1', initLockAt);
    // await test.balances('1', '1', '9999');
    // await test.stake('1', '0');
    // await test.deposits([
    //   ['0.5', initLockAt],
    //   ['0.5', initLockAt],
    // ]);
  });
});

const incDays = async (days: number) => {
  // suppose the current block has a timestamp of 01:00 PM
  await network.provider.send('evm_increaseTime', [days * 86400]);
  await network.provider.send('evm_mine');
};
