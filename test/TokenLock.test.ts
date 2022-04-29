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
// eslint-disable-next-line @typescript-eslint/no-explicit-any
// async function deployLock(setup: Record<string, any>) {
//   const {TDFTokenBeneficiary, TDFToken, deployer} = setup;
//   const addresses = await getUnnamedAccounts();

//   // fund users with TDF token
//   addresses.map(async (e) => {
//     await TDFTokenBeneficiary.TDFToken.transfer(e, parseEther('10000'));
//   });

//   // Deploy Lock
//   const c = await getMock('TokenLock', deployer.address, [TDFToken.address]);
//   return {
//     lockUsers: await setupUsers(addresses, {Lock: c}),
//     lockDeployer: await setupUser(deployer.address, {Lock: c}),
//     Lock: c,
//   };
// }

const setup = deployments.createFixture(async (hre) => {
  const {deployments, getNamedAccounts, ethers} = hre;
  await deployments.fixture();

  const accounts = await getNamedAccounts();
  const users = await getUnnamedAccounts();
  const {deployer, TDFTokenBeneficiary} = accounts;

  const token: TDFToken = await ethers.getContract('TDFToken', deployer);
  const contracts = {
    TDFToken: token,
    TokenLock: <TokenLock>await getMock('TokenLock', deployer, [token.address]),
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
  it('lock and reddem funds', async () => {
    const {users, TokenLock, TDFToken} = await setup();

    const user = users[0];

    await user.TDFToken.approve(user.TokenLock.address, parseEther('10'));
    // await expect(user.TDFToken.transfer(users[1].address, parseEther('1'))).to.emit(TDFToken, 'Transfer');
    await user.TokenLock.lock(parseEther('1'));
    expect(await TDFToken.balanceOf(TokenLock.address)).to.eq(parseEther('1'));
    expect(await TokenLock.balanceOf(user.address)).to.eq(parseEther('1'));
    // TODO test the response
    await user.TokenLock.unlock();
    // expect(await user.TokenLock.unlock()).to.eq(parseEther('0'));
    expect(await TDFToken.balanceOf(TokenLock.address)).to.eq(parseEther('1'));
    expect(await user.TokenLock.balanceOf(user.address)).to.eq(parseEther('1'));
    // expect(await user.TokenLock.unlock()).to.eq(parseEther('0'));
    await incDays(1);
    await user.TokenLock.lock(parseEther('1'));
    expect(await TDFToken.balanceOf(TokenLock.address)).to.eq(parseEther('2'));
    expect(await user.TokenLock.balanceOf(user.address)).to.eq(parseEther('2'));

    await user.TokenLock.unlock();
    expect(await TDFToken.balanceOf(TokenLock.address)).to.eq(parseEther('1'));
    expect(await user.TokenLock.balanceOf(user.address)).to.eq(parseEther('1'));
    await incDays(1);
    await user.TokenLock.unlock();
    expect(await TDFToken.balanceOf(TokenLock.address)).to.eq(parseEther('0'));
    expect(await user.TokenLock.balanceOf(user.address)).to.eq(parseEther('0'));
    await expect(user.TokenLock.unlock()).to.be.revertedWith('NOT_ENOUGHT_BALANCE');
  });

  it('getters', async () => {});

  it('ownable', async () => {});

  it('pausable', async () => {});
});
