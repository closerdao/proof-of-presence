import {expect} from '../../chai-setup';
import {BookingMapLib} from '../../../typechain/ProofOfPresenceFacet';

import {HelpersInput, DatesTestData, DateMetadata, DateInputs} from './types';
import * as _ from 'lodash';

export const setupHelpers = async ({diamond, user, admin}: HelpersInput) => {
  return {
    call: {
      getBookings: async (dates: DatesTestData) => {
        const years = _.groupBy(dates.data, (e) => e.year);
        const listTest = async (bookings: BookingMapLib.BookingStruct[], datum: DateMetadata[]) => {
          return Promise.all(
            datum.map(async (e) => {
              const found = bookings.find((val) => val.year == e.year && val.dayOfYear == e.day);
              return Promise.all([expect(found).not.be.undefined]);
            })
          );
        };
        await Promise.all(
          _.map(years, async (yList) => {
            const bookings = await diamond.getBookings(user.address, yList[0].year);
            return Promise.all([expect(yList.length).to.eq(bookings.length), listTest(bookings, yList)]);
          })
        );
      },
    },
    // functions that modify state
    send: {
      book: {
        success: async (dates: DateInputs) => {
          await expect(user.TDFDiamond.book(dates)).to.emit(diamond, 'NewBookings');
        },
        reverted: {
          paused: async (dates: DateInputs) => {
            await expect(user.TDFDiamond.book(dates)).to.be.revertedWith('Pausable: paused');
          },
        },
      },
      cancel: {
        success: async (dates: DateInputs) => {
          await expect(user.TDFDiamond.cancel(dates)).to.emit(diamond, 'CanceledBookings');
        },
        reverted: {
          noneExisting: async (dates: DateInputs) => {
            await expect(user.TDFDiamond.cancel(dates)).to.be.revertedWith('Booking does not exists');
          },
          inThepast: async (dates: DateInputs) => {
            await expect(user.TDFDiamond.cancel(dates)).to.be.revertedWith('Can not cancel past booking');
          },
          paused: async (dates: DateInputs) => {
            await expect(user.TDFDiamond.cancel(dates)).to.be.revertedWith('Pausable: paused');
          },
        },
      },
      addYear: {
        success: async (year: BookingMapLib.YearStruct) => {
          await expect(
            admin.TDFDiamond.addYear(year.number, year.leapYear, year.start, year.end, year.enabled)
          ).to.emit(diamond, 'YearAdded');
        },
        reverted: {
          onlyOwner: async (year: BookingMapLib.YearStruct) => {
            await expect(
              user.TDFDiamond.addYear(year.number, year.leapYear, year.start, year.end, year.enabled)
            ).to.be.revertedWith('LibDiamond: Must be contract owner');
          },
          alreadyExists: async (year: BookingMapLib.YearStruct) => {
            await expect(
              admin.TDFDiamond.addYear(year.number, year.leapYear, year.start, year.end, year.enabled)
            ).to.be.revertedWith('Unable to add year');
          },
        },
      },
      removeYear: {
        success: async (year: number) => {
          await expect(admin.TDFDiamond.removeYear(year)).to.emit(diamond, 'YearRemoved');
        },
        reverted: {
          onlyOwner: async (year: number) => {
            await expect(user.TDFDiamond.removeYear(year)).to.be.revertedWith('LibDiamond: Must be contract owner');
          },
          doesNotExists: async (year: number) => {
            await expect(admin.TDFDiamond.removeYear(year)).to.be.revertedWith('Unable to remove Year');
          },
        },
      },
      enableYear: {
        success: async (year: number, enable: boolean) => {
          await expect(admin.TDFDiamond.enableYear(year, enable)).to.emit(diamond, 'YearUpdated');
        },
        reverted: {
          onlyOwner: async (year: number, enable: boolean) => {
            await expect(user.TDFDiamond.enableYear(year, enable)).to.be.revertedWith(
              'LibDiamond: Must be contract owner'
            );
          },
          doesNotExists: async (year: number, enable: boolean) => {
            await expect(admin.TDFDiamond.enableYear(year, enable)).to.be.revertedWith('Unable to update year');
          },
        },
      },
      updateYear: {
        success: async (year: BookingMapLib.YearStruct) => {
          await expect(
            admin.TDFDiamond.updateYear(year.number, year.leapYear, year.start, year.end, year.enabled)
          ).to.emit(diamond, 'YearUpdated');
        },
        reverted: {
          onlyOwner: async (year: BookingMapLib.YearStruct) => {
            await expect(
              user.TDFDiamond.updateYear(year.number, year.leapYear, year.start, year.end, year.enabled)
            ).to.be.revertedWith('LibDiamond: Must be contract owner');
          },
          doesNotExists: async (year: BookingMapLib.YearStruct) => {
            await expect(
              admin.TDFDiamond.updateYear(year.number, year.leapYear, year.start, year.end, year.enabled)
            ).to.be.revertedWith('Unable to update Year');
          },
        },
      },
      pause: {
        success: async () => {
          await expect(admin.TDFDiamond.pause()).to.emit(diamond, 'Paused');
          expect(await diamond.paused()).to.be.true;
        },
        reverted: {
          onlyOwner: async () => {
            await expect(user.TDFDiamond.pause()).to.be.revertedWith('LibDiamond: Must be contract owner');
          },
        },
      },
      unpause: {
        success: async () => {
          await expect(admin.TDFDiamond.unpause()).to.emit(diamond, 'Unpaused');
          expect(await diamond.paused()).to.be.false;
        },
        reverted: {
          onlyOwner: async () => {
            await expect(user.TDFDiamond.unpause()).to.be.revertedWith('LibDiamond: Must be contract owner');
          },
        },
      },
    },
  };
};
