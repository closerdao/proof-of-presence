import {HardhatRuntimeEnvironment} from 'hardhat/types';
import {DeployFunction} from 'hardhat-deploy/types';
import {ethers} from 'hardhat';
import {TDFDiamond} from '../typechain';

// TODO what should be the default values for these?
export const DEFAULT_PRESENCE_TOKEN_NAME = 'TDF Presence';
export const DEFAULT_PRESENCE_TOKEN_SYMBOL = '$PRESENCE';
export const DEFAULT_PRESENCE_TOKEN_DECAY_RATE_PER_DAY = 28861; // eta 10% per year

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const {deployments, getNamedAccounts} = hre;
  const {deploy} = deployments;

  const {deployer} = await getNamedAccounts();

  const daoContract = (await ethers.getContract('TDFDiamond', deployer).catch(() => {
    throw new Error('TDFDiamond contract not found. Please deploy it first.');
  })) as TDFDiamond;

  // TODO in prod this should be called from the same address as the owner
  //  of the TDFDiamond, so maybe the TDFMultisig should be the deployer?
  await deploy('PresenceToken', {
    // gasPrice: ethers.utils.parseUnits('100', 'gwei'), // specify a higher gas price
    from: deployer,
    proxy: {
      proxyContract: 'OptimizedTransparentProxy',
      execute: {
        init: {
          methodName: `initialize`,
          // TODO what name and symbol to set?
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
  });
};
export default func;
func.tags = ['PresenceToken'];
