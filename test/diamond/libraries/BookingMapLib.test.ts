import {expect} from '../../chai-setup';
import {deployments, getUnnamedAccounts} from 'hardhat';
import {BookingMapLibMock} from '../../../typechain';
import {setupUser, setupUsers, getMock} from '../../utils';
import {parseEther} from 'ethers/lib/utils';
import {fromUnixTime, getDayOfYear} from 'date-fns';

const yearData = () => {
  return {
    '2024': {number: 2024, LeapYear: true, start: 1704067200, end: 1735689599},
    '2027': {number: 2027, LeapYear: false, start: 1798761600, end: 1830297599},
  };
};

const setup = deployments.createFixture(async (hre) => {
  const {deployments, getNamedAccounts} = hre;
  await deployments.fixture();

  const accounts = await getNamedAccounts();
  const users = await getUnnamedAccounts();
  const {deployer} = accounts;

  const contracts = {
    BookingContract: <BookingMapLibMock>await getMock('BookingMapLibMock', deployer, []),
  };

  return {
    ...contracts,
    users: await setupUsers(users, contracts),
    deployer: await setupUser(deployer, contracts),
    accounts,
  };
});

describe('BookingMapLib', () => {
  it('Bookings test', async () => {
    const {users, BookingContract} = await setup();
    const user = users[0];
    await expect(user.BookingContract.book(user.address, 2023, 13))
      .to.emit(BookingContract, 'OperationResult')
      .withArgs(true);

    let result, data;
    [result, data] = await BookingContract.getBooking(user.address, 2023, 13);
    expect(result).to.be.true;
    expect(data.price).to.eq(parseEther('1'));
    [result, data] = await BookingContract.getBooking(user.address, 2023, 234);
    expect(result).to.be.false;

    data = await BookingContract.getBookings(user.address, 2023);
    expect(data[0].year).to.eq(2023);
    expect(data[0].dayOfYear).to.eq(13);
    expect(data[0].price).to.eq(parseEther('1'));
    expect(data.length).to.eq(1);

    await expect(user.BookingContract.remove(user.address, 2023, 13))
      .to.emit(BookingContract, 'OperationResult')
      .withArgs(true);
    data = await BookingContract.getBookings(user.address, 2023);
    expect(data.length).to.eq(0);
  });

  it('years integration test', async () => {
    const {users, BookingContract} = await setup();
    const user = users[0];

    const testYear = {
      year: 3500,
      init: 16409952000,
      end: 16725311990,
    };
    await expect(user.BookingContract.addYear(testYear.year, false, testYear.init, testYear.end, true))
      .to.emit(BookingContract, 'OperationResult')
      .withArgs(true);
    await expect(user.BookingContract.addYear(testYear.year, true, testYear.init + 100, testYear.end + 100, true))
      .to.emit(BookingContract, 'OperationResult')
      .withArgs(false);

    let result, data;
    // Did not updated the year
    [result, data] = await BookingContract.getYear(testYear.year);
    expect(result).to.be.true;
    expect(data.number).to.eq(testYear.year);
    expect(data.leapYear).to.eq(false);
    expect(data.start).to.eq(testYear.init);
    expect(data.end).to.eq(testYear.end);

    // updateing the year
    const year2027 = yearData()['2027'];
    await expect(user.BookingContract.updateYear(2027, year2027.LeapYear, year2027.start, year2027.end, true))
      .to.emit(BookingContract, 'OperationResult')
      .withArgs(true);

    [result, data] = await BookingContract.getYear(2027);
    expect(result).to.be.true;
    expect(data.number).to.eq(2027);
    expect(data.leapYear).to.eq(year2027.LeapYear);
    expect(data.start).to.eq(year2027.start);
    expect(data.end).to.eq(year2027.end);

    await expect(user.BookingContract.removeYear(2027)).to.emit(BookingContract, 'OperationResult').withArgs(true);
    [result, data] = await BookingContract.getYear(2027);
    expect(result).to.be.false;

    data = await BookingContract.getYears();

    expect(data[0].number).to.eq(2022);
    expect(data[0].leapYear).to.eq(false);
    expect(data[0].start).to.eq(1640995200);
    expect(data[0].end).to.eq(1672531199);

    expect(await BookingContract.containsYear(2027)).to.be.false;
    expect(await BookingContract.containsYear(2022)).to.be.true;
  });

  it('buildTimestamp', async () => {
    const {BookingContract, users} = await setup();
    const user = users[0];
    const testTimestamp = async (year: number, month: number, day: number) => {
      const date = new Date(year, month - 1, day);
      const dayOY = getDayOfYear(date);
      const res = await BookingContract.buildTimestamp(year, dayOY);
      const d = fromUnixTime(res.toNumber());
      expect(d.getUTCDate()).to.eq(day);
      expect(d.getUTCMonth() + 1).to.eq(month);
      expect(d.getUTCFullYear()).to.eq(year);
      expect(getDayOfYear(d)).to.eq(dayOY);
    };
    await testTimestamp(2022, 5, 16);
    await testTimestamp(2022, 8, 16);
    await testTimestamp(2022, 12, 31);
    await testTimestamp(2023, 8, 13);
    await testTimestamp(2023, 8, 18);
    await testTimestamp(2024, 1, 1);
    await testTimestamp(2024, 2, 29);
    await testTimestamp(2024, 12, 31);
    await testTimestamp(2024, 10, 28);
    await testTimestamp(2025, 1, 1);
    await testTimestamp(2025, 2, 27);
    await testTimestamp(2025, 12, 31);
    await testTimestamp(2025, 10, 28);
    await testTimestamp(2024, 12, 30);

    await expect(BookingContract.buildTimestamp(3500, 10)).to.be.revertedWith('Unable to build Timestamp');
    await expect(BookingContract.buildTimestamp(2000, 10)).to.be.revertedWith('Unable to build Timestamp');
    await expect(BookingContract.buildTimestamp(3100, 34)).to.be.revertedWith('Unable to build Timestamp');
    await expect(BookingContract.buildTimestamp(3000, 366)).to.be.revertedWith('Unable to build Timestamp');

    // After disabling year. build timestamp should fail
    const year2024 = yearData()['2024'];

    await expect(user.BookingContract.updateYear(2024, year2024.LeapYear, year2024.start, year2024.end, false))
      .to.emit(BookingContract, 'OperationResult')
      .withArgs(true);
    const [result, data] = await BookingContract.getYear(2024);
    expect(result).to.be.true;
    expect(data.enabled).to.be.false;

    await expect(BookingContract.buildTimestamp(2024, 2)).to.be.revertedWith('Unable to build Timestamp');
    await expect(BookingContract.buildTimestamp(2024, 12)).to.be.revertedWith('Unable to build Timestamp');
  });

  it('buildBooking', async () => {
    const {BookingContract, users} = await setup();
    const user = users[0];
    let result, data;

    result = await BookingContract.buildBooking(2022, 16, parseEther('1'));
    expect(result.year).to.eq(2022);
    expect(result.dayOfYear).to.eq(16);
    expect(result.price).to.eq(parseEther('1'));
    // expect(result.timestamp).to.be.greaterThan(1640995200);
    result = await BookingContract.buildBooking(2024, 366, parseEther('2'));
    expect(result.year).to.eq(2024);
    expect(result.dayOfYear).to.eq(366);
    expect(result.price).to.eq(parseEther('2'));
    await expect(BookingContract.buildBooking(3000, 366, parseEther('2'))).to.be.revertedWith(
      'Unable to build Booking'
    );
    await expect(BookingContract.buildBooking(2021, 366, parseEther('2'))).to.be.revertedWith(
      'Unable to build Booking'
    );

    // After disabling year. build timestamp should fail
    const year2024 = yearData()['2024'];
    data = undefined;
    await expect(user.BookingContract.updateYear(2024, year2024.LeapYear, year2024.start, year2024.end, false))
      .to.emit(BookingContract, 'OperationResult')
      .withArgs(true);
    [result, data] = await BookingContract.getYear(2024);
    expect(result).to.be.true;
    expect(data.enabled).to.be.false;

    await expect(BookingContract.buildBooking(2024, 366, parseEther('2'))).to.be.revertedWith(
      'Unable to build Booking'
    );
    await expect(BookingContract.buildBooking(2024, 10, parseEther('2'))).to.be.revertedWith('Unable to build Booking');
  });
});
