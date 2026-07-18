import {buildModule} from '@nomicfoundation/hardhat-ignition/modules';
import type {ArgumentType, ContractFuture, IgnitionModuleBuilder} from '@nomicfoundation/ignition-core';
import VillageAccessModule from './VillageAccess.js';
import {deployVillageUupsProxy} from './shared.js';

export const COMMUNITY_TOKEN_MODULE_ID = 'CommunityTokenModule';

export function deployCommunityToken(
  m: IgnitionModuleBuilder,
  villageAccess: ContractFuture<string>,
  transferPolicy: ArgumentType,
) {
  const name = m.getParameter<string>('name');
  const symbol = m.getParameter<string>('symbol');
  const initialSupply = m.getParameter<string>('initialSupply', '0');
  const initialRecipient = m.getParameter<string>('initialRecipient', '0x0000000000000000000000000000000000000000');
  const owner = m.getParameter<string>('owner');
  return deployVillageUupsProxy(m, 'CommunityToken', [
    name,
    symbol,
    initialSupply,
    initialRecipient,
    villageAccess,
    transferPolicy,
    owner,
  ]);
}

export default buildModule(COMMUNITY_TOKEN_MODULE_ID, (m) => {
  const {villageAccess} = m.useModule(VillageAccessModule);
  const transferPolicy = m.getParameter<string>('transferPolicy', '0x0000000000000000000000000000000000000000');
  const deployed = deployCommunityToken(m, villageAccess, transferPolicy);

  return {
    communityToken: deployed.instance,
    communityTokenImplementation: deployed.implementation,
    communityTokenProxy: deployed.proxy,
  };
});
