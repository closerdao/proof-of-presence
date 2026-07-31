#!/usr/bin/env node
import {existsSync, readFileSync, rmSync} from 'node:fs';
import console from 'node:console';
import process from 'node:process';
import {unexpectedErcFindingTypes} from './report-validation.js';
import {
  ensureReportDirectory,
  reportSlug,
  slitherBuildArgs,
  slitherCommand,
  verifySlitherInstallation,
} from './shared.js';

const checks = [
  ['src/village/tokens/CommunityToken.sol', 'CommunityToken', 'ERC20', ['lack_of_erc20_race_condition_protection']],
  ['src/village/tokens/CommunityToken.sol', 'CommunityToken', 'ERC2612', []],
  ['src/village/access/VillageAccess.sol', 'VillageAccess', 'ERC165', []],
  ['src/village/citizenship/VillageCitizenNFT.sol', 'VillageCitizenNFT', 'ERC721', ['missing_event_emmited']],
  ['src/village/citizenship/VillageCitizenNFT.sol', 'VillageCitizenNFT', 'ERC165', []],
  ['src/profiles/tdf/TDFTransferPolicy.sol', 'TDFTransferPolicy', 'ERC165', []],
  ['src/profiles/tdf/TDFV1BondingCurve.sol', 'TDFV1BondingCurve', 'ERC165', []],
];

const reportDirectory = ensureReportDirectory('standards');
verifySlitherInstallation();
const buildArgs = slitherBuildArgs();
let failed = false;
for (const [target, contract, standard, acceptedFindingTypes] of checks) {
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
  if (!existsSync(report)) {
    console.error(`Missing ${report}; ${standard} check for ${contract} produced no output.`);
    failed = true;
    continue;
  }
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(report, 'utf8'));
  } catch (error) {
    console.error(`${report} is malformed JSON: ${error instanceof Error ? error.message : String(error)}`);
    failed = true;
    continue;
  }
  let unexpectedFindingTypes;
  try {
    unexpectedFindingTypes = unexpectedErcFindingTypes(parsed, acceptedFindingTypes);
  } catch (error) {
    console.error(`${report}: ${error instanceof Error ? error.message : String(error)}`);
    failed = true;
    continue;
  }
  if (unexpectedFindingTypes.length > 0) {
    console.error(`${standard} check for ${contract} reported: ${unexpectedFindingTypes.join(', ')}`);
    failed = true;
  }
}

if (failed) {
  console.error('\nAt least one ERC conformance check failed.');
  process.exit(1);
}
