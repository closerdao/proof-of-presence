import {deployScript, artifacts} from '../rocketh/deploy.js';
import {parseUnits} from 'ethers';
import {ZERO_ADDRESS} from '../utils/index.js';

export default deployScript(
  async (env) => {
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

    await env.deployViaProxy(
      'TDFToken',
      {
        account: deployer,
        artifact: artifacts.TDFToken,
        args: [],
        ...gasOverrides,
      },
      {
        proxyContract: 'SharedAdminOptimizedTransparentProxy',
        execute: {
          methodName: 'initialize',
          args: [ZERO_ADDRESS],
        },
      },
    );
  },
  {tags: ['TDFToken']},
);
