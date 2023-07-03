import {HardhatRuntimeEnvironment} from 'hardhat/types';
import {DeployFunction} from 'hardhat-deploy/types';
import {ethers} from 'hardhat';
import {TDFToken} from '../typechain';

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const {deployments, getNamedAccounts} = hre;
  const {diamond} = deployments;

  const {deployer, TDFMultisig} = await getNamedAccounts();
  const realTDFToken = (await ethers.getContract('TDFToken', deployer)).connect(
    await ethers.getSigner(deployer)
  ) as TDFToken;

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
    execute: {
      methodName: 'init',
      args: [realTDFToken.address, TDFMultisig],
    },
  });
  await realTDFToken.setDAOContract(contract.address);
};
export default func;
func.tags = ['Diamond'];
