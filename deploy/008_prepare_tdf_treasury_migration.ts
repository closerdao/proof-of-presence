import {ethers} from 'hardhat';
import {HardhatRuntimeEnvironment} from 'hardhat/types';
import {DeployFunction} from 'hardhat-deploy/types';

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const {deployments, getNamedAccounts} = hre;
  const {deploy, get} = deployments;
  const {deployer, TDFMultisig} = await getNamedAccounts();

  const migration = await deploy('TDFTreasuryMigration', {
    from: deployer,
    log: true,
    autoMine: true,
    maxPriorityFeePerGas: '10',
  });
  const diamondDeployment = await get('TDFDiamond');
  const diamond = await ethers.getContractAt('IDiamondCut', diamondDeployment.address);
  const migrationContract = await ethers.getContractAt('TDFTreasuryMigration', migration.address);
  const migrationData = migrationContract.interface.encodeFunctionData('migrate', [TDFMultisig]);
  const diamondCutData = diamond.interface.encodeFunctionData('diamondCut', [[], migration.address, migrationData]);

  console.log('TDF treasury migration must be proposed and executed by the current Diamond owner Safe.');
  console.log('Safe:', TDFMultisig);
  console.log('Transaction to:', diamondDeployment.address);
  console.log('Transaction value: 0');
  console.log('Transaction data:', diamondCutData);
};

func.tags = ['TDFTreasuryMigration'];
func.skip = async (hre: HardhatRuntimeEnvironment) => hre.network.name !== 'celoSepolia';

export default func;
