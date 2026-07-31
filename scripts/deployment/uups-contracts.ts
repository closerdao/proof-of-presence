import {getAddress} from 'ethers';
import {
  CONTRACT_REGISTRY,
  type ContractName,
  type UupsContractName,
  uupsContractMetadata,
} from './contract-registry.js';

/**
 * Canonical registry for contracts supported by the repository's UUPS deployment and upgrade workflows.
 *
 * The authority kind is part of the capability: upgrade commands must know how to discover and simulate calls from
 * the live upgrade authority. A future UUPS contract with different authority semantics must add an explicit adapter
 * here rather than silently falling through to Ownable behavior.
 */
export {UUPS_CONTRACT_NAMES, type UupsContractName} from './contract-registry.js';

export interface UpgradeAuthority {
  current: string;
  pending: string;
}

export function isSupportedUupsContract(contractName: string): contractName is UupsContractName {
  return (
    Object.hasOwn(CONTRACT_REGISTRY, contractName) && CONTRACT_REGISTRY[contractName as ContractName].kind === 'uups'
  );
}

/** Reads the current and pending authority through the registered authority adapter. */
export async function readUpgradeAuthority(
  contractName: string,
  address: string,
  ethers: any,
): Promise<UpgradeAuthority> {
  if (!isSupportedUupsContract(contractName)) {
    throw new Error(`'${contractName}' is not a supported UUPS contract`);
  }

  if (uupsContractMetadata(contractName).authority === 'default-admin') {
    const access = await ethers.getContractAt(
      [
        'function defaultAdmin() view returns (address)',
        'function pendingDefaultAdmin() view returns (address,uint48)',
      ],
      address,
    );
    const [pending] = await access.pendingDefaultAdmin();
    return {current: getAddress(await access.defaultAdmin()), pending: getAddress(pending)};
  }

  const ownable = await ethers.getContractAt(
    ['function owner() view returns (address)', 'function pendingOwner() view returns (address)'],
    address,
  );
  return {current: getAddress(await ownable.owner()), pending: getAddress(await ownable.pendingOwner())};
}
