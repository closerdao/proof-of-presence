import 'dotenv/config';
import type {HardhatUserConfig} from 'hardhat/config';

import HardhatMocha from '@nomicfoundation/hardhat-mocha';
import HardhatEthers from '@nomicfoundation/hardhat-ethers';
import HardhatEthersChaiMatchers from '@nomicfoundation/hardhat-ethers-chai-matchers';
import HardhatVerify from '@nomicfoundation/hardhat-verify';
import HardhatIgnitionEthers from '@nomicfoundation/hardhat-ignition-ethers';
import HardhatUpgrades from '@openzeppelin/hardhat-upgrades';

const DEVCHAIN_MNEMONIC = 'myth like bonus scare over problem client lizard pioneer submit female collect';
const CONTRACT_FUZZ_RUNS = Number(process.env.CONTRACT_FUZZ_RUNS ?? 256);
const CONTRACT_INVARIANT_RUNS = Number(process.env.CONTRACT_INVARIANT_RUNS ?? 64);
const CONTRACT_INVARIANT_DEPTH = Number(process.env.CONTRACT_INVARIANT_DEPTH ?? 50);
const CONTRACT_FUZZ_SEED = process.env.CONTRACT_FUZZ_SEED ?? `0x${'42'.repeat(32)}`;
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
    HardhatVerify,
    HardhatIgnitionEthers,
    HardhatUpgrades,
  ],
  solidity: {
    profiles: {
      default: {
        compilers: [
          {
            version: '0.8.35',
            settings: {
              evmVersion: 'cancun',
              optimizer: {
                enabled: true,
                runs: 2000,
              },
            },
          },
        ],
      },
    },
  },
  verify: {
    etherscan: {
      apiKey: process.env.CELOSCAN_API_KEY || '',
      enabled: true,
    },
    sourcify: {
      enabled: true,
    },
  },
  networks: {
    default: {
      type: 'edr-simulated',
      chainType: 'l1',
      initialBaseFeePerGas: 0,
      accounts: {mnemonic: DEVCHAIN_MNEMONIC},
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
      url: process.env.LOCALHOST_RPC_URL || 'http://127.0.0.1:8545',
      accounts: {
        mnemonic: process.env.LOCALHOST_MNEMONIC || DEVCHAIN_MNEMONIC,
      },
    },
  },
  paths: {
    sources: ['src'],
    tests: {
      mocha: 'test',
      solidity: 'test/solidity',
    },
    ignition: process.env.IGNITION_ROOT || 'ignition',
  },
  coverage: {
    skipFiles: ['src/village/test/**'],
  },
  test: {
    mocha: {
      timeout: 0,
    },
    solidity: {
      profiles: {
        default: {
          fuzz: {
            runs: CONTRACT_FUZZ_RUNS,
            maxTestRejects: 65_536,
            seed: CONTRACT_FUZZ_SEED,
            failurePersistDir: 'cache/solidity-tests/fuzz',
          },
          invariant: {
            runs: CONTRACT_INVARIANT_RUNS,
            depth: CONTRACT_INVARIANT_DEPTH,
            // Handlers return early for invalid generated actions. Any revert
            // that escapes a handler is therefore an unexpected regression.
            failOnRevert: true,
            shrinkRunLimit: 5_000,
            failurePersistDir: 'cache/solidity-tests/invariant',
          },
        },
      },
    },
  },
};

export default config;
