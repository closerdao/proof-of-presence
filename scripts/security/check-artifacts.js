#!/usr/bin/env node
import {createHash} from 'node:crypto';
import {existsSync, readFileSync, writeFileSync} from 'node:fs';
import console from 'node:console';
import process from 'node:process';
import {EventFragment, FunctionFragment, id} from 'ethers';
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

function loadStorageLayout(artifact) {
  const buildInfoPath = `artifacts/build-info/${artifact.buildInfoId}.output.json`;
  if (!artifact.buildInfoId || !existsSync(buildInfoPath)) return null;
  const buildInfo = JSON.parse(readFileSync(buildInfoPath, 'utf8'));
  const source = buildInfo.output?.contracts?.[`project/${artifact.sourceName}`]?.[artifact.contractName];
  return source?.storageLayout ?? null;
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
      storageLayoutSha256: hash(loadStorageLayout(artifact)),
      functions: stable(functions),
      events: stable(events),
    };
  }
  return {format: 1, contracts: stable(contracts)};
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
const failures = [];

for (const [contractName, actual] of Object.entries(current.contracts)) {
  const expected = baseline.contracts[contractName];
  if (!expected) {
    failures.push(`${contractName}: missing committed baseline`);
    continue;
  }
  if (actual.deployedBytecodeBytes > MAX_DEPLOYED_BYTECODE_BYTES) {
    failures.push(
      `${contractName}: ${actual.deployedBytecodeBytes} byte runtime exceeds EIP-170's ${MAX_DEPLOYED_BYTECODE_BYTES} byte limit`,
    );
  }
  for (const [signature, selector] of Object.entries(expected.functions)) {
    if (actual.functions[signature] !== selector)
      failures.push(`${contractName}: removed or changed function ${signature} (${selector})`);
  }
  for (const [signature, topic] of Object.entries(expected.events)) {
    if (actual.events[signature] !== topic)
      failures.push(`${contractName}: removed or changed event ${signature} (${topic})`);
  }
}

if (failures.length > 0) {
  console.error(failures.map((failure) => `- ${failure}`).join('\n'));
  console.error('Intentional ABI changes require review and `yarn security:artifacts:update`.');
  process.exit(1);
}

for (const [contractName, actual] of Object.entries(current.contracts)) {
  const expected = baseline.contracts[contractName];
  const bytecodeChanged = actual.deployedBytecodeSha256 !== expected.deployedBytecodeSha256;
  const storageChanged = actual.storageLayoutSha256 !== expected.storageLayoutSha256;
  console.log(
    `${contractName}: ${actual.deployedBytecodeBytes} bytes${bytecodeChanged ? ', bytecode changed' : ''}${storageChanged ? ', storage layout changed' : ''}`,
  );
}
