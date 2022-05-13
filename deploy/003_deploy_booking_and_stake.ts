import {HardhatRuntimeEnvironment} from 'hardhat/types';
import {DeployFunction} from 'hardhat-deploy/types';
import {parseEther} from 'ethers/lib/utils';

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const {deployments, getNamedAccounts} = hre;
  const {deploy} = deployments;

  const TDFToken = await deployments.get('TDFToken');

  const {deployer} = await getNamedAccounts();

  const stake = await deploy('TokenLock', {
    from: deployer,
    args: [TDFToken.address, 365],
    log: true,
    autoMine: true, // speed up deployment on local network (ganache, hardhat), no effect on live networks
  });

  await deploy('ProofOfPresence', {
    from: deployer,
    args: [stake.address],
    log: true,
    autoMine: true, // speed up deployment on local network (ganache, hardhat), no effect on live networks
  });
};
export default func;
func.tags = ['TokenLock', 'ProofOfPresence'];
