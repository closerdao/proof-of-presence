import {HardhatRuntimeEnvironment} from 'hardhat/types';
import {DeployFunction} from 'hardhat-deploy/types';
import {ethers} from 'hardhat';
import {TDFDiamond} from '../typechain';
import {parseUnits} from 'ethers/lib/utils';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const ProxyAdmin = require('hardhat-deploy/extendedArtifacts/ProxyAdmin.json');

export const DEFAULT_PRESENCE_TOKEN_NAME = 'TDF Presence';
export const DEFAULT_PRESENCE_TOKEN_SYMBOL = '$PRESENCE';
export const DEFAULT_PRESENCE_TOKEN_DECAY_RATE_PER_DAY = 288_617; // eta 10% per year

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const {deployments, getNamedAccounts} = hre;
  const {deploy} = deployments;

  const {deployer} = await getNamedAccounts();
  const isCelo = hre.network.name === 'celo';
  const priorityFee = process.env.PRIORITY_FEE || '1';
  const maxFee = process.env.MAX_FEE || '30';
  const gasOverrides = isCelo
    ? {}
    : {
        maxPriorityFeePerGas: parseUnits(priorityFee, 'gwei'),
        maxFeePerGas: parseUnits(maxFee, 'gwei'),
      };

  const daoContract = (await ethers.getContract('TDFDiamond', deployer).catch(() => {
    throw new Error('TDFDiamond contract not found. Please deploy it first.');
  })) as TDFDiamond;

  // Both PresenceToken and SweatToken share the same ProxyAdmin
  // (PresenceToken__DefaultProxyAdmin), separate from the DefaultProxyAdmin
  // used by other contracts (TDFToken, DynamicSale, etc.)
  await deploy('PresenceToken', {
    from: deployer,
    proxy: {
      proxyContract: 'OptimizedTransparentProxy',
      viaAdminContract: {
        name: 'PresenceToken__DefaultProxyAdmin',
        artifact: ProxyAdmin,
      },
      execute: {
        init: {
          methodName: `initialize`,
          args: [
            DEFAULT_PRESENCE_TOKEN_NAME,
            DEFAULT_PRESENCE_TOKEN_SYMBOL,
            daoContract.address,
            DEFAULT_PRESENCE_TOKEN_DECAY_RATE_PER_DAY,
          ],
        },
      },
    },
    log: true,
    autoMine: true,
    ...gasOverrides,
  });
};
export default func;
func.tags = ['PresenceToken'];
