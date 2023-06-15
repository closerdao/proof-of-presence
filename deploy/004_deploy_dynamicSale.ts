import {HardhatRuntimeEnvironment} from 'hardhat/types';
import {DeployFunction} from 'hardhat-deploy/types';
import {TDFDiamond} from '../typechain';
import {ethers} from 'hardhat';
import {ROLES} from '../utils';

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const {deployments, getNamedAccounts} = hre;
  const {deploy} = deployments;

  const TDFTokenTest = await deployments.get('TDFTokenTest');
  const TDFDiamond = await deployments.get('TDFDiamond');

  const accounts = await getNamedAccounts();
  const {deployer, TDFDevMultisig} = accounts;
  let eur: string;

  // switch (hre.network.name) {
  //   case 'celo': {
  //     eur = accounts.ceur;
  //     break;
  //   }
  //   default: {
  // const eur_contract = await deploy('FakeEURToken', {
  //   from: deployer,
  //   args: [],
  //   log: true,
  //   autoMine: true, // speed up deployment on local network (ganache, hardhat), no effect on live networks
  // });
  eur = '0xD8763CBa276a3738E6DE85b4b3bF5FDed6D6cA73';
  //     break;
  //   }
  // }
  console.log(eur);
  console.log(deployer);
  console.log(TDFTokenTest.address);
  console.log(TDFDiamond.address);

  const sale = await deploy('DynamicSaleTest', {
    from: deployer,
    gasPrice: ethers.utils.parseUnits('100', 'gwei'), // specify a higher gas price
    proxy: {
      proxyContract: 'OptimizedTransparentProxy',
      execute: {
        init: {methodName: `initialize`, args: [TDFTokenTest.address, eur, TDFDiamond.address, TDFDevMultisig]},
      },
    },
    log: true,
    autoMine: true, // speed up deployment on local network (ganache, hardhat), no effect on live networks
  });
  console.log('hereh');
  const diamond = (await ethers.getContract('TDFDiamond', deployer)).connect(
    await ethers.getSigner(deployer)
  ) as TDFDiamond;
  await diamond.grantRole(ROLES['MINTER_ROLE'], sale.address);
};
export default func;
func.tags = ['DynamicSaleTest'];
