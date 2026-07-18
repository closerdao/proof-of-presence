#!/usr/bin/env node
import {existsSync, readFileSync, writeFileSync} from 'node:fs';
import console from 'node:console';
import process from 'node:process';
import {ensureReportDirectory, run} from './shared.js';

const BASELINE_PATH = 'security/osv-baseline.json';
const reportDirectory = ensureReportDirectory('osv');
const result = run('osv-scanner', ['scan', 'source', '--format', 'json', '--lockfile', 'yarn.lock'], {capture: true});

writeFileSync(`${reportDirectory}/results.json`, result.stdout || '{}\n');
if (result.stderr) process.stderr.write(result.stderr);
if (result.status !== 0 && result.status !== 1) {
  process.stderr.write('OSV-Scanner could not complete the scan.\n');
  process.exit(result.status ?? 1);
}

const report = JSON.parse(result.stdout || '{}');
const findings = (report.results ?? [])
  .flatMap((scanResult) => scanResult.packages ?? [])
  .flatMap(({package: packageInfo, vulnerabilities = []}) =>
    vulnerabilities.map(({id}) => ({
      ecosystem: packageInfo.ecosystem,
      package: packageInfo.name,
      version: packageInfo.version,
      id,
    })),
  )
  .sort((left, right) => findingKey(left).localeCompare(findingKey(right)));

if (process.argv.includes('--update')) {
  const baseline = {
    format: 1,
    reviewedOn: new Date().toISOString().slice(0, 10),
    note: 'Existing dependency findings only. Reports remain visible; new package/version/advisory tuples fail CI.',
    findings,
  };
  writeFileSync(BASELINE_PATH, `${JSON.stringify(baseline, null, 2)}\n`);
  console.log(`Updated ${BASELINE_PATH} with ${findings.length} reviewed findings.`);
  process.exit(0);
}

if (!existsSync(BASELINE_PATH)) {
  throw new Error(`Missing ${BASELINE_PATH}; review the JSON report, then run yarn security:dependencies:update.`);
}

const baseline = JSON.parse(readFileSync(BASELINE_PATH, 'utf8'));
const accepted = new Set(baseline.findings.map(findingKey));
const newFindings = findings.filter((finding) => !accepted.has(findingKey(finding)));

console.log(`${findings.length} existing dependency findings; full details are in security-reports/osv/results.json.`);
if (newFindings.length > 0) {
  console.error('New dependency vulnerabilities:');
  console.error(newFindings.map((finding) => `- ${findingKey(finding)}`).join('\n'));
  process.exit(1);
}

function findingKey(finding) {
  return `${finding.ecosystem}:${finding.package}@${finding.version}:${finding.id}`;
}
