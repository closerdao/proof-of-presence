import {buildModule} from '@nomicfoundation/hardhat-ignition/modules';
import {deployVillageUupsProxy} from './shared.js';

export const VILLAGE_ACCESS_MODULE_ID = 'VillageAccessModule';

/** Root authority shared by all village contract Modules. */
export default buildModule(VILLAGE_ACCESS_MODULE_ID, (m) => {
  const initialDefaultAdmin = m.getParameter<string>('initialDefaultAdmin');
  const initialRoleGrants = m.getParameter<Array<{role: string; account: string}>>('initialRoleGrants', []);
  const deployed = deployVillageUupsProxy(m, 'VillageAccess', [initialDefaultAdmin, initialRoleGrants]);

  return {
    villageAccess: deployed.instance,
    villageAccessImplementation: deployed.implementation,
    villageAccessProxy: deployed.proxy,
  };
});
