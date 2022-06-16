import {expect} from '../../chai-setup';
import {TDFToken, TDFDiamond} from '../../../typechain';
import {parseEther} from 'ethers/lib/utils';
import {ethers} from 'hardhat';
import * as TLH from './tokenlockFacet';

interface HelpersInput {
  diamond: TDFDiamond;
  tokenContract: TDFToken;
  user: {address: string; TDFDiamond: TDFDiamond};
  admin: {address: string; TDFDiamond: TDFDiamond};
}

const BN = ethers.BigNumber;
const testHelpers = async ({tokenContract, diamond, user}: HelpersInput) => {
  return {
    testBalances: async (TK: string, tkU: string, u: string) => {
      expect(await tokenContract.balanceOf(diamond.address)).to.eq(parseEther(TK));
      expect(await diamond.balanceOf(user.address)).to.eq(parseEther(tkU));
      expect(await tokenContract.balanceOf(user.address)).to.eq(parseEther(u));
    },
    testStake: async (locked: string, unlocked: string) => {
      expect(await diamond.lockedAmount(user.address)).to.eq(parseEther(locked));
      expect(await diamond.unlockedAmount(user.address)).to.eq(parseEther(unlocked));
    },
    testDeposits: async (examples: [string, number][]) => {
      const deposits = await diamond.depositsFor(user.address);
      for (let i = 0; i < deposits.length; i++) {
        expect(deposits[i].amount).to.eq(parseEther(examples[i][0]));
        expect(deposits[i].timestamp).to.eq(ethers.BigNumber.from(examples[i][1]));
      }
    },
  };
};

export const diamondTest = async (input: HelpersInput) => {
  return {
    test: await testHelpers(input),
    TLF: await TLH.setupHelpers(input),
  };
};
