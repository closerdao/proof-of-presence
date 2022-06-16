import {expect} from '../../chai-setup';
import {parseEther} from 'ethers/lib/utils';
import {ethers} from 'hardhat';
import {HelpersInput, DatesTestData} from './types';
import * as TLH from './tokenlockFacet';
import * as POPH from './proofOfPresenceFacet';

const BN = ethers.BigNumber;

const testHelpers = async ({tokenContract, diamond, user}: HelpersInput) => {
  return {
    balances: async (TK: string, tkU: string, u: string) => {
      expect(await tokenContract.balanceOf(diamond.address)).to.eq(parseEther(TK));
      expect(await diamond.balanceOf(user.address)).to.eq(parseEther(tkU));
      expect(await tokenContract.balanceOf(user.address)).to.eq(parseEther(u));
    },
    stake: async (locked: string, unlocked: string) => {
      expect(await diamond.lockedAmount(user.address)).to.eq(parseEther(locked));
      expect(await diamond.unlockedAmount(user.address)).to.eq(parseEther(unlocked));
    },
    deposits: async (examples: [string, number][]) => {
      const deposits = await diamond.depositsFor(user.address);
      for (let i = 0; i < deposits.length; i++) {
        expect(deposits[i].amount).to.eq(parseEther(examples[i][0]));
        expect(deposits[i].timestamp).to.eq(BN.from(examples[i][1]));
      }
    },
    bookings: async (dates: DatesTestData, price: string) => {
      await Promise.all(
        dates.data.map(async (e) => {
          const [success, booking] = await diamond.getBooking(user.address, e.year, e.day);
          return Promise.all([
            expect(booking.price).to.eq(parseEther(price)),
            expect(booking.year).to.eq(e.year),
            expect(booking.dayOfYear).to.eq(e.day),
            expect(success).to.be.true,
          ]);
        })
      );
    },
  };
};

export const diamondTest = async (input: HelpersInput) => {
  return {
    test: await testHelpers(input),
    TLF: await TLH.setupHelpers(input),
    POPH: await POPH.setupHelpers(input),
  };
};
