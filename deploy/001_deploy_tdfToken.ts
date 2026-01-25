import {HardhatRuntimeEnvironment} from 'hardhat/types';
import {DeployFunction} from 'hardhat-deploy/types';
import {ZERO_ADDRESS} from '../utils';
import {parseUnits} from 'ethers/lib/utils';

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

  await deploy('TDFToken', {
    from: deployer,
    proxy: {
      proxyContract: 'OptimizedTransparentProxy',
      execute: {init: {methodName: `initialize`, args: [ZERO_ADDRESS]}},
    },
    ...gasOverrides,
    log: true,
    autoMine: true,
  });
};
export default func;
func.tags = ['TDFToken'];
