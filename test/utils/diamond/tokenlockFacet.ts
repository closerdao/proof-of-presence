import {expect} from '../../chai-setup';
import {parseEther} from 'ethers/lib/utils';
import {HelpersInput} from './types';

export const setupHelpers = async ({diamond, user, admin}: HelpersInput) => {
  return {
    deposit: async (amount: string) => {
      await expect(user.TDFDiamond.depositStake(parseEther(amount)), `deposit ${amount}`)
        .to.emit(diamond, 'DepositedTokens')
        .withArgs(user.address, parseEther(amount));
    },
    withdrawMax: {
      success: async (amount: string) => {
        await expect(user.TDFDiamond.withdrawMaxStake(), `withdrawMax.success ${amount}`)
          .to.emit(diamond, 'WithdrawnTokens')
          .withArgs(user.address, parseEther(amount));
      },
      none: async () => {
        await expect(user.TDFDiamond.withdrawMaxStake(), `withdrawMax.none`).to.not.emit(diamond, 'WithdrawnTokens');
      },
    },
    withdraw: {
      success: async (amount: string) => {
        await expect(user.TDFDiamond.withdrawStake(parseEther(amount)), `withdraw.success ${amount}`)
          .to.emit(diamond, 'WithdrawnTokens')
          .withArgs(user.address, parseEther(amount));
      },
      reverted: async (amount: string) => {
        await expect(
          user.TDFDiamond.withdrawStake(parseEther(amount)),
          `withdraw.reverted ${amount}`
        ).to.be.revertedWith('NOT_ENOUGHT_UNLOCKABLE_BALANCE');
      },
    },
    restakeMax: async () => {
      // TODO:
      await user.TDFDiamond.restakeMax();
    },
    restake: {
      reverted: async (amount: string) => {
        await expect(user.TDFDiamond.restake(parseEther(amount)), `restake.reverted ${amount}`).to.be.revertedWith(
          'NOT_ENOUGHT_UNLOCKABLE_BALANCE'
        );
      },
      success: async (amount: string) => {
        // TODO: `restake.success ${amount}`
        await user.TDFDiamond.restake(parseEther(amount));
      },
    },
    restakeOrDepositAtFor: async (amount: string, initLockAt: number) => {
      // TODO: `restakeOrDepositAtFor.success ${amount}`
      if (admin) {
        await admin.TDFDiamond.restakeOrDepositAtFor(user.address, parseEther(amount), initLockAt);
      } else {
        throw 'No admin Set';
      }
    },
  };
};
