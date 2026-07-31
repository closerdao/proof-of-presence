import {getAddress, id, keccak256, zeroPadValue} from 'ethers';
import type {LogReference, ManifestContract, ManifestUpgrade} from './village.js';

export const ERC1967_IMPLEMENTATION_SLOT = '0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc';

interface UpgradeProvider {
  getStorage(address: string, slot: string): Promise<string>;
  getCode(address: string): Promise<string>;
  getLogs(filter: {address: string; fromBlock: bigint; topics: [string, string]}): Promise<
    Array<{
      blockNumber: number;
      blockHash: string;
      transactionHash: string;
      transactionIndex: number;
      index?: number;
      logIndex?: number;
    }>
  >;
}

export interface UpgradeReconciliationResult {
  liveImplementation: string;
  executed: boolean;
}

/**
 * Reconciles a prepared upgrade exclusively from the proxy slot and deployed bytecode.
 * Transaction receipts and Safe service state are informational and cannot mark execution.
 * Manifest state is updated only after the proxy points to the prepared implementation and its code matches the recorded hash.
 * This proves which implementation is active; migration-specific state must be checked separately by the release runbook.
 */
export async function reconcileExecutedUpgrade(
  contracts: Record<string, ManifestContract>,
  upgrade: ManifestUpgrade,
  provider: UpgradeProvider,
): Promise<UpgradeReconciliationResult> {
  if (upgrade.status !== 'prepared' && upgrade.status !== 'executed') {
    throw new Error(`${upgrade.contractName} upgrade has unsupported status '${String(upgrade.status)}'`);
  }
  const record = contracts[upgrade.contractName];
  if (!record?.implementation) {
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

  if (upgrade.status === 'prepared') {
    const executedAt = await findUpgradeEvent(record.address, expectedImplementation, upgrade, provider);
    record.artifact = upgrade.nextArtifact;
    record.implementation = {address: liveImplementation, runtimeCodeHash: implementationCodeHash};
    upgrade.executedAt = executedAt;
    upgrade.status = 'executed';
  } else if (getAddress(record.implementation.address) !== expectedImplementation) {
    throw new Error(`${upgrade.contractName} executed upgrade is not the manifest's active implementation`);
  }
  return {liveImplementation, executed: true};
}

async function findUpgradeEvent(
  proxyAddress: string,
  implementationAddress: string,
  upgrade: ManifestUpgrade,
  provider: UpgradeProvider,
): Promise<LogReference> {
  if (upgrade.executedAt) return upgrade.executedAt;
  const logs = await provider.getLogs({
    address: proxyAddress,
    fromBlock: BigInt(upgrade.preparedAtBlock.blockNumber),
    topics: [id('Upgraded(address)'), zeroPadValue(implementationAddress, 32)],
  });
  if (logs.length !== 1) {
    throw new Error(
      `Expected one Upgraded event for ${upgrade.contractName} implementation ${implementationAddress}, found ${logs.length}`,
    );
  }
  const [log] = logs;
  const logIndex = log.index ?? log.logIndex;
  if (logIndex === undefined) throw new Error('Upgrade event has no log index');
  return {
    transactionHash: log.transactionHash,
    blockNumber: String(log.blockNumber),
    blockHash: log.blockHash,
    transactionIndex: log.transactionIndex,
    logIndex,
  };
}
