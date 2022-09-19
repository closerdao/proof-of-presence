import {expect} from '../../chai-setup';
import {deployments, getUnnamedAccounts, network} from 'hardhat';
import {StakeLibMock, ERC20} from '../../../typechain';
import {setupUser, setupUsers, getMock} from '../../utils';
import {parseEther} from 'ethers/lib/utils';
import {fromUnixTime, getDayOfYear} from 'date-fns';
import {addDays, getUnixTime} from 'date-fns';

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

  const token = <ERC20>await getMock('ERC20', deployer, []);

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
type PrepareBuyInput = {user: setupReturnType['deployer']} & setupReturnType;

const setupTest = ({token, user, stake}: PrepareBuyInput) => {
  return {
    test: {
      balances: async (TK: string, tkU: string, u: string) => {
        expect(await token.balanceOf(stake.address)).to.eq(parseEther(TK));
        expect(await stake.stakedBalanceOf(user.address)).to.eq(parseEther(tkU));
        expect(await token.balanceOf(user.address)).to.eq(parseEther(u));
      },

      deposits: async () => {
        throw new Error('NOT implemented');
      },
      stake: async () => {
        throw new Error('NOT implemented');
      },
    },
    restakeOrDepositAtFor: (a: string, tm: number) => {
      throw new Error('NOT implemented');
    },
    withdrawMax: {
      success: async (amount: string) => {
        await expect(user.stake.withdrawMaxStake(), `withdrawMax.success ${amount}`)
          .to.emit(stake, 'WithdrawnTokens')
          .withArgs(user.address, parseEther(amount));
      },
      none: async () => {
        await expect(user.stake.withdrangMaxStake(), `withdrawMax.none`).to.not.emit(diamond, 'WithdrawnTokens');
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
    const {users, stake, token, deployer} = await setup();
    const user = users[0];

    const {test, restakeOrDepositAtFor, withdraw, withdrawMax} = setupTest({token});

    expect(await token.balanceOf(user.address)).to.eq(parseEther('10000'));
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
