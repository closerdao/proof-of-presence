import type {EnhancedEnvironment, UnknownDeployments, UserConfig} from 'rocketh/types';

import * as deployExtension from '@rocketh/deploy';
import * as readExecuteExtension from '@rocketh/read-execute';
import * as deployProxyExtension from '@rocketh/proxy';
import * as deployDiamondExtension from '@rocketh/diamond';

export const config = {
  accounts: {
    deployer: {
      default: 0,
    },
    user: {
      default: 1,
    },
    TDFTokenBeneficiary: {
      default: 0,
      celoSepolia: '0x4410c9De0B7523b48B6EF4190eEb439aACC5F4D3',
    },
    TDFMultisig: {
      default: 0,
      celoSepolia: '0x4410c9De0B7523b48B6EF4190eEb439aACC5F4D3',
      celo: '0x5E810b93c51981eccA16e030Ea1cE8D8b1DEB83b',
    },
    ceur: {
      default: '0x0000000000000000000000000000000000000000',
      celo: '0xD8763CBa276a3738E6DE85b4b3bF5FDed6D6cA73',
    },
    julienFirst: {
      default: 1,
      celoSepolia: '0xbE5B7A0F27e7Ec296670c3fc7c34BE652303e716',
    },
    JulienSecond: {
      default: 2,
      celoSepolia: '0x346314781c4D1483bE27fAEA9d698074f7cBa1Be',
    },
    sam: {
      default: 3,
      celoSepolia: '0x630A5342b2cf4ffED9a366642482C7517b6379F1',
    },
  },
  data: {},
} as const satisfies UserConfig;

const extensions = {
  ...deployExtension,
  ...readExecuteExtension,
  ...deployProxyExtension,
  ...deployDiamondExtension,
};
export {extensions};

type Extensions = typeof extensions;
type Accounts = typeof config.accounts;
type Data = typeof config.data;
type Environment = EnhancedEnvironment<Accounts, Data, UnknownDeployments, Extensions>;

export type {Extensions, Accounts, Data, Environment};
