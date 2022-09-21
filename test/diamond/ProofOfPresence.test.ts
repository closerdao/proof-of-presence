import {expect} from '../chai-setup';
import {parseEther} from 'ethers/lib/utils';
import {addDays} from 'date-fns';
import {buildDates, collectDates, yearData, timeTravelTo, ROLES, setupContext, setDiamondUser} from '../utils/diamond';
import * as _ from 'lodash';

const setup = setupContext;

describe('ProofOfPresenceFacet', () => {
  it('book', async () => {
    const context = await setup();
    const {users, TDFDiamond} = context;

    const user = users[0];
    const {test, POPH} = await setDiamondUser({
      user: user,
      ...context,
    });

    const {send} = POPH;

    await user.TDFToken.approve(TDFDiamond.address, parseEther('10'));
    const init = addDays(Date.now(), 10);
    const dates = buildDates(init, 5);
    await send.book.success(dates.inputs);
    await test.balances('5', '5', '9995');
  });
  it('book and cancel', async () => {
    const context = await setup();
    const {users, TDFDiamond} = context;

    const user = users[0];
    const {test, POPH} = await setDiamondUser({
      user: user,
      ...context,
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
    const context = await setup();
    const {users, TDFDiamond} = context;

    const user = users[0];
    const {test, POPH} = await setDiamondUser({
      user: user,
      ...context,
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

    const user = users[0];
    const {POPH} = await setDiamondUser({
      user: user,
      ...context,
    });

    const bookingManager = await setDiamondUser({
      user: users[1],
      ...context,
    });
    const {send} = POPH;
    let yearAttrs;
    yearAttrs = yearData()['2028'];

    // Give role to user 1 for booking management
    await deployer.TDFDiamond.grantRole(ROLES.BOOKING_MANAGER_ROLE as string, users[1].address);

    await send.addYear.reverted.onlyOwner({...yearAttrs, enabled: false});
    await bookingManager.POPH.send.addYear.success({...yearAttrs, enabled: false});
    yearAttrs = yearData()['2024'];
    await bookingManager.POPH.send.addYear.reverted.alreadyExists({...yearAttrs, enabled: false});
    let [stored] = await TDFDiamond.getAccommodationYear(2024);
    expect(stored).to.be.true;
    await send.removeYear.reverted.onlyOwner(2024);
    [stored] = await TDFDiamond.getAccommodationYear(2024);
    expect(stored).to.be.true;
    await bookingManager.POPH.send.removeYear.reverted.doesNotExists(3000);
    await bookingManager.POPH.send.removeYear.success(2023);

    await send.updateYear.reverted.onlyOwner({...yearAttrs, enabled: false});
    await bookingManager.POPH.send.updateYear.reverted.doesNotExists({...yearAttrs, number: 3002, enabled: false});
    await bookingManager.POPH.send.updateYear.success({...yearAttrs, enabled: false});
    await send.enableYear.reverted.onlyOwner(2025, false);
    await bookingManager.POPH.send.enableYear.reverted.doesNotExists(3002, true);
    await bookingManager.POPH.send.enableYear.success(2027, false);
  });

  it('DEFAULT_ADMIN_ROLE', async () => {
    const context = await setup();
    const {users, TDFDiamond, deployer} = context;

    const user = users[0];
    const {POPH} = await setDiamondUser({
      user: user,
      ...context,
    });

    const bookingManager = await setDiamondUser({
      user: users[1],
      ...context,
    });

    const {send} = POPH;

    await deployer.TDFDiamond.grantRole(ROLES.DEFAULT_ADMIN_ROLE as string, users[1].address);

    await send.pause.reverted.onlyOwner();
    await bookingManager.POPH.send.pause.success();
    await send.unpause.reverted.onlyOwner();
    await bookingManager.POPH.send.unpause.success();
  });

  it('pausable', async () => {
    const context = await setup();
    const {users, TDFDiamond, deployer} = context;

    const user = users[0];
    const {POPH} = await setDiamondUser({
      user: user,
      ...context,
    });

    await deployer.TDFDiamond.grantRole(ROLES.DEFAULT_ADMIN_ROLE as string, users[1].address);
    const admin = await setDiamondUser({
      user: users[1],
      ...context,
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
    await admin.POPH.send.pause.success();
    expect(await TDFDiamond.paused()).to.be.true;

    await send.book.reverted.paused(dates.inputs);
    await send.cancel.reverted.paused(dates.inputs);
  });
});
