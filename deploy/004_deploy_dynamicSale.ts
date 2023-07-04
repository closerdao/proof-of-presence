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

  const accounts = await getNamedAccounts();
  const {deployer, TDFMultisig} = accounts;
  let eur: string;

  switch (hre.network.name) {
    case 'celo': {
      eur = accounts.ceur;
      break;
    }
    default: {
      const eur_contract = await deploy('FakeEURToken', {
        gasPrice: ethers.utils.parseUnits('100', 'gwei'), // specify a higher gas price
        from: deployer,
        args: [],
        log: true,
        autoMine: true, // speed up deployment on local network (ganache, hardhat), no effect on live networks
      });
      eur = eur_contract.address;
      break;
    }
  }

  const sale = await deploy('DynamicSale', {
    from: deployer,
    gasPrice: ethers.utils.parseUnits('100', 'gwei'), // specify a higher gas price
    proxy: {
      proxyContract: 'OptimizedTransparentProxy',
      execute: {
        init: {methodName: `initialize`, args: [TDFToken.address, eur, TDFDiamond.address, TDFMultisig]},
      },
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
