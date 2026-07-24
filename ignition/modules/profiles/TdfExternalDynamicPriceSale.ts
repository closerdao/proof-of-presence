import {buildModule} from '@nomicfoundation/hardhat-ignition/modules';
import {deployDynamicPriceSale} from '../contracts/DynamicPriceSale.js';
import TdfCommunityTokenModule from './TdfCommunityToken.js';

export const TDF_EXTERNAL_DYNAMIC_PRICE_SALE_MODULE_ID = 'TdfExternalDynamicPriceSaleModule';

/** Adds a generic externally supplied curve to a token graph that also uses the TDF transfer policy. */
export default buildModule(TDF_EXTERNAL_DYNAMIC_PRICE_SALE_MODULE_ID, (m) => {
  const {communityToken, communityTokenImplementation, communityTokenProxy, tdfTransferPolicy} =
    m.useModule(TdfCommunityTokenModule);
  const bondingCurve = m.getParameter<string>('bondingCurve');
  const deployed = deployDynamicPriceSale(m, communityToken, bondingCurve);

  return {
    communityToken,
    communityTokenImplementation,
    communityTokenProxy,
    tdfTransferPolicy,
    dynamicPriceSale: deployed.instance,
    dynamicPriceSaleImplementation: deployed.implementation,
    dynamicPriceSaleProxy: deployed.proxy,
  };
});
