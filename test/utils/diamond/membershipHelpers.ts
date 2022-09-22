import * as _ from 'lodash';
import {expect} from '../../chai-setup';

import type {TestContext} from './index';
import {wrapOnlyRole, wrapSuccess} from './helpers';

export const setupHelpers = async ({TDFDiamond, user}: TestContext) => {
  return {
    addMember: (address: string) => ({
      success: async () => {
        await expect(user.TDFDiamond.addMember(address), 'addMember: should succeed').to.emit(
          TDFDiamond,
          'MemberAdded'
        );
      },
      reverted: {
        onlyRole: async () => {
          await expect(user.TDFDiamond.addMember(address), 'addMember: should revert AccessControl').to.be.revertedWith(
            'AccessControl:'
          );
        },
        exists: async () => {
          await expect(
            user.TDFDiamond.addMember(address),
            'addMember: should revert `already exists`'
          ).to.be.revertedWith('MembershipFacet: member exists');
        },
      },
    }),
    removeMember: (address: string) => ({
      success: async () => {
        await expect(user.TDFDiamond.removeMember(address), `removeMenber: should succeed ${address}`).to.emit(
          TDFDiamond,
          'MemberRemoved'
        );
      },
      reverted: {
        onlyRole: async () => {
          await expect(
            user.TDFDiamond.removeMember(address),
            'removeMember: should revert AccessControl'
          ).to.be.revertedWith('AccessControl:');
        },
        exists: async () => {
          await expect(
            user.TDFDiamond.removeMember(address),
            'removeMember: should revert `does not exists`'
          ).to.be.revertedWith('MembershipFacet: member does not exists');
        },
      },
    }),
    // TODO: move to getterHelpers
    isMember: async (address: string, expected: boolean) => {
      expect(await TDFDiamond.isMember(address), `isMember: ${address} to be ${expected}`).to.eq(expected);
    },
    membersLength: async (expected: number) => {
      expect(await TDFDiamond.membersLength(), `membersLength: to be ${expected}`).to.eq(expected);
    },
  };
};

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export const getterHelpers = async (_context: TestContext) => ({});
export const roleTesters = async (context: TestContext) => {
  const helpers = await setupHelpers(context);

  return {
    can: {
      addMember: wrapSuccess(helpers.addMember),
      removeMember: wrapSuccess(helpers.removeMember),
    },
    cannot: {
      addMember: wrapOnlyRole(helpers.addMember),
      removeMember: wrapOnlyRole(helpers.removeMember),
    },
  };
};
