#!/usr/bin/env tsx
import hre from 'hardhat';
import {requiredValue} from './deployment/cli-args.js';
import {ownerStatusCommand} from './deployment/commands/owner-status.js';

interface Args {
  manifest?: string;
  network?: string;
  txServiceUrl?: string;
}

function parseArgs(argv: string[]): Args {
  const args: Args = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--manifest') args.manifest = requiredValue(argv, ++i, arg);
    else if (arg === '--network') args.network = requiredValue(argv, ++i, arg);
    else if (arg === '--tx-service-url') args.txServiceUrl = requiredValue(argv, ++i, arg);
    else if (arg === '--help' || arg === '-h') return args;
    else throw new Error(`Unknown argument '${arg}'`);
  }
  return args;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (!args.manifest || !args.network) {
    console.log('Usage: yarn owner:status -- --manifest <manifest.json> --network <network>');
    if (!process.argv.includes('--help') && !process.argv.includes('-h'))
      throw new Error('--manifest and --network are required');
    return;
  }

  const connection = await hre.network.create(args.network);
  try {
    await ownerStatusCommand(
      {
        manifestPath: args.manifest,
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
