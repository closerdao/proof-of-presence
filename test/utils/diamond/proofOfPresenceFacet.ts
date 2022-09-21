import {expect} from '../../chai-setup';
import {BookingMapLib} from '../../../typechain/ProofOfPresenceFacet';
import type {TestContext} from './index';

import {DatesTestData, DateMetadata, DateInputs} from './types';
import * as _ from 'lodash';

export const setupHelpers = async ({TDFDiamond, user}: TestContext) => {
  return {
    bookAccommodation: {
      success: async (dates: DateInputs) => {
        await expect(user.TDFDiamond.bookAccommodation(dates), `send.book.success: ${dates}`).to.emit(
          TDFDiamond,
          'NewBookings'
        );
      },
      reverted: {
        paused: async (dates: DateInputs) => {
          await expect(
            user.TDFDiamond.bookAccommodation(dates),
            `send.book.reverted.paused: ${dates}`
          ).to.be.revertedWith('Pausable: paused');
        },
      },
    },
    cancelAccommodation: {
      success: async (dates: DateInputs) => {
        await expect(user.TDFDiamond.cancelAccommodation(dates), `send.cancel.success ${dates}`).to.emit(
          TDFDiamond,
          'CanceledBookings'
        );
      },
      reverted: {
        noneExisting: async (dates: DateInputs) => {
          await expect(
            user.TDFDiamond.cancelAccommodation(dates),
            `send.cancel.reverted.noneExisting ${dates}`
          ).to.be.revertedWith('Booking does not exists');
        },
        inThepast: async (dates: DateInputs) => {
          await expect(
            user.TDFDiamond.cancelAccommodation(dates),
            `send.cancel.reverted.inThepast ${dates}`
          ).to.be.revertedWith('Can not cancel past booking');
        },
        paused: async (dates: DateInputs) => {
          await expect(
            user.TDFDiamond.cancelAccommodation(dates),
            `send.cancel.reverted.paused ${dates}`
          ).to.be.revertedWith('Pausable: paused');
        },
      },
    },
    addAccommodationYear: {
      success: async (year: BookingMapLib.YearStruct) => {
        await expect(
          user.TDFDiamond.addAccommodationYear(year.number, year.leapYear, year.start, year.end, year.enabled),
          `send.addYear.success ${year}`
        ).to.emit(TDFDiamond, 'YearAdded');
      },
      reverted: {
        // TODO: Access Mananger cannot
        onlyRole: async (year: BookingMapLib.YearStruct) => {
          await expect(
            user.TDFDiamond.addAccommodationYear(year.number, year.leapYear, year.start, year.end, year.enabled),
            `send.addYear.reverted.onlyOwner ${year}`
          ).to.be.revertedWith('AccessControl:');
        },
        alreadyExists: async (year: BookingMapLib.YearStruct) => {
          await expect(
            user.TDFDiamond.addAccommodationYear(year.number, year.leapYear, year.start, year.end, year.enabled),
            `send.addYear.reverted.alreadyExists ${year}`
          ).to.be.revertedWith('Unable to add year');
        },
      },
    },
    removeAccommodationYear: {
      success: async (year: number) => {
        await expect(user.TDFDiamond.removeAccommodationYear(year), `send.removeYear.success: ${year}`).to.emit(
          TDFDiamond,
          'YearRemoved'
        );
      },
      reverted: {
        onlyRole: async (year: number) => {
          await expect(
            user.TDFDiamond.removeAccommodationYear(year),
            `send.removeYear.reverted.onlyOwner ${year}`
          ).to.be.revertedWith('AccessControl:');
        },
        doesNotExists: async (year: number) => {
          await expect(
            user.TDFDiamond.removeAccommodationYear(year),
            `send.removeYear.reverted.doesNotExists ${year}`
          ).to.be.revertedWith('Unable to remove Year');
        },
      },
    },
    enableAccommodationYear: {
      success: async (year: number, enable: boolean) => {
        await expect(
          user.TDFDiamond.enableAccommodationYear(year, enable),
          `send.enableYear.success: y ${year}, e ${enable}`
        ).to.emit(TDFDiamond, 'YearUpdated');
      },
      reverted: {
        onlyRole: async (year: number, enable: boolean) => {
          await expect(
            user.TDFDiamond.enableAccommodationYear(year, enable),
            `send.enableYear.reverted.onlyOwner: y ${year}, e ${enable}`
          ).to.be.revertedWith('AccessControl:');
        },
        doesNotExists: async (year: number, enable: boolean) => {
          await expect(
            user.TDFDiamond.enableAccommodationYear(year, enable),
            `send.enableYear.reverted.doesNotExists: y ${year}, e ${enable}`
          ).to.be.revertedWith('Unable to update year');
        },
      },
    },
    updateAccommodationYear: {
      success: async (year: BookingMapLib.YearStruct) => {
        await expect(
          user.TDFDiamond.updateAccommodationYear(year.number, year.leapYear, year.start, year.end, year.enabled),
          `send.enableYear.updateYear.success: y ${year}`
        ).to.emit(TDFDiamond, 'YearUpdated');
      },
      reverted: {
        onlyRole: async (year: BookingMapLib.YearStruct) => {
          await expect(
            user.TDFDiamond.updateAccommodationYear(year.number, year.leapYear, year.start, year.end, year.enabled),
            `send.updateYear.reverted.onlyOwner: y ${year}`
          ).to.be.revertedWith('AccessControl:');
        },
        doesNotExists: async (year: BookingMapLib.YearStruct) => {
          await expect(
            user.TDFDiamond.updateAccommodationYear(year.number, year.leapYear, year.start, year.end, year.enabled),
            `send.updateYear.reverted.doesNotExists: y ${year}`
          ).to.be.revertedWith('Unable to update Year');
        },
      },
    },
  };
};

export const getterHelpers = async ({TDFDiamond}: TestContext) => {
  return {
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

  return {
    can: {
      addAccommodationYear: helpers.addAccommodationYear.success,
      removeAccommodationYear: helpers.removeAccommodationYear.success,
      enableAccommodationYear: helpers.enableAccommodationYear.success,
      updateAccommodationYear: helpers.updateAccommodationYear.success,
    },
    cannot: {
      addAccommodationYear: helpers.addAccommodationYear.reverted.onlyRole,
      removeAccommodationYear: helpers.removeAccommodationYear.reverted.onlyRole,
      enableAccommodationYear: helpers.enableAccommodationYear.reverted.onlyRole,
      updateAccommodationYear: helpers.updateAccommodationYear.reverted.onlyRole,
    },
  };
};
