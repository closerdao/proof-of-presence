import { ethers } from 'ethers';

async function readAdminFacetStorage(adminFacetAddress: string, provider: ethers.providers.Provider) {
    console.log("adminFacetAddress", adminFacetAddress);
    console.log("provider", provider);

    // Read slot 0 which contains the AppStorage struct
    const slot0 = await provider.getStorageAt(adminFacetAddress, "0x0");
    console.log("slot0", slot0);

    // The first 32 bytes contain:
    // - initialized (bool) at offset 0
    // - paused (bool) at offset 1
    // - communityToken (address) at offset 2
    const initialized = ethers.BigNumber.from(slot0).and(ethers.BigNumber.from(1)).eq(1);
    const paused = ethers.BigNumber.from(slot0).and(ethers.BigNumber.from(2)).eq(2);
    const communityToken = ethers.utils.getAddress("0x" + slot0.slice(26));
    
    // Read slot 1 which contains the _roleStore
    const slot1 = await provider.getStorageAt(adminFacetAddress, "0x1");
    console.log("slot1", slot1);
    // Read slot 3 which contains the _accommodationBookings mapping
    const slot3 = await provider.getStorageAt(adminFacetAddress, "0x3");
    console.log("slot3", slot3);
    // Read slot 4 which contains the _accommodationYears
    const slot4 = await provider.getStorageAt(adminFacetAddress, "0x4");
    console.log("slot4", slot4);
    // Read slot 7 which contains the staking mapping
    const slot7 = await provider.getStorageAt(adminFacetAddress, "0x7");
    console.log("slot7", slot7);
    // Read slot 8 which contains the members
    const slot8 = await provider.getStorageAt(adminFacetAddress, "0x8");
    console.log("slot8", slot8);
    // Read slot 9 which contains the tdfTreasury
    const slot9 = await provider.getStorageAt(adminFacetAddress, "0x9");
    console.log("slot9", slot9);
    const tdfTreasury = ethers.utils.getAddress("0x" + slot9.slice(26));
    console.log("tdfTreasury", tdfTreasury);
    return {
        initialized,
        paused,
        communityToken,
        roleStore: slot1,
        accommodationBookings: slot3,
        accommodationYears: slot4,
        staking: slot7,
        members: slot8,
        tdfTreasury
    };
}

const provider = new ethers.providers.JsonRpcProvider(
    'https://forno.celo.org',
);
const adminFacetAddress = "0x315C9dBF6f4019DD0A36c03a5EFC28854f72BA86";
const diamondAddress = "0x475398EeE0E22cb6fe5403ffA294Fb10Ad989e17"

readAdminFacetStorage(diamondAddress, provider)
    .then(storage => console.log("Storage values:", storage))
    .catch(error => console.error("Error reading storage:", error));
