import assert from 'node:assert/strict';
import test from 'node:test';
import {
  artifactBaselineFailures,
  baselineContractsMissingFromCurrent,
  parseOsvReport,
  provedSmtPropertyIds,
  unexpectedErcFindingTypes,
} from './report-validation.js';

test('OSV reports fail closed on missing or malformed structure', () => {
  assert.throws(() => parseOsvReport(''), /no report output/);
  assert.throws(() => parseOsvReport('{'), /malformed JSON/);
  assert.throws(() => parseOsvReport('{}'), /results array/);
  assert.throws(() => parseOsvReport('{"results":[{}]}'), /packages array/);
  assert.throws(
    () => parseOsvReport('{"results":[{"packages":[{"package":{"ecosystem":"npm","name":"x","version":"1"}}]}]}'),
    /invalid package or vulnerabilities data/,
  );
  assert.deepEqual(parseOsvReport('{"results":[]}'), {results: []});
});

test('ERC reports reject unsuccessful, malformed, and unexpected findings', () => {
  assert.throws(() => unexpectedErcFindingTypes({}, []), /not a successful/);
  assert.throws(
    () => unexpectedErcFindingTypes({success: true, error: null, results: {'erc-conformance': {invalid: {}}}}, []),
    /invalid findings data/,
  );
  const report = {
    success: true,
    error: null,
    results: {'erc-conformance': {accepted: [{}], unexpected: [{}]}},
  };
  assert.deepEqual(unexpectedErcFindingTypes(report, ['accepted']), ['unexpected']);
});

test('SMT reports identify every proved property exactly once', () => {
  const diagnostic = (id) => `Info: CHC: Assertion violation check is safe!
  --> security/smt/Example.sol:1:1:
   |
1 | assert(true); // SMT: ${id}
   | ^^^^^^^^^^^^`;
  assert.deepEqual(provedSmtPropertyIds(`${diagnostic('FIRST')}\n\n${diagnostic('SECOND')}`), ['FIRST', 'SECOND']);
  assert.throws(
    () => provedSmtPropertyIds('Info: CHC: Assertion violation check is safe!\n --> Example.sol:1:1:'),
    /exactly one property/,
  );
  assert.throws(
    () => provedSmtPropertyIds(`${diagnostic('DUPLICATE')}\n\n${diagnostic('DUPLICATE')}`),
    /more than once/,
  );
});

test('reverse artifact-baseline comparison reports contracts no longer analyzed', () => {
  assert.deepEqual(baselineContractsMissingFromCurrent({Current: {}, Removed: {}}, {Current: {}}), ['Removed']);
});

test('artifact comparison blocks bytecode, ABI, source, size, and inventory drift', () => {
  const contract = {
    sourceName: 'src/Example.sol',
    deployedBytecodeBytes: 10,
    deployedBytecodeSha256: 'reviewed',
    functions: {'value()': '0x12345678'},
    events: {'Value(uint256)': '0xtopic'},
  };
  assert.deepEqual(artifactBaselineFailures({Example: contract}, {Example: contract}, 100), []);

  const changed = {
    ...contract,
    sourceName: 'src/Moved.sol',
    deployedBytecodeBytes: 101,
    deployedBytecodeSha256: 'changed',
    functions: {'added()': '0x87654321'},
    events: {'Added(uint256)': '0xnew'},
  };
  const failures = artifactBaselineFailures({Example: contract, Removed: contract}, {Example: changed}, 100);
  assert.ok(failures.some((failure) => failure.includes('source changed')));
  assert.ok(failures.some((failure) => failure.includes('byte runtime exceeds')));
  assert.ok(failures.some((failure) => failure.includes('deployed bytecode differs')));
  assert.ok(failures.some((failure) => failure.includes('removed or changed function')));
  assert.ok(failures.some((failure) => failure.includes('added function')));
  assert.ok(failures.some((failure) => failure.includes('removed or changed event')));
  assert.ok(failures.some((failure) => failure.includes('added event')));
  assert.ok(failures.some((failure) => failure.includes('Removed: present in baseline')));
});
