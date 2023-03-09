import * as _ from 'lodash';
import {expect} from '../../chai-setup';
import {BookingMapLib} from '../../../typechain/BookingFacet';
import type {TestContext} from './index';

import {buildDates} from './index';

import {DatesTestData, DateMetadata, DateInputs} from './types';
import {wrapOnlyRole, wrapSuccess} from './helpers';
import {addDays} from 'date-fns';
import {parseEther} from 'ethers/lib/utils';

export const setupHelpers = async ({TDFDiamond, user}: TestContext) => {
  return {
    bookAccommodation: (dates: DateInputs, price = '1.0') => {
      const p = parseEther(price);
      return {
        success: async () => {
          await expect(user.TDFDiamond.bookAccommodation(dates, p), `send.book.success: ${dates}`).to.emit(
            TDFDiamond,
            'NewBookings'
          );
        },
        reverted: {
          paused: async () => {
            await expect(
              user.TDFDiamond.bookAccommodation(dates, p),
              `book.reverted.paused: ${dates}`
            ).to.be.revertedWith('Pausable: paused');
          },
          onlyMember: async () => {
            await expect(
              user.TDFDiamond.bookAccommodation(dates, p),
              `book.reverted.onlyMember: ${dates}`
            ).to.be.revertedWith('Membership:');
          },
        },
      };
    },
    cancelAccommodation: (dates: DateInputs) => ({
      success: async () => {
        await expect(user.TDFDiamond.cancelAccommodation(dates), `cancel.success ${dates}`).to.emit(
          TDFDiamond,
          'CanceledBookings'
        );
      },
      reverted: {
        nonExisting: async () => {
          await expect(
            user.TDFDiamond.cancelAccommodation(dates),
            `cancel.reverted.noneExisting ${dates}`
          ).to.be.revertedWith('NonExisting');
        },
        inThepast: async () => {
          await expect(
            user.TDFDiamond.cancelAccommodation(dates),
            `cancel.reverted.inThepast ${dates}`
          ).to.be.revertedWith('Can not cancel past booking');
        },
        paused: async () => {
          await expect(
            user.TDFDiamond.cancelAccommodation(dates),
            `cancel.reverted.paused ${dates}`
          ).to.be.revertedWith('Pausable: paused');
        },
      },
    }),
    cancelAccommodationFor: (account: string, dates: DateInputs) => ({
      success: async () => {
        await expect(
          user.TDFDiamond.cancelAccommodationFor(account, dates),
          `cancelAccommodationFor.success ${dates}`
        ).to.emit(TDFDiamond, 'CanceledBookings');
      },
      reverted: {
        onlyRole: async () => {
          await expect(
            user.TDFDiamond.cancelAccommodationFor(account, dates),
            `cancelAccommodationFor.reverted.onlyRole ${dates}`
          ).to.be.revertedWith('AccessControl:');
        },
        nonExisting: async () => {
          await expect(
            user.TDFDiamond.cancelAccommodationFor(account, dates),
            `cancelAccommodationFor.reverted.NonExisting ${dates}`
          ).to.be.revertedWith('NonExisting');
        },
        inThepast: async () => {
          await expect(
            user.TDFDiamond.cancelAccommodationFor(account, dates),
            `cancelAccommodationFor.reverted.inThepast ${dates}`
          ).to.be.revertedWith('Can not cancel past booking');
        },
        paused: async () => {
          await expect(
            user.TDFDiamond.cancelAccommodationFor(account, dates),
            `cancelAccommodationFor.reverted.paused ${dates}`
          ).to.be.revertedWith('Pausable: paused');
        },
        nonPending: async () => {
          await expect(
            user.TDFDiamond.cancelAccommodationFor(account, dates),
            `cancelAccommodationFor.reverted.paused ${dates}`
          ).to.be.revertedWith('NotPending');
        },
      },
    }),
    confirmAccommodationFor: (account: string, dates: DateInputs) => ({
      success: async () => {
        await expect(
          user.TDFDiamond.confirmAccommodationFor(account, dates),
          `confirmAccommodationFor.success ${dates}`
        ).to.emit(TDFDiamond, 'BookingConfirmed');
      },
      reverted: {
        onlyRole: async () => {
          await expect(
            user.TDFDiamond.confirmAccommodationFor(account, dates),
            `confirmAccommodationFor.reverted.onlyRole ${dates}`
          ).to.be.revertedWith('AccessControl:');
        },
        nonExisting: async () => {
          await expect(
            user.TDFDiamond.confirmAccommodationFor(account, dates),
            `confirmAccommodationFor.reverted.NonExisting ${dates}`
          ).to.be.revertedWith('NonExisting');
        },
        nonPending: async () => {
          await expect(
            user.TDFDiamond.confirmAccommodationFor(account, dates),
            `confirmAccommodationFor.reverted.paused ${dates}`
          ).to.be.revertedWith('NotPending');
        },
      },
    }),
    checkinAccommodationFor: (account: string, dates: DateInputs) => ({
      success: async () => {
        await expect(
          user.TDFDiamond.checkinAccommodationFor(account, dates),
          `checkinAccommodationFor.success ${dates}`
        ).to.emit(TDFDiamond, 'BookingCheckedIn');
      },
      reverted: {
        onlyRole: async () => {
          await expect(
            user.TDFDiamond.checkinAccommodationFor(account, dates),
            `checkinAccommodationFor.reverted.onlyRole ${dates}`
          ).to.be.revertedWith('AccessControl:');
        },
      },
    }),
    addAccommodationYear: (year: BookingMapLib.YearStruct) => ({
      success: async () => {
        await expect(
          user.TDFDiamond.addAccommodationYear(year.number, year.leapYear, year.start, year.end, year.enabled),
          `addYear.success ${year}`
        ).to.emit(TDFDiamond, 'YearAdded');
      },
      reverted: {
        onlyRole: async () => {
          await expect(
            user.TDFDiamond.addAccommodationYear(year.number, year.leapYear, year.start, year.end, year.enabled),
            `addYear.reverted.onlyOwner ${year}`
          ).to.be.revertedWith('AccessControl:');
        },
        alreadyExists: async () => {
          await expect(
            user.TDFDiamond.addAccommodationYear(year.number, year.leapYear, year.start, year.end, year.enabled),
            `addYear.reverted.alreadyExists ${year}`
          ).to.be.revertedWith('Unable to add year');
        },
      },
    }),
    removeAccommodationYear: (year: number) => ({
      success: async () => {
        await expect(user.TDFDiamond.removeAccommodationYear(year), `removeYear.success: ${year}`).to.emit(
          TDFDiamond,
          'YearRemoved'
        );
      },
      reverted: {
        onlyRole: async () => {
          await expect(
            user.TDFDiamond.removeAccommodationYear(year),
            `removeYear.reverted.onlyOwner ${year}`
          ).to.be.revertedWith('AccessControl:');
        },
        doesNotExists: async () => {
          await expect(
            user.TDFDiamond.removeAccommodationYear(year),
            `removeYear.reverted.doesNotExists ${year}`
          ).to.be.revertedWith('Unable to remove Year');
        },
      },
    }),
    enableAccommodationYear: (year: number, enable: boolean) => ({
      success: async () => {
        await expect(
          user.TDFDiamond.enableAccommodationYear(year, enable),
          `enableYear.success: y ${year}, e ${enable}`
        ).to.emit(TDFDiamond, 'YearUpdated');
      },
      reverted: {
        onlyRole: async () => {
          await expect(
            user.TDFDiamond.enableAccommodationYear(year, enable),
            `enableYear.reverted.onlyOwner: y ${year}, e ${enable}`
          ).to.be.revertedWith('AccessControl:');
        },
        doesNotExists: async () => {
          await expect(
            user.TDFDiamond.enableAccommodationYear(year, enable),
            `enableYear.reverted.doesNotExists: y ${year}, e ${enable}`
          ).to.be.revertedWith('Unable to update year');
        },
      },
    }),
    updateAccommodationYear: (year: BookingMapLib.YearStruct) => ({
      success: async () => {
        await expect(
          user.TDFDiamond.updateAccommodationYear(year.number, year.leapYear, year.start, year.end, year.enabled),
          `enableYear.updateYear.success: y ${year}`
        ).to.emit(TDFDiamond, 'YearUpdated');
      },
      reverted: {
        onlyRole: async () => {
          await expect(
            user.TDFDiamond.updateAccommodationYear(year.number, year.leapYear, year.start, year.end, year.enabled),
            `updateYear.reverted.onlyOwner: y ${year}`
          ).to.be.revertedWith('AccessControl:');
        },
        doesNotExists: async () => {
          await expect(
            user.TDFDiamond.updateAccommodationYear(year.number, year.leapYear, year.start, year.end, year.enabled),
            `updateYear.reverted.doesNotExists: y ${year}`
          ).to.be.revertedWith('Unable to update Year');
        },
      },
    }),
  };
};

export const getterHelpers = async ({TDFDiamond}: TestContext) => {
  return {
    presentByYearsFor: (user: {
      address: string;
    }): {
      toInclude: (year: number, nights: number) => Promise<void>;
      toAllBeZero: () => Promise<void>;
    } => {
      const val = async () => {
        return await TDFDiamond.presentByYearFor(user.address);
      };
      return {
        toInclude: async (year: number, nights: number) => {
          const list = await val();
          const found = _.find(list, (e) => e[0] == year);

          expect(found, `presentByYearsFor.toInclude: Year not found in ${JSON.stringify(list)}`).to.not.be.undefined;
          if (found) {
            expect(
              found[1],
              `presentByYearsFor.toInclude: expected year ${year} to have '${nights}' nights, got ${found[1]}`
            ).to.eq(nights);
          }
        },
        toAllBeZero: async () => {
          const list = await val();
          const all = _.every(list, (e) => e[1] == 0);

          expect(all, `presentByYearsFor.toAllBeZero: some are not`).to.be.true;
        },
      };
    },
    getAccommodationBookings: (user: {address: string}, year: number) => {
      return {
        val: async () => {
          return await TDFDiamond.getAccommodationBookings(user.address, year);
        },
        exactMatch: async (dates: DatesTestData) => {
          const years = _.groupBy(dates.data, (e) => e.year);
          const listTest = async (bookings: BookingMapLib.BookingStruct[], datum: DateMetadata[]) => {
            return Promise.all(
              datum.map(async (e) => {
                const found = bookings.find((val) => val.year == e.year && val.dayOfYear == e.day);
                return Promise.all([expect(found, `bookings to include: ${e.year}-${e.day}`).not.be.undefined]);
              })
            );
          };
          await Promise.all(
            _.map(years, async (yList) => {
              const bookings = await TDFDiamond.getAccommodationBookings(user.address, yList[0].year);
              return Promise.all([
                expect(yList.length, 'getAccommodationBookings have length').to.eq(bookings.length),
                listTest(bookings, yList),
              ]);
            })
          );
        },
      };
    },
  };
};

export const roleTesters = async (context: TestContext) => {
  const helpers = await setupHelpers(context);
  const init = addDays(Date.now(), 10);
  const dates = buildDates(init, 5);

  return {
    can: {
      addAccommodationYear: wrapSuccess(helpers.addAccommodationYear),
      removeAccommodationYear: wrapSuccess(helpers.removeAccommodationYear),
      enableAccommodationYear: wrapSuccess(helpers.enableAccommodationYear),
      updateAccommodationYear: wrapSuccess(helpers.updateAccommodationYear),
      checkinAccommodationFor: async () => {
        try {
          await context.user.TDFDiamond.checkinAccommodationFor(context.user.address, dates.inputs);
        } catch {
          expect(true, 'checkinAccommodationFor to not be reverted because of AccessControl').to.eq(false);
        }
      },
      cancelAccommodationFor: async () => {
        await helpers.cancelAccommodationFor(context.user.address, dates.inputs).reverted.nonExisting();
      },
      confirmAccommodationFor: async () => {
        try {
          await context.user.TDFDiamond.confirmAccommodationFor(context.user.address, dates.inputs);
        } catch {
          expect(true, 'confirmAccommodationFor to not be reverted because of AccessControl').to.eq(false);
        }
      },
    },
    cannot: {
      addAccommodationYear: wrapOnlyRole(helpers.addAccommodationYear),
      removeAccommodationYear: wrapOnlyRole(helpers.removeAccommodationYear),
      enableAccommodationYear: wrapOnlyRole(helpers.enableAccommodationYear),
      updateAccommodationYear: wrapOnlyRole(helpers.updateAccommodationYear),
      checkinAccommodationFor: async () => {
        await wrapOnlyRole(helpers.checkinAccommodationFor)(context.user.address, dates.inputs);
      },
      cancelAccommodationFor: async () => {
        await wrapOnlyRole(helpers.cancelAccommodationFor)(context.user.address, dates.inputs);
      },
      confirmAccommodationFor: async () => {
        await wrapOnlyRole(helpers.confirmAccommodationFor)(context.user.address, dates.inputs);
      },
    },
  };
};
