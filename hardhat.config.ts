import 'dotenv/config';
import type {HardhatUserConfig} from 'hardhat/config';

import HardhatMocha from '@nomicfoundation/hardhat-mocha';
import HardhatEthers from '@nomicfoundation/hardhat-ethers';
import HardhatEthersChaiMatchers from '@nomicfoundation/hardhat-ethers-chai-matchers';
import HardhatNetworkHelpers from '@nomicfoundation/hardhat-network-helpers';
import HardhatVerify from '@nomicfoundation/hardhat-verify';
import HardhatTypechain from '@nomicfoundation/hardhat-typechain';
import HardhatIgnitionEthers from '@nomicfoundation/hardhat-ignition-ethers';
import HardhatDeploy from 'hardhat-deploy';
import HardhatUpgrades from '@openzeppelin/hardhat-upgrades';

const DEVCHAIN_MNEMONIC = 'myth like bonus scare over problem client lizard pioneer submit female collect';
const V2_FUZZ_RUNS = Number(process.env.V2_FUZZ_RUNS ?? 256);
const V2_INVARIANT_RUNS = Number(process.env.V2_INVARIANT_RUNS ?? 64);
const V2_INVARIANT_DEPTH = Number(process.env.V2_INVARIANT_DEPTH ?? 50);
const V2_FUZZ_SEED = process.env.V2_FUZZ_SEED ?? `0x${'42'.repeat(32)}`;
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
    HardhatIgnitionEthers,
    HardhatDeploy,
    HardhatUpgrades,
  ],
  solidity: {
    profiles: {
      default: {
        compilers: [
          {
            version: '0.8.28',
            settings: {
              evmVersion: 'paris',
              optimizer: {
                enabled: true,
                runs: 2000,
              },
            },
          },
          {
            version: '0.8.35',
            settings: {
              // OpenZeppelin Contracts 5.6 uses EIP-5656 MCOPY. Keep legacy
              // 0.8.28 builds on Paris while targeting Cancun for V2 only.
              evmVersion: 'cancun',
              optimizer: {
                enabled: true,
                runs: 2000,
              },
            },
          },
        ],
        // These legacy libraries use range pragmas and would otherwise be
        // selected for the newer V2 target. Keep their standalone artifacts
        // on Paris independently of the V2 Cancun target.
        overrides: {
          'src/legacy/tdf-v1/libraries/CustomDoubleEndedQueue.sol': {
            version: '0.8.35',
            settings: {
              evmVersion: 'paris',
              optimizer: {enabled: true, runs: 2000},
            },
          },
          'src/legacy/tdf-v1/libraries/FixedPointMathLib.sol': {
            version: '0.8.35',
            settings: {
              evmVersion: 'paris',
              optimizer: {enabled: true, runs: 2000},
            },
          },
        },
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
    skipFiles: ['src/legacy/**', 'src/village/test/**'],
  },
  test: {
    mocha: {
      timeout: 0,
    },
    solidity: {
      profiles: {
        default: {
          fuzz: {
            runs: V2_FUZZ_RUNS,
            maxTestRejects: 65_536,
            seed: V2_FUZZ_SEED,
            failurePersistDir: 'cache/solidity-tests/fuzz',
          },
          invariant: {
            runs: V2_INVARIANT_RUNS,
            depth: V2_INVARIANT_DEPTH,
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
