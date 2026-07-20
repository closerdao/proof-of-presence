#!/usr/bin/env tsx
import {readFile} from 'node:fs/promises';
import hre from 'hardhat';
import {upgrades} from '@openzeppelin/hardhat-upgrades';
import {parseVillageDeploymentConfig} from './deployment/config.js';
import {deployVillage, type DeploymentProfile, type VillageDeploymentConfig} from './deployment/village.js';
import {attemptAutomaticVerification} from './deployment/verification.js';

interface Args {
  config?: string;
  network?: string;
  outputRoot?: string;
  profile?: DeploymentProfile;
}

function parseArgs(argv: string[]): Args {
  const args: Args = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--config') args.config = argv[++i];
    else if (arg === '--network') args.network = argv[++i];
    else if (arg === '--output-root') args.outputRoot = argv[++i];
    else if (arg === '--profile') args.profile = argv[++i] as DeploymentProfile;
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
  tsx scripts/deploy-village.ts --config path/to/config.json [--network <network>] [--profile tdf]
    [--output-root <path>]

The config must include villageSlug, chainId, deploymentProfile, ownership, modules, and apiOperator.
The script rejects configs whose deploymentProfile does not match
the optional --profile guard.`);
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (!args.config) {
    printHelp();
    throw new Error('--config is required');
  }

  const config: VillageDeploymentConfig = parseVillageDeploymentConfig(JSON.parse(await readFile(args.config, 'utf8')));
  if (args.profile && config.deploymentProfile !== args.profile) {
    throw new Error(
      `Config deploymentProfile '${config.deploymentProfile}' does not match --profile '${args.profile}'`,
    );
  }

  // Future hardening: optionally run this exact validated config against a Tenderly fork before
  // opening the real network connection. It is intentionally not part of the current release flow.
  const connection = args.network ? await hre.network.create(args.network) : await hre.network.create();
  try {
    const upgradesApi = await upgrades(hre, connection);
    const result = await deployVillage(config, {
      ethers: connection.ethers,
      upgrades: upgradesApi,
      ignition: connection.ignition,
      displayIgnitionUi: true,
      safeProvider: connection.provider,
      networkName: connection.networkName,
      outputRoot: args.outputRoot,
    });
    console.log(`Village deployment manifest written to ${result.manifestPath}`);
    console.log(`Deployment status: ${result.manifest.status}`);
    if (result.manifest.manualActions.length > 0) {
      console.log('Manual ownership acceptance actions (deployment is already complete):');
      console.table(
        result.manifest.manualActions.map(({contractName, to, functionName, recipient, acceptAfter}) => ({
          contract: contractName,
          to,
          function: functionName,
          recipient,
          acceptAfter: acceptAfter ?? 'now',
        })),
      );
    }
    const verification = await attemptAutomaticVerification(result.manifestPath, result.manifest);
    console.log(`Ignition verification: ${verification.status}`);
  } finally {
    await connection.close();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
