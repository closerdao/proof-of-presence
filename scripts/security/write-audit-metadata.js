#!/usr/bin/env node
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {existsSync, mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import console from 'node:console';

const OUTPUT_PATH = 'security-reports/audit-metadata.json';
const REVIEWED_INPUTS = [
  'hardhat.config.ts',
  'mise.toml',
  'mise.lock',
  'package.json',
  'yarn.lock',
  'config/project.json',
  'slither.config.json',
  'wake.toml',
  'security/gambit.json',
];

function command(executable, args) {
  return execFileSync(executable, args, {encoding: 'utf8'}).trim();
}

function sha256(file) {
  return createHash('sha256').update(readFileSync(file)).digest('hex');
}

if (command('git', ['status', '--porcelain'])) {
  throw new Error('Pre-audit evidence must be generated from a clean worktree');
}

const metadata = {
  format: 1,
  generatedAt: new Date().toISOString(),
  sourceRevision: command('git', ['rev-parse', 'HEAD']),
  sourceTreeClean: true,
  toolVersions: {
    node: command('node', ['--version']),
    yarn: command('yarn', ['--version']),
    solc: command('solc', ['--version']),
  },
  reviewedInputSha256: Object.fromEntries(REVIEWED_INPUTS.filter(existsSync).map((file) => [file, sha256(file)])),
};

mkdirSync('security-reports', {recursive: true});
writeFileSync(OUTPUT_PATH, `${JSON.stringify(metadata, null, 2)}\n`);
console.log(`Wrote clean-revision audit metadata to ${OUTPUT_PATH}`);
