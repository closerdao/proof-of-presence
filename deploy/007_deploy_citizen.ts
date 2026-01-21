import {HardhatRuntimeEnvironment} from 'hardhat/types';
import {DeployFunction} from 'hardhat-deploy/types';
import {ethers} from 'hardhat';
import {TDFDiamond} from '../typechain';

export const DEFAULT_CITIZEN_NAME = 'Citizen';
export const DEFAULT_CITIZEN_SYMBOL = 'Citizen';
export const DEFAULT_CITIZEN_BASE_URI = 'https://metadata.tdf.org/citizen/';

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const {deployments, getNamedAccounts} = hre;
  const {deploy} = deployments;

  const {deployer} = await getNamedAccounts();

  const daoContract = (await ethers.getContract('TDFDiamond', deployer).catch(() => {
    throw new Error('TDFDiamond contract not found. Please deploy it first.');
  })) as TDFDiamond;

  // For real deployment, Citizen uses different ProxyAdmin deployer/upgrader
  // because of different EOA used for the deployment. The ProxyAdmin used for
  // Citizen is under Citizen__DefaultProxyImplementation.json
  await deploy('Citizen', {
    from: deployer,
    contract: 'Citizen',
    proxy: {
      proxyContract: 'OptimizedTransparentProxy',
      owner: deployer, // Explicitly set the owner to the deployer
      execute: {
        init: {
          methodName: 'initialize',
          args: [
            DEFAULT_CITIZEN_NAME,
            DEFAULT_CITIZEN_SYMBOL,
            DEFAULT_CITIZEN_BASE_URI,
            daoContract.address,
          ],
        },
      },
    },
    log: true,
    autoMine: true,
  });
};
export default func;
func.tags = ['Citizen'];
