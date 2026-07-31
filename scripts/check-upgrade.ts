#!/usr/bin/env tsx
import hre from 'hardhat';
import {requiredValue} from './deployment/cli-args.js';
import {upgradeStatusCommand} from './deployment/commands/upgrade-status.js';
import {readVillageDeploymentManifest} from './deployment/village.js';

interface Args {
  manifest?: string;
  upgrade?: string;
  network?: string;
  txServiceUrl?: string;
}

function parseArgs(argv: string[]): Args {
  const args: Args = {};
  for (let index = 0; index < argv.length; index++) {
    const argument = argv[index];
    if (argument === '--manifest') args.manifest = requiredValue(argv, ++index, argument);
    else if (argument === '--upgrade') args.upgrade = requiredValue(argv, ++index, argument);
    else if (argument === '--network') args.network = requiredValue(argv, ++index, argument);
    else if (argument === '--tx-service-url') args.txServiceUrl = requiredValue(argv, ++index, argument);
    else if (argument === '--help' || argument === '-h') return args;
    else throw new Error(`Unknown argument '${argument}'`);
  }
  return args;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (!args.manifest || !args.upgrade) {
    console.log(
      'Usage: yarn upgrade:status -- --manifest <manifest.json> --upgrade <contract:version> [--network <network>]',
    );
    if (!process.argv.includes('--help') && !process.argv.includes('-h')) {
      throw new Error('--manifest and --upgrade are required');
    }
    return;
  }
  const manifest = await readVillageDeploymentManifest(args.manifest);
  const networkName = args.network ?? manifest.network;
  const connection = await hre.network.create(networkName);
  try {
    await upgradeStatusCommand(
      {
        manifestPath: args.manifest,
        upgrade: args.upgrade,
        apiKey: process.env.SAFE_API_KEY,
        txServiceUrl: args.txServiceUrl ?? process.env.SAFE_TX_SERVICE_URL,
      },
      {ethers: connection.ethers, networkName: connection.networkName},
    );
  } finally {
    await connection.close();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
