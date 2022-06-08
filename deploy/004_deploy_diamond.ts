import {HardhatRuntimeEnvironment} from 'hardhat/types';
import {DeployFunction} from 'hardhat-deploy/types';
import {parseEther} from 'ethers/lib/utils';

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const {deployments, getNamedAccounts} = hre;
  const {deploy, diamond} = deployments;

  const TDFToken = await deployments.get('TDFToken');

  const {deployer} = await getNamedAccounts();

  await diamond.deploy('TDFDiamond', {
    from: deployer,
    owner: deployer,
    facets: [{name: 'ProofOfPresenceFacet'}, {name: 'TokenLockFacet', args: [365]}],
  });
};
export default func;
func.tags = ['Diamond'];
