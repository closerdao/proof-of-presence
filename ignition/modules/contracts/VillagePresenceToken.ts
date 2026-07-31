import {buildModule} from '@nomicfoundation/hardhat-ignition/modules';
import VillageAccessModule from './VillageAccess.js';
import {deployVillageDecayingToken} from './shared.js';

export const VILLAGE_PRESENCE_TOKEN_MODULE_ID = 'VillagePresenceTokenModule';

export default buildModule(VILLAGE_PRESENCE_TOKEN_MODULE_ID, (m) => {
  const {villageAccess} = m.useModule(VillageAccessModule);
  const deployed = deployVillageDecayingToken(m, 'VillagePresenceToken', villageAccess);

  return {
    villagePresenceToken: deployed.instance,
    villagePresenceTokenImplementation: deployed.implementation,
    villagePresenceTokenProxy: deployed.proxy,
  };
});
