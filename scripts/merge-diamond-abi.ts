/**
 * Merges all diamond facet ABIs into a single TDFDiamond artifact.
 * Replaces the now-dead `hardhat-diamond-abi` plugin.
 *
 * Run after `hardhat compile`:
 *   npx tsx scripts/merge-diamond-abi.ts
 */
import fs from 'node:fs';
import path from 'node:path';

const FACETS_DIR = 'artifacts/src/diamond/facets';
const OUTPUT_DIR = 'generated';
const OUTPUT_FILE = path.join(OUTPUT_DIR, 'TDFDiamond.json');

interface AbiEntry {
  type: string;
  name?: string;
  inputs?: Array<{name: string; type: string; indexed?: boolean; components?: unknown[]}>;
  outputs?: Array<{name: string; type: string; components?: unknown[]}>;
  stateMutability?: string;
  anonymous?: boolean;
}

function signatureOf(entry: AbiEntry): string {
  const name = entry.name ?? '';
  const inputTypes = (entry.inputs ?? []).map((i) => i.type).join(',');
  return `${entry.type}:${name}(${inputTypes})`;
}

const facetDirs = fs.readdirSync(FACETS_DIR).filter((d) => d.endsWith('.sol'));
const seen = new Set<string>();
const mergedAbi: AbiEntry[] = [];

for (const dir of facetDirs) {
  const contractName = dir.replace('.sol', '');
  const artifactPath = path.join(FACETS_DIR, dir, `${contractName}.json`);
  if (!fs.existsSync(artifactPath)) continue;

  const artifact = JSON.parse(fs.readFileSync(artifactPath, 'utf-8'));
  for (const entry of artifact.abi as AbiEntry[]) {
    const sig = signatureOf(entry);
    if (!seen.has(sig)) {
      seen.add(sig);
      mergedAbi.push(entry);
    }
  }
}

const diamondArtifact = {
  _format: 'hh3-artifact-1',
  contractName: 'TDFDiamond',
  sourceName: 'src/diamond/TDFDiamond.sol',
  abi: mergedAbi,
  bytecode: '0x',
  deployedBytecode: '0x',
  linkReferences: {},
  deployedLinkReferences: {},
};

fs.writeFileSync(OUTPUT_FILE, JSON.stringify(diamondArtifact, null, 2));
console.log(`Merged ${facetDirs.length} facet ABIs into ${OUTPUT_FILE} (${mergedAbi.length} entries)`);
