import {deployScript, artifacts} from '../rocketh/deploy.js';
import {parseUnits, ZeroAddress} from 'ethers';

export default deployScript(
  async (env) => {
    console.log('Starting deploy 007_upgrade_adminFacet');

    const {deployer} = env.namedAccounts;
    const isCelo = env.network.name === 'celo';
    const priorityFee = process.env.PRIORITY_FEE || '1';
    const maxFee = process.env.MAX_FEE || '30';
    const gasOverrides = isCelo
      ? {}
      : {
          maxPriorityFeePerGas: parseUnits(priorityFee, 'gwei'),
          maxFeePerGas: parseUnits(maxFee, 'gwei'),
        };

    console.log('Deployer:', deployer);

    const newAdminFacet = await env.deploy('AdminFacet', {
      account: deployer,
      artifact: artifacts.AdminFacet,
      args: [],
      ...gasOverrides,
    });

    console.log('Deployed new AdminFacet:', newAdminFacet.address);

    // Skip if AdminFacet wasn't actually redeployed (same bytecode = same address)
    if (!newAdminFacet.newlyDeployed) {
      console.log('AdminFacet bytecode unchanged, skipping diamond upgrade.');
      return;
    }

    const tdfDiamond = env.get('TDFDiamond');
    if (!tdfDiamond) {
      throw new Error('TDFDiamond contract not found. Please deploy it first.');
    }

    console.log('Updating AdminFacet on existing diamond at address:', tdfDiamond.address);

    // upgrade AdminFacet on diamond via diamondCut
    await env.executeByName('TDFDiamond', {
      account: deployer,
      functionName: 'diamondCut',
      args: [
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
        ZeroAddress,
        '0x',
      ],
      ...gasOverrides,
    });
  },
  {tags: ['AdminFacetUpgrade']},
);
