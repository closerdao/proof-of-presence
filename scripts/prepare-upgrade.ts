#!/usr/bin/env tsx
import hre from 'hardhat';
import {upgrades} from '@openzeppelin/hardhat-upgrades';
import {requiredValue} from './deployment/cli-args.js';
import {prepareUpgradeCommand} from './deployment/commands/prepare-upgrade.js';
import {readVillageDeploymentManifest} from './deployment/village.js';

interface Args {
  manifest?: string;
  contract?: string;
  implementation?: string;
  version?: string;
  network?: string;
  call?: string;
  callArgs?: string;
}

function parseArgs(argv: string[]): Args {
  const args: Args = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--manifest') args.manifest = requiredValue(argv, ++i, arg);
    else if (arg === '--contract') args.contract = requiredValue(argv, ++i, arg);
    else if (arg === '--implementation') args.implementation = requiredValue(argv, ++i, arg);
    else if (arg === '--version') args.version = requiredValue(argv, ++i, arg);
    else if (arg === '--network') args.network = requiredValue(argv, ++i, arg);
    else if (arg === '--call') args.call = requiredValue(argv, ++i, arg);
    else if (arg === '--call-args') args.callArgs = requiredValue(argv, ++i, arg);
    else if (arg === '--help' || arg === '-h') return args;
    else throw new Error(`Unknown argument '${arg}'`);
  }
  return args;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (!args.manifest || !args.contract || !args.implementation || !args.version) {
    console.log(`Usage: yarn upgrade:prepare -- --manifest <file> --contract <name>
  --implementation <artifact> --version <version> [--network <network>]
  [--call <function>] [--call-args '<json-array>']`);
    if (!process.argv.includes('--help') && !process.argv.includes('-h')) {
      throw new Error('--manifest, --contract, --implementation, and --version are required');
    }
    return;
  }

  const manifest = await readVillageDeploymentManifest(args.manifest);
  const networkName = args.network ?? manifest.network;
  if (networkName !== manifest.network) throw new Error(`Network '${networkName}' does not match manifest`);
  const connection = await hre.network.create(networkName);
  try {
    await prepareUpgradeCommand(
      {
        manifestPath: args.manifest,
        contractName: args.contract,
        implementation: args.implementation,
        version: args.version,
        call: args.call,
        callArgs: args.callArgs,
      },
      {
        ethers: connection.ethers,
        upgrades: await upgrades(hre, connection),
        ignition: connection.ignition,
        provider: connection.provider,
        networkName: connection.networkName,
      },
    );
  } finally {
    await connection.close();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
