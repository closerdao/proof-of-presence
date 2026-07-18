#!/usr/bin/env node
import {existsSync} from 'node:fs';
import {homedir} from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import console from 'node:console';
import process from 'node:process';

const targets = [
  'src/village/access/VillageAccess.sol',
  'src/village/tokens/CommunityToken.sol',
  'src/village/tokens/VillagePresenceToken.sol',
  'src/village/tokens/VillageSweatToken.sol',
  'src/village/stays/TokenizedStays.sol',
  'src/profiles/tdf-v2/TDFTransferPolicy.sol',
];

const uvSolc = path.join(homedir(), '.local/share/uv/tools/slither-analyzer/bin/solc');
const solc = process.env.SLITHER_SOLC || (existsSync(uvSolc) ? uvSolc : 'solc');
const commonArgs = [
  '--compile-force-framework',
  'solc',
  '--solc',
  solc,
  '--solc-remaps',
  '@openzeppelin/=node_modules/@openzeppelin/',
  '--solc-args',
  '--optimize --optimize-runs 2000 --evm-version cancun',
  '--config-file',
  'slither.config.json',
  '--fail-none',
];

for (const target of targets) {
  console.log(`\n=== Slither: ${target} ===`);
  const result = spawnSync('slither', [target, ...commonArgs], {stdio: 'inherit'});
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
