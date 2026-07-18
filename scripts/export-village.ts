#!/usr/bin/env tsx
import {mkdir, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {readVillageDeploymentManifest} from './deployment/village.js';

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

  const manifestPath = path.resolve(args.manifest);
  const manifest = await readVillageDeploymentManifest(manifestPath);
  const outPath =
    args.out ??
    path.join(
      process.cwd(),
      'export',
      manifest.generation === 'profile' ? 'profiles' : 'villages',
      manifest.generation === 'profile' ? manifest.deploymentProfile : '',
      String(manifest.chainId),
      `${manifest.villageSlug}.json`,
    );
  const exportPath = path.resolve(outPath);
  // Downstream consumers need stable addresses and ABIs, not deployment journals, owner actions, or code provenance.
  const contracts = Object.fromEntries(
    Object.entries(manifest.contracts).map(([name, contract]) => [
      name,
      {
        address: contract.address,
        deploymentName: contract.deploymentName,
        implementationAddress: contract.implementationAddress,
        abi: contract.abi,
      },
    ]),
  );

  await mkdir(path.dirname(exportPath), {recursive: true});
  await writeFile(
    exportPath,
    `${JSON.stringify(
      {
        schemaVersion: 1,
        sourceManifest: path.relative(process.cwd(), manifestPath),
        generation: manifest.generation,
        deploymentProfile: manifest.deploymentProfile,
        villageSlug: manifest.villageSlug,
        chainId: manifest.chainId,
        network: manifest.network,
        contracts,
        productAliases: manifest.productAliases ?? {},
      },
      null,
      2,
    )}\n`,
  );
  console.log(`Village export written to ${exportPath}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
