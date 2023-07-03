import {HardhatRuntimeEnvironment} from 'hardhat/types';
import {DeployFunction} from 'hardhat-deploy/types';

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const {deployments, getNamedAccounts} = hre;
  const {deploy} = deployments;

  const {deployer, TDFMultisig} = await getNamedAccounts();

  await deploy('SweatToken', {
    from: deployer,
    args: [TDFMultisig],
  });
};
export default func;
func.tags = ['SweatToken'];
