#!/usr/bin/env node
import {rmSync} from 'node:fs';
import console from 'node:console';
import process from 'node:process';
import {ensureReportDirectory, reportSlug, slitherBuildArgs, slitherCommand} from './shared.js';

const checks = [
  ['src/village/tokens/CommunityToken.sol', 'CommunityToken', 'ERC20'],
  ['src/village/tokens/CommunityToken.sol', 'CommunityToken', 'ERC2612'],
  ['src/village/access/VillageAccess.sol', 'VillageAccess', 'ERC165'],
  ['src/profiles/tdf/TDFTransferPolicy.sol', 'TDFTransferPolicy', 'ERC165'],
];

const reportDirectory = ensureReportDirectory('standards');
const buildArgs = slitherBuildArgs();
let failed = false;
for (const [target, contract, standard] of checks) {
  const report = `${reportDirectory}/${reportSlug(target, `-${standard.toLowerCase()}`)}.json`;
  rmSync(report, {force: true});
  console.log(`\n=== ${standard}: ${contract} ===`);
  const result = slitherCommand('slither-check-erc', [
    target,
    contract,
    '--erc',
    standard,
    '--json',
    report,
    ...buildArgs,
  ]);
  failed ||= result.status !== 0;
}

if (failed) {
  console.error('\nAt least one ERC conformance check failed.');
  process.exit(1);
}
