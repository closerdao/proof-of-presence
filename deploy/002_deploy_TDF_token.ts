import {HardhatRuntimeEnvironment} from 'hardhat/types';
import {DeployFunction} from 'hardhat-deploy/types';
import {ZERO_ADDRESS} from '../utils';
import {ethers} from 'hardhat';
import {PrelaunchDAO} from '../typechain';

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const {deployments, getNamedAccounts} = hre;
  const {deploy} = deployments;

  const {deployer} = await getNamedAccounts();
  const dao = (await ethers.getContract('PrelaunchDAO', deployer)).connect(
    await ethers.getSigner(deployer)
  ) as PrelaunchDAO;

  await deploy('TDFToken', {
    from: deployer,
    proxy: {
      proxyContract: 'OptimizedTransparentProxy',
      execute: {init: {methodName: `initialize`, args: [dao.address]}},
    },
  });

  await dao.setCommunityToken((await deployments.get('TDFToken')).address);
};
export default func;
func.tags = ['TDFToken'];
