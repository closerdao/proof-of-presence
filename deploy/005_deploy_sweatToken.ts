import {HardhatRuntimeEnvironment} from 'hardhat/types';
import {DeployFunction} from 'hardhat-deploy/types';
import {ethers} from 'hardhat';

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const {deployments, getNamedAccounts} = hre;
  const {deploy} = deployments;

  const {deployer, TDFMultisig} = await getNamedAccounts();

  await deploy('SweatToken', {
    gasPrice: ethers.utils.parseUnits('100', 'gwei'), // specify a higher gas price
    from: deployer,
    proxy: {
      proxyContract: 'OptimizedTransparentProxy',
      execute: {init: {methodName: `initialize`, args: [TDFMultisig]}},
    },
    log: true,
    autoMine: true,
  });
};
export default func;
func.tags = ['SweatToken'];
