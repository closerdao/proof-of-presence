#!/usr/bin/env node
import {lstatSync, mkdirSync, readFileSync, realpathSync, symlinkSync, writeFileSync} from 'node:fs';
import {homedir} from 'node:os';
import path from 'node:path';
import console from 'node:console';
import process from 'node:process';
import {ensureReportDirectory, run} from './shared.js';

const SOLC_VERSION = '0.8.35';
const SOLC_BUILD_PATTERN = /Version: 0\.8\.35\+commit\.47b9dedd/;
const ADERYN_PACKAGE = '@cyfrin/aderyn@0.6.8';
const PATH_EXCLUDES = 'src/legacy,src/village/test,security/smt,test';
const REQUIRED_SOURCES = ['src/village/stays/TokenizedStays.sol', 'src/profiles/tdf-v2/TDFTransferPolicy.sol'];

const reportDirectory = ensureReportDirectory('aderyn');
const reportPath = path.join(reportDirectory, 'report.md');
const runLogPath = path.join(reportDirectory, 'run.txt');
const solcVersionPath = path.join(reportDirectory, 'solc-version.txt');

function captured(command, args) {
  const result = run(command, args, {capture: true});
  return {result, output: `${result.stdout ?? ''}${result.stderr ?? ''}`};
}

function assertSolcVersion(executable, source) {
  const {result, output} = captured(executable, ['--version']);
  if (result.status !== 0 || !SOLC_BUILD_PATTERN.test(output)) {
    throw new Error(`Expected ${source} to be solc 0.8.35+commit.47b9dedd, received:\n${output}`);
  }
  return output;
}

const miseSolc = captured('mise', ['which', 'solc']);
if (miseSolc.result.status !== 0 || !miseSolc.result.stdout.trim()) {
  throw new Error(`Mise could not resolve pinned solc ${SOLC_VERSION}. Run \`mise install\`.\n${miseSolc.output}`);
}

const solcExecutable = realpathSync(miseSolc.result.stdout.trim());
const solcVersion = assertSolcVersion(solcExecutable, 'the Mise-pinned compiler');
writeFileSync(solcVersionPath, solcVersion);
process.stdout.write(solcVersion);

const aderynSolc = path.join(homedir(), '.svm', SOLC_VERSION, `solc-${SOLC_VERSION}`);
mkdirSync(path.dirname(aderynSolc), {recursive: true});

let aderynSolcExists = false;
try {
  lstatSync(aderynSolc);
  aderynSolcExists = true;
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
}

if (aderynSolcExists) {
  assertSolcVersion(aderynSolc, `the existing Aderyn compiler at ${aderynSolc}`);
} else {
  symlinkSync(solcExecutable, aderynSolc, 'file');
}

const analysis = captured('npx', [
  '--yes',
  ADERYN_PACKAGE,
  '.',
  '--path-excludes',
  PATH_EXCLUDES,
  '--output',
  reportPath,
]);
writeFileSync(runLogPath, analysis.output);
if (analysis.result.stdout) process.stdout.write(analysis.result.stdout);
if (analysis.result.stderr) process.stderr.write(analysis.result.stderr);

if (analysis.result.status !== 0) {
  throw new Error(`Aderyn failed with exit code ${analysis.result.status ?? 'unknown'}.`);
}
if (!/Ingesting [1-9][0-9]* compiled files \[solc : v0\.8\.35\]/.test(analysis.output)) {
  throw new Error('Aderyn did not compile a nonzero source scope with solc 0.8.35.');
}
if (!/Running [1-9][0-9]* detectors/.test(analysis.output)) {
  throw new Error('Aderyn did not run a nonzero detector set.');
}

const report = readFileSync(reportPath, 'utf8');
for (const requiredSource of REQUIRED_SOURCES) {
  if (!report.includes(requiredSource)) {
    throw new Error(`Aderyn report omitted required source ${requiredSource}.`);
  }
}

console.log(`Aderyn analysis completed. Review ${reportPath}.`);
