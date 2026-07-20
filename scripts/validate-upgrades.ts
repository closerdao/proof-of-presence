#!/usr/bin/env tsx
import hre from 'hardhat';
import {upgrades} from '@openzeppelin/hardhat-upgrades';

const upgradePairs = [
  ['VillageAccess', 'VillageAccessUpgradeMock'],
  ['CommunityToken', 'CommunityTokenUpgradeMock'],
  ['VillagePresenceToken', 'PresenceTokenUpgradeMock'],
  ['VillageSweatToken', 'SweatTokenUpgradeMock'],
  ['TokenizedStays', 'TokenizedStaysUpgradeMock'],
] as const;

async function main(): Promise<void> {
  const connection = await hre.network.create();
  try {
    const upgradesApi = await upgrades(hre, connection);
    for (const [currentName, nextName] of upgradePairs) {
      let stage = 'loading contract factories';
      try {
        const current = await connection.ethers.getContractFactory(currentName);
        const next = await connection.ethers.getContractFactory(nextName);
        stage = 'validating the current implementation';
        await upgradesApi.validateImplementation(current, {kind: 'uups'});
        stage = 'validating the upgrade pair';
        await upgradesApi.validateUpgrade(current, next, {kind: 'uups'});
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`Failed while ${stage} for ${currentName} -> ${nextName}: ${message}`, {cause: error});
      }
    }
    console.log(`Validated ${upgradePairs.length} UUPS implementation and storage-layout pairs.`);
  } finally {
    await connection.close();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
