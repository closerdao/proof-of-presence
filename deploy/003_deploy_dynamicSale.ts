import {HardhatRuntimeEnvironment} from 'hardhat/types';
import {DeployFunction} from 'hardhat-deploy/types';
import {TDFDiamond} from '../typechain';
import {ethers} from 'hardhat';
import {ROLES} from '../utils';

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const {deployments, getNamedAccounts} = hre;
  const {deploy} = deployments;

  const TDFToken = await deployments.get('TDFToken');
  const TDFDiamond = await deployments.get('TDFDiamond');

  const {deployer, ceur} = await getNamedAccounts();

  const sale = await deploy('DynamicSale', {
    from: deployer,
    proxy: {
      proxyContract: 'OptimizedTransparentProxy',
      execute: {init: {methodName: `initialize`, args: [TDFToken.address, ceur, TDFDiamond.address]}},
    },
    log: true,
    autoMine: true, // speed up deployment on local network (ganache, hardhat), no effect on live networks
  });
  const diamond = (await ethers.getContract('TDFDiamond', deployer)).connect(
    await ethers.getSigner(deployer)
  ) as TDFDiamond;
  await diamond.grantRole(ROLES['MINTER_ROLE'], sale.address);
};
export default func;
func.tags = ['DynamicSale'];
