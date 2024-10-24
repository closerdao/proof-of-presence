import {HardhatRuntimeEnvironment} from 'hardhat/types';
import {DeployFunction} from 'hardhat-deploy/types';
import {ethers} from 'hardhat';
import {TDFDiamond} from '../typechain';

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const {deployments, getNamedAccounts} = hre;
  const {deploy} = deployments;

  const {deployer} = await getNamedAccounts();

  // TODO what should be the default value?
  const decayRatePerDay = 28861; // eta 10% per year

  const daoContract = (await ethers.getContract('TDFDiamond', deployer)) as TDFDiamond;

  // TODO in prod this should be called from the same address as the owner
  //  of the TDFDiamond, so maybe the TDFMultisig should be the deployer?
  await deploy('PresenceToken', {
    gasPrice: ethers.utils.parseUnits('100', 'gwei'), // specify a higher gas price
    from: deployer,
    proxy: {
      proxyContract: 'OptimizedTransparentProxy',
      execute: {
        init: {
          methodName: `initialize`,
          // TODO what name and symbol to set?
          args: ['TDF Presence', '$PRESENCE', daoContract.address, decayRatePerDay],
        },
      },
    },
    log: true,
    autoMine: true,
  });
};
export default func;
func.tags = ['PresenceToken'];
