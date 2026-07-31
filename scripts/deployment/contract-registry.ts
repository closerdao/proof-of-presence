/**
 * Canonical deployment metadata.
 *
 * Object insertion order is the canonical deployment/manifest order. Dependencies are
 * resolved by the config parser, while Ignition keeps the concrete graph explicit.
 */
export const CONTRACT_REGISTRY = {
  TDFTransferPolicy: {
    kind: 'plain',
    dependencies: [],
  },
  VillageAccess: {
    kind: 'uups',
    dependencies: [],
    authority: 'default-admin',
    upgradeTestImplementation: 'VillageAccessUpgradeMock',
  },
  CommunityToken: {
    kind: 'uups',
    dependencies: ['VillageAccess'],
    authority: 'ownable',
    upgradeTestImplementation: 'CommunityTokenUpgradeMock',
  },
  VillagePresenceToken: {
    kind: 'uups',
    dependencies: ['VillageAccess'],
    authority: 'ownable',
    upgradeTestImplementation: 'PresenceTokenUpgradeMock',
  },
  VillageSweatToken: {
    kind: 'uups',
    dependencies: ['VillageAccess'],
    authority: 'ownable',
    upgradeTestImplementation: 'SweatTokenUpgradeMock',
  },
  TokenizedStays: {
    kind: 'uups',
    dependencies: ['VillageAccess', 'CommunityToken'],
    authority: 'ownable',
    upgradeTestImplementation: 'TokenizedStaysUpgradeMock',
  },
  VillageCitizenNFT: {
    kind: 'uups',
    dependencies: ['VillageAccess'],
    authority: 'ownable',
    upgradeTestImplementation: 'VillageCitizenNFTUpgradeMock',
  },
  DynamicPriceSale: {
    kind: 'uups',
    dependencies: ['VillageAccess', 'CommunityToken'],
    authority: 'ownable',
    upgradeTestImplementation: 'DynamicPriceSaleUpgradeMock',
  },
} as const;

export type ContractName = keyof typeof CONTRACT_REGISTRY;
export type ContractMetadata = (typeof CONTRACT_REGISTRY)[ContractName];
export type UupsContractMetadata = Extract<ContractMetadata, {kind: 'uups'}>;
export type UupsContractName = {
  [Name in ContractName]: (typeof CONTRACT_REGISTRY)[Name]['kind'] extends 'uups' ? Name : never;
}[ContractName];

export const CONTRACT_NAMES = Object.keys(CONTRACT_REGISTRY) as [ContractName, ...ContractName[]];
export const UUPS_CONTRACT_NAMES = CONTRACT_NAMES.filter(
  (name): name is UupsContractName => CONTRACT_REGISTRY[name].kind === 'uups',
);

export function contractMetadata(name: ContractName): ContractMetadata {
  return CONTRACT_REGISTRY[name];
}

export function uupsContractMetadata(name: UupsContractName): UupsContractMetadata {
  return CONTRACT_REGISTRY[name] as UupsContractMetadata;
}
