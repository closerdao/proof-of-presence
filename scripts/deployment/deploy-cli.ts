import {readFile} from 'node:fs/promises';
import path from 'node:path';
import hre from 'hardhat';
import {upgrades} from '@openzeppelin/hardhat-upgrades';
import {requiredValue} from './cli-args.js';
import {deployVillage} from './village.js';
import {
  dependencyAdditions,
  parseTdfDeploymentConfig,
  parseVillageDeploymentConfig,
  type DeploymentPreset,
} from './spec.js';

interface Args {
  config?: string;
  network?: string;
  outputRoot?: string;
  help: boolean;
}

export async function runDeploymentCli(preset?: DeploymentPreset): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || !args.config) {
    printHelp(preset);
    if (!args.help) throw new Error('--config is required');
    return;
  }

  const raw = JSON.parse(await readFile(args.config, 'utf8'));
  const spec = preset === 'tdf' ? parseTdfDeploymentConfig(raw) : parseVillageDeploymentConfig(raw);
  console.log(`Requested contracts: ${spec.requestedContracts.join(', ')}`);
  const additions = dependencyAdditions(spec);
  console.log(`Auto-added dependencies: ${additions.length > 0 ? additions.join(', ') : 'none'}`);
  console.log(`Resolved contracts: ${spec.contracts.join(', ')}`);

  const connection = args.network ? await hre.network.create(args.network) : await hre.network.create();
  try {
    const result = await deployVillage(spec, {
      ethers: connection.ethers,
      upgrades: await upgrades(hre, connection),
      ignition: connection.ignition,
      displayIgnitionUi: true,
      networkName: connection.networkName,
      outputRoot: path.resolve(args.outputRoot ?? process.cwd()),
    });
    console.log(`Deployment manifest: ${result.manifestPath}`);
    console.log(`Ignition deployment: ${result.manifest.graph.deploymentId}`);
    if (result.manifest.pendingOwnerActions.length > 0) {
      console.log('Ownership acceptance remains pending; use owner:submit and owner:status with this manifest.');
    }
    if (!['default', 'localhost'].includes(connection.networkName)) {
      console.log(
        `Verify explicitly: yarn hardhat --network ${connection.networkName} ignition verify ` +
          result.manifest.graph.deploymentId,
      );
    }
  } finally {
    await connection.close();
  }
}

function parseArgs(argv: string[]): Args {
  const args: Args = {help: false};
  for (let index = 0; index < argv.length; index++) {
    const argument = argv[index];
    if (argument === '--config') args.config = requiredValue(argv, ++index, argument);
    else if (argument === '--network') args.network = requiredValue(argv, ++index, argument);
    else if (argument === '--output-root') args.outputRoot = requiredValue(argv, ++index, argument);
    else if (argument === '--help' || argument === '-h') args.help = true;
    else throw new Error(`Unknown argument '${argument}'`);
  }
  return args;
}

function printHelp(preset?: DeploymentPreset): void {
  const command = preset === 'tdf' ? 'deploy:tdf' : 'deploy:village';
  console.log(`Usage: yarn ${command} -- --config <config.json> [--network <network>] [--output-root <path>]`);
}
