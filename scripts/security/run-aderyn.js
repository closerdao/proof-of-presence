#!/usr/bin/env node
import {lstatSync, mkdirSync, readFileSync, realpathSync, symlinkSync, writeFileSync} from 'node:fs';
import {homedir} from 'node:os';
import path from 'node:path';
import console from 'node:console';
import process from 'node:process';
import {assertSolcVersion, COMPILER_SETTINGS, SOLC_VERSION, ensureReportDirectory, run} from './shared.js';

const EVM_VERSION = COMPILER_SETTINGS.evmVersion;
const ADERYN_PACKAGE = '@cyfrin/aderyn@0.6.8';
const PATH_EXCLUDES = 'src/village/test,security/smt,test';
const REQUIRED_SOURCES = [
  'src/village/citizenship/VillageCitizenNFT.sol',
  'src/village/stays/TokenizedStays.sol',
  'src/village/sales/DynamicPriceSale.sol',
  'src/profiles/tdf/TDFTransferPolicy.sol',
  'src/profiles/tdf/TDFV1BondingCurve.sol',
];

const reportDirectory = ensureReportDirectory('aderyn');
const reportPath = path.join(reportDirectory, 'report.md');
const runLogPath = path.join(reportDirectory, 'run.txt');
const solcVersionPath = path.join(reportDirectory, 'solc-version.txt');

function captured(command, args, options = {}) {
  const result = run(command, args, {capture: true, ...options});
  return {result, output: `${result.stdout ?? ''}${result.stderr ?? ''}`};
}

const miseSolc = captured('mise', ['which', 'solc']);
if (miseSolc.result.status !== 0 || !miseSolc.result.stdout.trim()) {
  throw new Error(`Mise could not resolve pinned solc ${SOLC_VERSION}. Run \`mise install\`.\n${miseSolc.output}`);
}

const solcExecutable = realpathSync(miseSolc.result.stdout.trim());
const solcVersion = assertSolcVersion('the Mise-pinned compiler', solcExecutable);
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
  assertSolcVersion(`the existing Aderyn compiler at ${aderynSolc}`, aderynSolc);
} else {
  symlinkSync(solcExecutable, aderynSolc, 'file');
}

const analysis = captured(
  'npx',
  ['--yes', ADERYN_PACKAGE, '.', '--path-excludes', PATH_EXCLUDES, '--output', reportPath],
  {
    env: {...process.env, FOUNDRY_EVM_VERSION: EVM_VERSION},
  },
);
writeFileSync(runLogPath, analysis.output);
if (analysis.result.stdout) process.stdout.write(analysis.result.stdout);
if (analysis.result.stderr) process.stderr.write(analysis.result.stderr);

if (analysis.result.status !== 0) {
  throw new Error(`Aderyn failed with exit code ${analysis.result.status ?? 'unknown'}.`);
}
if (
  !new RegExp(`Ingesting [1-9][0-9]* compiled files \\[solc : v${SOLC_VERSION.replaceAll('.', '\\.')}\\]`).test(
    analysis.output,
  )
) {
  throw new Error(`Aderyn did not compile a nonzero source scope with solc ${SOLC_VERSION}.`);
}
if (!new RegExp(`EVM version - ${EVM_VERSION}`).test(analysis.output)) {
  throw new Error(`Aderyn did not target the required ${EVM_VERSION} EVM version.`);
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
if (/^## H-\d+:/m.test(report)) {
  throw new Error(`Aderyn reported a high-severity finding. Review ${reportPath}.`);
}

console.log(`Aderyn analysis completed. Review ${reportPath}.`);
