import {expect} from '../../chai-setup';

import * as _ from 'lodash';
import type {TestContext} from './index';

export const setupHelpers = async ({TDFDiamond, user}: TestContext) => {
  return {
    addMember: {
      success: async (address: string) => {
        await expect(user.TDFDiamond.addMember(address), 'addMember: should succeed').to.emit(
          TDFDiamond,
          'MemberAdded'
        );
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
          TDFDiamond,
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
      expect(await TDFDiamond.isMember(address), `isMember: ${address} to be ${expected}`).to.eq(expected);
    },
    membersLength: async (expected: number) => {
      expect(await TDFDiamond.membersLength(), `membersLength: to be ${expected}`).to.eq(expected);
    },
  };
};
export const roleTesters = async (context: TestContext) => {
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
