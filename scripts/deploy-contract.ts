#!/usr/bin/env tsx
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import hre from 'hardhat';
import {upgrades} from '@openzeppelin/hardhat-upgrades';
import {parseVillageDeploymentConfig} from './deployment/config.js';
import {deployVillage, type VillageDeploymentConfig} from './deployment/village.js';
import {attemptAutomaticVerification} from './deployment/verification.js';

const CONTRACT_MODULES = {
  VillageAccess: [],
  CommunityToken: ['communityToken'],
  VillagePresenceToken: ['presenceToken'],
  VillageSweatToken: ['sweatToken'],
  TokenizedStays: ['communityToken', 'tokenizedStays'],
  TDFTransferPolicy: ['tdfTransferPolicy'],
} as const satisfies Record<string, readonly string[]>;

type ContractModuleName = keyof typeof CONTRACT_MODULES;

interface Args {
  contract?: ContractModuleName;
  config?: string;
  network?: string;
  outputRoot?: string;
}

function parseArgs(argv: string[]): Args {
  const args: Args = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--contract') args.contract = argv[++i] as ContractModuleName;
    else if (arg === '--config') args.config = argv[++i];
    else if (arg === '--network') args.network = argv[++i];
    else if (arg === '--output-root') args.outputRoot = argv[++i];
    else if (arg === '--help' || arg === '-h') {
      printHelp();
      process.exit(0);
    } else throw new Error(`Unknown argument '${arg}'`);
  }
  return args;
}

function printHelp(): void {
  console.log(`Usage:
  tsx scripts/deploy-contract.ts --contract <name> --config path/to/config.json [--network <network>]
    [--output-root <path>]

Supported names: ${Object.keys(CONTRACT_MODULES).join(', ')}.
The selected contract is deployed through the same Ignition Module used by village profiles. Required dependency
Modules are included automatically (for example TokenizedStays includes CommunityToken and VillageAccess).`);
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (!args.contract || !args.config) {
    printHelp();
    throw new Error('--contract and --config are required');
  }
  if (!(args.contract in CONTRACT_MODULES)) throw new Error(`Unsupported V2 contract Module '${args.contract}'`);

  const parsed = parseVillageDeploymentConfig(JSON.parse(await readFile(args.config, 'utf8')));
  const config: VillageDeploymentConfig = {
    ...parsed,
    deploymentProfile: 'minimal-village',
    modules: [...CONTRACT_MODULES[args.contract]],
  };
  const connection = args.network ? await hre.network.create(args.network) : await hre.network.create();
  try {
    const upgradesApi = await upgrades(hre, connection);
    const contractSlug = args.contract.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();
    const outputRoot = path.resolve(args.outputRoot ?? process.cwd());
    const result = await deployVillage(config, {
      ethers: connection.ethers,
      upgrades: upgradesApi,
      ignition: connection.ignition,
      displayIgnitionUi: true,
      safeProvider: connection.provider,
      networkName: connection.networkName,
      outputRoot,
      deploymentIdOverride: `contract-${config.chainId}-${config.villageSlug}-${contractSlug}`,
      manifestPathOverride: path.join(
        outputRoot,
        'deployments',
        'contracts',
        String(config.chainId),
        config.villageSlug,
        `${contractSlug}.json`,
      ),
    });
    console.log(`Contract Module '${args.contract}' deployed through ${result.manifest.deploymentTool.deploymentId}`);
    console.log(`Deployment manifest written to ${result.manifestPath}`);
    if (result.manifest.manualActions.length > 0) {
      console.log('Manual ownership acceptance actions are recorded in the manifest.');
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
