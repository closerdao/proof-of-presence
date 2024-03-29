import {expect} from '../../chai-setup';

import type {TestContext} from './index';
import {wrapOnlyRole, wrapSuccess} from './helpers';
import {ROLES} from '../../../utils';

type RoleKeys = keyof typeof ROLES;

export const setupHelpers = async ({TDFDiamond, user}: TestContext) => {
  return {
    pause: () => ({
      success: async () => {
        await expect(user.TDFDiamond.pause(), 'pause: should succeed')
          .to.emit(TDFDiamond, 'Paused')
          .withArgs(user.address);
      },
      reverted: {
        onlyRole: async () => {
          await expect(user.TDFDiamond.pause(), 'pause: should revert AccessControl').to.be.revertedWith(
            'AccessControl:'
          );
        },
        whenNotPaused: async () => {
          await expect(user.TDFDiamond.pause(), 'pause: should revert').to.be.revertedWith('Pausable: paused');
        },
      },
    }),
    unpause: () => ({
      success: async () => {
        await expect(user.TDFDiamond.unpause(), 'unpause: should succeed')
          .to.emit(TDFDiamond, 'Unpaused')
          .withArgs(user.address);
      },
      reverted: {
        onlyRole: async () => {
          await expect(user.TDFDiamond.unpause(), 'unpause: should revert AccessControl').to.be.revertedWith(
            'AccessControl:'
          );
        },
        whenPaused: async () => {
          await expect(user.TDFDiamond.unpause(), 'unpause: should revert').to.be.revertedWith('Pausable: unpaused');
        },
      },
    }),

    grantRole: (role: RoleKeys, address: string) => ({
      success: async () => {
        await expect(
          user.TDFDiamond.grantRole(ROLES[role], address),
          `grantRole.success: role(${role}) address(${address})`
        )
          .to.emit(TDFDiamond, 'RoleGranted')
          .withArgs(ROLES[role], address, user.address);
      },
      reverted: {
        onlyRole: async () => {
          await expect(
            user.TDFDiamond.grantRole(ROLES[role], address),
            `grantRole.reverted.onlyRole: role(${role}) address(${address})`
          ).to.be.revertedWith('AccessControl:');
        },
      },
    }),
    revokeRole: (role: RoleKeys, address: string) => ({
      success: async () => {
        await expect(
          user.TDFDiamond.revokeRole(ROLES[role], address),
          `revokeRole.success: role(${role}) address(${address})`
        )
          .to.emit(TDFDiamond, 'RoleRevoked')
          .withArgs(ROLES[role], address, user.address);
      },
      reverted: {
        onlyRole: async () => {
          await expect(
            user.TDFDiamond.revokeRole(ROLES[role], address),
            `revokeRole.reverted.onlyRole: role(${role}) address(${address})`
          ).to.be.revertedWith('AccessControl:');
        },
      },
    }),
    renounceRole: (role: RoleKeys, address: string) => ({
      success: async () => {
        await expect(
          user.TDFDiamond.renounceRole(ROLES[role], address),
          `renounceRole.success: role(${role}) address(${address})`
        )
          .to.emit(TDFDiamond, 'RoleRevoked')
          .withArgs(ROLES[role], address, user.address);
      },
      reverted: {
        notSelf: async () => {
          await expect(
            user.TDFDiamond.renounceRole(ROLES[role], address),
            `renounceRole.reverted.notSelf: role(${role}) address(${address})`
          ).to.be.revertedWith('AccessControl:');
        },
      },
    }),
    setRoleAdmin: (role: RoleKeys, adminRole: RoleKeys) => ({
      success: async () => {
        await expect(
          user.TDFDiamond.setRoleAdmin(ROLES[role], ROLES[adminRole]),
          `setRoleAdmin.success: role(${role}) adminRole(${adminRole})`
        ).to.emit(TDFDiamond, 'RoleAdminChanged');
      },
      reverted: {
        onlyRole: async () => {
          await expect(
            user.TDFDiamond.setRoleAdmin(ROLES[role], ROLES[adminRole]),
            `setRoleAdmin.reverted.onlyRole: role(${role}) adminRole(${adminRole})`
          ).to.be.revertedWith('AccessControl:');
        },
      },
    }),
  };
};

export const getterHelpers = async ({TDFDiamond}: TestContext) => {
  return {
    hasRole: (role: RoleKeys, address: string) => {
      const value = async () => await TDFDiamond.hasRole(ROLES[role], address);
      return {
        toEq: async (expected: boolean) => {
          expect(await value(), `hasRole.toEq role(${role}), address(${address}) expected => ${expected}`).to.eq(
            expected
          );
        },
      };
    },
    getRoleAdmin: async (role: RoleKeys) => {
      return await TDFDiamond.getRoleAdmin(ROLES[role]);
    },
  };
};

export const roleTesters = async (context: TestContext) => {
  const helpers = await setupHelpers(context);

  return {
    can: {
      pause: wrapSuccess(helpers.pause),
      unpause: wrapSuccess(helpers.unpause),
      grantRole: wrapSuccess(helpers.grantRole),
      revokeRole: wrapSuccess(helpers.revokeRole),
      setRoleAdmin: wrapSuccess(helpers.setRoleAdmin),
    },
    cannot: {
      pause: wrapOnlyRole(helpers.pause),
      unpause: wrapOnlyRole(helpers.unpause),
      grantRole: wrapOnlyRole(helpers.grantRole),
      revokeRole: wrapOnlyRole(helpers.revokeRole),
      setRoleAdmin: wrapOnlyRole(helpers.setRoleAdmin),
    },
  };
};
