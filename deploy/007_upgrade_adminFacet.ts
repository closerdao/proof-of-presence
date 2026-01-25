import {ethers} from 'hardhat';
import {HardhatRuntimeEnvironment} from 'hardhat/types';
import {DeployFunction} from 'hardhat-deploy/types';
import {IDiamondCut} from '../typechain';
import {parseUnits} from 'ethers/lib/utils';

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  console.log('Starting deploy 007_upgrade_adminFacet');

  const {deployments, getNamedAccounts} = hre;
  const {deploy} = deployments;

  const {deployer} = await getNamedAccounts();
  const isCelo = hre.network.name === 'celo';
  const priorityFee = process.env.PRIORITY_FEE || '1';
  const maxFee = process.env.MAX_FEE || '30';
  const gasOverrides = isCelo
    ? {}
    : {
        maxPriorityFeePerGas: parseUnits(priorityFee, 'gwei'),
        maxFeePerGas: parseUnits(maxFee, 'gwei'),
      };

  console.log('Deployer:', deployer);

  const newAdminFacet = await deploy('AdminFacet', {
    from: deployer,
    log: true,
    autoMine: true,
    ...gasOverrides,
  });

  console.log('Deployed new AdminFacet:', newAdminFacet.address);

  const tdfDiamond = (await ethers.getContract('TDFDiamond', deployer).catch(() => {
    throw new Error('TDFDiamond contract not found. Please deploy it first.');
  })) as IDiamondCut;

  console.log('Updating AdminFacet on existing diamond at address:', tdfDiamond.address);

  // upgrade used AdminFacet on diamond
  const result = await tdfDiamond.diamondCut(
    [
      {
        facetAddress: newAdminFacet.address,
        action: 1, // 1 === replace
        functionSelectors: [
          '0x248a9ca3',
          '0x71061398',
          '0x2f2ff15d',
          '0x91d14854',
          '0x1ce22b61',
          '0xda3d8950',
          '0x8456cb59',
          '0x5c975abb',
          '0x36568abe',
          '0xd547741f',
          '0x1e4e0091',
          '0x3f4ba83a',
        ],
      },
    ],
    ethers.constants.AddressZero,
    '0x',
    gasOverrides
  );
  console.log('Diamond cut result:', result);
};
export default func;
func.tags = ['AdminFacetUpgrade'];
