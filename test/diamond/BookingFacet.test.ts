import {expect} from '../chai-setup';
import {parseEther} from 'ethers/lib/utils';
import {addDays} from 'date-fns';
import {DateTime} from 'luxon';
import {
  buildDates,
  collectDates,
  yearData,
  timeTravelTo,
  ROLES,
  setupContext,
  setDiamondUser,
  getterHelpers,
  userTesters,
  newBuildDates,
} from '../utils/diamond';
import * as _ from 'lodash';

const setup = setupContext;

describe('BookingFacet', () => {
  it('book', async () => {
    const context = await setup();
    const {users, TDFDiamond, deployer} = context;

    const user = await setDiamondUser({
      user: users[0],
      ...context,
    });

    const admin = await setDiamondUser({
      user: deployer,
      ...context,
    });

    await admin.addMember(users[0].address).success();

    const test = await userTesters({user: users[0], ...context});

    await users[0].TDFToken.approve(TDFDiamond.address, parseEther('10'));
    const init = addDays(Date.now(), 10);
    const dates = buildDates(init, 5);
    await user.bookAccommodation(dates.inputs).success();
    await test.balances('5', '5', '9995');
  });
  describe('book and cancel', () => {
    it('book and cancel same year', async () => {
      const context = await setup();
      const {users, TDFDiamond, deployer} = context;

      const user = await setDiamondUser({
        user: users[0],
        ...context,
      });
      const admin = await setDiamondUser({
        user: deployer,
        ...context,
      });

      await admin.addMember(users[0].address).success();

      const test = await userTesters({user: users[0], ...context});

      await users[0].TDFToken.approve(TDFDiamond.address, parseEther('10'));
      const init = addDays(Date.now(), 10);
      const dates = buildDates(init, 5);

      // -------------------------------------------------------
      //  Book and cancel all the dates
      // -------------------------------------------------------
      await user.bookAccommodation(dates.inputs).success();
      await test.balances('5', '5', '9995');
      await test.bookings(dates, '1');

      await user.cancelAccommodation(dates.inputs).success();

      await test.balances('0', '0', '10000');
      // -------------------------------------------------------
      //  Book and cancel few dates
      // -------------------------------------------------------
      await user.bookAccommodation(dates.inputs).success();
      await test.balances('5', '5', '9995');
      await test.bookings(dates, '1');

      const cDates = collectDates(dates, [0, 4]);
      await user.cancelAccommodation(cDates.inputs).success();
      await test.balances('3', '3', '9997');
      const restcDates = collectDates(dates, [1, 2, 3]);

      await test.bookings(restcDates, '1');
      // TODO test errors
      // await user.cancelAccommodation(cDates.inputs).reverted.noneExisting();

      await timeTravelTo(dates.data[4].unix + 2 * 86400);

      await user.cancelAccommodation(collectDates(dates, [1, 2, 3]).inputs).reverted.inThepast();
    });

    it('book and cancel different years having bookings in future year', async () => {
      const context = await setup();
      const {users, TDFDiamond, deployer} = context;

      const user = await setDiamondUser({
        user: users[0],
        ...context,
      });
      const admin = await setDiamondUser({
        user: deployer,
        ...context,
      });

      await admin.addMember(users[0].address).success();

      const test = await userTesters({user: users[0], ...context});

      await users[0].TDFToken.approve(TDFDiamond.address, parseEther('10'));
      const init = addDays(Date.now(), 10);
      const dates = buildDates(init, 5);

      // -------------------------------------------------------
      //  Booking dates current Year
      // -------------------------------------------------------
      await user.bookAccommodation(dates.inputs).success();
      await test.balances('5', '5', '9995');
      await test.bookings(dates, '1');

      // -------------------------------------------------------
      //  Booking dates for next year
      // -------------------------------------------------------
      const nextYear = DateTime.now().plus({year: 1}).startOf('year').plus({day: 134});
      // console.log(moment((365 * 86400).toString(), 'YYYYMMDD').fromNow());
      const init2 = nextYear.plus({days: 10});
      const dates2 = newBuildDates(init2, 5);
      await user.bookAccommodation(dates2.inputs).success();
      await test.balances('5', '5', '9995');
      await test.bookings(dates2, '1');
      await test.bookings(dates, '1');
    });
  });

  it('getters', async () => {
    const context = await setup();
    const {users, TDFDiamond, deployer} = context;

    const user = await setDiamondUser({
      user: users[0],
      ...context,
    });

    const admin = await setDiamondUser({
      user: deployer,
      ...context,
    });

    await admin.addMember(users[0].address).success();

    const call = await getterHelpers({user: users[0], ...context});
    const test = await userTesters({user: users[0], ...context});

    await users[0].TDFToken.approve(TDFDiamond.address, parseEther('10'));
    const init = addDays(Date.now(), 10);
    const dates = buildDates(init, 5);

    // -------------------------------------------------------
    //  Book and cancel all the dates
    // -------------------------------------------------------
    await user.bookAccommodation(dates.inputs).success();
    await test.balances('5', '5', '9995');
    await test.bookings(dates, '1');
    await call.getAccommodationBookings(users[0], 0).exactMatch(dates);

    const years = await TDFDiamond.getAccommodationYears();
    expect(years.length).to.eq(5);
    const y = years[0];
    let eY = _.find(yearData(), (v) => v.number == y.number);
    expect(eY).not.to.be.undefined;
    if (eY) {
      expect(eY.leapYear).to.eq(y.leapYear);
      expect(eY.start).to.eq(y.start);
      expect(eY.end).to.eq(y.end);
    }

    eY = yearData()['2024'];
    const [success, res] = await TDFDiamond.getAccommodationYear(2024);
    expect(success).to.be.true;
    expect(res.leapYear).to.eq(eY.leapYear);
    expect(res.start).to.eq(eY.start);
    expect(res.end).to.eq(eY.end);
  });

  it('BOOKING_MANAGER_ROLE', async () => {
    const context = await setup();
    const {users, TDFDiamond, deployer} = context;

    const user = await setDiamondUser({
      user: users[0],
      ...context,
    });

    const bookingManager = await setDiamondUser({
      user: users[1],
      ...context,
    });
    let yearAttrs;
    yearAttrs = yearData()['2028'];

    // Give role to user 1 for booking management
    await deployer.TDFDiamond.grantRole(ROLES.BOOKING_MANAGER_ROLE as string, users[1].address);

    await user.addAccommodationYear({...yearAttrs, enabled: false}).reverted.onlyRole();
    await bookingManager.addAccommodationYear({...yearAttrs, enabled: false}).success();
    yearAttrs = yearData()['2024'];
    await bookingManager.addAccommodationYear({...yearAttrs, enabled: false}).reverted.alreadyExists();
    let [stored] = await TDFDiamond.getAccommodationYear(2024);
    expect(stored).to.be.true;
    await user.removeAccommodationYear(2024).reverted.onlyRole();
    [stored] = await TDFDiamond.getAccommodationYear(2024);
    expect(stored).to.be.true;
    await bookingManager.removeAccommodationYear(3000).reverted.doesNotExists();
    await bookingManager.removeAccommodationYear(2023).success();

    await user.updateAccommodationYear({...yearAttrs, enabled: false}).reverted.onlyRole();
    await bookingManager
      .updateAccommodationYear({
        ...yearAttrs,
        number: 3002,
        enabled: false,
      })
      .reverted.doesNotExists();
    await bookingManager.updateAccommodationYear({...yearAttrs, enabled: false}).success();
    await user.enableAccommodationYear(2025, false).reverted.onlyRole();
    await bookingManager.enableAccommodationYear(3002, true).reverted.doesNotExists();
    await bookingManager.enableAccommodationYear(2027, false).success();
  });

  it('DEFAULT_ADMIN_ROLE', async () => {
    const context = await setup();
    const {users, deployer} = context;

    const exampleUser = users[0];
    const user = await setDiamondUser({
      user: exampleUser,
      ...context,
    });

    const bookingManager = await setDiamondUser({
      user: users[1],
      ...context,
    });

    await deployer.TDFDiamond.grantRole(ROLES.DEFAULT_ADMIN_ROLE as string, users[1].address);

    await user.pause().reverted.onlyRole();
    await bookingManager.pause().success();
    await user.unpause().reverted.onlyRole();
    await bookingManager.unpause().success();
  });

  it('pausable', async () => {
    const context = await setup();
    const {users, TDFDiamond, deployer} = context;

    const user = await setDiamondUser({
      user: users[0],
      ...context,
    });

    const admin = await setDiamondUser({
      user: deployer,
      ...context,
    });
    await admin.addMember(users[0].address).success();

    await users[0].TDFToken.approve(TDFDiamond.address, parseEther('10'));
    const init = addDays(Date.now(), 10);
    const dates = buildDates(init, 5);

    // -------------------------------------------------------
    //  Book and cancel enabled with  Unpaused
    // -------------------------------------------------------
    expect(await TDFDiamond.paused()).to.be.false;
    await user.bookAccommodation(dates.inputs).success();
    await user.cancelAccommodation(dates.inputs).success();
    // -------------------------------------------------------
    //  Book and cancel disabled with  Paused
    // -------------------------------------------------------
    await admin.pause().success();
    expect(await TDFDiamond.paused()).to.be.true;

    await user.bookAccommodation(dates.inputs).reverted.paused();
    await user.cancelAccommodation(dates.inputs).reverted.paused();
  });

  it('onlyMembers can book', async () => {
    const context = await setup();
    const {users, deployer, TDFDiamond} = context;

    const user = await setDiamondUser({
      user: users[0],
      ...context,
    });
    const admin = await setDiamondUser({
      user: deployer,
      ...context,
    });
    await users[0].TDFToken.approve(TDFDiamond.address, parseEther('10'));

    await admin.addMember(users[0].address).success();
    // When member

    let init = addDays(Date.now(), 5);
    let dates = buildDates(init, 5);

    await user.bookAccommodation(dates.inputs).success();

    // When not member
    await admin.removeMember(users[0].address).success();

    init = addDays(Date.now(), 11);
    dates = buildDates(init, 5);
    await user.bookAccommodation(dates.inputs).reverted.onlyMember();
  });
});
