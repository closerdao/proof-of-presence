import {expect} from '../../chai-setup';
import {BookingMapLib} from '../../../typechain/ProofOfPresenceFacet';

import {HelpersInput, DatesTestData, DateMetadata, DateInputs} from './types';
import * as _ from 'lodash';

export const setupHelpers = async ({diamond, user}: HelpersInput) => {
  return {
    call: {
      getBookings: async (dates: DatesTestData) => {
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
            const bookings = await diamond.getAccommodationBookings(user.address, yList[0].year);
            return Promise.all([
              expect(yList.length, 'getAccommodationBookings have length').to.eq(bookings.length),
              listTest(bookings, yList),
            ]);
          })
        );
      },
    },
    // functions that modify state
    send: {
      book: {
        success: async (dates: DateInputs) => {
          await expect(user.TDFDiamond.bookAccommodation(dates), `send.book.success: ${dates}`).to.emit(
            diamond,
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
      cancel: {
        success: async (dates: DateInputs) => {
          await expect(user.TDFDiamond.cancelAccommodation(dates), `send.cancel.success ${dates}`).to.emit(
            diamond,
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
      addYear: {
        success: async (year: BookingMapLib.YearStruct) => {
          await expect(
            user.TDFDiamond.addAccommodationYear(year.number, year.leapYear, year.start, year.end, year.enabled),
            `send.addYear.success ${year}`
          ).to.emit(diamond, 'YearAdded');
        },
        reverted: {
          // TODO: Access Mananger cannot
          onlyOwner: async (year: BookingMapLib.YearStruct) => {
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
      removeYear: {
        success: async (year: number) => {
          await expect(user.TDFDiamond.removeAccommodationYear(year), `send.removeYear.success: ${year}`).to.emit(
            diamond,
            'YearRemoved'
          );
        },
        reverted: {
          onlyOwner: async (year: number) => {
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
      enableYear: {
        success: async (year: number, enable: boolean) => {
          await expect(
            user.TDFDiamond.enableAccommodationYear(year, enable),
            `send.enableYear.success: y ${year}, e ${enable}`
          ).to.emit(diamond, 'YearUpdated');
        },
        reverted: {
          onlyOwner: async (year: number, enable: boolean) => {
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
      updateYear: {
        success: async (year: BookingMapLib.YearStruct) => {
          await expect(
            user.TDFDiamond.updateAccommodationYear(year.number, year.leapYear, year.start, year.end, year.enabled),
            `send.enableYear.updateYear.success: y ${year}`
          ).to.emit(diamond, 'YearUpdated');
        },
        reverted: {
          onlyOwner: async (year: BookingMapLib.YearStruct) => {
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
      pause: {
        success: async () => {
          await expect(user.TDFDiamond.pause(), `send.pause.success`).to.emit(diamond, 'Paused');
          expect(await diamond.paused()).to.be.true;
        },
        reverted: {
          onlyOwner: async () => {
            await expect(user.TDFDiamond.pause(), `pause.reverted.onlyOwner`).to.be.revertedWith('AccessControl:');
          },
        },
      },
      unpause: {
        success: async () => {
          await expect(user.TDFDiamond.unpause(), `send.unpause.success`).to.emit(diamond, 'Unpaused');
          expect(await diamond.paused()).to.be.false;
        },
        reverted: {
          onlyOwner: async () => {
            await expect(user.TDFDiamond.unpause(), `send.unpause.reverted.onlyOwner`).to.be.revertedWith(
              'AccessControl:'
            );
          },
        },
      },
    },
  };
};
