import {expect} from './chai-setup';
import {deployments, getUnnamedAccounts, ethers} from 'hardhat';
import {TDFToken, ProofOfPresence} from '../typechain';
import {setupUser, setupUsers} from './utils';
import {Contract} from 'ethers';
import {parseEther} from 'ethers/lib/utils';
import {addDays, getUnixTime} from 'date-fns';

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
  const pOP = await getMock('ProofOfPresence', deployer, [token.address]);
  const contracts = {
    TDFToken: token,
    ProofOfPresence: pOP,
  };

  const tokenBeneficiary = await setupUser(TDFTokenBeneficiary, contracts);

  const conf = {
    ...contracts,
    users: await setupUsers(users, contracts),
    deployer: await setupUser(deployer, contracts),
    TDFTokenBeneficiary: tokenBeneficiary,
    accounts,
  };

  await Promise.all(
    [users[0], users[1]].map((e) => {
      return conf.TDFTokenBeneficiary.TDFToken.transfer(e, parseEther('10000'));
    })
  );
  return conf;
});

const buildDates = (initDate: Date, amount: number) => {
  const acc = [];
  for (let i = 0; i < amount; i++) {
    acc.push(getUnixTime(addDays(initDate, i)));
  }
  return acc;
};

describe('ProofOfPresence', () => {
  it('book', async () => {
    const {users, ProofOfPresence, TDFToken} = await setup();

    const testBalances = async (TK: string, tkU: string, u: string) => {
      expect(await TDFToken.balanceOf(ProofOfPresence.address)).to.eq(parseEther(TK));
      expect(await ProofOfPresence.balanceOf(user.address)).to.eq(parseEther(tkU));
      expect(await TDFToken.balanceOf(user.address)).to.eq(parseEther(u));
    };
    const user = users[0];
    await user.TDFToken.approve(ProofOfPresence.address, parseEther('10'));
    const init = addDays(Date.now(), 10);
    const dates = buildDates(init, 5);
    await user.ProofOfPresence.book(dates);
    await testBalances('5', '5', '9995');
  });
  it('book and cancel', async () => {
    const {users, ProofOfPresence, TDFToken} = await setup();

    const testBalances = async (TK: string, tkU: string, u: string) => {
      expect(await TDFToken.balanceOf(ProofOfPresence.address)).to.eq(parseEther(TK));
      expect(await ProofOfPresence.balanceOf(user.address)).to.eq(parseEther(tkU));
      expect(await TDFToken.balanceOf(user.address)).to.eq(parseEther(u));
    };
    const user = users[0];
    await user.TDFToken.approve(ProofOfPresence.address, parseEther('10'));
    const init = addDays(Date.now(), 10);
    const dates = buildDates(init, 5);
    await user.ProofOfPresence.book(dates);
    await testBalances('5', '5', '9995');

    await user.ProofOfPresence.cancel(dates);
    console.log(await ProofOfPresence.getDates(user.address));
    await testBalances('0', '0', '10000');
  });

  it('getters', async () => {});

  it('ownable', async () => {});

  it('pausable', async () => {});
});
