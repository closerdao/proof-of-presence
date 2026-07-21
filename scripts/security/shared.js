import {existsSync, mkdirSync, realpathSync} from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import process from 'node:process';

export const ACTIVE_CONTRACTS = [
  ['src/village/access/VillageAccess.sol', 'VillageAccess'],
  ['src/village/tokens/CommunityToken.sol', 'CommunityToken'],
  ['src/village/tokens/VillagePresenceToken.sol', 'VillagePresenceToken'],
  ['src/village/tokens/VillageSweatToken.sol', 'VillageSweatToken'],
  ['src/village/stays/TokenizedStays.sol', 'TokenizedStays'],
  ['src/profiles/tdf/TDFTransferPolicy.sol', 'TDFTransferPolicy'],
];

export const SLITHER_SOURCE = process.env.SLITHER_SOURCE ?? 'git+https://github.com/crytic/slither.git@master';

const SOLC_VERSION = '0.8.35';
const SOLC_BUILD_PATTERN = /Version: 0\.8\.35\+commit\.47b9dedd/;

function executableOnPath(name) {
  if (path.isAbsolute(name) || name.includes(path.sep)) return existsSync(name) ? name : undefined;

  const executableName = process.platform === 'win32' ? `${name}.exe` : name;
  return process.env.PATH.split(path.delimiter)
    .map((directory) => path.join(directory, executableName))
    .find(existsSync);
}

export function resolveSlitherSolc() {
  let source = 'SLITHER_SOLC';
  let configuredSolc = process.env.SLITHER_SOLC;

  if (!configuredSolc) {
    source = 'the Mise-pinned compiler';
    const miseSolc = run('mise', ['which', 'solc'], {capture: true});
    const output = `${miseSolc.stdout ?? ''}${miseSolc.stderr ?? ''}`;
    if (miseSolc.status !== 0 || !miseSolc.stdout.trim()) {
      throw new Error(`Mise could not resolve pinned solc ${SOLC_VERSION}. Run \`mise install\`.\n${output}`);
    }
    configuredSolc = miseSolc.stdout.trim();
  }

  const resolvedSolc = executableOnPath(configuredSolc);
  if (!resolvedSolc) throw new Error(`Could not resolve ${source} executable: ${configuredSolc}`);
  const executable = realpathSync(resolvedSolc);
  const version = run(executable, ['--version'], {capture: true});
  const output = `${version.stdout ?? ''}${version.stderr ?? ''}`;
  if (version.status !== 0 || !SOLC_BUILD_PATTERN.test(output)) {
    throw new Error(`Expected ${source} to be solc 0.8.35+commit.47b9dedd, received:\n${output}`);
  }

  return executable;
}

export function slitherBuildArgs() {
  return [
    '--compile-force-framework',
    'solc',
    '--solc',
    resolveSlitherSolc(),
    '--solc-remaps',
    '@openzeppelin/=node_modules/@openzeppelin/',
    '--solc-args',
    '--optimize --optimize-runs 2000 --evm-version cancun',
  ];
}

export function slitherCompileArgs() {
  return [...slitherBuildArgs(), '--config-file', 'slither.config.json'];
}

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
