#!/usr/bin/env tsx
import hre from 'hardhat';
import {upgrades} from '@openzeppelin/hardhat-upgrades';
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
    if (arg === '--manifest') args.manifest = argv[++i];
    else if (arg === '--contract') args.contract = argv[++i];
    else if (arg === '--implementation') args.implementation = argv[++i];
    else if (arg === '--version') args.version = argv[++i];
    else if (arg === '--network') args.network = argv[++i];
    else if (arg === '--call') args.call = argv[++i];
    else if (arg === '--call-args') args.callArgs = argv[++i];
    else if (arg === '--help' || arg === '-h') return args;
    else throw new Error(`Unknown argument '${arg}'`);
  }
  return args;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (!args.manifest || !args.contract || !args.implementation || !args.version) {
    console.log(`Usage: npm run upgrade:prepare -- --manifest <file> --contract <name>
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
