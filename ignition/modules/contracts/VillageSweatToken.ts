import {buildModule} from '@nomicfoundation/hardhat-ignition/modules';
import VillageAccessModule from './VillageAccess.js';
import {deployVillageDecayingToken} from './shared.js';

export const VILLAGE_SWEAT_TOKEN_MODULE_ID = 'VillageSweatTokenModule';

export default buildModule(VILLAGE_SWEAT_TOKEN_MODULE_ID, (m) => {
  const {villageAccess} = m.useModule(VillageAccessModule);
  const deployed = deployVillageDecayingToken(m, 'VillageSweatToken', villageAccess);

  return {
    villageSweatToken: deployed.instance,
    villageSweatTokenImplementation: deployed.implementation,
    villageSweatTokenProxy: deployed.proxy,
  };
});
