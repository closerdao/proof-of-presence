import {buildModule} from '@nomicfoundation/hardhat-ignition/modules';
import type {ContractFuture, IgnitionModuleBuilder} from '@nomicfoundation/ignition-core';
import VillageAccessModule from './VillageAccess.js';
import CommunityTokenModule from './CommunityToken.js';
import {deployVillageUupsProxy} from './shared.js';

export const TOKENIZED_STAYS_MODULE_ID = 'TokenizedStaysModule';

export function deployTokenizedStays(
  m: IgnitionModuleBuilder,
  communityToken: ContractFuture<string>,
  villageAccess: ContractFuture<string>,
) {
  const owner = m.getParameter<string>('owner');
  return deployVillageUupsProxy(m, 'TokenizedStays', [communityToken, villageAccess, owner]);
}

export default buildModule(TOKENIZED_STAYS_MODULE_ID, (m) => {
  const {villageAccess} = m.useModule(VillageAccessModule);
  const {communityToken} = m.useModule(CommunityTokenModule);
  const deployed = deployTokenizedStays(m, communityToken, villageAccess);

  return {
    tokenizedStays: deployed.instance,
    tokenizedStaysImplementation: deployed.implementation,
    tokenizedStaysProxy: deployed.proxy,
  };
});
