#!/usr/bin/env node
import {createHash} from 'node:crypto';
import {existsSync, readFileSync, writeFileSync} from 'node:fs';
import console from 'node:console';
import process from 'node:process';
import {EventFragment, FunctionFragment, id} from 'ethers';
import {artifactBaselineFailures} from './report-validation.js';
import {ACTIVE_CONTRACTS} from './shared.js';

const BASELINE_PATH = 'security/artifact-baseline.json';
const MAX_DEPLOYED_BYTECODE_BYTES = 24_576;

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, stable(value[key])]),
    );
  }
  return value;
}

function hash(value) {
  return createHash('sha256')
    .update(typeof value === 'string' ? value : JSON.stringify(stable(value)))
    .digest('hex');
}

function currentManifest() {
  const contracts = {};
  for (const [sourceName, contractName] of ACTIVE_CONTRACTS) {
    const artifactPath = `artifacts/${sourceName}/${contractName}.json`;
    if (!existsSync(artifactPath)) {
      throw new Error(`Missing ${artifactPath}. Run \`yarn hardhat compile\` first.`);
    }

    const artifact = JSON.parse(readFileSync(artifactPath, 'utf8'));
    const functions = {};
    const events = {};
    for (const item of artifact.abi) {
      if (item.type === 'function') {
        const signature = FunctionFragment.from(item).format('sighash');
        functions[signature] = id(signature).slice(0, 10);
      } else if (item.type === 'event') {
        const signature = EventFragment.from(item).format('sighash');
        events[signature] = id(signature);
      }
    }

    const deployedBytecode = artifact.deployedBytecode ?? '0x';
    contracts[contractName] = {
      sourceName,
      deployedBytecodeBytes: Math.max(0, (deployedBytecode.length - 2) / 2),
      deployedBytecodeSha256: hash(deployedBytecode),
      functions: stable(functions),
      events: stable(events),
    };
  }
  return {format: 2, contracts: stable(contracts)};
}

const current = currentManifest();
if (process.argv.includes('--update')) {
  writeFileSync(BASELINE_PATH, `${JSON.stringify(current, null, 2)}\n`);
  console.log(`Updated ${BASELINE_PATH}`);
  process.exit(0);
}

if (!existsSync(BASELINE_PATH))
  throw new Error(`Missing ${BASELINE_PATH}; create it with yarn security:artifacts:update.`);
const baseline = JSON.parse(readFileSync(BASELINE_PATH, 'utf8'));
if (baseline?.format !== 2 || !baseline.contracts || typeof baseline.contracts !== 'object') {
  throw new Error(`${BASELINE_PATH} must use format 2 and contain a contracts object.`);
}
const failures = artifactBaselineFailures(baseline.contracts, current.contracts, MAX_DEPLOYED_BYTECODE_BYTES);

if (failures.length > 0) {
  console.error(failures.map((failure) => `- ${failure}`).join('\n'));
  console.error('Intentional ABI or bytecode changes require review and `yarn security:artifacts:update`.');
  process.exit(1);
}

for (const [contractName, actual] of Object.entries(current.contracts)) {
  console.log(`${contractName}: ${actual.deployedBytecodeBytes} bytes, reviewed ABI and bytecode`);
}
