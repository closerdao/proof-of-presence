#!/usr/bin/env node
import {existsSync, realpathSync, writeFileSync} from 'node:fs';
import path from 'node:path';
import console from 'node:console';
import process from 'node:process';
import {ensureReportDirectory, reportSlug, run} from './shared.js';

const targets = ['src/village/libraries/DecayMath.sol', 'src/profiles/tdf-v2/TDFTransferPolicy.sol'];
const reportDirectory = ensureReportDirectory('smtchecker');
let failed = false;
const z3Executable = process.env.PATH.split(path.delimiter)
  .map((directory) => path.join(directory, process.platform === 'win32' ? 'z3.exe' : 'z3'))
  .find(existsSync);
if (!z3Executable) throw new Error('Z3 is not on PATH. Run `mise install` and invoke this command through Mise.');

const solverLibraryDirectory = path.dirname(realpathSync(z3Executable));
const libraryPathVariable = process.platform === 'darwin' ? 'DYLD_LIBRARY_PATH' : 'LD_LIBRARY_PATH';
const solverEnvironment = {
  ...process.env,
  [libraryPathVariable]: [solverLibraryDirectory, process.env[libraryPathVariable]]
    .filter(Boolean)
    .join(path.delimiter),
};

for (const target of targets) {
  console.log(`\n=== SMTChecker: ${target} ===`);
  const result = run(
    'solc',
    [
      '@openzeppelin/=node_modules/@openzeppelin/',
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
      'chc',
      '--model-checker-solvers',
      'z3',
      '--model-checker-targets',
      'all',
      '--model-checker-timeout',
      '30000',
      '--model-checker-show-proved-safe',
      '--model-checker-show-unproved',
      '--model-checker-show-unsupported',
      target,
    ],
    {capture: true, env: solverEnvironment},
  );
  const output = `${result.stdout}${result.stderr}`;
  writeFileSync(`${reportDirectory}/${reportSlug(target)}.txt`, output);
  process.stdout.write(output);

  if (
    result.status !== 0 ||
    /Counterexample:|(?:CHC|BMC): Assertion violation|solver .* (?:not available|not found)|analysis was not possible/i.test(
      output,
    )
  ) {
    failed = true;
  }
}

if (failed) {
  console.error('\nSMTChecker failed to compile a target or produced a concrete assertion counterexample.');
  process.exit(1);
}
