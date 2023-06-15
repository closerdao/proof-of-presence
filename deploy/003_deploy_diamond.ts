import {HardhatRuntimeEnvironment} from 'hardhat/types';
import {DeployFunction} from 'hardhat-deploy/types';
import {ethers} from 'hardhat';
import {TDFTokenTest} from '../typechain';

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const {deployments, getNamedAccounts} = hre;
  const {diamond} = deployments;

  const {deployer} = await getNamedAccounts();
  const realTDFToken = (await ethers.getContract('TDFTokenTest', deployer)).connect(
    await ethers.getSigner(deployer)
  ) as TDFTokenTest;

  const contract = await diamond.deploy('TDFDiamond', {
    from: deployer,
    owner: deployer,
    facets: [
      {name: 'BookingFacet'},
      {name: 'StakingFacet'},
      {name: 'AdminFacet'},
      {name: 'MembershipFacet'},
      {name: 'DiamondInit'},
    ],
    // diamondContractArgs: [TDFTokenTest.address],
    execute: {
      methodName: 'init',
      args: [realTDFToken.address],
    },
  });
  await realTDFToken.setDAOContract(contract.address);
};
export default func;
func.tags = ['Diamond'];
