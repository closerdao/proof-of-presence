#!/usr/bin/env tsx
import {exportVillageCommand} from './deployment/commands/export-village.js';

interface Args {
  manifest?: string;
  out?: string;
}

function parseArgs(argv: string[]): Args {
  const args: Args = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--manifest') args.manifest = argv[++i];
    else if (arg === '--out') args.out = argv[++i];
    else if (arg === '--help' || arg === '-h') {
      printHelp();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument '${arg}'`);
    }
  }
  return args;
}

function printHelp(): void {
  console.log(`Usage:
  tsx scripts/export-village.ts --manifest deployments/villages/<chainId>/<slug>.json [--out export/villages/<chainId>/<slug>.json]

The export is a derived ABI/address artifact. The deployment manifest remains the source of truth.`);
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (!args.manifest) {
    printHelp();
    throw new Error('--manifest is required');
  }

  const exportPath = await exportVillageCommand({manifestPath: args.manifest, outPath: args.out});
  console.log(`Village export written to ${exportPath}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
