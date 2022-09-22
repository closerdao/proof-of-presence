import {expect} from '../../chai-setup';

import * as _ from 'lodash';

import {soliditySha3} from 'web3-utils';

import type {TestContext} from './index';
import {wrapOnlyRole, wrapSuccess} from './helpers';

export const ROLES = {
  DEFAULT_ADMIN_ROLE: '0x0000000000000000000000000000000000000000000000000000000000000000',
  /* eslint-disable @typescript-eslint/no-non-null-assertion */
  MINTER_ROLE: soliditySha3('MINTER_ROLE')!,
  BOOKING_MANAGER_ROLE: soliditySha3('BOOKING_MANAGER_ROLE')!,
  STAKE_MANAGER_ROLE: soliditySha3('STAKE_MANAGER_ROLE')!,
  VAULT_MANAGER_ROLE: soliditySha3('VAULT_MANAGER_ROLE')!,
  MEMBERSHIP_MANAGER_ROLE: soliditySha3('MEMBERSHIP_MANAGER_ROLE')!,
  /* eslint-enable @typescript-eslint/no-non-null-assertion */
} as const;

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
    setLockingTimePeriodDays: (days: number) => ({
      success: async () => {
        await expect(user.TDFDiamond.setLockingTimePeriodDays(days), `setLockingTimePeriodDays: should succeed ${days}`)
          .to.emit(TDFDiamond, 'LockingTimePeriodChanged')
          .withArgs(days, user.address);
      },
      reverted: {
        onlyRole: async () => {
          await expect(
            user.TDFDiamond.setLockingTimePeriodDays(days),
            'setLockingTimePeriodDays: should revert AccessControl'
          ).to.be.revertedWith('AccessControl:');
        },
        zero: async () => {
          await expect(
            user.TDFDiamond.setLockingTimePeriodDays(days),
            'setLockingTimePeriodDays: should revert `not zero`'
          ).to.be.revertedWith('AdminFaucet:');
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
            `reverted.reverted.onlyRole: role(${role}) address(${address})`
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
            `setRoleAdmin.reveole: role(${role}) adminRole(${adminRole})`
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
      setLockingTimePeriodDays: wrapSuccess(helpers.setLockingTimePeriodDays),
      grantRole: wrapSuccess(helpers.grantRole),
      revokeRole: wrapSuccess(helpers.revokeRole),
      setRoleAdmin: wrapSuccess(helpers.setRoleAdmin),
    },
    cannot: {
      pause: wrapOnlyRole(helpers.pause),
      unpause: wrapOnlyRole(helpers.unpause),
      setLockingTimePeriodDays: wrapOnlyRole(helpers.setLockingTimePeriodDays),
      grantRole: wrapOnlyRole(helpers.grantRole),
      revokeRole: wrapOnlyRole(helpers.revokeRole),
      setRoleAdmin: wrapOnlyRole(helpers.setRoleAdmin),
    },
  };
};
