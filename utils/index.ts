import {utils} from 'ethers';

export const ROLES = {
  DEFAULT_ADMIN_ROLE: '0x0000000000000000000000000000000000000000000000000000000000000000',
  MINTER_ROLE: utils.keccak256(utils.toUtf8Bytes('MINTER_ROLE')),
  BOOKING_MANAGER_ROLE: utils.keccak256(utils.toUtf8Bytes('BOOKING_MANAGER_ROLE')),
  STAKE_MANAGER_ROLE: utils.keccak256(utils.toUtf8Bytes('STAKE_MANAGER_ROLE')),
  VAULT_MANAGER_ROLE: utils.keccak256(utils.toUtf8Bytes('VAULT_MANAGER_ROLE')),
  MEMBERSHIP_MANAGER_ROLE: utils.keccak256(utils.toUtf8Bytes('MEMBERSHIP_MANAGER_ROLE')),
  BOOKING_PLATFORM_ROLE: utils.keccak256(utils.toUtf8Bytes('BOOKING_PLATFORM_ROLE')),
  // Citizen contract roles
  REVOKER_ROLE: utils.keccak256(utils.toUtf8Bytes('REVOKER_ROLE')),
  UPGRADER_ROLE: utils.keccak256(utils.toUtf8Bytes('UPGRADER_ROLE')),
  DAO_ROLE: utils.keccak256(utils.toUtf8Bytes('DAO_ROLE')),
} as const;

export * from './Constants';
