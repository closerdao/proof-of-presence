import {buildModule} from '@nomicfoundation/hardhat-ignition/modules';
import VillageAccessModule from '../contracts/VillageAccess.js';
import VillagePresenceTokenModule from '../contracts/VillagePresenceToken.js';
import VillageSweatTokenModule from '../contracts/VillageSweatToken.js';
import TdfTokenizedStaysModule from './TdfTokenizedStays.js';

export const TDF_V2_VILLAGE_MODULE_ID = 'TdfV2VillageModule';

export default buildModule(TDF_V2_VILLAGE_MODULE_ID, (m) => {
  const {villageAccess, villageAccessImplementation, villageAccessProxy} = m.useModule(VillageAccessModule);
  const {
    communityToken,
    communityTokenImplementation,
    communityTokenProxy,
    tokenizedStays,
    tokenizedStaysImplementation,
    tokenizedStaysProxy,
    tdfTransferPolicy,
  } = m.useModule(TdfTokenizedStaysModule);
  const {villagePresenceToken, villagePresenceTokenImplementation, villagePresenceTokenProxy} =
    m.useModule(VillagePresenceTokenModule);
  const {villageSweatToken, villageSweatTokenImplementation, villageSweatTokenProxy} =
    m.useModule(VillageSweatTokenModule);

  return {
    villageAccess,
    villageAccessImplementation,
    villageAccessProxy,
    communityToken,
    communityTokenImplementation,
    communityTokenProxy,
    villagePresenceToken,
    villagePresenceTokenImplementation,
    villagePresenceTokenProxy,
    villageSweatToken,
    villageSweatTokenImplementation,
    villageSweatTokenProxy,
    tokenizedStays,
    tokenizedStaysImplementation,
    tokenizedStaysProxy,
    tdfTransferPolicy,
  };
});
