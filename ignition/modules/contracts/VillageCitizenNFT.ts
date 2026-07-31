import {buildModule} from '@nomicfoundation/hardhat-ignition/modules';
import VillageAccessModule from './VillageAccess.js';
import {deployVillageUupsProxy} from './shared.js';

export const VILLAGE_CITIZEN_NFT_MODULE_ID = 'VillageCitizenNFTModule';

/** Fresh UUPS deployment for the village citizenship credential. */
export default buildModule(VILLAGE_CITIZEN_NFT_MODULE_ID, (m) => {
  const {villageAccess} = m.useModule(VillageAccessModule);
  const name = m.getParameter<string>('name');
  const symbol = m.getParameter<string>('symbol');
  const baseURI = m.getParameter<string>('baseURI');
  const owner = m.getParameter<string>('owner');
  const deployed = deployVillageUupsProxy(m, 'VillageCitizenNFT', [name, symbol, baseURI, villageAccess, owner]);

  return {
    citizenNft: deployed.instance,
    citizenNftImplementation: deployed.implementation,
    citizenNftProxy: deployed.proxy,
  };
});
