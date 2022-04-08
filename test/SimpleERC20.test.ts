import {expect} from './chai-setup';
import {ethers, deployments, getUnnamedAccounts, getNamedAccounts} from 'hardhat';
import {IERC20} from '../typechain';
import {setupUser, setupUsers} from './utils';

const setup = deployments.createFixture(async () => {
  await deployments.fixture('TDFToken');
  const {TDFTokenBeneficiary} = await getNamedAccounts();
  const contracts = {
    TDFToken: <IERC20>await ethers.getContract('TDFToken'),
  };
  const users = await setupUsers(await getUnnamedAccounts(), contracts);
  return {
    ...contracts,
    users,
    TDFTokenBeneficiary: await setupUser(TDFTokenBeneficiary, contracts),
  };
});

describe('TDFToken', function () {
  it('transfer fails', async function () {
    const {users} = await setup();
    await expect(users[0].TDFToken.transfer(users[1].address, 1)).to.be.revertedWith('NOT_ENOUGH_TOKENS');
  });

  it('transfer succeed', async function () {
    const {users, TDFTokenBeneficiary, TDFToken} = await setup();
    await TDFTokenBeneficiary.TDFToken.transfer(users[1].address, 1);

    await expect(TDFTokenBeneficiary.TDFToken.transfer(users[1].address, 1))
      .to.emit(TDFToken, 'Transfer')
      .withArgs(TDFTokenBeneficiary.address, users[1].address, 1);
  });
});
