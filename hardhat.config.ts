import 'dotenv/config';
import type {HardhatUserConfig} from 'hardhat/config';

import HardhatMocha from '@nomicfoundation/hardhat-mocha';
import HardhatEthers from '@nomicfoundation/hardhat-ethers';
import HardhatEthersChaiMatchers from '@nomicfoundation/hardhat-ethers-chai-matchers';
import HardhatNetworkHelpers from '@nomicfoundation/hardhat-network-helpers';
import HardhatVerify from '@nomicfoundation/hardhat-verify';
import HardhatTypechain from '@nomicfoundation/hardhat-typechain';
import HardhatDeploy from 'hardhat-deploy';

const DEVCHAIN_MNEMONIC = 'myth like bonus scare over problem client lizard pioneer submit female collect';
const getAccounts = (
  def: [string] | {mnemonic: string} | undefined = undefined,
): [string] | {mnemonic: string} | undefined => {
  return process.env.PRIVATE_KEY ? [process.env.PRIVATE_KEY] : def;
};

const config: HardhatUserConfig = {
  plugins: [
    HardhatMocha,
    HardhatEthers,
    HardhatEthersChaiMatchers,
    HardhatNetworkHelpers,
    HardhatVerify,
    HardhatTypechain,
    HardhatDeploy,
  ],
  solidity: {
    profiles: {
      default: {
        version: '0.8.28',
        settings: {
          evmVersion: 'paris',
          optimizer: {
            enabled: true,
            runs: 2000,
          },
        },
      },
    },
  },
  etherscan: {
    apiKey: process.env.CELOSCAN_API_KEY,
    customChains: [
      {
        network: 'celo',
        chainId: 42220,
        urls: {
          apiURL: 'https://api.celoscan.io/api',
          browserURL: 'https://celoscan.io',
        },
      },
      {
        network: 'celoSepolia',
        chainId: 11142220,
        urls: {
          apiURL: 'https://api-sepolia.celoscan.io/api',
          browserURL: 'https://sepolia.celoscan.io',
        },
      },
    ],
  },
  sourcify: {
    enabled: true,
  },
  networks: {
    default: {
      type: 'edr-simulated',
      chainType: 'l1',
      initialBaseFeePerGas: 0,
    },
    celoSepolia: {
      type: 'http',
      url: 'https://celo-sepolia.drpc.org',
      accounts: getAccounts(),
      chainId: 11142220,
    },
    celo: {
      type: 'http',
      url: 'https://forno.celo.org',
      accounts: getAccounts(),
      chainId: 42220,
    },
    localhost: {
      type: 'http',
      url: 'http://127.0.0.1:8545',
      accounts: {
        mnemonic: DEVCHAIN_MNEMONIC,
      },
    },
  },
  paths: {
    sources: ['src'],
  },
  mocha: {
    timeout: 0,
  },
};

export default config;
