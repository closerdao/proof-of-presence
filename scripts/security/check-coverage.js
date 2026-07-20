#!/usr/bin/env node
import {existsSync, readFileSync, writeFileSync} from 'node:fs';
import console from 'node:console';
import process from 'node:process';

const LCOV_PATH = 'coverage/lcov.info';
const BASELINE_PATH = 'security/coverage-baseline.json';
const NEW_FILE_MINIMUM = 90;
const ACTIVE_PREFIXES = ['src/village/', 'src/profiles/tdf/'];
const EXCLUDED_PREFIXES = ['src/village/test/', 'src/village/interfaces/'];

if (!existsSync(LCOV_PATH)) throw new Error(`Missing ${LCOV_PATH}; run yarn coverage first.`);

const records = readFileSync(LCOV_PATH, 'utf8').split('end_of_record');
const files = {};
for (const record of records) {
  const source = record.match(/^SF:(.+)$/m)?.[1];
  if (!source || !ACTIVE_PREFIXES.some((prefix) => source.startsWith(prefix))) continue;
  if (EXCLUDED_PREFIXES.some((prefix) => source.startsWith(prefix))) continue;
  const found = Number(record.match(/^LF:(\d+)$/m)?.[1] ?? 0);
  const hit = Number(record.match(/^LH:(\d+)$/m)?.[1] ?? 0);
  if (found === 0) continue;
  files[source] = {hit, found, percent: Number(((hit / found) * 100).toFixed(2))};
}

const snapshot = {format: 1, metric: 'lcov-lines', newFileMinimumPercent: NEW_FILE_MINIMUM, files};
if (process.argv.includes('--update')) {
  writeFileSync(BASELINE_PATH, `${JSON.stringify(snapshot, null, 2)}\n`);
  console.log(`Updated ${BASELINE_PATH}`);
  process.exit(0);
}

if (!existsSync(BASELINE_PATH))
  throw new Error(`Missing ${BASELINE_PATH}; create it with yarn security:coverage:update.`);
const baseline = JSON.parse(readFileSync(BASELINE_PATH, 'utf8'));
const failures = [];

for (const [source, actual] of Object.entries(files)) {
  const expected = baseline.files[source];
  const minimum = expected?.percent ?? baseline.newFileMinimumPercent ?? NEW_FILE_MINIMUM;
  console.log(`${source}: ${actual.hit}/${actual.found} lines (${actual.percent}%, minimum ${minimum}%)`);
  if (actual.percent < minimum) failures.push(`${source}: ${actual.percent}% is below ${minimum}%`);
}
for (const source of Object.keys(baseline.files)) {
  if (!files[source]) failures.push(`${source}: missing from coverage report`);
}

if (failures.length > 0) {
  console.error(failures.map((failure) => `- ${failure}`).join('\n'));
  process.exit(1);
}
