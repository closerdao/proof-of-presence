import {HardhatRuntimeEnvironment} from 'hardhat/types';
import {DeployFunction} from 'hardhat-deploy/types';

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const {deployments, getNamedAccounts} = hre;
  const {diamond} = deployments;

  const {deployer} = await getNamedAccounts();
  const TDFToken = await deployments.deploy('ERC20TestMock', {from: deployer});
  const minutes = (n: number) => n * 3600;
  const days = (n: number) => n * 86400;

  await diamond.deploy('TDFDiamond', {
    from: deployer,
    owner: deployer,
    facets: [
      {name: 'BookingFacet'},
      {name: 'StakingFacet'},
      {name: 'AdminFacet'},
      {name: 'MembershipFacet'},
      {name: 'DiamondInit'},
    ],
    // diamondContractArgs: [TDFToken.address],
    execute: {
      methodName: 'init',
      args: [TDFToken.address, minutes(5)], // TODO: be 365 and change in tests
    },
  });
  // TODO:
  // Set the
  // deployed
};
export default func;
func.tags = ['Diamond'];
