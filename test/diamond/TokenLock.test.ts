import {expect} from '../chai-setup';
import {network} from 'hardhat';
import {parseEther} from 'ethers/lib/utils';
import {setDiamondUser, setupContext, userTesters} from '../utils/diamond';

const setup = setupContext;

const incDays = async (days: number) => {
  // suppose the current block has a timestamp of 01:00 PM
  await network.provider.send('evm_increaseTime', [days * 86400]);
  await network.provider.send('evm_mine');
};

describe('TokenLockFacet', () => {
  it('lock and unlockMax', async () => {
    const context = await setup();
    const {users, TDFDiamond, TDFToken} = context;

    const user = await setDiamondUser({
      user: users[0],
      ...context,
    });
    const test = await userTesters({user: users[0], ...context});

    expect(await TDFToken.balanceOf(users[0].address)).to.eq(parseEther('10000'));
    await test.balances('0', '0', '10000');

    await users[0].TDFToken.approve(TDFDiamond.address, parseEther('10'));
    await user.depositStake('1').success();

    await test.balances('1', '1', '9999');

    await user.withdrawMaxStake().none();
    await test.balances('1', '1', '9999');

    await incDays(1);
    await user.depositStake('1').success();
    await test.balances('2', '2', '9998');
    await user.withdrawMaxStake().successWithAmount('1');
    await test.balances('1', '1', '9999');

    await incDays(1);
    await user.withdrawMaxStake().successWithAmount('1');
    await test.balances('0', '0', '10000');

    await expect(users[0].TDFDiamond.withdrawMaxStake()).to.be.revertedWith('NOT_ENOUGHT_BALANCE');
  });
  it('lock and unlock', async () => {
    const context = await setup();
    const {users, TDFDiamond, TDFToken} = context;

    const user = await setDiamondUser({
      user: users[0],
      ...context,
    });

    const test = await userTesters({user: users[0], ...context});

    expect(await TDFToken.balanceOf(users[0].address)).to.eq(parseEther('10000'));
    await test.balances('0', '0', '10000');

    await users[0].TDFToken.approve(users[0].TDFDiamond.address, parseEther('10'));

    ///////////////////////////////////////////////
    //                DAY 0
    // ------------------------------------------
    // Before: NOTHING
    // During:
    //     - lock 1 token
    // After:
    //     - 1 token unlockable
    ///////////////////////////////////////////////
    await user.depositStake('1').success();
    await test.balances('1', '1', '9999');
    await user.withdrawStake('0.5').reverted();
    // Does not change the balances, nothing to unlock
    await test.balances('1', '1', '9999');

    ///////////////////////////////////////////////
    //  DAY 1
    ///////////////////////////////////////////////
    await incDays(1);
    await user.depositStake('1').success();

    await test.balances('2', '2', '9998');

    expect(await TDFDiamond.unlockedStake(users[0].address)).to.eq(parseEther('1'));
    // we only have available 1
    // we are not able to redeem more than 1
    // So trying to remove more will be reverted
    await user.withdrawStake('1.5').reverted();
    // With the balances unchaded
    await test.balances('2', '2', '9998');
    // remove in lower bound of pocket
    await user.withdrawStake('0.5').success();
    await test.balances('1.5', '1.5', '9998.5');

    ///////////////////////////////////////////////
    //  DAY 2
    // --------------------------------------------
    // Now we have two buckets
    // 1) with 0.5
    // 2) with 1
    // remove in the upper bound
    // 0.5 + 0.75 = 1.25
    // reminder of 0.25
    ///////////////////////////////////////////////
    await incDays(1);
    await user.withdrawStake('1.25').success();

    await test.balances('0.25', '0.25', '9999.75');
    // Add more balance to stress test
    await user.depositStake('1.5').success();

    await test.balances('1.75', '1.75', '9998.25');
    await user.withdrawMaxStake().successWithAmount('0.25');
    await test.balances('1.5', '1.5', '9998.50');
    await incDays(1);
    ///////////////////////////////////////////////
    //  DAY 3
    // Unlock all
    ///////////////////////////////////////////////
    await user.withdrawStake('1.3').success();

    await test.balances('0.2', '0.2', '9999.8');
    await user.withdrawMaxStake().successWithAmount('0.2');
    await test.balances('0', '0', '10000');
  });

  it('restakeMax', async () => {
    const context = await setup();
    const {users, TDFToken} = context;

    const user = await setDiamondUser({
      user: users[0],
      ...context,
    });
    const test = await userTesters({user: users[0], ...context});

    expect(await TDFToken.balanceOf(users[0].address)).to.eq(parseEther('10000'));
    await test.balances('0', '0', '10000');

    await users[0].TDFToken.approve(users[0].TDFDiamond.address, parseEther('10'));
    await user.depositStake('1').success();

    await test.balances('1', '1', '9999');
    await test.stake('1', '0');
    await incDays(1);
    await user.depositStake('0.5').success();
    await test.balances('1.5', '1.5', '9998.5');
    await test.stake('0.5', '1');
    await user.restakeMax().success();
    await test.balances('1.5', '1.5', '9998.5');
    await test.stake('1.5', '0');
    await incDays(1);
    await user.withdrawMaxStake().successWithAmount('1.5');
    await test.balances('0', '0', '10000');
    await test.stake('0', '0');
  });
  it('restake(uint256 amount)', async () => {
    const context = await setup();
    const {users, TDFToken} = context;

    const user = await setDiamondUser({
      user: users[0],
      ...context,
    });
    const test = await userTesters({user: users[0], ...context});

    expect(await TDFToken.balanceOf(users[0].address)).to.eq(parseEther('10000'));
    await test.balances('0', '0', '10000');

    await users[0].TDFToken.approve(users[0].TDFDiamond.address, parseEther('10'));
    ///////////////////////////////////////////////
    //                DAY 0
    ///////////////////////////////////////////////
    await user.depositStake('1').success();

    await test.balances('1', '1', '9999');
    await test.stake('1', '0');
    // Restake max without any untied amount
    await user.restakeMax().success();
    // Results in nothing changes
    await test.balances('1', '1', '9999');
    await test.stake('1', '0');

    await incDays(1);
    ///////////////////////////////////////////////
    //                DAY 1
    ///////////////////////////////////////////////
    await user.depositStake('0.5').success();

    await test.balances('1.5', '1.5', '9998.5');
    await test.stake('0.5', '1');
    // Trying to restake more than unlocked will revert
    await user.restake('1.5').reverted.notEnoughtBalance();
    await test.balances('1.5', '1.5', '9998.5');
    await test.stake('0.5', '1');
    await incDays(1);
    ///////////////////////////////////////////////
    //                DAY 2
    ///////////////////////////////////////////////
    await test.balances('1.5', '1.5', '9998.5');
    await test.stake('0', '1.5');

    await user.restake('0.5').success();
    await test.balances('1.5', '1.5', '9998.5');
    await test.stake('0.5', '1');
    await user.withdrawStake('0.25').success();
    // await user.TDFDiamond.withdraw(parseEther('0.25'));
    await test.balances('1.25', '1.25', '9998.75');
    await test.stake('0.5', '0.75');
    await user.withdrawMaxStake().successWithAmount('0.75');
    await test.balances('0.5', '0.5', '9999.5');
    await test.stake('0.5', '0');
    ///////////////////////////////////////////////
    //                DAY 3
    ///////////////////////////////////////////////
    await incDays(1);
    await user.withdrawMaxStake().successWithAmount('0.5');
    await test.balances('0', '0', '10000');
    await test.stake('0', '0');
  });
});
