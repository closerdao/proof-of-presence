import {mkdir, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {readVillageDeploymentManifest} from '../village.js';

export interface ExportVillageOptions {
  manifestPath: string;
  outPath?: string;
  cwd?: string;
}

export async function exportVillageCommand(options: ExportVillageOptions): Promise<string> {
  const cwd = options.cwd ?? process.cwd();
  const manifestPath = path.resolve(cwd, options.manifestPath);
  const manifest = await readVillageDeploymentManifest(manifestPath);
  const outPath =
    options.outPath ??
    path.join(
      cwd,
      'export',
      manifest.deploymentKind === 'profile' ? 'profiles' : 'villages',
      manifest.deploymentKind === 'profile' ? manifest.deploymentProfile : '',
      String(manifest.chainId),
      `${manifest.villageSlug}.json`,
    );
  const exportPath = path.resolve(cwd, outPath);
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
        schemaVersion: 3,
        sourceManifest: path.relative(cwd, manifestPath),
        deploymentKind: manifest.deploymentKind,
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
  return exportPath;
}
