import type {ContractFuture, IgnitionModuleBuilder, ArgumentType} from '@nomicfoundation/ignition-core';

/**
 * Builds the supported UUPS deployment shape.
 *
 * OpenZeppelin validation deliberately lives in the supported TypeScript
 * wrappers because an Ignition Module is a synchronous deployment graph. The
 * wrapper must validate the implementation before this graph is submitted.
 */
export function deployVillageUupsProxy<ContractName extends string>(
  m: IgnitionModuleBuilder,
  contractName: ContractName,
  initializerArgs: ArgumentType[],
): {
  implementation: ContractFuture<ContractName>;
  proxy: ContractFuture<'VillageUUPSProxy'>;
  instance: ContractFuture<ContractName>;
} {
  const implementation = m.contract(contractName, [], {
    id: `${contractName}Implementation`,
  });
  const initializerData = m.encodeFunctionCall(implementation, 'initialize', initializerArgs, {
    id: `${contractName}InitializerData`,
  });
  const proxy = m.contract('VillageUUPSProxy', [implementation, initializerData], {
    id: `${contractName}Proxy`,
  });
  const instance = m.contractAt(contractName, proxy, {
    id: `${contractName}Instance`,
  });

  return {implementation, proxy, instance};
}
