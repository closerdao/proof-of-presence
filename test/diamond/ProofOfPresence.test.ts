import {expect} from '../chai-setup';
import {deployments, getUnnamedAccounts, ethers, network} from 'hardhat';
import {TDFToken, ProofOfPresence, TokenLock, TDFDiamond__factory} from '../../typechain';
import {BookingMapLib} from '../../typechain/ProofOfPresence';

import {setupUser, setupUsers} from '../utils';
import {Contract} from 'ethers';
import {parseEther} from 'ethers/lib/utils';
import {addDays, getUnixTime, fromUnixTime, getDayOfYear, yearsToMonths} from 'date-fns';
const BN = ethers.BigNumber;
import * as _ from 'lodash';
import {TDFDiamond} from '../../typechain';
import {diamondTest} from '../utils/diamond';
import {DatesTestData} from '../utils/diamond/types';

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

const setup = deployments.createFixture(async (hre) => {
  const {deployments, getNamedAccounts, ethers} = hre;

  await deployments.fixture();

  const accounts = await getNamedAccounts();
  const users = await getUnnamedAccounts();
  const {deployer, TDFTokenBeneficiary} = accounts;

  const token = <TDFToken>await ethers.getContract('TDFToken', deployer);
  const contracts = {
    TDFDiamond: <TDFDiamond>await ethers.getContract('TDFDiamond', deployer),
    TDFToken: token,
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

describe('ProofOfPresenceFacet', () => {
  it('book', async () => {
    const {users, TDFToken, deployer, TDFDiamond} = await setup();

    const user = users[0];
    const {test, POPH} = await diamondTest({
      tokenContract: TDFToken,
      diamond: TDFDiamond,
      user: user,
      admin: deployer,
    });

    const {send} = POPH;

    await user.TDFToken.approve(TDFDiamond.address, parseEther('10'));
    const init = addDays(Date.now(), 10);
    const dates = buildDates(init, 5);
    await send.book.success(dates.inputs);
    await test.balances('5', '5', '9995');
  });
  it('book and cancel', async () => {
    const {users, TDFToken, deployer, TDFDiamond} = await setup();
    const user = users[0];

    const {test, POPH} = await diamondTest({
      tokenContract: TDFToken,
      diamond: TDFDiamond,
      user: user,
      admin: deployer,
    });

    const {send} = POPH;

    await user.TDFToken.approve(TDFDiamond.address, parseEther('10'));
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

  it('getters', async () => {
    const {users, TDFToken, deployer, TDFDiamond} = await setup();
    const user = users[0];

    const {test, POPH} = await diamondTest({
      tokenContract: TDFToken,
      diamond: TDFDiamond,
      user: user,
      admin: deployer,
    });

    const {send, call} = POPH;

    await user.TDFToken.approve(TDFDiamond.address, parseEther('10'));
    const init = addDays(Date.now(), 10);
    const dates = buildDates(init, 5);

    // -------------------------------------------------------
    //  Book and cancel all the dates
    // -------------------------------------------------------
    await send.book.success(dates.inputs);
    await test.balances('5', '5', '9995');
    await test.bookings(dates, '1');
    await call.getBookings(dates);

    const years = await TDFDiamond.getYears();
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
    const [success, res] = await TDFDiamond.getYear(2024);
    expect(success).to.be.true;
    expect(res.leapYear).to.eq(eY.leapYear);
    expect(res.start).to.eq(eY.start);
    expect(res.end).to.eq(eY.end);
  });

  it('ownable', async () => {
    const {users, TDFToken, deployer, TDFDiamond} = await setup();

    const user = users[0];
    const {POPH} = await diamondTest({
      tokenContract: TDFToken,
      diamond: TDFDiamond,
      user: user,
      admin: deployer,
    });

    const {send} = POPH;
    let yearAttrs;
    yearAttrs = yearData()['2027'];
    await send.addYear.reverted.onlyOwner({...yearAttrs, enabled: false});
    await send.addYear.success({...yearAttrs, enabled: false});
    yearAttrs = yearData()['2024'];
    await send.addYear.reverted.alreadyExists({...yearAttrs, enabled: false});
    let [stored] = await TDFDiamond.getYear(2024);
    expect(stored).to.be.true;
    await send.removeYear.reverted.onlyOwner(2024);
    [stored] = await TDFDiamond.getYear(2024);
    expect(stored).to.be.true;
    await send.removeYear.reverted.doesNotExists(3000);
    await send.removeYear.success(2023);

    await send.updateYear.reverted.onlyOwner({...yearAttrs, enabled: false});
    await send.updateYear.reverted.doesNotExists({...yearAttrs, number: 3002, enabled: false});
    await send.updateYear.success({...yearAttrs, enabled: false});
    await send.enableYear.reverted.onlyOwner(2025, false);
    await send.enableYear.reverted.doesNotExists(3002, true);
    await send.enableYear.success(2027, false);
    await send.pause.reverted.onlyOwner();
    await send.pause.success();
    await send.unpause.reverted.onlyOwner();
    await send.unpause.success();
  });

  it('pausable', async () => {
    const {users, TDFToken, deployer, TDFDiamond} = await setup();

    const user = users[0];
    const {POPH} = await diamondTest({
      tokenContract: TDFToken,
      diamond: TDFDiamond,
      user: user,
      admin: deployer,
    });

    const {send} = POPH;
    await user.TDFToken.approve(TDFDiamond.address, parseEther('10'));
    const init = addDays(Date.now(), 10);
    const dates = buildDates(init, 5);

    // -------------------------------------------------------
    //  Book and cancel enabled with  Unpaused
    // -------------------------------------------------------
    expect(await TDFDiamond.paused()).to.be.false;
    await send.book.success(dates.inputs);
    await send.cancel.success(dates.inputs);
    // -------------------------------------------------------
    //  Book and cancel disabled with  Paused
    // -------------------------------------------------------
    await send.pause.success();
    expect(await TDFDiamond.paused()).to.be.true;

    await send.book.reverted.paused(dates.inputs);
    await send.cancel.reverted.paused(dates.inputs);
  });
});
