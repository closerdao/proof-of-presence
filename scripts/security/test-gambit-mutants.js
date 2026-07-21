#!/usr/bin/env node
import {copyFileSync, cpSync, mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import path from 'node:path';
import console from 'node:console';
import process from 'node:process';
import {ensureReportDirectory} from './shared.js';

const REPORT_DIRECTORY = path.resolve('security-reports/gambit');
const RESULTS_PATH = path.join(REPORT_DIRECTORY, 'gambit_results.json');
const TEST_LOG_DIRECTORY = path.resolve(ensureReportDirectory('gambit/mutant-tests'));
const TEST_RESULTS_PATH = path.join(REPORT_DIRECTORY, 'test-results.json');
const MUTANT_TIMEOUT_MS = 120_000;
const COPY_EXCLUDES = new Set([
  '.env',
  '.git',
  '.wake',
  'artifacts',
  'cache',
  'coverage',
  'node_modules',
  'security-reports',
]);

const repositoryRoot = process.cwd();
const mutants = JSON.parse(readFileSync(RESULTS_PATH, 'utf8'));
if (!Array.isArray(mutants) || mutants.length === 0) {
  throw new Error(`Missing generated mutants in ${RESULTS_PATH}. Run yarn analyze:gambit first.`);
}

const isolatedRoot = mkdtempSync(path.join(tmpdir(), 'proof-of-presence-gambit-'));
const outcomes = [];

try {
  cpSync(repositoryRoot, isolatedRoot, {
    recursive: true,
    filter(source) {
      const relative = path.relative(repositoryRoot, source);
      if (!relative) return true;
      return !COPY_EXCLUDES.has(relative.split(path.sep)[0]);
    },
  });
  symlinkSync(path.join(repositoryRoot, 'node_modules'), path.join(isolatedRoot, 'node_modules'), 'dir');

  for (const mutant of mutants) {
    const isolatedSource = path.join(isolatedRoot, mutant.original);
    const originalSource = path.join(repositoryRoot, mutant.original);
    const mutatedSource = path.join(REPORT_DIRECTORY, mutant.name);
    mkdirSync(path.dirname(isolatedSource), {recursive: true});
    copyFileSync(mutatedSource, isolatedSource);

    console.log(`Testing Gambit mutant ${mutant.id}/${mutants.length}: ${mutant.original}`);
    const test = spawnSync('yarn', ['test:solidity'], {
      encoding: 'utf8',
      cwd: isolatedRoot,
      timeout: MUTANT_TIMEOUT_MS,
    });
    const output = `${test.stdout ?? ''}${test.stderr ?? ''}`;
    writeFileSync(path.join(TEST_LOG_DIRECTORY, `${mutant.id}.txt`), output);

    const timedOut = test.error?.code === 'ETIMEDOUT';
    const survived = test.status === 0 && !timedOut;
    outcomes.push({
      id: mutant.id,
      description: mutant.description,
      source: mutant.original,
      outcome: survived ? 'survived' : 'killed',
      reason: timedOut ? 'timeout' : `test-exit-${test.status ?? 'signal'}`,
    });
    copyFileSync(originalSource, isolatedSource);
  }
} finally {
  rmSync(isolatedRoot, {recursive: true, force: true});
}

writeFileSync(TEST_RESULTS_PATH, `${JSON.stringify({format: 1, outcomes}, null, 2)}\n`);
const survived = outcomes.filter((outcome) => outcome.outcome === 'survived');
console.log(
  `${outcomes.length - survived.length}/${outcomes.length} Gambit mutants killed by the Solidity test suite.`,
);
if (survived.length > 0) {
  console.error(`Surviving mutants: ${survived.map((outcome) => outcome.id).join(', ')}`);
  process.exit(1);
}
