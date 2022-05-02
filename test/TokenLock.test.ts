import {expect} from './chai-setup';
import {deployments, getUnnamedAccounts, ethers, network} from 'hardhat';
import {TDFToken, TokenLock} from '../typechain';
import {setupUser, setupUsers} from './utils';
import {Contract} from 'ethers';
import {parseEther} from 'ethers/lib/utils';

const BN = ethers.BigNumber;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function getMock(name: string, deployer: string, args: Array<any>): Promise<Contract> {
  await deployments.deploy(name, {from: deployer, args: args});
  return ethers.getContract(name, deployer);
}

const setup = deployments.createFixture(async (hre) => {
  const {deployments, getNamedAccounts, ethers} = hre;
  await deployments.fixture();

  const accounts = await getNamedAccounts();
  const users = await getUnnamedAccounts();
  const {deployer, TDFTokenBeneficiary} = accounts;

  const token: TDFToken = await ethers.getContract('TDFToken', deployer);
  const contracts = {
    TDFToken: token,
    TokenLock: <TokenLock>await getMock('TokenLock', deployer, [token.address, 1]),
  };

  const tokenBeneficiary = await setupUser(TDFTokenBeneficiary, contracts);

  const conf = {
    ...contracts,
    users: await setupUsers(users, contracts),
    deployer: await setupUser(deployer, contracts),
    TDFTokenBeneficiary: tokenBeneficiary,
    accounts,
  };
  // fund users with TDF token
  await Promise.all(
    users.map((e) => {
      return conf.TDFTokenBeneficiary.TDFToken.transfer(e, parseEther('10000'));
    })
  );
  return conf;
});

async function incDays(days: number) {
  // suppose the current block has a timestamp of 01:00 PM
  await network.provider.send('evm_increaseTime', [days * 86400]);
  await network.provider.send('evm_mine');
}

describe('TokenLock', () => {
  it('lock and unlockMax', async () => {
    const {users, TokenLock, TDFToken} = await setup();

    const testBalances = async (TK: string, tkU: string, u: string) => {
      expect(await TDFToken.balanceOf(TokenLock.address)).to.eq(parseEther(TK));
      expect(await TokenLock.balanceOf(user.address)).to.eq(parseEther(tkU));
      expect(await TDFToken.balanceOf(user.address)).to.eq(parseEther(u));
    };

    const user = users[0];

    expect(await TDFToken.balanceOf(user.address)).to.eq(parseEther('10000'));
    await testBalances('0', '0', '10000');

    await user.TDFToken.approve(user.TokenLock.address, parseEther('10'));
    await user.TokenLock.deposit(parseEther('1'));
    await testBalances('1', '1', '9999');

    // TODO test the response
    await user.TokenLock.withdrawMax();
    await testBalances('1', '1', '9999');

    await incDays(1);
    await user.TokenLock.deposit(parseEther('1'));
    await testBalances('2', '2', '9998');
    await user.TokenLock.withdrawMax();
    await testBalances('1', '1', '9999');

    await incDays(1);
    await user.TokenLock.withdrawMax();
    await testBalances('0', '0', '10000');

    await expect(user.TokenLock.withdrawMax()).to.be.revertedWith('NOT_ENOUGHT_BALANCE');
  });
  it('lock and unlock', async () => {
    const {users, TokenLock, TDFToken} = await setup();

    const testBalances = async (TK: string, tkU: string, u: string) => {
      expect(await TDFToken.balanceOf(TokenLock.address)).to.eq(parseEther(TK));
      expect(await TokenLock.balanceOf(user.address)).to.eq(parseEther(tkU));
      expect(await TDFToken.balanceOf(user.address)).to.eq(parseEther(u));
    };

    const user = users[0];

    expect(await TDFToken.balanceOf(user.address)).to.eq(parseEther('10000'));
    await testBalances('0', '0', '10000');

    await user.TDFToken.approve(user.TokenLock.address, parseEther('10'));

    ///////////////////////////////////////////////
    //                DAY 0
    // ------------------------------------------
    // Before: NOTHING
    // During:
    //     - lock 1 token
    // After:
    //     - 1 token unlockable
    ///////////////////////////////////////////////
    await user.TokenLock.deposit(parseEther('1'));
    await testBalances('1', '1', '9999');

    await expect(user.TokenLock.withdraw(parseEther('0.5'))).to.be.revertedWith('NOT_ENOUGHT_UNLOCKABLE_BALANCE');
    // Does not change the balances, nothing to unlock
    await testBalances('1', '1', '9999');

    await incDays(1);
    ///////////////////////////////////////////////
    //  DAY 1
    ///////////////////////////////////////////////
    await user.TokenLock.deposit(parseEther('1'));
    await testBalances('2', '2', '9998');

    expect(await TokenLock.unlockedAmount(user.address)).to.eq(parseEther('1'));
    // we only have available 1
    // we are not able to redeem more than 1
    // So trying to remove more will be reverted
    await expect(user.TokenLock.withdraw(parseEther('1.5'))).to.be.revertedWith('NOT_ENOUGHT_UNLOCKABLE_BALANCE');
    // With the balances unchaded
    await testBalances('2', '2', '9998');
    // remove in lower bound of pocket
    await user.TokenLock.withdraw(parseEther('0.5'));
    await testBalances('1.5', '1.5', '9998.5');

    await incDays(1);
    ///////////////////////////////////////////////
    //  DAY 2
    ///////////////////////////////////////////////
    // Now we have two buckets
    // 1) with 0.5
    // 2) with 1
    // remove in the upper bound
    // 0.5 + 0.75 = 1.25
    // reminder of 0.25
    await user.TokenLock.withdraw(parseEther('1.25'));
    await testBalances('0.25', '0.25', '9999.75');
    // Add more balance to stress test
    await user.TokenLock.deposit(parseEther('1.5'));
    await testBalances('1.75', '1.75', '9998.25');
    await user.TokenLock.withdrawMax();
    await testBalances('1.5', '1.5', '9998.50');
    await incDays(1);
    ///////////////////////////////////////////////
    //  DAY 3
    // Unlock all
    ///////////////////////////////////////////////
    await user.TokenLock.withdraw(parseEther('1.3'));
    await testBalances('0.2', '0.2', '9999.8');
    await user.TokenLock.withdrawMax();
    await testBalances('0', '0', '10000');
  });

  it('getters', async () => {});

  it('ownable', async () => {});

  it('pausable', async () => {});
});
