import {expect} from '../../chai-setup';
import {parseEther, formatEther} from 'ethers/lib/utils';
import {ethers, network, deployments, getUnnamedAccounts} from 'hardhat';
import {DateTime} from 'luxon';

import {BookingMapLib} from '../../../typechain/TDFDiamond';

import {addDays, getUnixTime, getDayOfYear} from 'date-fns';
import {setupUser, setupUsers} from '..';

import {DatesTestData} from './types';
import * as stakingHelpers from './stakingHelpers';
import * as bookingHelpers from './bookingHelpers';
import * as membershipHelpers from './membershipHelpers';
import * as adminHelpers from './adminHelpers';
import type {TDFTokenTest, TDFDiamond} from '../../../typechain';

export {ROLES} from '../../../utils';

const BN = ethers.BigNumber;

export const userTesters = async ({TDFTokenTest, TDFDiamond, user}: TestContext) => {
  enum BookingStatus {
    Pending = 'Pending',
    Confirmed = 'Confirmed',
    CheckedIn = 'CheckedIn',
  }
  return {
    balances: async (diamondTokenBalance: string, stakedBalance: string, userTokenBalance: string) => {
      let current = await TDFTokenTest.balanceOf(TDFDiamond.address);
      expect(current, `balances diamondTokenBalance to Eq(${diamondTokenBalance}), GOT(${formatEther(current)})`).to.eq(
        parseEther(diamondTokenBalance)
      );
      current = await TDFDiamond.stakedBalanceOf(user.address);
      expect(current, `balances stakedBalance to Eq(${stakedBalance}), GOT(${formatEther(current)})`).to.eq(
        parseEther(stakedBalance)
      );
      current = await TDFTokenTest.balanceOf(user.address);
      expect(current, `balances userTokenBalance to Eq(${userTokenBalance}), GOT(${formatEther(current)})`).to.eq(
        parseEther(userTokenBalance)
      );
    },
    stake: async (locked: string, unlocked: string) => {
      expect(await TDFDiamond.lockedStake(user.address), `stake locked to Eq(${locked})`).to.eq(parseEther(locked));
      expect(await TDFDiamond.unlockedStake(user.address), `stake unlocked to Eq(${unlocked})`).to.eq(
        parseEther(unlocked)
      );
    },
    stakeAt: async (year: number, day: number, locked: string, unlocked: string) => {
      expect(
        await TDFDiamond.lockedStakeAt(user.address, year, day),
        `stakedAt locked(${locked}), year(${year}), day(${day})`
      ).to.eq(parseEther(locked));
      expect(
        await TDFDiamond.unlockedStakeAt(user.address, year, day),
        `stakedAt unLocked(${unlocked}), year(${year}), day(${day})`
      ).to.eq(parseEther(unlocked));
    },
    deposits: async (examples: [string, number][]) => {
      const deposits = await TDFDiamond.depositsStakedFor(user.address);
      for (let i = 0; i < examples.length; i++) {
        expect(deposits[i].amount, `deposits Index(${i}) Amount(${examples[i][0]})`).to.eq(parseEther(examples[i][0]));
        expect(deposits[i].timestamp, `deposits Index(${i}) timestamp(${examples[i][1]})`).to.eq(
          BN.from(examples[i][1])
        );
      }
    },
    bookings: {
      toExists: async (dates: DatesTestData, price: string, status: string = BookingStatus.Confirmed) => {
        const list: BookingMapLib.BookingStructOutput[] = [];
        let st: number;
        switch (status) {
          case BookingStatus.Pending:
            st = 0;
            break;
          case BookingStatus.Confirmed:
            st = 1;
            break;
          case BookingStatus.CheckedIn:
            st = 2;
            break;
          default:
            throw new Error(`invalid Booking status: ${status} `);
        }
        await Promise.all(
          dates.data.map(async (e) => {
            const [success, booking] = await TDFDiamond.getAccommodationBooking(user.address, e.year, e.day);
            list.push(booking);
            return Promise.all([
              expect(success).to.be.true,
              expect(booking.price).to.eq(parseEther(price)),
              expect(booking.year).to.eq(e.year),
              expect(booking.dayOfYear).to.eq(e.day),
              expect(
                booking.status,
                `expect booking status toEQ(${status}) GOT(${
                  Object.values(BookingStatus)[parseInt(booking.status.toString())]
                })`
              ).to.eq(st),
            ]);
          })
        );
      },
      toNotExist: async (dates: DatesTestData) => {
        await Promise.all(
          dates.data.map(async (e) => {
            const [exists] = await TDFDiamond.getAccommodationBooking(user.address, e.year, e.day);
            return Promise.all([expect(exists).to.be.false]);
          })
        );
      },
    },
  };
};

export const buildDates = (initDate: Date, amount: number): DatesTestData => {
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

export const newBuildDates = (date: DateTime, amount: number) => {
  const acc: DatesTestData = {data: [], inputs: []};
  for (let i = 0; i < amount; i++) {
    const nDate = date.plus({days: i});
    acc.data.push({
      year: nDate.year,
      day: getDayOfYear(nDate.toJSDate()),
      unix: nDate.toUnixInteger(),
    });
    acc.inputs.push([nDate.year, getDayOfYear(nDate.toJSDate())]);
  }
  return acc;
};

export const collectDates = (dates: DatesTestData, indexes: number[]): DatesTestData => {
  const acc: DatesTestData = {data: [], inputs: []};
  indexes.forEach((i) => {
    acc.data.push(dates.data[i]);
    acc.inputs.push(dates.inputs[i]);
  });
  return acc;
};

export const timeTravelTo = async (time: number) => {
  await network.provider.send('evm_setNextBlockTimestamp', [time]);
  await network.provider.send('evm_mine');
};

// TODO: no need to be a function
export const yearData = () => {
  return {
    '2022': {number: 2022, leapYear: false, start: 1640995200, end: 1672531199},
    '2023': {number: 2023, leapYear: false, start: 1672531200, end: 1704067199},
    '2024': {number: 2024, leapYear: true, start: 1704067200, end: 1735689599},
    '2025': {number: 2025, leapYear: false, start: 1735689600, end: 1767225599},
    '2026': {number: 2026, leapYear: false, start: 1767225600, end: 1798761599},
    '2027': {number: 2027, leapYear: false, start: 1798761600, end: 1830297599},
    '2028': {number: 2028, leapYear: true, start: 1830297600, end: 1861919999},
    '2029': {number: 2029, leapYear: false, start: 1861920000, end: 1893455999},
    '2030': {number: 2030, leapYear: false, start: 1893456000, end: 1924991999},
  };
};

export const setupContext = deployments.createFixture(async (hre) => {
  const {deployments, getNamedAccounts, ethers} = hre;
  await deployments.fixture();

  const accounts = await getNamedAccounts();
  const users = await getUnnamedAccounts();
  const {deployer, TDFTokenBeneficiary} = accounts;

  const token: TDFTokenTest = await ethers.getContract('TDFTokenTest', deployer);
  const contracts = {
    TDFTokenTest: token,
    TDFDiamond: <TDFDiamond>await ethers.getContract('TDFDiamond', deployer),
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
  await conf.deployer.TDFTokenTest.mint(deployer, parseEther('10000'));
  await Promise.all(
    users.map((e) => {
      return conf.deployer.TDFTokenTest.mint(e, parseEther('10000'));
    })
  );
  return conf;
});
type setupReturnType = Awaited<ReturnType<typeof setupContext>>;
export type TestContext = {user: setupReturnType['deployer']} & setupReturnType;

export const setDiamondUser = async (testContext: TestContext) => {
  return {
    ...(await stakingHelpers.setupHelpers(testContext)),
    ...(await bookingHelpers.setupHelpers(testContext)),
    ...(await membershipHelpers.setupHelpers(testContext)),
    ...(await adminHelpers.setupHelpers(testContext)),
    address: testContext.user.address,
  };
};

export const getterHelpers = async (testContext: TestContext) => {
  return {
    ...(await stakingHelpers.getterHelpers(testContext)),
    ...(await membershipHelpers.getterHelpers(testContext)),
    ...(await bookingHelpers.getterHelpers(testContext)),
    ...(await adminHelpers.getterHelpers(testContext)),
  };
};

export const roleTesters = async (testContext: TestContext) => {
  const booking = await bookingHelpers.roleTesters(testContext);
  const admin = await adminHelpers.roleTesters(testContext);
  const members = await membershipHelpers.roleTesters(testContext);
  const staking = await stakingHelpers.roleTesters(testContext);

  return {
    address: testContext.user.address,
    can: {
      ...staking.can,
      ...members.can,
      ...booking.can,
      ...admin.can,
    },
    cannot: {
      ...staking.cannot,
      ...members.cannot,
      ...booking.cannot,
      ...admin.cannot,
    },
  };
};
