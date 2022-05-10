import {expect} from './chai-setup';
import {deployments, getUnnamedAccounts, ethers, network} from 'hardhat';
import {TDFToken, ProofOfPresence, TokenLock} from '../typechain';
import {setupUser, setupUsers} from './utils';
import {Contract} from 'ethers';
import {parseEther} from 'ethers/lib/utils';
import {addDays, getUnixTime} from 'date-fns';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function getMock(name: string, deployer: string, args: Array<any>): Promise<Contract> {
  await deployments.deploy(name, {from: deployer, args: args});
  return ethers.getContract(name, deployer);
}

const timeTravelTo = async (time: number) => {
  await network.provider.send('evm_setNextBlockTimestamp', [time]);
  await network.provider.send('evm_mine');
};

const setup = deployments.createFixture(async (hre) => {
  const {deployments, getNamedAccounts, ethers} = hre;
  await deployments.fixture();

  const accounts = await getNamedAccounts();
  const users = await getUnnamedAccounts();
  const {deployer, TDFTokenBeneficiary} = accounts;

  const token: TDFToken = await ethers.getContract('TDFToken', deployer);
  const stakeContract = await getMock('TokenLock', deployer, [token.address, 1]);
  const pOP = await getMock('ProofOfPresence', deployer, [token.address, stakeContract.address]);
  const contracts = {
    TDFToken: token,
    ProofOfPresence: pOP,
    TokenLock: stakeContract,
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
    const {users, ProofOfPresence, TDFToken, TokenLock} = await setup();

    const testBalances = async (TK: string, tkU: string, u: string) => {
      expect(await TDFToken.balanceOf(ProofOfPresence.address)).to.eq(parseEther(TK));
      expect(await ProofOfPresence.balanceOf(user.address)).to.eq(parseEther(tkU));
      expect(await TDFToken.balanceOf(user.address)).to.eq(parseEther(u));
    };
    const user = users[0];
    await user.TDFToken.approve(TokenLock.address, parseEther('10'));
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

    const testBookings = async (dates: number[], price: string) => {
      await Promise.all(
        dates.map(async (e) => {
          const [d, c] = await ProofOfPresence.getBooking(user.address, e);
          return Promise.all([expect(d).to.eq(e), expect(c).to.eq(parseEther(price))]);
        })
      );
    };

    const user = users[0];
    await user.TDFToken.approve(ProofOfPresence.address, parseEther('10'));
    const init = addDays(Date.now(), 10);
    const dates = buildDates(init, 5);

    // -------------------------------------------------------
    //  Book and cancel all the dates
    // -------------------------------------------------------
    await user.ProofOfPresence.book(dates);
    await testBalances('5', '5', '9995');
    await testBookings(dates, '1');

    await user.ProofOfPresence.cancel(dates);
    expect((await ProofOfPresence.getDates(user.address)).length).to.eq(0);
    await testBalances('0', '0', '10000');
    await testBookings(dates, '0');
    // -------------------------------------------------------
    //  Book and cancel few dates
    // -------------------------------------------------------
    await user.ProofOfPresence.book(dates);
    await testBalances('5', '5', '9995');
    await testBookings(dates, '1');

    const cDates = [dates[0], dates[4]];
    await user.ProofOfPresence.cancel(cDates);
    expect((await ProofOfPresence.getDates(user.address)).length).to.eq(3);
    await testBalances('3', '3', '9997');
    await testBookings(cDates, '0');
    await testBookings([dates[1], dates[2], dates[3]], '1');
    await expect(user.ProofOfPresence.cancel(cDates)).to.be.revertedWith('Booking does not exists');

    await timeTravelTo(dates[4] + 2 * 86400);
    await expect(user.ProofOfPresence.cancel([dates[1], dates[2], dates[3]])).to.be.revertedWith(
      'Can not cancel past booking'
    );
  });

  it('getters', async () => {});

  it('ownable', async () => {});

  it('pausable', async () => {});
});
