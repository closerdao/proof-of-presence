import 'dotenv/config';
import {HardhatUserConfig} from 'hardhat/types';
import 'hardhat-deploy';
import '@nomiclabs/hardhat-ethers';
import 'hardhat-gas-reporter';
import 'hardhat-diamond-abi';
import '@typechain/hardhat';
import 'solidity-coverage';
import 'hardhat-deploy-tenderly';
import {task} from 'hardhat/config';
import {addForkConfiguration} from './utils/network';
import './hardhatExtensions';
import '@typechain/hardhat';
import "@nomicfoundation/hardhat-verify";

// const mnemonicPath = "m/44'/52752'/0'/0"; // derivation path used by Celo

// This is the mnemonic used by celo-devchain
const DEVCHAIN_MNEMONIC = 'myth like bonus scare over problem client lizard pioneer submit female collect';
const getAccounts = (
  def: [string] | {mnemonic: string} | undefined = undefined
): [string] | {mnemonic: string} | undefined => {
  return process.env.PRIVATE_KEY ? [process.env.PRIVATE_KEY] : def;
};

const namedAccounts = {
  ceur: {
    alfajores: '0x10c892A6EC43a53E45D0B916B4b7D383B1b78C0F',
    celo: '0xD8763CBa276a3738E6DE85b4b3bF5FDed6D6cA73',
  },
  deployer: {
    default: 0,
    localhost: 0,
    hardhat: 0,
  },
  user: {
    default: 1,
    localhost: 1,
    hardhat: 1,
  },
  TDFTokenBeneficiary: {
    default: 0,
    alfajores: '0x2Ba5dCb83a95e998c57410435bb7699B8Bca929e',
    localhost: 1,
    hardhat: 1,
  },
  TDFMultisig: {
    default: 0,
    hardhat: 1,
    alfajores: '0xBD9658A4286459DD599Ab8b02bDa6167d750A288',
    celo: '0x5E810b93c51981eccA16e030Ea1cE8D8b1DEB83b',
  },
  julienFirst: {
    default: 1,
    alfajores: '0xbE5B7A0F27e7Ec296670c3fc7c34BE652303e716',
  },
  JulienSecond: {
    default: 2,
    alfajores: '0x346314781c4D1483bE27fAEA9d698074f7cBa1Be',
  },
  sam: {
    default: 3,
    alfajores: '0x630A5342b2cf4ffED9a366642482C7517b6379F1',
  },
};

const config: HardhatUserConfig = {
  diamondAbi: {
    // (required) The name of your Diamond ABI
    name: 'TDFDiamond',
    include: ['src/diamond/facets/'],
  },
  solidity: {
    compilers: [
      {
        version: '0.8.9',
        settings: {
          optimizer: {
            enabled: true,
            runs: 2000,
          },
        },
      },
    ],
  },
  etherscan: {
    // TODO do we need to separately define celo key?
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
        network: 'alfajores',
        chainId: 44787,
        urls: {
          apiURL: 'https://api-alfajores.celoscan.io/api',
          browserURL: 'https://alfajores.celoscan.io',
        },
      },
    ],
  },
  sourcify: {
    enabled: true,
  },
  namedAccounts: namedAccounts,
  defaultNetwork: 'hardhat',
  networks: addForkConfiguration({
    hardhat: {
      forking: {
        url: 'https://celo-alfajores.g.alchemy.com/v2/bS8alx-x_wlTHvoWzpI6LXj2zkc1pzkr'
      },
      initialBaseFeePerGas: 0, // to fix : https://github.com/sc-forks/solidity-coverage/issues/652, see https://github.com/sc-forks/solidity-coverage/issues/652#issuecomment-896330136
      chainId: 44787,
    },
    alfajores: {
      url: 'https://alfajores-forno.celo-testnet.org',
      accounts: getAccounts(),
      chainId: 44787,
    },
    celo: {
      url: 'https://forno.celo.org',
      accounts: getAccounts(),
      chainId: 42220,
    },
    localhost: {
      url: 'http://127.0.0.1:8545',
      accounts: {
        mnemonic: DEVCHAIN_MNEMONIC,
        // path: mnemonicPath,
      },
    },
  }),
  paths: {
    sources: 'src',
  },
  gasReporter: {
    currency: 'USD',
    // gasPrice: 100,
    enabled: process.env.REPORT_GAS ? true : false,
    coinmarketcap: process.env.COINMARKETCAP_API_KEY,
    maxMethodDiff: 10,
  },
  typechain: {
    outDir: 'typechain',
    target: 'ethers-v5',
    alwaysGenerateOverloads: false, // should overloads with full signatures like deposit(uint256) be generated always, even if there are no overloads?
    externalArtifacts: ['externalArtifacts/*.json'], // optional array of glob patterns with external artifacts to process (for example external libs from node_modules)
  },
  mocha: {
    timeout: 0,
  },
  external: process.env.HARDHAT_FORK
    ? {
        deployments: {
          // process.env.HARDHAT_FORK will specify the network that the fork is made from.
          // these lines allow it to fetch the deployments from the network being forked from both for node and deploy task
          hardhat: ['deployments/' + process.env.HARDHAT_FORK],
          localhost: ['deployments/' + process.env.HARDHAT_FORK],
        },
      }
    : undefined,

  tenderly: {
    project: 'template-ethereum-contracts',
    username: process.env.TENDERLY_USERNAME as string,
  },
};

// This is a sample Hardhat task. To learn how to create your own go to
// https://hardhat.org/guides/create-task.html

// task('accounts', 'Prints the list of accounts', async (taskArgs, hre) => {
//   const accounts = await hre.ethers.getSigners();

//   for (const account of accounts) {
//     console.log(account.address);
//   }
// });

// task('devchain-keys', 'Prints the private keys associated with the devchain', async (taskArgs, hre) => {
//   const accounts = await hre.ethers.getSigners();
//   const hdNode = hre.ethers.utils.HDNode.fromMnemonic(DEVCHAIN_MNEMONIC);
//   for (let i = 0; i < accounts.length; i++) {
//     const account = hdNode.derivePath(`m/44'/60'/0'/0/${i}`);
//     console.log(`Account ${i}\nAddress: ${account.address}\nKey: ${account.privateKey}`);
//   }
// });

task('create-account', 'Prints a new private key', async (taskArgs, hre) => {
  const wallet = hre.ethers.Wallet.createRandom();
  console.log(`PRIVATE_KEY="` + wallet.privateKey + `"`);
  console.log();
  console.log(`Your account address: `, wallet.address);
});

// task('print-account', 'Prints the address of the account', async () => {
//   const wallet = hre.ethers.Wallet(process.env.PRIVATE_KEY);
//   console.log(`Account: `, wallet.address);
// });

export default config;
