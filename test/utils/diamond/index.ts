import {expect} from '../../chai-setup';
import {parseEther} from 'ethers/lib/utils';
import {ethers, network, deployments, getUnnamedAccounts} from 'hardhat';
import {TDFToken, TDFDiamond} from '../../../typechain';

import {addDays, getUnixTime, getDayOfYear} from 'date-fns';
import {setupUser, setupUsers} from '..';

import {DatesTestData} from './types';
import * as TLH from './tokenlockFacet';
import * as POPH from './proofOfPresenceFacet';
import * as Members from './membershipFacet';
import * as Admin from './adminFacet';

export {ROLES} from './adminFacet';

const BN = ethers.BigNumber;

const testHelpers = async ({TDFToken, TDFDiamond, user}: TestContext) => {
  return {
    balances: async (TK: string, tkU: string, u: string) => {
      expect(await TDFToken.balanceOf(TDFDiamond.address)).to.eq(parseEther(TK));
      expect(await TDFDiamond.stakedBalanceOf(user.address)).to.eq(parseEther(tkU));
      expect(await TDFToken.balanceOf(user.address)).to.eq(parseEther(u));
    },
    stake: async (locked: string, unlocked: string) => {
      expect(await TDFDiamond.lockedStake(user.address)).to.eq(parseEther(locked));
      expect(await TDFDiamond.unlockedStake(user.address)).to.eq(parseEther(unlocked));
    },
    deposits: async (examples: [string, number][]) => {
      const deposits = await TDFDiamond.depositsStakedFor(user.address);
      for (let i = 0; i < deposits.length; i++) {
        expect(deposits[i].amount).to.eq(parseEther(examples[i][0]));
        expect(deposits[i].timestamp).to.eq(BN.from(examples[i][1]));
      }
    },
    bookings: async (dates: DatesTestData, price: string) => {
      await Promise.all(
        dates.data.map(async (e) => {
          const [success, booking] = await TDFDiamond.getAccommodationBooking(user.address, e.year, e.day);
          return Promise.all([
            expect(booking.price).to.eq(parseEther(price)),
            expect(booking.year).to.eq(e.year),
            expect(booking.dayOfYear).to.eq(e.day),
            expect(success).to.be.true,
          ]);
        })
      );
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

export const yearData = () => {
  return {
    '2022': {number: 2022, leapYear: false, start: 1640995200, end: 1672531199},
    '2023': {number: 2023, leapYear: false, start: 1672531200, end: 1704067199},
    '2024': {number: 2024, leapYear: true, start: 1704067200, end: 1735689599},
    '2025': {number: 2025, leapYear: false, start: 1735689600, end: 1767225599},
    '2027': {number: 2027, leapYear: false, start: 1798761600, end: 1830297599},
    '2028': {number: 2028, leapYear: false, start: 1830297600, end: 1861919999},
  };
};

export const setupContext = deployments.createFixture(async (hre) => {
  const {deployments, getNamedAccounts, ethers} = hre;
  await deployments.fixture();

  const accounts = await getNamedAccounts();
  const users = await getUnnamedAccounts();
  const {deployer, TDFTokenBeneficiary} = accounts;

  const token: TDFToken = await ethers.getContract('TDFToken', deployer);
  const contracts = {
    TDFToken: token,
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
  await Promise.all(
    users.map((e) => {
      return conf.TDFTokenBeneficiary.TDFToken.transfer(e, parseEther('10000'));
    })
  );
  return conf;
});
type setupReturnType = Awaited<ReturnType<typeof setupContext>>;
export type TestContext = {user: setupReturnType['deployer']} & setupReturnType;

export const setDiamondUser = async (testContext: TestContext) => {
  return {
    test: await testHelpers(testContext),
    TLF: await TLH.setupHelpers(testContext),
    POPH: await POPH.setupHelpers(testContext),
    ...(await Members.setupHelpers(testContext)),
    ...(await Admin.setupHelpers(testContext)),
  };
};

export const getterHelpers = async (testContext: TestContext) => {
  return {
    ...(await Admin.getterHelpers(testContext)),
  };
};
