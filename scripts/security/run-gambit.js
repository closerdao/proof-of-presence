#!/usr/bin/env node
import {readFileSync, writeFileSync} from 'node:fs';
import console from 'node:console';
import process from 'node:process';
import {ensureReportDirectory, run} from './shared.js';

const CONFIG_PATH = 'security/gambit.json';
const REPORT_DIRECTORY = ensureReportDirectory('gambit');
const RUN_LOG_PATH = `${REPORT_DIRECTORY}/run.txt`;
const SUMMARY_PATH = `${REPORT_DIRECTORY}/summary.txt`;

const configurations = JSON.parse(readFileSync(CONFIG_PATH, 'utf8'));
if (!Array.isArray(configurations) || configurations.length === 0) {
  throw new Error(`${CONFIG_PATH} must contain at least one mutation configuration.`);
}
for (const configuration of configurations) {
  if (configuration.solc_evm_version !== 'cancun') {
    throw new Error(`${configuration.filename ?? 'A Gambit target'} does not pin solc_evm_version to cancun.`);
  }
}

const mutation = run('gambit', ['mutate', '--json', CONFIG_PATH], {capture: true});
const mutationOutput = `${mutation.stdout ?? ''}${mutation.stderr ?? ''}`;
writeFileSync(RUN_LOG_PATH, mutationOutput);
if (mutation.stdout) process.stdout.write(mutation.stdout);
if (mutation.stderr) process.stderr.write(mutation.stderr);
if (mutation.status !== 0) {
  throw new Error(`Gambit mutation generation failed with exit code ${mutation.status ?? 'unknown'}.`);
}

const summary = run('gambit', ['summary', '--mutation-directory', REPORT_DIRECTORY], {capture: true});
const summaryOutput = `${summary.stdout ?? ''}${summary.stderr ?? ''}`;
writeFileSync(SUMMARY_PATH, summaryOutput);
if (summary.stdout) process.stdout.write(summary.stdout);
if (summary.stderr) process.stderr.write(summary.stderr);
if (summary.status !== 0) {
  throw new Error(`Gambit summary failed with exit code ${summary.status ?? 'unknown'}.`);
}
if (!/Mutant ID/.test(summaryOutput)) {
  throw new Error(`Gambit did not summarize any mutants. Review ${SUMMARY_PATH}.`);
}

console.log(`Gambit mutation generation completed. Review ${SUMMARY_PATH}.`);
