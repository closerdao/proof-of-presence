#!/usr/bin/env tsx
import path from 'node:path';
import {readVillageDeploymentManifest} from './deployment/village.js';
import {recordIgnitionVerification, verifyIgnitionDeployment} from './deployment/verification.js';

function manifestArgument(argv: string[]): string | undefined {
  const index = argv.indexOf('--manifest');
  if (index >= 0) return argv[index + 1];
  if (argv.includes('--help') || argv.includes('-h')) return undefined;
  const unknown = argv.filter((value, position) => position !== index + 1 && value !== '--submit');
  if (unknown.length > 0) throw new Error(`Unknown argument '${unknown[0]}'`);
  return undefined;
}

async function main(): Promise<void> {
  const argument = manifestArgument(process.argv.slice(2));
  if (!argument) {
    console.log('Usage: tsx scripts/verify-village.ts --manifest <manifest.json>');
    if (!process.argv.includes('--help') && !process.argv.includes('-h')) throw new Error('--manifest is required');
    return;
  }
  const manifestPath = path.resolve(argument);
  const manifest = await readVillageDeploymentManifest(manifestPath);
  const attempt = await verifyIgnitionDeployment(manifest.network, manifest.deploymentTool.deploymentId);
  await recordIgnitionVerification(manifestPath, attempt);
  console.log(`Ignition verification ${attempt.status} for ${manifest.deploymentTool.deploymentId}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
