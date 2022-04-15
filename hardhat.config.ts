import 'dotenv/config';
import {HardhatUserConfig} from 'hardhat/types';
import 'hardhat-deploy';
import '@nomiclabs/hardhat-ethers';
import 'hardhat-gas-reporter';
import '@typechain/hardhat';
import 'solidity-coverage';
import 'hardhat-deploy-tenderly';
import {task} from 'hardhat/config';
import {node_url, accounts, addForkConfiguration} from './utils/network';

const defaultNetwork = 'alfajores';
const mnemonicPath = "m/44'/52752'/0'/0"; // derivation path used by Celo

// This is the mnemonic used by celo-devchain
const DEVCHAIN_MNEMONIC = 'concert load couple harbor equip island argue ramp clarify fence smart topic';

const getAccounts = (
  def: [string] | {mnemonic: string} | undefined = undefined
): [string] | {mnemonic: string} | undefined => {
  return process.env.PRIVATE_KEY ? [process.env.PRIVATE_KEY] : def;
};

const namedAccounts = {
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
    default: 1,
    localhost: 1,
    hardhat: 1,
  },
};

const config: HardhatUserConfig = {
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
  namedAccounts: namedAccounts,
  defaultNetwork,
  networks: addForkConfiguration({
    hardhat: {
      initialBaseFeePerGas: 0, // to fix : https://github.com/sc-forks/solidity-coverage/issues/652, see https://github.com/sc-forks/solidity-coverage/issues/652#issuecomment-896330136
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
      },
    },
  }),
  paths: {
    sources: 'src',
  },
  gasReporter: {
    currency: 'USD',
    gasPrice: 100,
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

task('accounts', 'Prints the list of accounts', async (taskArgs, hre) => {
  const accounts = await hre.ethers.getSigners();

  for (const account of accounts) {
    console.log(account.address);
  }
});

task('devchain-keys', 'Prints the private keys associated with the devchain', async (taskArgs, hre) => {
  const accounts = await hre.ethers.getSigners();
  const hdNode = hre.ethers.utils.HDNode.fromMnemonic(DEVCHAIN_MNEMONIC);
  for (let i = 0; i < accounts.length; i++) {
    const account = hdNode.derivePath(`m/44'/60'/0'/0/${i}`);
    console.log(`Account ${i}\nAddress: ${account.address}\nKey: ${account.privateKey}`);
  }
});

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
