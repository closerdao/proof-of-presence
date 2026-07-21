#!/usr/bin/env node
import {existsSync, readFileSync, realpathSync, writeFileSync} from 'node:fs';
import path from 'node:path';
import console from 'node:console';
import process from 'node:process';
import {ensureReportDirectory, reportSlug, run} from './shared.js';

const source = 'security/smt/TokenizedStaysSMT.sol';
const targets = [
  {contract: 'GregorianDateMathSMT', engine: 'bmc'},
  {contract: 'TokenizedStaysExposureSMT', engine: 'chc'},
];
const negativeControl = {
  source: 'security/smt/TokenizedStaysSMTNegative.sol',
  contract: 'TokenizedStaysSMTNegative',
  engine: 'chc',
};
const reportDirectory = ensureReportDirectory('smtchecker');
let failed = false;

function executableOnPath(name) {
  const executableName = process.platform === 'win32' ? `${name}.exe` : name;
  return process.env.PATH.split(path.delimiter)
    .map((directory) => path.join(directory, executableName))
    .find(existsSync);
}

function propertyIds(contractName) {
  const contents = readFileSync(source, 'utf8');
  const start = contents.indexOf(`contract ${contractName}`);
  if (start === -1) throw new Error(`Cannot find SMT contract ${contractName} in ${source}.`);
  const nextContract = contents.indexOf('\ncontract ', start + 1);
  const contractSource = contents.slice(start, nextContract === -1 ? undefined : nextContract);
  const ids = [...contractSource.matchAll(/SMT:\s*([A-Z0-9-]+)/g)].map((match) => match[1]);
  if (ids.length === 0) throw new Error(`No SMT property IDs found for ${contractName}.`);
  if (new Set(ids).size !== ids.length) throw new Error(`Duplicate SMT property ID in ${contractName}.`);
  return ids;
}

const solcExecutable = executableOnPath('solc');
const z3Executable = executableOnPath('z3');
if (!solcExecutable || !z3Executable) {
  throw new Error('Pinned solc and Z3 must be on PATH. Run `mise install` and `mise run security:smt`.');
}

const solverLibraryDirectory = path.dirname(realpathSync(z3Executable));
const libraryPathVariable = process.platform === 'darwin' ? 'DYLD_LIBRARY_PATH' : 'LD_LIBRARY_PATH';
const solverEnvironment = {
  ...process.env,
  [libraryPathVariable]: [solverLibraryDirectory, process.env[libraryPathVariable]]
    .filter(Boolean)
    .join(path.delimiter),
};

function captured(command, args, env = process.env) {
  const result = run(command, args, {capture: true, env});
  return {result, output: `${result.stdout}${result.stderr}`};
}

const miseSolc = captured('mise', ['which', 'solc']);
const miseZ3 = captured('mise', ['which', 'z3']);
if (miseSolc.result.status !== 0 || miseZ3.result.status !== 0) {
  throw new Error('Mise could not resolve the pinned solc and Z3 installations. Run `mise install`.');
}
if (
  realpathSync(solcExecutable) !== realpathSync(miseSolc.output.trim()) ||
  realpathSync(z3Executable) !== realpathSync(miseZ3.output.trim())
) {
  throw new Error('solc or Z3 resolved outside the repository-pinned Mise toolchain. Use `mise run security:smt`.');
}

const solcVersion = captured(solcExecutable, ['--version']).output;
const z3Version = captured(z3Executable, ['--version']).output;
if (!/Version: 0\.8\.35\+commit\.47b9dedd/.test(solcVersion)) {
  throw new Error(`Expected solc 0.8.35+commit.47b9dedd, received:\n${solcVersion}`);
}
if (!/Z3 version 4\.15\.8/.test(z3Version)) {
  throw new Error(`Expected Z3 4.15.8, received:\n${z3Version}`);
}

function analyze(targetSource, contract, engine) {
  return captured(
    solcExecutable,
    [
      '--base-path',
      '.',
      '--include-path',
      'node_modules',
      '--allow-paths',
      '.',
      '--evm-version',
      'cancun',
      '--optimize',
      '--model-checker-engine',
      engine,
      '--model-checker-solvers',
      'z3',
      '--model-checker-contracts',
      `${targetSource}:${contract}`,
      '--model-checker-targets',
      'assert',
      '--model-checker-timeout',
      '10000',
      '--model-checker-show-proved-safe',
      '--model-checker-show-unproved',
      '--model-checker-show-unsupported',
      targetSource,
    ],
    solverEnvironment,
  );
}

for (const target of targets) {
  const ids = propertyIds(target.contract);
  console.log(`\n=== SMTChecker: ${target.contract} (${target.engine.toUpperCase()}, ${ids.length} properties) ===`);
  const {result, output} = analyze(source, target.contract, target.engine);
  const reportName = `${reportSlug(source, `-${target.contract}`)}.txt`;
  writeFileSync(`${reportDirectory}/${reportName}`, output);
  process.stdout.write(output);

  const proved = (output.match(/Info: (?:CHC|BMC): Assertion violation check is safe!/g) ?? []).length;
  const inconclusive =
    /Assertion violation might happen here|could not be proved|analysis was not possible|not supported|solver .* (?:not available|not found)/i.test(
      output,
    );
  const counterexample = /Counterexample:|(?:CHC|BMC): Assertion violation happens here/i.test(output);
  if (result.status !== 0 || inconclusive || counterexample || proved !== ids.length) {
    console.error(`Expected ${ids.length} proved properties (${ids.join(', ')}), received ${proved}.`);
    failed = true;
  }
}

console.log('\n=== SMTChecker negative control ===');
{
  const {result, output} = analyze(negativeControl.source, negativeControl.contract, negativeControl.engine);
  writeFileSync(`${reportDirectory}/negative-control.txt`, output);
  process.stdout.write(output);
  const detected = /Counterexample:|(?:CHC|BMC): Assertion violation happens here/i.test(output);
  const solverFailure = /analysis was not possible|not supported|solver .* (?:not available|not found)/i.test(output);
  if (result.status !== 0 || !detected || solverFailure) {
    console.error('The deliberate negative-control assertion was not reported as a concrete violation.');
    failed = true;
  }
}

if (failed) {
  console.error('\nTokenizedStays SMTChecker verification failed.');
  process.exit(1);
}

console.log('\nTokenizedStays SMTChecker verification passed, including the negative control.');
