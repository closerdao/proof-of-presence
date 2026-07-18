import {buildModule} from '@nomicfoundation/hardhat-ignition/modules';
import VillageAccessModule from '../contracts/VillageAccess.js';
import {deployCommunityToken} from '../contracts/CommunityToken.js';
import TDFTransferPolicyModule from '../contracts/TDFTransferPolicy.js';

export const TDF_COMMUNITY_TOKEN_MODULE_ID = 'TdfCommunityTokenModule';

/** Links the internally deployed TDF policy during token initialization so transfers fail closed from deployment. */
export default buildModule(TDF_COMMUNITY_TOKEN_MODULE_ID, (m) => {
  const {villageAccess} = m.useModule(VillageAccessModule);
  const {tdfTransferPolicy} = m.useModule(TDFTransferPolicyModule);
  const deployed = deployCommunityToken(m, villageAccess, tdfTransferPolicy);

  return {
    communityToken: deployed.instance,
    communityTokenImplementation: deployed.implementation,
    communityTokenProxy: deployed.proxy,
    tdfTransferPolicy,
  };
});
