import {buildModule} from '@nomicfoundation/hardhat-ignition/modules';
import TdfDynamicPriceSaleModule from './TdfDynamicPriceSale.js';
import TdfVillageModule from './TdfVillage.js';

export const TDF_VILLAGE_DYNAMIC_PRICE_SALE_MODULE_ID = 'TdfVillageDynamicPriceSaleModule';

/**
 * Sale-enabled TDF root graph. The legacy TdfVillageModule remains unchanged so existing no-sale journals keep
 * their exact persistent Module IDs.
 */
export default buildModule(TDF_VILLAGE_DYNAMIC_PRICE_SALE_MODULE_ID, (m) => {
  const village = m.useModule(TdfVillageModule);
  const sale = m.useModule(TdfDynamicPriceSaleModule);
  return {...village, ...sale};
});
