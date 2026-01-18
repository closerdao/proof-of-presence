import {HardhatRuntimeEnvironment} from 'hardhat/types';
import {DeployFunction} from 'hardhat-deploy/types';
import {ethers} from 'hardhat';
import {TDFDiamond} from '../typechain';
import {parseUnits} from 'ethers/lib/utils';

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

  // For real deployment, PresenceToken uses different ProxyAdmin deployer/upgrader
  // because of different EOA used for the deployment. The ProxyAdmin used for
  // PresenceToken is under PresenceToken__DefaultProxyImplementation.json
  await deploy('PresenceToken', {
    from: deployer,
    proxy: {
      proxyContract: 'OptimizedTransparentProxy',
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
