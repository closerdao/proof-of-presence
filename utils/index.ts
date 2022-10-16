import {soliditySha3} from 'web3-utils';

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

export * from './Constants';
