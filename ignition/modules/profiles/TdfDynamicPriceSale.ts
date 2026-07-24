import {buildModule} from '@nomicfoundation/hardhat-ignition/modules';
import {deployDynamicPriceSale} from '../contracts/DynamicPriceSale.js';
import TdfCommunityTokenModule from './TdfCommunityToken.js';

export const TDF_DYNAMIC_PRICE_SALE_MODULE_ID = 'TdfDynamicPriceSaleModule';

/** Deploys the historical stateless curve and wires it to the TDF primary sale. */
export default buildModule(TDF_DYNAMIC_PRICE_SALE_MODULE_ID, (m) => {
  const {communityToken, communityTokenImplementation, communityTokenProxy, tdfTransferPolicy} =
    m.useModule(TdfCommunityTokenModule);
  const tdfBondingCurve = m.contract('TDFV1BondingCurve');
  const deployed = deployDynamicPriceSale(m, communityToken, tdfBondingCurve);

  return {
    communityToken,
    communityTokenImplementation,
    communityTokenProxy,
    tdfTransferPolicy,
    tdfBondingCurve,
    dynamicPriceSale: deployed.instance,
    dynamicPriceSaleImplementation: deployed.implementation,
    dynamicPriceSaleProxy: deployed.proxy,
  };
});
