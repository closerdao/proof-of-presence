import {expect} from '../chai-setup';
import {parseEther} from 'ethers/lib/utils';
import {addDays} from 'date-fns';
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
} from '../utils/diamond';
import * as _ from 'lodash';

const setup = setupContext;

describe('ProofOfPresenceFacet', () => {
  it('book', async () => {
    const context = await setup();
    const {users, TDFDiamond} = context;

    const user = await setDiamondUser({
      user: users[0],
      ...context,
    });

    const test = await userTesters({user: users[0], ...context});

    await users[0].TDFToken.approve(TDFDiamond.address, parseEther('10'));
    const init = addDays(Date.now(), 10);
    const dates = buildDates(init, 5);
    await user.bookAccommodation.success(dates.inputs);
    await test.balances('5', '5', '9995');
  });
  it('book and cancel', async () => {
    const context = await setup();
    const {users, TDFDiamond} = context;

    const user = await setDiamondUser({
      user: users[0],
      ...context,
    });

    const test = await userTesters({user: users[0], ...context});

    await users[0].TDFToken.approve(TDFDiamond.address, parseEther('10'));
    const init = addDays(Date.now(), 10);
    const dates = buildDates(init, 5);

    // -------------------------------------------------------
    //  Book and cancel all the dates
    // -------------------------------------------------------
    await user.bookAccommodation.success(dates.inputs);
    await test.balances('5', '5', '9995');
    await test.bookings(dates, '1');

    await user.cancelAccommodation.success(dates.inputs);
    // TODO:
    // expect((await ProofOfPresence.getDates(user.address)).length).to.eq(0);
    await test.balances('5', '5', '9995');
    // -------------------------------------------------------
    //  Book and cancel few dates
    // -------------------------------------------------------
    await user.bookAccommodation.success(dates.inputs);
    await test.balances('5', '5', '9995');
    await test.bookings(dates, '1');

    const cDates = collectDates(dates, [0, 4]);
    await user.cancelAccommodation.success(cDates.inputs);
    // TODO:
    // expect((await ProofOfPresence.getDates(user.address)).length).to.eq(3);
    await test.balances('5', '5', '9995');
    const restcDates = collectDates(dates, [1, 2, 3]);

    await test.bookings(restcDates, '1');
    await user.cancelAccommodation.reverted.noneExisting(cDates.inputs);

    await timeTravelTo(dates.data[4].unix + 2 * 86400);

    await user.cancelAccommodation.reverted.inThepast(collectDates(dates, [1, 2, 3]).inputs);
  });

  it('getters', async () => {
    const context = await setup();
    const {users, TDFDiamond} = context;

    const user = await setDiamondUser({
      user: users[0],
      ...context,
    });

    const call = await getterHelpers({user: users[0], ...context});
    const test = await userTesters({user: users[0], ...context});

    await users[0].TDFToken.approve(TDFDiamond.address, parseEther('10'));
    const init = addDays(Date.now(), 10);
    const dates = buildDates(init, 5);

    // -------------------------------------------------------
    //  Book and cancel all the dates
    // -------------------------------------------------------
    await user.bookAccommodation.success(dates.inputs);
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

    await user.addAccommodationYear.reverted.onlyRole({...yearAttrs, enabled: false});
    await bookingManager.addAccommodationYear.success({...yearAttrs, enabled: false});
    yearAttrs = yearData()['2024'];
    await bookingManager.addAccommodationYear.reverted.alreadyExists({...yearAttrs, enabled: false});
    let [stored] = await TDFDiamond.getAccommodationYear(2024);
    expect(stored).to.be.true;
    await user.removeAccommodationYear.reverted.onlyRole(2024);
    [stored] = await TDFDiamond.getAccommodationYear(2024);
    expect(stored).to.be.true;
    await bookingManager.removeAccommodationYear.reverted.doesNotExists(3000);
    await bookingManager.removeAccommodationYear.success(2023);

    await user.updateAccommodationYear.reverted.onlyRole({...yearAttrs, enabled: false});
    await bookingManager.updateAccommodationYear.reverted.doesNotExists({
      ...yearAttrs,
      number: 3002,
      enabled: false,
    });
    await bookingManager.updateAccommodationYear.success({...yearAttrs, enabled: false});
    await user.enableAccommodationYear.reverted.onlyRole(2025, false);
    await bookingManager.enableAccommodationYear.reverted.doesNotExists(3002, true);
    await bookingManager.enableAccommodationYear.success(2027, false);
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

    await user.pause.reverted.onlyRole();
    await bookingManager.pause.success();
    await user.unpause.reverted.onlyRole();
    await bookingManager.unpause.success();
  });

  it('pausable', async () => {
    const context = await setup();
    const {users, TDFDiamond, deployer} = context;

    const user = await setDiamondUser({
      user: users[0],
      ...context,
    });

    await deployer.TDFDiamond.grantRole(ROLES.DEFAULT_ADMIN_ROLE as string, users[1].address);
    const admin = await setDiamondUser({
      user: users[1],
      ...context,
    });

    await users[0].TDFToken.approve(TDFDiamond.address, parseEther('10'));
    const init = addDays(Date.now(), 10);
    const dates = buildDates(init, 5);

    // -------------------------------------------------------
    //  Book and cancel enabled with  Unpaused
    // -------------------------------------------------------
    expect(await TDFDiamond.paused()).to.be.false;
    await user.bookAccommodation.success(dates.inputs);
    await user.cancelAccommodation.success(dates.inputs);
    // -------------------------------------------------------
    //  Book and cancel disabled with  Paused
    // -------------------------------------------------------
    await admin.pause.success();
    expect(await TDFDiamond.paused()).to.be.true;

    await user.bookAccommodation.reverted.paused(dates.inputs);
    await user.cancelAccommodation.reverted.paused(dates.inputs);
  });
});
