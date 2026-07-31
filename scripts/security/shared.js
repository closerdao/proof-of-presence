import {existsSync, mkdirSync, realpathSync} from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import process from 'node:process';
import projectConfig from '../../config/project.json' with {type: 'json'};

export const ACTIVE_CONTRACTS = projectConfig.productionContracts;
export const COMPILER_SETTINGS = projectConfig.compiler;

export const SLITHER_VERSION = process.env.SLITHER_VERSION ?? '0.11.6';
export const SLITHER_SOURCE =
  process.env.SLITHER_SOURCE ?? 'git+https://github.com/crytic/slither.git@050cc0a094e77bfd58e8228ae3bb6aa15c65edb4';

export const SOLC_VERSION = COMPILER_SETTINGS.version;
export const SOLC_FULL_VERSION = COMPILER_SETTINGS.fullVersion;

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
  assertSolcVersion(source, executable);
  return executable;
}

export function assertSolcVersion(source, executable) {
  const version = run(executable, ['--version'], {capture: true});
  const output = `${version.stdout ?? ''}${version.stderr ?? ''}`;
  const headers = [...output.matchAll(/^Version:[ \t]*(\S+)[ \t]*\r?$/gm)].map((match) => match[1]);
  const compilerVersion = headers[0]?.replace(/\.(?:Linux\.g\+\+|Darwin\.appleclang|Windows\.msvc)$/, '');
  if (version.status !== 0 || headers.length !== 1 || compilerVersion !== SOLC_FULL_VERSION) {
    throw new Error(`Expected ${source} to be solc ${SOLC_FULL_VERSION}, received:\n${output}`);
  }
  return output;
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
    `--optimize --optimize-runs ${COMPILER_SETTINGS.optimizerRuns} --evm-version ${COMPILER_SETTINGS.evmVersion}`,
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

export function verifySlitherInstallation(refresh = false) {
  const result = slitherCommand('slither', ['--version'], refresh, {capture: true});
  const version = result.stdout?.trim() ?? '';
  if (result.status !== 0 || version !== SLITHER_VERSION) {
    const output = `${result.stdout ?? ''}${result.stderr ?? ''}`.trim();
    throw new Error(
      `Expected Slither ${SLITHER_VERSION} from '${SLITHER_SOURCE}', received status ${result.status ?? 'unknown'}:\n${output}`,
    );
  }
  return version;
}
