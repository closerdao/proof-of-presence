import {deployScript, artifacts} from '../rocketh/deploy.js';
import {parseUnits} from 'ethers';

export default deployScript(
  async (env) => {
    const {deployer, TDFMultisig} = env.namedAccounts;
    const isCelo = env.network.name === 'celo';
    const priorityFee = process.env.PRIORITY_FEE || '1';
    const maxFee = process.env.MAX_FEE || '30';
    const gasOverrides = isCelo
      ? {}
      : {
          maxPriorityFeePerGas: parseUnits(priorityFee, 'gwei'),
          maxFeePerGas: parseUnits(maxFee, 'gwei'),
        };

    const TDFToken = env.get('TDFToken');

    const contract = await env.diamond(
      'TDFDiamond',
      {
        account: deployer,
        ...gasOverrides,
      },
      {
        facets: [
          {name: 'BookingFacet', artifact: artifacts.BookingFacet, args: []},
          {name: 'StakingFacet', artifact: artifacts.StakingFacet, args: []},
          {name: 'AdminFacet', artifact: artifacts.AdminFacet, args: []},
          {name: 'MembershipFacet', artifact: artifacts.MembershipFacet, args: []},
          {name: 'DiamondInit', artifact: artifacts.DiamondInit, args: []},
        ],
        execute: {
          type: 'facet',
          functionName: 'init',
          args: [TDFToken.address, TDFMultisig],
        },
      },
    );

    // Set DAO contract on TDF token
    await env.executeByName('TDFToken', {
      account: deployer,
      functionName: 'setDAOContract',
      args: [contract.address],
      ...gasOverrides,
    });
  },
  {tags: ['Diamond']},
);
