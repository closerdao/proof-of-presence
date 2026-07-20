#!/usr/bin/env node
import {createHash} from 'node:crypto';
import {existsSync, readFileSync, renameSync, rmSync, writeFileSync} from 'node:fs';
import path from 'node:path';
import console from 'node:console';
import process from 'node:process';
import {ensureReportDirectory, run} from './shared.js';

const WAKE_REPOSITORY = 'https://github.com/microhoffman/wake.git';
const WAKE_COMMIT = '6484ca1961fab54fd594aef9479880d0522bdbcd';
const CONFIG_PATH = 'wake.toml';
const TARGETS = ['src/village', 'src/profiles/tdf-v2'];
const REQUIRED_SOURCES = ['src/village/stays/TokenizedStays.sol', 'src/profiles/tdf-v2/TDFTransferPolicy.sol'];
const REQUIRED_DETECTORS = ['reentrancy', 'unchecked-return-value'];
const FINDINGS_EXIT_CODE = 3;

const reportDirectory = ensureReportDirectory('wake/v2');
const nativeReportPath = 'wake-detections.html';
const reportPath = path.join(reportDirectory, 'report.html');
const runLogPath = path.join(reportDirectory, 'run.txt');
const gateLogPath = path.join(reportDirectory, 'gate.txt');
const metadataPath = path.join(reportDirectory, 'run-metadata.json');
const buildPath = '.wake/build/build.json';

function captured(command, args) {
  const result = run(command, args, {capture: true});
  return {result, output: `${result.stdout ?? ''}${result.stderr ?? ''}`};
}

function printResult(result) {
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
}

function gitValue(args) {
  const {result, output} = captured('git', args);
  if (result.status !== 0) throw new Error(`Git command failed: git ${args.join(' ')}\n${output}`);
  return result.stdout.trim();
}

const wakeSource = `git+${WAKE_REPOSITORY}@${WAKE_COMMIT}`;
const config = readFileSync(CONFIG_PATH);
const configSha256 = createHash('sha256').update(config).digest('hex');
const repositoryCommit = gitValue(['rev-parse', 'HEAD']);
const repositoryDirty = gitValue(['status', '--porcelain', '--untracked-files=no']).length > 0;

const version = captured('wake', ['--version']);
printResult(version.result);
if (version.result.status !== 0) {
  throw new Error(`Could not run the pinned Wake fork.\n${version.output}`);
}
const wakeVersion = version.output.trim();

const detectorList = captured('wake', ['--config', CONFIG_PATH, 'detect', 'list']);
if (detectorList.result.status !== 0) {
  throw new Error(`Wake could not list its detectors.\n${detectorList.output}`);
}
for (const detector of REQUIRED_DETECTORS) {
  if (!detectorList.output.includes(detector)) {
    throw new Error(`The pinned Wake fork did not load the required ${detector} detector.`);
  }
}

rmSync('.wake/build', {force: true, recursive: true});
rmSync(nativeReportPath, {force: true});
rmSync(reportPath, {force: true});

const fullScanArgs = ['--config', CONFIG_PATH, 'detect', '--export', 'html', 'all', ...TARGETS];
const fullScan = captured('wake', fullScanArgs);
writeFileSync(runLogPath, fullScan.output);
printResult(fullScan.result);

if (existsSync(nativeReportPath)) renameSync(nativeReportPath, reportPath);
if (![0, FINDINGS_EXIT_CODE].includes(fullScan.result.status)) {
  throw new Error(`Wake failed with exit code ${fullScan.result.status ?? 'unknown'}. Review ${runLogPath}.`);
}
if (!existsSync(reportPath)) {
  throw new Error(`Wake did not create its native ${nativeReportPath} report.`);
}
if (!existsSync(buildPath)) {
  throw new Error('Wake did not write build metadata; the analyzed production scope cannot be verified.');
}

const build = JSON.parse(readFileSync(buildPath, 'utf8'));
const compiledSources = new Set(Object.keys(build.source_units_info ?? {}));
for (const source of REQUIRED_SOURCES) {
  if (!compiledSources.has(source)) {
    throw new Error(`Wake build metadata omitted required production source ${source}.`);
  }
}

const gateArgs = [
  '--config',
  CONFIG_PATH,
  'detect',
  'all',
  ...TARGETS,
  '--min-impact',
  'medium',
  '--min-confidence',
  'medium',
];
const gate = captured('wake', gateArgs);
writeFileSync(gateLogPath, gate.output);
printResult(gate.result);

const metadata = {
  format: 1,
  generatedAt: new Date().toISOString(),
  repository: {commit: repositoryCommit, dirty: repositoryDirty},
  wake: {repository: WAKE_REPOSITORY, commit: WAKE_COMMIT, source: wakeSource, version: wakeVersion},
  compiler: {targetVersion: '0.8.35', evmVersion: 'cancun', optimizerRuns: 2000},
  config: {path: CONFIG_PATH, sha256: configSha256},
  targets: TARGETS,
  requiredSources: REQUIRED_SOURCES,
  reports: {html: reportPath, fullLog: runLogPath, gateLog: gateLogPath},
  exitCodes: {fullScan: fullScan.result.status, gate: gate.result.status},
};
writeFileSync(metadataPath, `${JSON.stringify(metadata, null, 2)}\n`);

if (gate.result.status === FINDINGS_EXIT_CODE) {
  throw new Error(`Wake reported a medium/high-impact finding with medium/high confidence. Review ${gateLogPath}.`);
}
if (gate.result.status !== 0) {
  throw new Error(
    `Wake's severity gate failed with exit code ${gate.result.status ?? 'unknown'}. Review ${gateLogPath}.`,
  );
}

console.log(`Wake analysis completed. Review ${reportPath}.`);
