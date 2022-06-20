import {expect} from '../../chai-setup';
import {parseEther} from 'ethers/lib/utils';
import {HelpersInput} from './types';

export const setupHelpers = async ({diamond, user, admin}: HelpersInput) => {
  return {
    deposit: async (amount: string) => {
      await expect(user.TDFDiamond.deposit(parseEther(amount)))
        .to.emit(diamond, 'DepositedTokens')
        .withArgs(user.address, parseEther(amount));
    },
    withdrawMax: {
      success: async (amount: string) => {
        await expect(user.TDFDiamond.withdrawMax())
          .to.emit(diamond, 'WithdrawnTokens')
          .withArgs(user.address, parseEther(amount));
      },
      none: async () => {
        await expect(user.TDFDiamond.withdrawMax()).to.not.emit(diamond, 'WithdrawnTokens');
      },
    },
    withdraw: {
      success: async (amount: string) => {
        await expect(user.TDFDiamond.withdraw(parseEther(amount)))
          .to.emit(diamond, 'WithdrawnTokens')
          .withArgs(user.address, parseEther(amount));
      },
      reverted: async (amount: string) => {
        await expect(user.TDFDiamond.withdraw(parseEther(amount))).to.be.revertedWith('NOT_ENOUGHT_UNLOCKABLE_BALANCE');
      },
    },
    restakeMax: async () => {
      await user.TDFDiamond.restakeMax();
    },
    restake: {
      reverted: async (amount: string) => {
        await expect(user.TDFDiamond.restake(parseEther(amount))).to.be.revertedWith('NOT_ENOUGHT_UNLOCKABLE_BALANCE');
      },
      success: async (amount: string) => {
        await user.TDFDiamond.restake(parseEther(amount));
      },
    },
    restakeOrDepositAtFor: async (amount: string, initLockAt: number) => {
      if (admin) {
        await admin.TDFDiamond.restakeOrDepositAtFor(user.address, parseEther(amount), initLockAt);
      } else {
        throw 'No admin Set';
      }
    },
  };
};
