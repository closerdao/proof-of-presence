#!/usr/bin/env node
import {rmSync, writeFileSync} from 'node:fs';
import console from 'node:console';
import process from 'node:process';
import {
  ACTIVE_CONTRACTS,
  ensureReportDirectory,
  reportSlug,
  run,
  slitherCompileArgs,
  slitherCommand,
} from './shared.js';

const reportDirectory = ensureReportDirectory('slither');
const remote = run('git', ['ls-remote', 'https://github.com/crytic/slither.git', 'refs/heads/master'], {capture: true});
if (remote.status !== 0) {
  process.stderr.write(remote.stderr);
  process.exit(remote.status ?? 1);
}

const resolvedCommit = remote.stdout.trim().split(/\s+/)[0];
if (!/^[0-9a-f]{40}$/.test(resolvedCommit)) {
  throw new Error(`Could not resolve Slither master commit from: ${remote.stdout.trim()}`);
}
writeFileSync(`${reportDirectory}/commit.txt`, `${resolvedCommit}\n`);
console.log(`Slither source: master @ ${resolvedCommit}`);
const resolvedSource = `git+https://github.com/crytic/slither.git@${resolvedCommit}`;
const compileArgs = slitherCompileArgs();

let failed = false;
for (const [target] of ACTIVE_CONTRACTS) {
  const slug = reportSlug(target);
  const jsonReport = `${reportDirectory}/${slug}.json`;
  const sarifReport = `${reportDirectory}/${slug}.sarif`;
  rmSync(jsonReport, {force: true});
  rmSync(sarifReport, {force: true});
  console.log(`\n=== Slither: ${target} ===`);
  const result = slitherCommand(
    'slither',
    [target, ...compileArgs, '--json', jsonReport, '--sarif', sarifReport, '--fail-medium'],
    target === ACTIVE_CONTRACTS[0][0],
    {},
    resolvedSource,
  );
  failed ||= result.status !== 0;
}

if (failed) {
  console.error('\nSlither reported at least one medium/high finding or failed to analyze a target.');
  process.exit(1);
}
