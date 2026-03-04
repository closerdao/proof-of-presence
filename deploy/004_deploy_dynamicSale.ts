import {deployScript, artifacts} from '../rocketh/deploy.js';
import {parseUnits} from 'ethers';
import {ROLES} from '../utils/index.js';

export default deployScript(
  async (env) => {
    const accounts = env.namedAccounts;
    const {deployer, TDFMultisig} = accounts;
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
    const TDFDiamond = env.get('TDFDiamond');

    let eur: string;
    switch (env.network.name) {
      case 'celo': {
        eur = accounts.ceur;
        break;
      }
      default: {
        const eurContract = await env.deploy('FakeEURToken', {
          account: deployer,
          artifact: artifacts.FakeEURToken,
          args: [],
          ...gasOverrides,
        });
        eur = eurContract.address;
        break;
      }
    }

    const sale = await env.deployViaProxy(
      'DynamicSale',
      {
        account: deployer,
        artifact: artifacts.DynamicSale,
        args: [],
        ...gasOverrides,
      },
      {
        proxyContract: 'SharedAdminOptimizedTransparentProxy',
        execute: {
          methodName: 'initialize',
          args: [TDFToken.address, eur, TDFDiamond.address, TDFMultisig],
        },
      },
    );

    await env.executeByName('TDFDiamond', {
      account: deployer,
      functionName: 'grantRole',
      args: [ROLES['MINTER_ROLE'], sale.address],
      ...gasOverrides,
    });
  },
  {tags: ['DynamicSale']},
);
