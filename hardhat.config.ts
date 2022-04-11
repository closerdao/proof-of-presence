import 'dotenv/config';
import {HardhatUserConfig} from 'hardhat/types';
import 'hardhat-deploy';
import '@nomiclabs/hardhat-ethers';
import 'hardhat-gas-reporter';
import '@typechain/hardhat';
import 'solidity-coverage';
import 'hardhat-deploy-tenderly';
import {node_url, accounts, addForkConfiguration} from './utils/network';

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
  networks: addForkConfiguration({
    hardhat: {
      initialBaseFeePerGas: 0, // to fix : https://github.com/sc-forks/solidity-coverage/issues/652, see https://github.com/sc-forks/solidity-coverage/issues/652#issuecomment-896330136
    },
    localhost: {
      // this is intended to use ganache with a mainnet fork, remember to run:
      // ganache-cli --fork https://eth-mainnet.alchemyapi.io/v2/$WEB3_ALCHEMY_APP_ID --unlock 0x1aD91ee08f21bE3dE0BA2ba6918E714dA6B45836 --deterministic
      url: node_url('localhost'),
      accounts: {
        mnemonic: 'myth like bonus scare over problem client lizard pioneer submit female collect',
        // mnemonic: 'walnut mutual phone police nut tribe cross coast donate early urban target',
      },
    },
    polygon: {
      url: node_url('polygon'),
      accounts: process.env.PRIVATE_KEY ? [process.env.PRIVATE_KEY] : accounts('polygon'),
    },
    staging: {
      url: node_url('rinkeby'),
      accounts: accounts('rinkeby'),
    },
    production: {
      url: node_url('mainnet'),
      accounts: accounts('mainnet'),
    },
    mainnet: {
      url: node_url('mainnet'),
      accounts: accounts('mainnet'),
    },
    rinkeby: {
      url: node_url('rinkeby'),
      accounts: accounts('rinkeby'),
    },
    kovan: {
      url: node_url('kovan'),
      accounts: accounts('kovan'),
    },
    goerli: {
      url: node_url('goerli'),
      accounts: accounts('goerli'),
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

export default config;
