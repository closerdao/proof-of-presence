import {buildModule} from '@nomicfoundation/hardhat-ignition/modules';
import VillageAccessModule from '../contracts/VillageAccess.js';

export const MINIMAL_VILLAGE_MODULE_ID = 'MinimalVillageModule';

export default buildModule(MINIMAL_VILLAGE_MODULE_ID, (m) => {
  const {villageAccess, villageAccessImplementation, villageAccessProxy} = m.useModule(VillageAccessModule);
  return {villageAccess, villageAccessImplementation, villageAccessProxy};
});
