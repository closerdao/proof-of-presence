#!/usr/bin/env node
import {rmSync, writeFileSync} from 'node:fs';
import console from 'node:console';
import process from 'node:process';
import {
  ACTIVE_CONTRACTS,
  ensureReportDirectory,
  reportSlug,
  SLITHER_SOURCE,
  SLITHER_VERSION,
  slitherCompileArgs,
  slitherCommand,
  verifySlitherInstallation,
} from './shared.js';

const reportDirectory = ensureReportDirectory('slither');
rmSync(`${reportDirectory}/commit.txt`, {force: true});
const verifiedVersion = verifySlitherInstallation();
writeFileSync(`${reportDirectory}/source.txt`, `${SLITHER_SOURCE}\n`);
writeFileSync(`${reportDirectory}/version.txt`, `${verifiedVersion}\n`);
console.log(`Slither source: ${SLITHER_SOURCE}`);
console.log(`Slither version: ${SLITHER_VERSION}`);
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
    false,
    {},
  );
  failed ||= result.status !== 0;
}

if (failed) {
  console.error('\nSlither reported at least one medium/high finding or failed to analyze a target.');
  process.exit(1);
}
