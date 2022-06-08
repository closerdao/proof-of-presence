import {expect} from '../chai-setup';
import {deployments, getUnnamedAccounts, ethers, network} from 'hardhat';
import {TDFToken, ProofOfPresence, TokenLock} from '../../typechain';
import {BookingMapLib} from '../../typechain/ProofOfPresence';

import {setupUser, setupUsers} from '../utils';
import {Contract} from 'ethers';
import {parseEther} from 'ethers/lib/utils';
import {addDays, getUnixTime, fromUnixTime, getDayOfYear, yearsToMonths} from 'date-fns';
const BN = ethers.BigNumber;
import * as _ from 'lodash';
import {TDFDiamond, TokenLockFacet, ProofOfPresenceFacet} from '../../typechain';

type DateInputs = [number, number][];
interface setUser {
  address: string;
  TokenLock: TokenLock;
  TDFToken: TDFToken;
  ProofOfPresence: ProofOfPresence;
  TDFDiamond: TDFDiamond;
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

const yearData = () => {
  return {
    '2022': {number: 2022, leapYear: false, start: 1640995200, end: 1672531199},
    '2023': {number: 2023, leapYear: false, start: 1672531200, end: 1704067199},
    '2024': {number: 2024, leapYear: true, start: 1704067200, end: 1735689599},
    '2025': {number: 2025, leapYear: false, start: 1735689600, end: 1767225599},
    '2027': {number: 2027, leapYear: false, start: 1798761600, end: 1830297599},
  };
};

const setupHelpers = async ({
  stakeContract,
  tokenContract,
  bookingContract,
  diamond,
  user,
  admin,
}: {
  stakeContract: TokenLockFacet;
  tokenContract: TDFToken;
  bookingContract: ProofOfPresenceFacet;
  diamond: TDFDiamond;
  user: setUser;
  admin: setUser;
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
    call: {
      getBookings: async (dates: DatesTestData) => {
        const years = _.groupBy(dates.data, (e) => e.year);
        const listTest = async (bookings: BookingMapLib.BookingStruct[], datum: DateMetadata[]) => {
          return Promise.all(
            datum.map(async (e) => {
              const found = bookings.find((val) => val.year == e.year && val.dayOfYear == e.day);
              return Promise.all([expect(found).not.be.undefined]);
            })
          );
        };
        await Promise.all(
          _.map(years, async (yList) => {
            const bookings = await bookingContract.getBookings(user.address, yList[0].year);
            return Promise.all([expect(yList.length).to.eq(bookings.length), listTest(bookings, yList)]);
          })
        );
      },
    },
    // functions that modify state
    send: {
      book: {
        success: async (dates: DateInputs) => {
          if (diamond) {
            await expect(user.TDFDiamond.book(dates)).to.emit(bookingContract, 'NewBookings');
          } else {
            await expect(user.ProofOfPresence.book(dates)).to.emit(bookingContract, 'NewBookings');
          }
        },
        reverted: {
          paused: async (dates: DateInputs) => {
            await expect(user.ProofOfPresence.book(dates)).to.be.revertedWith('Pausable: paused');
          },
        },
      },
      cancel: {
        success: async (dates: DateInputs) => {
          await expect(user.ProofOfPresence.cancel(dates)).to.emit(bookingContract, 'CanceledBookings');
        },
        reverted: {
          noneExisting: async (dates: DateInputs) => {
            await expect(user.ProofOfPresence.cancel(dates)).to.be.revertedWith('Booking does not exists');
          },
          inThepast: async (dates: DateInputs) => {
            await expect(user.ProofOfPresence.cancel(dates)).to.be.revertedWith('Can not cancel past booking');
          },
          paused: async (dates: DateInputs) => {
            await expect(user.ProofOfPresence.cancel(dates)).to.be.revertedWith('Pausable: paused');
          },
        },
      },
      addYear: {
        success: async (year: BookingMapLib.YearStruct) => {
          await expect(
            admin.ProofOfPresence.addYear(year.number, year.leapYear, year.start, year.end, year.enabled)
          ).to.emit(bookingContract, 'YearAdded');
        },
        reverted: {
          onlyOwner: async (year: BookingMapLib.YearStruct) => {
            await expect(
              user.ProofOfPresence.addYear(year.number, year.leapYear, year.start, year.end, year.enabled)
            ).to.be.revertedWith('Ownable: caller is not the owner');
          },
          alreadyExists: async (year: BookingMapLib.YearStruct) => {
            await expect(
              admin.ProofOfPresence.addYear(year.number, year.leapYear, year.start, year.end, year.enabled)
            ).to.be.revertedWith('Unable to add year');
          },
        },
      },
      removeYear: {
        success: async (year: number) => {
          await expect(admin.ProofOfPresence.removeYear(year)).to.emit(bookingContract, 'YearRemoved');
        },
        reverted: {
          onlyOwner: async (year: number) => {
            await expect(user.ProofOfPresence.removeYear(year)).to.be.revertedWith('Ownable: caller is not the owner');
          },
          doesNotExists: async (year: number) => {
            await expect(admin.ProofOfPresence.removeYear(year)).to.be.revertedWith('Unable to remove Year');
          },
        },
      },
      enableYear: {
        success: async (year: number, enable: boolean) => {
          await expect(admin.ProofOfPresence.enableYear(year, enable)).to.emit(bookingContract, 'YearUpdated');
        },
        reverted: {
          onlyOwner: async (year: number, enable: boolean) => {
            await expect(user.ProofOfPresence.enableYear(year, enable)).to.be.revertedWith(
              'Ownable: caller is not the owner'
            );
          },
          doesNotExists: async (year: number, enable: boolean) => {
            await expect(admin.ProofOfPresence.enableYear(year, enable)).to.be.revertedWith('Unable to update year');
          },
        },
      },
      updateYear: {
        success: async (year: BookingMapLib.YearStruct) => {
          await expect(
            admin.ProofOfPresence.updateYear(year.number, year.leapYear, year.start, year.end, year.enabled)
          ).to.emit(bookingContract, 'YearUpdated');
        },
        reverted: {
          onlyOwner: async (year: BookingMapLib.YearStruct) => {
            await expect(
              user.ProofOfPresence.updateYear(year.number, year.leapYear, year.start, year.end, year.enabled)
            ).to.be.revertedWith('Ownable: caller is not the owner');
          },
          doesNotExists: async (year: BookingMapLib.YearStruct) => {
            await expect(
              admin.ProofOfPresence.updateYear(year.number, year.leapYear, year.start, year.end, year.enabled)
            ).to.be.revertedWith('Unable to update Year');
          },
        },
      },
      // pause: {
      //   success: async () => {
      //     await expect(admin.ProofOfPresence.pause()).to.emit(bookingContract, 'Paused');
      //     expect(await bookingContract.paused()).to.be.true;
      //   },
      //   reverted: {
      //     onlyOwner: async () => {
      //       await expect(user.ProofOfPresence.pause()).to.be.revertedWith('Ownable: caller is not the owner');
      //     },
      //   },
      // },
      // unpause: {
      //   success: async () => {
      //     await expect(admin.ProofOfPresence.unpause()).to.emit(bookingContract, 'Unpaused');
      //     expect(await bookingContract.paused()).to.be.false;
      //   },
      //   reverted: {
      //     onlyOwner: async () => {
      //       await expect(user.ProofOfPresence.unpause()).to.be.revertedWith('Ownable: caller is not the owner');
      //     },
      //   },
      // },
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
  const stakeContract = <TokenLockFacet>await ethers.getContract('TokenLockFacet', deployer);
  const pOP = <ProofOfPresenceFacet>await ethers.getContract('TokenLockFacet', deployer);
  const contracts = {
    TDFDiamond: <TDFDiamond>await ethers.getContract('TDFDiamond', deployer),
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
    const {users, ProofOfPresence, TDFToken, TokenLock, deployer, TDFDiamond} = await setup();

    const user = users[0];
    const {test, send} = await setupHelpers({
      stakeContract: TokenLock,
      tokenContract: TDFToken,
      bookingContract: ProofOfPresence,
      diamond: TDFDiamond,
      user: user,
      admin: deployer,
    });

    await user.TDFToken.approve(TokenLock.address, parseEther('10'));
    const init = addDays(Date.now(), 10);
    const dates = buildDates(init, 5);
    await send.book.success(dates.inputs);
    await test.balances('5', '5', '9995');
  });
  xit('book and cancel', async () => {
    const {users, ProofOfPresence, TDFToken, TokenLock, deployer} = await setup();
    const user = users[0];

    const {test, send} = await setupHelpers({
      stakeContract: TokenLock,
      tokenContract: TDFToken,
      bookingContract: ProofOfPresence,
      user: user,
      admin: deployer,
    });

    await user.TDFToken.approve(TokenLock.address, parseEther('10'));
    const init = addDays(Date.now(), 10);
    const dates = buildDates(init, 5);

    // -------------------------------------------------------
    //  Book and cancel all the dates
    // -------------------------------------------------------
    await send.book.success(dates.inputs);
    await test.balances('5', '5', '9995');
    await test.bookings(dates, '1');

    await send.cancel.success(dates.inputs);
    // TODO:
    // expect((await ProofOfPresence.getDates(user.address)).length).to.eq(0);
    await test.balances('5', '5', '9995');
    // -------------------------------------------------------
    //  Book and cancel few dates
    // -------------------------------------------------------
    await send.book.success(dates.inputs);
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

  xit('getters', async () => {
    const {users, ProofOfPresence, TDFToken, TokenLock, deployer} = await setup();
    const user = users[0];

    const {test, send, call} = await setupHelpers({
      stakeContract: TokenLock,
      tokenContract: TDFToken,
      bookingContract: ProofOfPresence,
      user: user,
      admin: deployer,
    });

    await user.TDFToken.approve(TokenLock.address, parseEther('10'));
    const init = addDays(Date.now(), 10);
    const dates = buildDates(init, 5);

    // -------------------------------------------------------
    //  Book and cancel all the dates
    // -------------------------------------------------------
    await send.book.success(dates.inputs);
    await test.balances('5', '5', '9995');
    await test.bookings(dates, '1');
    await call.getBookings(dates);

    const years = await ProofOfPresence.getYears();
    expect(years.length).to.eq(4);
    const y = years[0];
    let eY = _.find(yearData(), (v) => v.number == y.number);
    expect(eY).not.to.be.undefined;
    if (eY) {
      expect(eY.leapYear).to.eq(y.leapYear);
      expect(eY.start).to.eq(y.start);
      expect(eY.end).to.eq(y.end);
    }

    eY = yearData()['2024'];
    const [success, res] = await ProofOfPresence.getYear(2024);
    expect(success).to.be.true;
    expect(res.leapYear).to.eq(eY.leapYear);
    expect(res.start).to.eq(eY.start);
    expect(res.end).to.eq(eY.end);
  });

  // xit('ownable', async () => {
  //   const {users, ProofOfPresence, TDFToken, TokenLock, deployer} = await setup();

  //   const user = users[0];
  //   const {send} = await setupHelpers({
  //     stakeContract: TokenLock,
  //     tokenContract: TDFToken,
  //     bookingContract: ProofOfPresence,
  //     user: user,
  //     admin: deployer,
  //   });
  //   let yearAttrs;
  //   yearAttrs = yearData()['2027'];
  //   await send.addYear.reverted.onlyOwner({...yearAttrs, enabled: false});
  //   await send.addYear.success({...yearAttrs, enabled: false});
  //   yearAttrs = yearData()['2024'];
  //   await send.addYear.reverted.alreadyExists({...yearAttrs, enabled: false});
  //   let [stored] = await ProofOfPresence.getYear(2024);
  //   expect(stored).to.be.true;
  //   await send.removeYear.reverted.onlyOwner(2024);
  //   [stored] = await ProofOfPresence.getYear(2024);
  //   expect(stored).to.be.true;
  //   await send.removeYear.reverted.doesNotExists(3000);
  //   await send.removeYear.success(2023);

  //   await send.updateYear.reverted.onlyOwner({...yearAttrs, enabled: false});
  //   await send.updateYear.reverted.doesNotExists({...yearAttrs, number: 3002, enabled: false});
  //   await send.updateYear.success({...yearAttrs, enabled: false});
  //   await send.enableYear.reverted.onlyOwner(2025, false);
  //   await send.enableYear.reverted.doesNotExists(3002, true);
  //   await send.enableYear.success(2027, false);
  //   await send.pause.reverted.onlyOwner();
  //   await send.pause.success();
  //   await send.unpause.reverted.onlyOwner();
  //   await send.unpause.success();
  // });

  // xit('pausable', async () => {
  //   const {users, ProofOfPresence, TDFToken, TokenLock, deployer} = await setup();

  //   const user = users[0];
  //   const {send} = await setupHelpers({
  //     stakeContract: TokenLock,
  //     tokenContract: TDFToken,
  //     bookingContract: ProofOfPresence,
  //     user: user,
  //     admin: deployer,
  //   });
  //   await user.TDFToken.approve(TokenLock.address, parseEther('10'));
  //   const init = addDays(Date.now(), 10);
  //   const dates = buildDates(init, 5);

  //   // -------------------------------------------------------
  //   //  Book and cancel enabled with  Unpaused
  //   // -------------------------------------------------------
  //   expect(await ProofOfPresence.paused()).to.be.false;
  //   await send.book.success(dates.inputs);
  //   await send.cancel.success(dates.inputs);
  //   // -------------------------------------------------------
  //   //  Book and cancel disabled with  Paused
  //   // -------------------------------------------------------
  //   await send.pause.success();
  //   expect(await ProofOfPresence.paused()).to.be.true;

  //   await send.book.reverted.paused(dates.inputs);
  //   await send.cancel.reverted.paused(dates.inputs);
  // });
});
