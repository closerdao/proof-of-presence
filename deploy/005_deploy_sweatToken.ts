import {deployScript, artifacts} from '../rocketh/deploy.js';
import {parseUnits} from 'ethers';

export const DEFAULT_SWEAT_TOKEN_NAME = 'TDF Sweat';
export const DEFAULT_SWEAT_TOKEN_SYMBOL = '$SWEAT';
export const DEFAULT_SWEAT_TOKEN_DECAY_RATE_PER_DAY = 288_617; // ~10% per year

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

    const daoContract = env.get('TDFDiamond');
    if (!daoContract) {
      throw new Error('TDFDiamond contract not found. Please deploy it first.');
    }

    await env.deployViaProxy(
      'SweatToken',
      {
        account: deployer,
        artifact: artifacts.SweatToken,
        args: [],
        ...gasOverrides,
      },
      {
        proxyContract: 'SharedAdminOptimizedTransparentProxy',
        execute: {
          methodName: 'initialize',
          args: [
            DEFAULT_SWEAT_TOKEN_NAME,
            DEFAULT_SWEAT_TOKEN_SYMBOL,
            daoContract.address,
            DEFAULT_SWEAT_TOKEN_DECAY_RATE_PER_DAY,
          ],
        },
      },
    );
  },
  {tags: ['SweatToken']},
);
