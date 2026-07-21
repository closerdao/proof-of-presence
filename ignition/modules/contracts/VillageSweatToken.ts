import {buildModule} from '@nomicfoundation/hardhat-ignition/modules';
import VillageAccessModule from './VillageAccess.js';
import {deployVillageUupsProxy} from './shared.js';

export const VILLAGE_SWEAT_TOKEN_MODULE_ID = 'VillageSweatTokenModule';

export default buildModule(VILLAGE_SWEAT_TOKEN_MODULE_ID, (m) => {
  const {villageAccess} = m.useModule(VillageAccessModule);
  const name = m.getParameter<string>('name');
  const symbol = m.getParameter<string>('symbol');
  const decayRatePerDay = m.getParameter<string>('decayRatePerDay');
  const owner = m.getParameter<string>('owner');
  const deployed = deployVillageUupsProxy(m, 'VillageSweatToken', [
    name,
    symbol,
    villageAccess,
    decayRatePerDay,
    owner,
  ]);

  return {
    villageSweatToken: deployed.instance,
    villageSweatTokenImplementation: deployed.implementation,
    villageSweatTokenProxy: deployed.proxy,
  };
});
