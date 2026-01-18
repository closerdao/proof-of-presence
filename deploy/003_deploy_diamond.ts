import {HardhatRuntimeEnvironment} from 'hardhat/types';
import {DeployFunction} from 'hardhat-deploy/types';
import {ethers} from 'hardhat';
import {TDFToken} from '../typechain';

import {parseUnits} from 'ethers/lib/utils';

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const {deployments, getNamedAccounts} = hre;
  const {diamond} = deployments;

  const {deployer, TDFMultisig} = await getNamedAccounts();
  const isCelo = hre.network.name === 'celo';
  const priorityFee = process.env.PRIORITY_FEE || '1';
  const maxFee = process.env.MAX_FEE || '30';
  const gasOverrides = isCelo
    ? {}
    : {
        maxPriorityFeePerGas: parseUnits(priorityFee, 'gwei'),
        maxFeePerGas: parseUnits(maxFee, 'gwei'),
      };

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
    ...gasOverrides,
    log: true,
    autoMine: true,
  });
  await realTDFToken.setDAOContract(contract.address, gasOverrides);
};
export default func;
func.tags = ['Diamond'];
