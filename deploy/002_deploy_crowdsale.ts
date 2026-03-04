import {deployScript, artifacts} from '../rocketh/deploy.js';
import {parseEther, parseUnits} from 'ethers';

// TODO: This deployment is only being used for testing.
// deploy as a mock in tests instead of here
export default deployScript(
  async (env) => {
    if (env.network.name === 'celo') {
      return;
    }
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

    const eur = await env.deploy('FakeEURToken', {
      account: deployer,
      artifact: artifacts.FakeEURToken,
      args: [],
      ...gasOverrides,
    });

    const TDFToken = env.get('TDFToken');

    await env.deploy('Crowdsale', {
      account: deployer,
      artifact: artifacts.Crowdsale,
      args: [TDFToken.address, eur.address, TDFMultisig, parseEther('150'), parseEther('0.5')],
      ...gasOverrides,
    });
  },
  {tags: ['Crowdsale']},
);
