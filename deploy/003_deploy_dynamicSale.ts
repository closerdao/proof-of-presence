import {HardhatRuntimeEnvironment} from 'hardhat/types';
import {DeployFunction} from 'hardhat-deploy/types';
import {PrelaunchDAO} from '../typechain';
import {ethers} from 'hardhat';

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const {deployments, getNamedAccounts} = hre;
  const {deploy} = deployments;
  const accounts = await getNamedAccounts();
  const {deployer, TDFTreasury} = accounts;

  const TDFToken = await deployments.get('TDFToken');
  const dao = (await ethers.getContract('PrelaunchDAO', deployer)).connect(
    await ethers.getSigner(deployer)
  ) as PrelaunchDAO;

  let eur: string;

  switch (hre.network.name) {
    case 'celo': {
      eur = accounts.ceur;
      break;
    }
    default: {
      const eur_contract = await deploy('FakeEURToken', {
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
    proxy: {
      proxyContract: 'OptimizedTransparentProxy',
      execute: {
        init: {methodName: `initialize`, args: [TDFToken.address, eur, dao.address, TDFTreasury]},
      },
    },
    log: true,
    autoMine: true, // speed up deployment on local network (ganache, hardhat), no effect on live networks
  });

  await dao.setSaleContract(sale.address);
};
export default func;
func.tags = ['DynamicSale'];
