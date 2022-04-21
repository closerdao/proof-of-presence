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
<<<<<<< HEAD
  namedAccounts: namedAccounts,
  defaultNetwork,
=======
  namedAccounts: {
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
    dai: {
      polygon: '0x8f3Cf7ad23Cd3CaDbD9735AFf958023239c6A063',
      mainnet: '0x6B175474E89094C44Da98b954EedeAC495271d0F',
    },
    wrapped: {
      polygon: '0x0d500b1d8e8ef31e21c99d1db9a6444d3adf1270',
      mainnet: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
      kovan: '0xd0a1e359811322d97991e03f863a0c30c2cf029c',
    },
    ether: {
      default: '0x0000000000000000000000000000000000000000',
      polygon: '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
    },
    wmatic: {
      polygon: '0x0d500b1d8e8ef31e21c99d1db9a6444d3adf1270',
    },
    weth: {
      polygon: '0x7ceb23fd6bc0add59e62ac25578270cff1b9f619',
      mainnet: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
      kovan: '0xd0a1e359811322d97991e03f863a0c30c2cf029c',
    },
    usdc: {
      polygon: '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174',
      mainnet: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
    },
    usdt: {
      polygon: '0xc2132D05D31c914a87C6611C10748AEb04B58e8F',
      mainnet: '0xdAC17F958D2ee523a2206206994597C13D831ec7',
    },
    ust: {
      polygon: '0x692597b009d13c4049a947cab2239b7d6517875f',
    },
    usdc_whale: {
      polygon: '0x075e72a5eDf65F0A5f44699c7654C1a76941Ddc8',
      mainnet: '0xbe0eb53f46cd790cd13851d5eff43d12404d33e8',
    },
    weth_whale: {
      polygon: '0x72a53cdbbcc1b9efa39c834a540550e23463aacb',
      mainnet: '0xbe0eb53f46cd790cd13851d5eff43d12404d33e8',
    },
    wmatic_whale: {
      polygon: '0xFffbCD322cEace527C8ec6Da8de2461C6D9d4e6e',
    },
    // USE binance as a whale
    binance: {
      mainnet: '0xBE0eB53F46cd790Cd13851d5EFf43D12404d33E8',
    },
  },
  defaultNetwork: 'hardhat',
>>>>>>> main
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
