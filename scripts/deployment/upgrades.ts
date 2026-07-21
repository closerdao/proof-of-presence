import {getAddress, keccak256} from 'ethers';
import type {ManifestContract, ManifestUpgrade} from './village.js';

export const ERC1967_IMPLEMENTATION_SLOT = '0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc';

interface UpgradeProvider {
  getStorage(address: string, slot: string): Promise<string>;
  getCode(address: string): Promise<string>;
}

export interface UpgradeReconciliationResult {
  liveImplementation: string;
  executed: boolean;
}

/**
 * Reconciles a prepared upgrade exclusively from the proxy slot and deployed bytecode.
 * Transaction receipts and Safe service state are informational and cannot mark execution.
 * Manifest state is updated only after the proxy points to the prepared implementation and its code matches the recorded hash.
 */
export async function reconcileExecutedUpgrade(
  contracts: Record<string, ManifestContract>,
  upgrade: ManifestUpgrade,
  provider: UpgradeProvider,
): Promise<UpgradeReconciliationResult> {
  const record = contracts[upgrade.contractName];
  if (!record?.implementationAddress) {
    throw new Error(`Manifest has no UUPS deployment for ${upgrade.contractName}`);
  }

  const raw = await provider.getStorage(record.address, ERC1967_IMPLEMENTATION_SLOT);
  const liveImplementation = getAddress(`0x${raw.slice(-40)}`);
  const previousImplementation = getAddress(upgrade.previousImplementation);
  const expectedImplementation = getAddress(upgrade.newImplementation);

  // The slot may still contain the previous implementation, contain the prepared one, or reveal an untracked upgrade.
  if (liveImplementation === previousImplementation) {
    if (upgrade.status === 'executed') {
      throw new Error(
        `${upgrade.contractName} upgrade is recorded as executed but the proxy still uses ${liveImplementation}`,
      );
    }
    return {liveImplementation, executed: false};
  }
  if (liveImplementation !== expectedImplementation) {
    throw new Error(
      `${upgrade.contractName} live implementation ${liveImplementation} is neither the prepared implementation ` +
        `${expectedImplementation} nor the previous implementation ${previousImplementation}`,
    );
  }

  const implementationCode = await provider.getCode(liveImplementation);
  if (implementationCode === '0x') {
    throw new Error(`${upgrade.contractName} implementation ${liveImplementation} has no runtime code`);
  }
  const implementationCodeHash = keccak256(implementationCode);
  if (implementationCodeHash !== upgrade.implementationCodeHash) {
    throw new Error(
      `${upgrade.contractName} implementation code hash ${implementationCodeHash} does not match prepared hash ` +
        upgrade.implementationCodeHash,
    );
  }

  upgrade.status = 'executed';
  record.implementationAddress = liveImplementation;
  record.implementationRuntimeCodeHash = implementationCodeHash;
  return {liveImplementation, executed: true};
}
