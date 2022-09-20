import {expect} from '../../chai-setup';
import {deployments, getUnnamedAccounts, network, ethers} from 'hardhat';
import {StakeLibMock, ERC20TestMock} from '../../../typechain';
import {setupUser, setupUsers, getMock} from '../../utils';
import {parseEther} from 'ethers/lib/utils';
import {addDays, getUnixTime} from 'date-fns';

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
    stake: <StakeLibMock>await getMock('StakeLibMock', deployer, [token.address]),
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

const setupTest = ({token, user, stake}: TestContext) => {
  return {
    test: {
      balances: async (TK: string, tkU: string, u: string) => {
        expect(await token.balanceOf(stake.address), `balances: staking Contract owns token`).to.eq(parseEther(TK));
        expect(await stake.stakedBalanceOf(user.address), `balances: user amount staked`).to.eq(parseEther(tkU));
        expect(await token.balanceOf(user.address), 'balances: user amount of token').to.eq(parseEther(u));
      },

      deposits: async (examples: [string, number][]) => {
        const deposits = await stake.depositsStakedFor(user.address);
        for (let i = 0; i < deposits.length; i++) {
          expect(deposits[i].amount, 'deposits amount').to.eq(parseEther(examples[i][0]));
          expect(deposits[i].timestamp, 'deposits timestamp').to.eq(BN.from(examples[i][1]));
        }
      },
      stake: async (locked: string, unlocked: string) => {
        expect(await stake.lockedStake(user.address), 'stake: locked stake').to.eq(parseEther(locked));
        expect(await stake.unlockedStake(user.address), 'stake: unlocked stake').to.eq(parseEther(unlocked));
      },
    },
    restakeOrDepositAtFor: async (a: string, tm: number) => {
      await expect(user.stake.restakeOrDepositAtFor(user.address, parseEther(a), tm)).to.emit(
        stake,
        'RestakeOrDepositedAtForStatus'
      );
    },
    withdrawMax: {
      success: async (amount: string) => {
        await expect(user.stake.withdrawMaxStake(), `withdrawMax.success ${amount}`)
          .to.emit(stake, 'WithdrawnTokens')
          .withArgs(user.address, parseEther(amount));
      },
      none: async () => {
        await expect(user.stake.withdrawMaxStake(), `withdrawMax.none`).to.not.emit(stake, 'WithdrawnTokens');
      },
    },
    withdraw: {
      success: async (amount: string) => {
        await expect(user.stake.withdrawStake(parseEther(amount)), `withdraw.success ${amount}`)
          .to.emit(stake, 'WithdrawnTokens')
          .withArgs(user.address, parseEther(amount));
      },
      reverted: async (amount: string) => {
        await expect(user.stake.withdrawStake(parseEther(amount)), `withdraw.reverted ${amount}`).to.be.revertedWith(
          'NOT_ENOUGHT_UNLOCKABLE_BALANCE'
        );
      },
    },
  };
};

describe('StakeLibMock', () => {
  it('restakeOrDepositAt', async () => {
    const context = await setup();
    const {users, stake, token, deployer} = context;
    const user = users[0];

    const {test, restakeOrDepositAtFor, withdraw, withdrawMax} = setupTest({...context, user});

    await user.token.faucet(parseEther('10000'));
    expect(await token.balanceOf(user.address), 'user to have initial balance').to.eq(parseEther('10000'));
    await test.balances('0', '0', '10000');

    // await user.TDFToken.approve(deployer.address, parseEther('10'));
    await user.token.approve(stake.address, parseEther('10'));

    let initLockAt = buildDate(3);

    ///////////////////////////////////////////////
    //                DAY 0
    // --------------------------------------------
    // With 0 stake, restake transfers Token to contract
    ///////////////////////////////////////////////
    await restakeOrDepositAtFor('1', initLockAt);
    await test.balances('1', '1', '9999');

    await test.deposits([['1', initLockAt]]);
    await test.stake('1', '0');

    ///////////////////////////////////////////////
    //                DAY 1
    // --------------------------------------------
    // Can not unstake since we staked in the future
    ///////////////////////////////////////////////
    await incDays(1);
    await withdraw.reverted('0.5');
    await test.balances('1', '1', '9999');
    await test.deposits([['1', initLockAt]]);
    await test.stake('1', '0');
    ///////////////////////////////////////////////
    //                DAY 4
    // --------------------------------------------
    // Can withdraw 1
    //
    ///////////////////////////////////////////////
    await incDays(4);

    await withdraw.success('0.5');
    await test.balances('0.5', '0.5', '9999.5');
    await test.deposits([['0.5', initLockAt]]);
    await test.stake('0', '0.5');

    // ------ Can reStake to the future current staked

    initLockAt = buildDate(6);
    await restakeOrDepositAtFor('0.5', initLockAt);

    await test.balances('0.5', '0.5', '9999.5');
    await test.deposits([['0.5', initLockAt]]);
    await test.stake('0.5', '0');
    // can not unstake
    await withdrawMax.none();
    await test.balances('0.5', '0.5', '9999.5');
    await test.deposits([['0.5', initLockAt]]);
    await test.stake('0.5', '0');
    ///////////////////////////////////////////////
    //                DAY 4 - CONT Restake locked
    // --------------------------------------------
    // mixed restake (token transfer, restake)
    // locked 0.5
    ///////////////////////////////////////////////
    initLockAt = buildDate(8);
    await restakeOrDepositAtFor('1', initLockAt);
    await test.balances('1', '1', '9999');
    await test.stake('1', '0');
    await test.deposits([
      ['0.5', initLockAt],
      ['0.5', initLockAt],
    ]);
  });
});

const incDays = async (days: number) => {
  // suppose the current block has a timestamp of 01:00 PM
  await network.provider.send('evm_increaseTime', [days * 86400]);
  await network.provider.send('evm_mine');
};
