export function parseOsvReport(output) {
  if (!output?.trim()) {
    throw new Error('OSV-Scanner produced no report output; refusing to evaluate or update the dependency baseline.');
  }

  let report;
  try {
    report = JSON.parse(output);
  } catch (error) {
    throw new Error(`OSV-Scanner produced malformed JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!report || typeof report !== 'object' || !Array.isArray(report.results)) {
    throw new Error('OSV-Scanner report must be an object with a results array.');
  }
  for (const [resultIndex, scanResult] of report.results.entries()) {
    if (!scanResult || typeof scanResult !== 'object' || !Array.isArray(scanResult.packages)) {
      throw new Error(`OSV-Scanner result ${resultIndex} must contain a packages array.`);
    }
    for (const [packageIndex, packageResult] of scanResult.packages.entries()) {
      const packageInfo = packageResult?.package;
      if (
        !packageInfo ||
        typeof packageInfo.ecosystem !== 'string' ||
        typeof packageInfo.name !== 'string' ||
        typeof packageInfo.version !== 'string' ||
        !Array.isArray(packageResult.vulnerabilities)
      ) {
        throw new Error(
          `OSV-Scanner result ${resultIndex} package ${packageIndex} has invalid package or vulnerabilities data.`,
        );
      }
    }
  }
  return report;
}

export function unexpectedErcFindingTypes(report, acceptedFindingTypes) {
  const conformance = report?.results?.['erc-conformance'];
  if (
    report?.success !== true ||
    report?.error !== null ||
    !conformance ||
    typeof conformance !== 'object' ||
    Array.isArray(conformance)
  ) {
    throw new Error('Report is not a successful Slither ERC-conformance report.');
  }
  for (const [findingType, findings] of Object.entries(conformance)) {
    if (!Array.isArray(findings)) throw new Error(`Report has invalid findings data for '${findingType}'.`);
  }
  return Object.entries(conformance)
    .filter(([, findings]) => findings.length > 0)
    .map(([findingType]) => findingType)
    .filter((findingType) => !acceptedFindingTypes.includes(findingType));
}

export function provedSmtPropertyIds(output) {
  const safeMessage = /Info: (?:CHC|BMC): Assertion violation check is safe!/;
  const propertyPattern = /\/\/ SMT:\s*([A-Z0-9-]+)/g;
  const ids = [];
  for (const block of output.split(/\r?\n[ \t]*\r?\n/)) {
    if (!safeMessage.test(block)) continue;
    const blockIds = [...block.matchAll(propertyPattern)].map((match) => match[1]);
    if (blockIds.length !== 1) {
      throw new Error(`Each proved-safe SMT diagnostic must identify exactly one property:\n${block}`);
    }
    ids.push(blockIds[0]);
  }
  if (new Set(ids).size !== ids.length) throw new Error('SMTChecker reported a property more than once.');
  return ids;
}

export function baselineContractsMissingFromCurrent(baselineContracts, currentContracts) {
  return Object.keys(baselineContracts).filter((contractName) => !currentContracts[contractName]);
}

export function artifactBaselineFailures(baselineContracts, currentContracts, maximumBytecodeBytes) {
  const failures = [];
  for (const [contractName, actual] of Object.entries(currentContracts)) {
    const expected = baselineContracts[contractName];
    if (!expected) {
      failures.push(`${contractName}: missing committed baseline`);
      continue;
    }
    if (actual.sourceName !== expected.sourceName) {
      failures.push(`${contractName}: source changed from ${expected.sourceName} to ${actual.sourceName}`);
    }
    if (actual.deployedBytecodeBytes > maximumBytecodeBytes) {
      failures.push(
        `${contractName}: ${actual.deployedBytecodeBytes} byte runtime exceeds EIP-170's ${maximumBytecodeBytes} byte limit`,
      );
    }
    if (actual.deployedBytecodeSha256 !== expected.deployedBytecodeSha256) {
      failures.push(`${contractName}: deployed bytecode differs from the reviewed baseline`);
    }
    for (const [signature, selector] of Object.entries(expected.functions)) {
      if (actual.functions[signature] !== selector) {
        failures.push(`${contractName}: removed or changed function ${signature} (${selector})`);
      }
    }
    for (const [signature, topic] of Object.entries(expected.events)) {
      if (actual.events[signature] !== topic) {
        failures.push(`${contractName}: removed or changed event ${signature} (${topic})`);
      }
    }
    for (const signature of Object.keys(actual.functions)) {
      if (!(signature in expected.functions)) failures.push(`${contractName}: added function ${signature}`);
    }
    for (const signature of Object.keys(actual.events)) {
      if (!(signature in expected.events)) failures.push(`${contractName}: added event ${signature}`);
    }
  }
  for (const contractName of baselineContractsMissingFromCurrent(baselineContracts, currentContracts)) {
    failures.push(`${contractName}: present in baseline but no longer analyzed`);
  }
  return failures;
}
