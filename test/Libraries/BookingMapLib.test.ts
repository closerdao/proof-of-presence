import {expect} from '../chai-setup';
import {deployments, getUnnamedAccounts, ethers} from 'hardhat';
import {BookingMapLibMock} from '../../typechain';
import {setupUser, setupUsers, getMock} from '../utils';
import {Contract} from 'ethers';
import {parseEther} from 'ethers/lib/utils';

const BN = ethers.BigNumber;

const setup = deployments.createFixture(async (hre) => {
  const {deployments, getNamedAccounts, ethers} = hre;
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
    await expect(user.BookingContract.addYear(2027, false, 1640995200, 1672531199))
      .to.emit(BookingContract, 'OperationResult')
      .withArgs(true);
    await expect(user.BookingContract.addYear(2027, true, 1640995200 + 100, 1672531199 + 100))
      .to.emit(BookingContract, 'OperationResult')
      .withArgs(false);

    let result, data;

    [result, data] = await BookingContract.getYear(2027);
    expect(result).to.be.true;
    expect(data.number).to.eq(2027);
    expect(data.leapYear).to.eq(false);
    expect(data.start).to.eq(1640995200);
    expect(data.end).to.eq(1640995200);
  });
});
