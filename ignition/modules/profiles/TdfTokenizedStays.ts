import {buildModule} from '@nomicfoundation/hardhat-ignition/modules';
import VillageAccessModule from '../contracts/VillageAccess.js';
import {deployTokenizedStays} from '../contracts/TokenizedStays.js';
import TdfCommunityTokenModule from './TdfCommunityToken.js';

export const TDF_TOKENIZED_STAYS_MODULE_ID = 'TdfTokenizedStaysModule';

/** Composes the pre-wired TDF token with TokenizedStays without duplicating generic contract mechanics. */
export default buildModule(TDF_TOKENIZED_STAYS_MODULE_ID, (m) => {
  const {villageAccess} = m.useModule(VillageAccessModule);
  const {communityToken, communityTokenImplementation, communityTokenProxy, tdfTransferPolicy} =
    m.useModule(TdfCommunityTokenModule);
  const deployed = deployTokenizedStays(m, communityToken, villageAccess);

  return {
    communityToken,
    communityTokenImplementation,
    communityTokenProxy,
    tokenizedStays: deployed.instance,
    tokenizedStaysImplementation: deployed.implementation,
    tokenizedStaysProxy: deployed.proxy,
    tdfTransferPolicy,
  };
});
