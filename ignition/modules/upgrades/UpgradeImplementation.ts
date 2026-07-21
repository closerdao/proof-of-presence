import {buildModule} from '@nomicfoundation/hardhat-ignition/modules';
import type {IgnitionModule} from '@nomicfoundation/ignition-core';

function stableId(value: string): string {
  return value.replace(/[^a-zA-Z0-9_]/g, '_');
}

/**
 * Builds a stable Ignition Module that deploys only a proposed implementation.
 * The proxy upgrade itself is a final-owner/Safe action and is never sent by
 * the Closer deployer.
 */
export function buildUpgradeImplementationModule(
  contractName: string,
  nextArtifact: string,
  version: string,
): IgnitionModule {
  const moduleId = `Upgrade_${stableId(contractName)}_${stableId(version)}_Module`;
  return buildModule(moduleId, (m) => {
    const implementation = m.contract(nextArtifact, [], {
      id: `${stableId(contractName)}_${stableId(version)}_Implementation`,
    });
    return {implementation};
  });
}
