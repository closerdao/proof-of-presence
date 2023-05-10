import {HardhatRuntimeEnvironment} from 'hardhat/types';
import {DeployFunction} from 'hardhat-deploy/types';
import {parseEther} from 'ethers/lib/utils';

// TODO: This deployment is only being used for testing.
// deploy as a nock in tests instead of here
const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  if (hre.network.name === 'celo') {
    return;
  }
  const {deployments, getNamedAccounts} = hre;
  const {deploy} = deployments;

  const TDFToken = await deployments.get('TDFToken');

  const {deployer, TDFDevMultisig} = await getNamedAccounts();

  const eur = await deploy('FakeEURToken', {
    from: deployer,
    args: [],
    log: true,
    autoMine: true, // speed up deployment on local network (ganache, hardhat), no effect on live networks
  });

  await deploy('Crowdsale', {
    from: deployer,
    args: [TDFToken.address, eur.address, TDFDevMultisig, parseEther('150'), parseEther('0.5')],
    log: true,
    autoMine: true, // speed up deployment on local network (ganache, hardhat), no effect on live networks
  });
};
export default func;
func.tags = ['Crowdsale'];
