import {expect} from '../chai-setup';
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

const setupTestYears = () => {
  const list: {past: DateTime[]; current: DateTime; future: DateTime[]} = {
    past: [],
    current: DateTime.now().startOf('year'),
    future: [],
  };
  for (let i = 1; i < 7; i++) {
    list.future.push(DateTime.now().plus({year: i}).startOf('year'));
    list.past.push(
      DateTime.now()
        .plus({year: i * -1})
        .startOf('year')
    );
  }
  return list;
};

describe('BookingFacet', () => {
  it('book', async () => {
    const context = await setup();
    const {users, deployer} = context;

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

    await test.balances('0', '0', '10000');
    const init = addDays(Date.now(), 10);
    const dates = buildDates(init, 5);
    await user.bookAccommodation(dates.inputs).success();
    await test.balances('5', '5', '9995');
  });

  describe('confirmAccommodationFrom', () => {
    it('works', async () => {
      const context = await setup();
      const {users, deployer} = context;

      const user = await setDiamondUser({
        user: users[0],
        ...context,
      });

      const admin = await setDiamondUser({
        user: deployer,
        ...context,
      });

      const test = await userTesters({user: users[0], ...context});

      const init = addDays(Date.now(), 10);
      const dates = buildDates(init, 5);
      await user.bookAccommodation(dates.inputs).success();
      await test.bookings.toExists(dates, '1', 'Pending');

      await admin.confirmAccommodationFrom(user.address, dates.inputs).success();
      await test.bookings.toExists(dates, '1', 'Confirmed');
    });
  });

  describe('bookAccommodation', () => {
    it('When member status is CONFIRMED', async () => {
      const context = await setup();
      const {users, deployer} = context;

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

      const init = addDays(Date.now(), 10);
      const dates = buildDates(init, 1);
      await user.bookAccommodation(dates.inputs).success();
      await test.bookings.toExists(dates, '1');
    });
    it('When guest status is PENDING', async () => {
      const context = await setup();
      const {users} = context;

      const user = await setDiamondUser({
        user: users[0],
        ...context,
      });

      const test = await userTesters({user: users[0], ...context});

      const init = addDays(Date.now(), 10);
      const dates = buildDates(init, 1);
      await user.bookAccommodation(dates.inputs).success();
      await test.bookings.toExists(dates, '1', 'Pending');
    });
  });

  describe('cancelAccommodationFrom', () => {
    it('works', async () => {
      const context = await setup();
      const {users, deployer} = context;

      const user = await setDiamondUser({
        user: users[0],
        ...context,
      });

      const admin = await setDiamondUser({
        user: deployer,
        ...context,
      });

      const test = await userTesters({user: users[0], ...context});

      const init = addDays(Date.now(), 10);
      const dates = buildDates(init, 1);
      await user.bookAccommodation(dates.inputs).success();
      await test.bookings.toExists(dates, '1', 'Pending');

      await admin.cancelAccommodationFrom(user.address, dates.inputs).success();
      await test.bookings.toNotExist(dates);
    });
    it('reverts when NonPending', async () => {
      const context = await setup();
      const {users, deployer} = context;

      const user = await setDiamondUser({
        user: users[0],
        ...context,
      });

      const admin = await setDiamondUser({
        user: deployer,
        ...context,
      });

      const test = await userTesters({user: users[0], ...context});
      await admin.addMember(users[0].address).success();

      const init = addDays(Date.now(), 10);
      const dates = buildDates(init, 1);
      await user.bookAccommodation(dates.inputs).success();
      await test.bookings.toExists(dates, '1', 'Confirmed');

      await admin.cancelAccommodationFrom(user.address, dates.inputs).reverted.nonPending();
      await test.bookings.toExists(dates, '1');
    });
    it('reverts when paused', async () => {
      const context = await setup();
      const {users, deployer} = context;

      const user = await setDiamondUser({
        user: users[0],
        ...context,
      });

      const admin = await setDiamondUser({
        user: deployer,
        ...context,
      });

      const test = await userTesters({user: users[0], ...context});

      const init = addDays(Date.now(), 10);
      const dates = buildDates(init, 1);
      await user.bookAccommodation(dates.inputs).success();
      await test.bookings.toExists(dates, '1', 'Pending');

      await admin.pause().success();

      await admin.cancelAccommodationFrom(user.address, dates.inputs).reverted.paused();
      await test.bookings.toExists(dates, '1', 'Pending');
    });
    it('reverts when inThePast', async () => {
      const context = await setup();
      const {users, deployer} = context;

      const user = await setDiamondUser({
        user: users[0],
        ...context,
      });

      const admin = await setDiamondUser({
        user: deployer,
        ...context,
      });

      const test = await userTesters({user: users[0], ...context});

      const init = addDays(Date.now(), 10);
      const dates = buildDates(init, 1);
      await user.bookAccommodation(dates.inputs).success();
      await test.bookings.toExists(dates, '1', 'Pending');

      await timeTravelTo(dates.data[0].unix + 2 * 86400);
      await admin.cancelAccommodationFrom(user.address, dates.inputs).reverted.inThepast();
      await test.bookings.toExists(dates, '1', 'Pending');
    });
    it('reverts when NonExisting', async () => {
      const context = await setup();
      const {users, deployer} = context;

      const user = await setDiamondUser({
        user: users[0],
        ...context,
      });

      const admin = await setDiamondUser({
        user: deployer,
        ...context,
      });

      const test = await userTesters({user: users[0], ...context});

      const init = addDays(Date.now(), 10);
      const dates = buildDates(init, 1);
      await test.bookings.toNotExist(dates);

      await admin.cancelAccommodationFrom(user.address, dates.inputs).reverted.nonExisting();
    });
  });
  describe('checkinAccommodationFrom', () => {
    it('works', async () => {
      const context = await setup();
      const {users, deployer} = context;

      const user = await setDiamondUser({
        user: users[0],
        ...context,
      });

      const admin = await setDiamondUser({
        user: deployer,
        ...context,
      });

      const test = await userTesters({user: users[0], ...context});

      const init = addDays(Date.now(), 10);
      const dates = buildDates(init, 1);
      await user.bookAccommodation(dates.inputs).success();
      await test.bookings.toExists(dates, '1', 'Pending');

      await admin.checkinAccommodationFrom(user.address, dates.inputs).success();
      await test.bookings.toExists(dates, '1', 'CheckedIn');
    });
  });

  describe('book and cancel', () => {
    it('same year', async () => {
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

      const init = addDays(Date.now(), 10);
      const dates = buildDates(init, 5);

      // -------------------------------------------------------
      //  Book and cancel all the dates
      // -------------------------------------------------------
      await user.bookAccommodation(dates.inputs).success();
      await test.balances('5', '5', '9995');
      await test.bookings.toExists(dates, '1');

      await user.cancelAccommodation(dates.inputs).success();

      await test.balances('5', '5', '9995');
      // -------------------------------------------------------
      //  Book and cancel few dates
      // -------------------------------------------------------
      await user.bookAccommodation(dates.inputs).success();
      await test.balances('5', '5', '9995');
      await test.bookings.toExists(dates, '1');

      const cDates = collectDates(dates, [0, 4]);
      await user.cancelAccommodation(cDates.inputs).success();
      await test.balances('5', '5', '9995');
      const restcDates = collectDates(dates, [1, 2, 3]);

      await test.bookings.toExists(restcDates, '1');

      await timeTravelTo(dates.data[4].unix + 2 * 86400);

      await user.cancelAccommodation(collectDates(dates, [1, 2, 3]).inputs).reverted.inThepast();
    });

    it('different years having bookings in future year', async () => {
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

      const init = addDays(Date.now(), 10);
      const dates = buildDates(init, 5);

      // -------------------------------------------------------
      //  Booking dates current Year
      // -------------------------------------------------------
      await user.bookAccommodation(dates.inputs).success();
      await test.balances('5', '5', '9995');
      await test.bookings.toExists(dates, '1');

      // -------------------------------------------------------
      //  Booking dates for next year
      // -------------------------------------------------------
      const nextYear = DateTime.now().plus({year: 1}).startOf('year').plus({day: 134});
      // console.log(moment((365 * 86400).toString(), 'YYYYMMDD').fromNow());
      const init2 = nextYear.plus({days: 10});
      const dates2 = newBuildDates(init2, 5);
      await user.bookAccommodation(dates2.inputs).success();
      await test.balances('5', '5', '9995');
      await test.deposits([]);
      await test.bookings.toExists(dates2, '1');
      await test.bookings.toExists(dates, '1');
    });
    it('booking next year, current year and canceling current', async () => {
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

      // -------------------------------------------------------
      //  Booking dates for next year
      // -------------------------------------------------------
      const nextYear = DateTime.now().plus({year: 1}).startOf('year').plus({day: 134});
      const init2 = nextYear.plus({days: 10});
      const dates2 = newBuildDates(init2, 5);
      await user.bookAccommodation(dates2.inputs).success();
      await test.balances('5', '5', '9995');
      await test.bookings.toExists(dates2, '1');
      // TODO: test locked balance

      // -------------------------------------------------------
      //  Booking dates current Year
      // -------------------------------------------------------
      const init = addDays(Date.now(), 10);
      const dates = buildDates(init, 5);
      await user.bookAccommodation(dates.inputs).success();
      await test.balances('5', '5', '9995');
      await test.bookings.toExists(dates, '1');
      await test.stake('5', '0');
      await user.cancelAccommodation(dates.inputs).success();
      await test.balances('5', '5', '9995');
      await test.stake('5', '0');
    });
    it('booking next year, current year and canceling current with different prices', async () => {
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

      // -------------------------------------------------------
      //  Booking dates for next year
      // -------------------------------------------------------
      const nextYear = DateTime.now().plus({year: 1}).startOf('year').plus({day: 134});
      const init2 = nextYear.plus({days: 10});
      const dates2 = newBuildDates(init2, 5);
      await user.bookAccommodation(dates2.inputs).success();
      await test.balances('5', '5', '9995');
      await test.bookings.toExists(dates2, '1');
      // TODO: test locked balance

      // -------------------------------------------------------
      //  Booking dates current Year
      // -------------------------------------------------------
      const init = addDays(Date.now(), 10);
      const dates = buildDates(init, 5);
      await user.bookAccommodation(dates.inputs).success();
      await test.balances('5', '5', '9995');
      await test.bookings.toExists(dates, '1');
      await test.stake('5', '0');
      await user.cancelAccommodation(dates.inputs).success();
      await test.balances('5', '5', '9995');
      await test.stake('5', '0');
    });

    describe('test cases', () => {
      it('Y1 add | Y2 cancel, add | Y3 add', async () => {
        // |Case|2022  |FIELD3  |2023  |FIELD5  |2024  |FIELD7  |2025  |FIELD9  |Init locking TM|End Locking TM|Locked Years                    |
        // |----|------|--------|------|--------|------|--------|------|--------|---------------|--------------|--------------------------------|
        // |    |Locked|Bookings|Locked|Bookings|Locked|Bookings|Locked|Bookings|               |              |                                |
        // |C   |1     |1       |1     |1       |      |        |      |        |2023           |2024          |2022 \ 2023                     |
        // |C'  |1     |1       |0     |0       |      |        |      |        |2022           |2023          |2022                            |
        // |C'' |1     |1       |1     |0       |1     |1       |      |        |2024           |2025          |2022 \ 2023 \ 2024              |
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

        // -------------------------------------------------------
        //  Set bookings for this and next year
        // -------------------------------------------------------
        const init = DateTime.now().plus({days: 10});
        const dates = newBuildDates(init, 1);
        await user.bookAccommodation(dates.inputs).success();
        const nextYear = DateTime.now().plus({year: 1}).startOf('year').plus({day: 134});
        const init2 = nextYear.plus({days: 10});
        const dates2 = newBuildDates(init2, 1);
        await user.bookAccommodation(dates2.inputs).success();
        await test.balances('1', '1', '9999');
        await test.bookings.toExists(dates, '1');
        await test.bookings.toExists(dates2, '1');
        // await test.stakeAt(dates2.inputs[0][0], dates2.inputs[0][1], '1', '0');
        // await test.stakeAt(dates2.inputs[0][0] + 1, dates2.inputs[0][1] + 1, '0', '1');

        await user.cancelAccommodation(dates2.inputs).success();
        // await test.stakeAt(dates2.inputs[0][0], dates2.inputs[0][1], '0', '1');
        // await test.stakeAt(dates.inputs[0][0], dates.inputs[0][1] + 10, '0', '1');

        const thirdYear = DateTime.now().plus({year: 2}).startOf('year').plus({day: 134});
        const init3 = thirdYear.plus({days: 10});
        const dates3 = newBuildDates(init3, 1);
        await user.bookAccommodation(dates3.inputs).success();
        await test.balances('1', '1', '9999');
        await test.bookings.toExists(dates, '1');
        await test.bookings.toExists(dates3, '1');
      });
      xit('case D', async () => {
        // |Case|2022  |FIELD3  |2023  |FIELD5  |2024  |FIELD7  |2025  |FIELD9  |Init locking TM|End Locking TM|Locked Years                    |
        // |----|------|--------|------|--------|------|--------|------|--------|---------------|--------------|--------------------------------|
        // |    |Locked|Bookings|Locked|Bookings|Locked|Bookings|Locked|Bookings|               |              |                                |
        // |D   |5     |0       |5     |5       |4     |4       |      |        |2024           |2025          |2023 \ 2023 \ 2024 \ 2025       |
        // |D'  |6     |0       |6     |5       |6     |4       |6     |6       |2025           |2026          |2024 \ 2023 \ 2024 \ 2025 \ 2026|
        // |D'' |5     |0       |5     |5       |4     |4       |2     |2       |2025           |2026          |2025 \ 2023 \ 2024 \ 2025 \ 2026|
        // |D'''|4     |0       |4     |3       |4     |4       |2     |2       |2025           |2026          |2026 \ 2023 \ 2024 \ 2025 \ 2026|
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

        const years = setupTestYears();

        ////
        // NOTE: Bookings will start one year ahead of current year this is to not running in
        // test failures when aproximating to end of year

        // -------------------------------------------------------
        //  Booking five days for next year
        // -------------------------------------------------------
        const init = years.future[1].plus({days: 156});
        const dates1 = newBuildDates(init, 5);
        await user.bookAccommodation(dates1.inputs).success();
        await test.balances('5', '5', '9995');
        // TODO: test:
        // - 5 coins should be locked until init + 1 year

        // -------------------------------------------------------
        //  Booking 4 days for two years in advance
        // -------------------------------------------------------
        const init2 = years.future[2].plus({days: 40});
        const dates2 = newBuildDates(init2, 4);
        await user.bookAccommodation(dates2.inputs).success();
        await test.balances('5', '5', '9995');
        // TODO: test:
        // - 5 coins should be locked until init + 1 year
        // - 4 coins should be locked until init2 + 1 year\

        // -------------------------------------------------------
        //  Booking 6 days for three years in advance
        // -------------------------------------------------------
        const init3 = years.future[3].plus({days: 200});
        const dates3 = newBuildDates(init3, 6);
        await user.bookAccommodation(dates3.inputs).success();
        await test.balances('6', '6', '9994');
        // TODO: test:
        // 6 coins are locked until 4 years in the future
        await user.cancelAccommodation(dates3.inputs.slice(2, 5)).success();
        await test.balances('5', '5', '9995');
        // TODO: test:
        // 2 coins are locked until 4 years in the future
        // 4 coins are locked until 3 years in the future
        // 5 coins are locked until 2 years in the future
        await user.cancelAccommodation(dates1.inputs.slice(0, 1)).success();
        await test.balances('5', '5', '9995');
      });
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

    const init = addDays(Date.now(), 10);
    const dates = buildDates(init, 5);

    // -------------------------------------------------------
    //  Book and cancel all the dates
    // -------------------------------------------------------
    await user.bookAccommodation(dates.inputs).success();
    await test.balances('5', '5', '9995');
    await test.bookings.toExists(dates, '1');
    await call.getAccommodationBookings(users[0], 0).exactMatch(dates);

    const years = await TDFDiamond.getAccommodationYears();
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
    // yearAttrs = yearData()['2028'];
    yearAttrs = {number: 4000, start: 20202020202, end: 949393999939, leapYear: false};

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
});
