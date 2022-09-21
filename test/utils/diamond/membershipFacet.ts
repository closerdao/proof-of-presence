import {expect} from '../../chai-setup';

import {HelpersInput} from './types';
import * as _ from 'lodash';

export const setupHelpers = async ({diamond, user}: HelpersInput) => {
  return {
    addMember: {
      success: async (address: string) => {
        await expect(user.TDFDiamond.addMember(address), 'addMember: should succeed').to.emit(diamond, 'MemberAdded');
      },
      reverted: {
        onlyRole: async (address: string) => {
          await expect(user.TDFDiamond.addMember(address), 'addMember: should revert AccessControl').to.be.revertedWith(
            'AccessControl:'
          );
        },
        exists: async (address: string) => {
          await expect(
            user.TDFDiamond.addMember(address),
            'addMember: should revert `already exists`'
          ).to.be.revertedWith('MembershipFacet: member exists');
        },
      },
    },
    removeMember: {
      success: async (address: string) => {
        await expect(user.TDFDiamond.removeMember(address), `removeMenber: should succeed ${address}`).to.emit(
          diamond,
          'MemberRemoved'
        );
      },
      reverted: {
        onlyRole: async (address: string) => {
          await expect(
            user.TDFDiamond.removeMember(address),
            'removeMember: should revert AccessControl'
          ).to.be.revertedWith('AccessControl:');
        },
        exists: async (address: string) => {
          await expect(
            user.TDFDiamond.removeMember(address),
            'removeMember: should revert `does not exists`'
          ).to.be.revertedWith('MembershipFacet: member does not exists');
        },
      },
    },
    isMember: async (address: string, expected: boolean) => {
      expect(await diamond.isMember(address), `isMember: ${address} to be ${expected}`).to.eq(expected);
    },
    membersLength: async (expected: number) => {
      expect(await diamond.membersLength(), `membersLength: to be ${expected}`).to.eq(expected);
    },
  };
};
export const roleTesters = async (context: HelpersInput) => {
  const helpers = await setupHelpers(context);

  return {
    can: {
      addMember: helpers.addMember.success,
      removeMember: helpers.removeMember.success,
    },
    cannot: {
      addMember: helpers.addMember.reverted.onlyRole,
      removeMember: helpers.removeMember.reverted.onlyRole,
    },
  };
};
