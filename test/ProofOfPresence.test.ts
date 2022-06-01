import {expect} from './chai-setup';
import {deployments, getUnnamedAccounts, ethers, network} from 'hardhat';
import {TDFToken, ProofOfPresence, TokenLock} from '../typechain';
import {setupUser, setupUsers} from './utils';
import {Contract} from 'ethers';
import {parseEther} from 'ethers/lib/utils';
import {addDays, getUnixTime, fromUnixTime, getDayOfYear} from 'date-fns';
const BN = ethers.BigNumber;

type DateInputs = [number, number][];
interface setUser {
  address: string;
  TokenLock: TokenLock;
  TDFToken: TDFToken;
  ProofOfPresence: ProofOfPresence;
}
interface DateMetadata {
  year: number;
  day: number;
  unix: number;
}
interface DatesTestData {
  data: DateMetadata[];
  inputs: DateInputs;
}
const buildDates = (initDate: Date, amount: number): DatesTestData => {
  const acc: DatesTestData = {data: [], inputs: []};
  for (let i = 0; i < amount; i++) {
    const nDate = addDays(initDate, i);
    acc.data.push({
      year: nDate.getUTCFullYear(),
      day: getDayOfYear(nDate),
      unix: getUnixTime(nDate),
    });
    acc.inputs.push([nDate.getUTCFullYear(), getDayOfYear(nDate)]);
  }
  return acc;
};

const collectDates = (dates: DatesTestData, indexes: number[]): DatesTestData => {
  const acc: DatesTestData = {data: [], inputs: []};
  indexes.forEach((i) => {
    acc.data.push(dates.data[i]);
    acc.inputs.push(dates.inputs[i]);
  });
  return acc;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function getMock(name: string, deployer: string, args: Array<any>): Promise<Contract> {
  await deployments.deploy(name, {from: deployer, args: args});
  return ethers.getContract(name, deployer);
}

const timeTravelTo = async (time: number) => {
  await network.provider.send('evm_setNextBlockTimestamp', [time]);
  await network.provider.send('evm_mine');
};

const setupHelpers = async ({
  stakeContract,
  tokenContract,
  bookingContract,
  user,
  admin,
}: {
  stakeContract: TokenLock;
  tokenContract: TDFToken;
  bookingContract: ProofOfPresence;
  user: setUser;
  admin?: setUser;
}) => {
  return {
    test: {
      balances: async (TK: string, tkU: string, u: string) => {
        expect(await tokenContract.balanceOf(stakeContract.address)).to.eq(parseEther(TK));
        expect(await stakeContract.balanceOf(user.address)).to.eq(parseEther(tkU));
        expect(await tokenContract.balanceOf(user.address)).to.eq(parseEther(u));
      },
      stake: async (locked: string, unlocked: string) => {
        expect(await stakeContract.lockedAmount(user.address)).to.eq(parseEther(locked));
        expect(await stakeContract.unlockedAmount(user.address)).to.eq(parseEther(unlocked));
      },
      deposits: async (examples: [string, number][]) => {
        const deposits = await stakeContract.depositsFor(user.address);
        for (let i = 0; i < deposits.length; i++) {
          expect(deposits[i].amount).to.eq(parseEther(examples[i][0]));
          expect(deposits[i].timestamp).to.eq(BN.from(examples[i][1]));
        }
      },
      bookings: async (dates: DatesTestData, price: string) => {
        await Promise.all(
          dates.data.map(async (e) => {
            const [success, booking] = await bookingContract.getBooking(user.address, e.year, e.day);
            return Promise.all([
              expect(booking.price).to.eq(parseEther(price)),
              expect(booking.year).to.eq(e.year),
              expect(booking.dayOfYear).to.eq(e.day),
              expect(success).to.be.true,
            ]);
          })
        );
      },
    },
    // functions that modify state
    send: {
      book: async (dates: DateInputs) => {
        await user.ProofOfPresence.book(dates);
      },
      cancel: {
        success: async (dates: DateInputs) => {
          await user.ProofOfPresence.cancel(dates);
        },
        reverted: {
          noneExisting: async (dates: DateInputs) => {
            await expect(user.ProofOfPresence.cancel(dates)).to.be.revertedWith('Booking does not exists');
          },
          inThepast: async (dates: DateInputs) => {
            await expect(user.ProofOfPresence.cancel(dates)).to.be.revertedWith('Can not cancel past booking');
          },
        },
      },
    },
  };
};

const setup = deployments.createFixture(async (hre) => {
  const {deployments, getNamedAccounts, ethers} = hre;
  await deployments.fixture();

  const accounts = await getNamedAccounts();
  const users = await getUnnamedAccounts();
  const {deployer, TDFTokenBeneficiary} = accounts;

  const token = <TDFToken>await ethers.getContract('TDFToken', deployer);
  const stakeContract = <TokenLock>await getMock('TokenLock', deployer, [token.address, 1]);
  const pOP = <ProofOfPresence>await getMock('ProofOfPresence', deployer, [stakeContract.address]);
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

describe('ProofOfPresence', () => {
  it('book', async () => {
    const {users, ProofOfPresence, TDFToken, TokenLock} = await setup();

    const user = users[0];
    const {test, send} = await setupHelpers({
      stakeContract: TokenLock,
      tokenContract: TDFToken,
      bookingContract: ProofOfPresence,
      user: user,
    });

    // await user.TDFToken.approve(TokenLock.address, parseEther('10'));
    const init = addDays(Date.now(), 10);
    const dates = buildDates(init, 5);
    await send.book(dates.inputs);
    await test.balances('5', '5', '9995');
  });
  it('book and cancel', async () => {
    const {users, ProofOfPresence, TDFToken, TokenLock} = await setup();
    const user = users[0];

    const {test, send} = await setupHelpers({
      stakeContract: TokenLock,
      tokenContract: TDFToken,
      bookingContract: ProofOfPresence,
      user: user,
    });

    // await user.TDFToken.approve(TokenLock.address, parseEther('10'));
    const init = addDays(Date.now(), 10);
    const dates = buildDates(init, 5);

    // -------------------------------------------------------
    //  Book and cancel all the dates
    // -------------------------------------------------------
    await send.book(dates.inputs);
    await test.balances('5', '5', '9995');
    await test.bookings(dates, '1');
    const bookings = await ProofOfPresence.getBookings(user.address, 2022);
    console.log(bookings);

    await send.cancel.success(dates.inputs);
    // TODO:
    // expect((await ProofOfPresence.getDates(user.address)).length).to.eq(0);
    await test.balances('5', '5', '9995');
    // -------------------------------------------------------
    //  Book and cancel few dates
    // -------------------------------------------------------
    await send.book(dates.inputs);
    await test.balances('5', '5', '9995');
    await test.bookings(dates, '1');

    const cDates = collectDates(dates, [0, 4]);
    await send.cancel.success(cDates.inputs);
    // TODO:
    // expect((await ProofOfPresence.getDates(user.address)).length).to.eq(3);
    await test.balances('5', '5', '9995');
    const restcDates = collectDates(dates, [1, 2, 3]);

    await test.bookings(restcDates, '1');
    await send.cancel.reverted.noneExisting(cDates.inputs);

    await timeTravelTo(dates.data[4].unix + 2 * 86400);

    await send.cancel.reverted.inThepast(collectDates(dates, [1, 2, 3]).inputs);
  });

  it('getters', async () => {});

  it('ownable', async () => {});

  it('pausable', async () => {});
});
