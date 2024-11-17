import {HardhatRuntimeEnvironment} from 'hardhat/types';
import {DeployFunction} from 'hardhat-deploy/types';
import {ZERO_ADDRESS} from '../utils';

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const {deployments, getNamedAccounts} = hre;
  const {deploy} = deployments;

  const {deployer} = await getNamedAccounts();

  await deploy('TDFToken', {
    from: deployer,
    proxy: {
      proxyContract: 'OptimizedTransparentProxy',
      execute: {init: {methodName: `initialize`, args: [ZERO_ADDRESS]}},
    },
    log: true,
    autoMine: true,
  });
};
export default func;
func.tags = ['TDFToken'];
