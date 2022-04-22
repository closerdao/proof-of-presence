import {HardhatRuntimeEnvironment} from 'hardhat/types';
import {DeployFunction} from 'hardhat-deploy/types';
import {parseEther} from 'ethers/lib/utils';

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const {deployments, getNamedAccounts} = hre;
  const {deploy} = deployments;

  const TDFToken = await deployments.get('TDFToken');

  const {deployer, TDFTokenBeneficiary} = await getNamedAccounts();

  const eur = await deploy('FakeEURToken', {
    from: deployer,
    args: [],
    log: true,
    autoMine: true, // speed up deployment on local network (ganache, hardhat), no effect on live networks
  });

  await deploy('Crowdsale', {
    from: deployer,
    args: [TDFToken.address, eur.address, TDFTokenBeneficiary, parseEther('150'), parseEther('0.5')],
  });
};
export default func;
func.tags = ['Crowdsale'];
