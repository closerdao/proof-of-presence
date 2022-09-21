import {expect} from '../../chai-setup';

import {HelpersInput} from './types';
import * as _ from 'lodash';

import {soliditySha3} from 'web3-utils';
import {BytesLike} from 'ethers';

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

export const setupHelpers = async ({diamond, user}: HelpersInput) => {
  return {
    pause: {
      success: async () => {
        await expect(user.TDFDiamond.pause(), 'pause: should succeed')
          .to.emit(diamond, 'Paused')
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
    },
    unpause: {
      success: async () => {
        await expect(user.TDFDiamond.unpause(), 'unpause: should succeed')
          .to.emit(diamond, 'Unpaused')
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
    },
    setLockingTimePeriodDays: {
      success: async (days: number) => {
        await expect(user.TDFDiamond.setLockingTimePeriodDays(days), `setLockingTimePeriodDays: should succeed ${days}`)
          .to.emit(diamond, 'LockingTimePeriodChanged')
          .withArgs(days, user.address);
      },
      reverted: {
        onlyRole: async (days: number) => {
          await expect(
            user.TDFDiamond.setLockingTimePeriodDays(days),
            'setLockingTimePeriodDays: should revert AccessControl'
          ).to.be.revertedWith('AccessControl:');
        },
        zero: async (days: number) => {
          await expect(
            user.TDFDiamond.setLockingTimePeriodDays(days),
            'setLockingTimePeriodDays: should revert `not zero`'
          ).to.be.revertedWith('AdminFaucet:');
        },
      },
    },

    grantRole: {
      success: async (role: RoleKeys, address: string) => {
        await expect(
          user.TDFDiamond.grantRole(ROLES[role], address),
          `grantRole.success: role(${role}) address(${address})`
        )
          .to.emit(diamond, 'RoleGranted')
          .withArgs(ROLES[role], address, user.address);
      },
      reverted: {
        onlyRole: async (role: RoleKeys, address: string) => {
          await expect(
            user.TDFDiamond.grantRole(ROLES[role], address),
            `grantRole.reverted.onlyRole: role(${role}) address(${address})`
          ).to.be.revertedWith('AccessControl:');
        },
      },
    },
    revokeRole: {
      success: async (role: RoleKeys, address: string) => {
        await expect(
          user.TDFDiamond.revokeRole(ROLES[role], address),
          `revokeRole.success: role(${role}) address(${address})`
        )
          .to.emit(diamond, 'RoleRevoked')
          .withArgs(ROLES[role], address, user.address);
      },
      reverted: {
        onlyRole: async (role: RoleKeys, address: string) => {
          await expect(
            user.TDFDiamond.revokeRole(ROLES[role], address),
            `reverted.reverted.onlyRole: role(${role}) address(${address})`
          ).to.be.revertedWith('AccessControl:');
        },
      },
    },
    renounceRole: {
      success: async (role: RoleKeys, address: string) => {
        await expect(
          user.TDFDiamond.renounceRole(ROLES[role], address),
          `renounceRole.success: role(${role}) address(${address})`
        )
          .to.emit(diamond, 'RoleRevoked')
          .withArgs(ROLES[role], address, user.address);
      },
      reverted: {
        notSelf: async (role: RoleKeys, address: string) => {
          await expect(
            user.TDFDiamond.renounceRole(ROLES[role], address),
            `renounceRole.reverted.notSelf: role(${role}) address(${address})`
          ).to.be.revertedWith('AccessControl:');
        },
      },
    },
    setRoleAdmin: {
      success: async (role: RoleKeys, adminRole: RoleKeys) => {
        await expect(
          user.TDFDiamond.setRoleAdmin(ROLES[role], ROLES[adminRole]),
          `setRoleAdmin.success: role(${role}) adminRole(${adminRole})`
        ).to.emit(diamond, 'RoleAdminChanged');
      },
      reverted: {
        onlyRole: async (role: RoleKeys, adminRole: RoleKeys) => {
          await expect(
            user.TDFDiamond.setRoleAdmin(ROLES[role], ROLES[adminRole]),
            `setRoleAdmin.reveole: role(${role}) adminRole(${adminRole})`
          ).to.be.revertedWith('AccessControl:');
        },
      },
    },
  };
};

export const getterHelpers = async ({diamond}: HelpersInput) => {
  return {
    hasRole: (role: RoleKeys, address: string) => {
      const value = async () => await diamond.hasRole(ROLES[role], address);
      return {
        toEq: async (expected: boolean) => {
          expect(await value(), `hasRole.toEq role(${role}), address(${address}) expected => ${expected}`).to.eq(
            expected
          );
        },
      };
    },
    getRoleAdmin: async (role: RoleKeys) => {
      return await diamond.getRoleAdmin(ROLES[role]);
    },
  };
};

export const roleTesters = async (context: HelpersInput) => {
  const helpers = await setupHelpers(context);

  return {
    can: {
      pause: helpers.pause.success,
      unpause: helpers.unpause.success,
      setLockingTimePeriodDays: helpers.setLockingTimePeriodDays.success,
      grantRole: helpers.grantRole.success,
      revokeRole: helpers.revokeRole.success,
      setRoleAdmin: helpers.setRoleAdmin.success,
    },
    cannot: {
      pause: helpers.pause.reverted.onlyRole,
      unpause: helpers.unpause.reverted.onlyRole,
      setLockingTimePeriodDays: helpers.setLockingTimePeriodDays.reverted.onlyRole,
      grantRole: helpers.grantRole.reverted.onlyRole,
      revokeRole: helpers.revokeRole.reverted.onlyRole,
      setRoleAdmin: helpers.setRoleAdmin.reverted.onlyRole,
    },
  };
};
