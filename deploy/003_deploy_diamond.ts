import {HardhatRuntimeEnvironment} from 'hardhat/types';
import {DeployFunction} from 'hardhat-deploy/types';

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const {deployments, getNamedAccounts} = hre;
  const {diamond} = deployments;

  const TDFToken = await deployments.get('TDFToken');

  const {deployer} = await getNamedAccounts();

  await diamond.deploy('TDFDiamond', {
    from: deployer,
    owner: deployer,
    facets: [{name: 'ProofOfPresenceFacet'}, {name: 'TokenLockFacet'}, {name: 'DiamondInit'}, {name: 'AdminFacet'}],
    // diamondContractArgs: [TDFToken.address],
    execute: {
      methodName: 'init',
      args: [TDFToken.address, 1], // TODO: be 365 and change in tests
    },
  });
  // TODO:
  // Set the
  // deployed
};
export default func;
func.tags = ['Diamond'];
