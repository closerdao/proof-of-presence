import {buildModule} from '@nomicfoundation/hardhat-ignition/modules';
import type {ArgumentType, ContractFuture, IgnitionModuleBuilder} from '@nomicfoundation/ignition-core';
import CommunityTokenModule from './CommunityToken.js';
import {deployVillageUupsProxy} from './shared.js';

export const DYNAMIC_PRICE_SALE_MODULE_ID = 'DynamicPriceSaleModule';

export function deployDynamicPriceSale(
  m: IgnitionModuleBuilder,
  communityToken: ContractFuture<string>,
  bondingCurve: ArgumentType,
) {
  const configuration = {
    communityToken,
    quoteToken: m.getParameter<string>('quoteToken'),
    bondingCurve,
    villageTreasury: m.getParameter<string>('villageTreasury'),
    closerFeeRecipient: m.getParameter<string>('closerFeeRecipient'),
    saleCap: m.getParameter<string>('saleCap'),
    minimumPurchase: m.getParameter<string>('minimumPurchase'),
    maximumPurchase: m.getParameter<string>('maximumPurchase'),
    purchaseGranularity: m.getParameter<string>('purchaseGranularity'),
    maximumRecipientBalance: m.getParameter<string>('maximumRecipientBalance'),
    closerFeeBps: m.getParameter<number>('closerFeeBps'),
  };
  const owner = m.getParameter<string>('owner');
  return deployVillageUupsProxy(m, 'DynamicPriceSale', [configuration, owner]);
}

export default buildModule(DYNAMIC_PRICE_SALE_MODULE_ID, (m) => {
  const {communityToken} = m.useModule(CommunityTokenModule);
  const bondingCurve = m.getParameter<string>('bondingCurve');
  const deployed = deployDynamicPriceSale(m, communityToken, bondingCurve);

  return {
    dynamicPriceSale: deployed.instance,
    dynamicPriceSaleImplementation: deployed.implementation,
    dynamicPriceSaleProxy: deployed.proxy,
  };
});
