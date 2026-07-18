import {mkdirSync} from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import process from 'node:process';

export const ACTIVE_CONTRACTS = [
  ['src/village/access/VillageAccess.sol', 'VillageAccess'],
  ['src/village/tokens/CommunityToken.sol', 'CommunityToken'],
  ['src/village/tokens/VillagePresenceToken.sol', 'VillagePresenceToken'],
  ['src/village/tokens/VillageSweatToken.sol', 'VillageSweatToken'],
  ['src/village/stays/TokenizedStays.sol', 'TokenizedStays'],
  ['src/profiles/tdf-v2/TDFTransferPolicy.sol', 'TDFTransferPolicy'],
];

export const SLITHER_SOURCE = process.env.SLITHER_SOURCE ?? 'git+https://github.com/crytic/slither.git@master';

export const SLITHER_BUILD_ARGS = [
  '--compile-force-framework',
  'solc',
  '--solc',
  process.env.SLITHER_SOLC ?? 'solc',
  '--solc-remaps',
  '@openzeppelin/=node_modules/@openzeppelin/',
  '--solc-args',
  '--optimize --optimize-runs 2000 --evm-version cancun',
];

export const SLITHER_COMPILE_ARGS = [...SLITHER_BUILD_ARGS, '--config-file', 'slither.config.json'];

export function ensureReportDirectory(name) {
  const directory = path.join('security-reports', name);
  mkdirSync(directory, {recursive: true});
  return directory;
}

export function reportSlug(source, suffix = '') {
  return `${source
    .replace(/^src\//, '')
    .replace(/\.sol$/, '')
    .replaceAll('/', '-')}${suffix}`;
}

export function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    stdio: options.capture ? 'pipe' : 'inherit',
    ...options,
  });

  if (result.error) throw result.error;
  return result;
}

export function slitherCommand(executable, args, refresh = false, options = {}, source = SLITHER_SOURCE) {
  const uvArgs = [];
  if (refresh) uvArgs.push('--refresh');
  uvArgs.push('--from', source, executable, ...args);
  return run('uvx', uvArgs, options);
}
