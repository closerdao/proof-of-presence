import {buildModule} from '@nomicfoundation/hardhat-ignition/modules';
import VillageAccessModule from './VillageAccess.js';
import {deployVillageUupsProxy} from './shared.js';

export const VILLAGE_PRESENCE_TOKEN_MODULE_ID = 'VillagePresenceTokenModule';

export default buildModule(VILLAGE_PRESENCE_TOKEN_MODULE_ID, (m) => {
  const {villageAccess} = m.useModule(VillageAccessModule);
  const name = m.getParameter<string>('name');
  const symbol = m.getParameter<string>('symbol');
  const decayRatePerDay = m.getParameter<string>('decayRatePerDay');
  const owner = m.getParameter<string>('owner');
  const deployed = deployVillageUupsProxy(m, 'VillagePresenceToken', [
    name,
    symbol,
    villageAccess,
    decayRatePerDay,
    owner,
  ]);

  return {
    villagePresenceToken: deployed.instance,
    villagePresenceTokenImplementation: deployed.implementation,
    villagePresenceTokenProxy: deployed.proxy,
  };
});
