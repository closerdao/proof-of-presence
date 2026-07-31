#!/usr/bin/env tsx
import hre from 'hardhat';
import {requiredValue} from './deployment/cli-args.js';
import {ownerSubmitCommand} from './deployment/commands/owner-submit.js';

interface Args {
  manifest?: string;
  network?: string;
  txServiceUrl?: string;
  origin?: string;
}

function parseArgs(argv: string[]): Args {
  const args: Args = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--manifest') args.manifest = requiredValue(argv, ++i, arg);
    else if (arg === '--network') args.network = requiredValue(argv, ++i, arg);
    else if (arg === '--tx-service-url') args.txServiceUrl = requiredValue(argv, ++i, arg);
    else if (arg === '--origin') args.origin = requiredValue(argv, ++i, arg);
    else if (arg === '--help' || arg === '-h') return args;
    else throw new Error(`Unknown argument '${arg}'`);
  }
  return args;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (!args.manifest || !args.network) {
    console.log('Usage: yarn owner:submit -- --manifest <manifest.json> --network <network>');
    if (!process.argv.includes('--help') && !process.argv.includes('-h'))
      throw new Error('--manifest and --network are required');
    return;
  }

  const connection = await hre.network.create(args.network);
  try {
    const safeOptions = process.env.SAFE_PROPOSER_PRIVATE_KEY
      ? {
          provider: connection.provider,
          signer: process.env.SAFE_PROPOSER_PRIVATE_KEY,
          apiKey: process.env.SAFE_API_KEY,
          txServiceUrl: args.txServiceUrl ?? process.env.SAFE_TX_SERVICE_URL,
          origin: args.origin ?? 'Closer village owner action',
        }
      : undefined;
    await ownerSubmitCommand(
      {manifestPath: args.manifest, safeOptions},
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
