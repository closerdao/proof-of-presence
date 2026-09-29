import assert from 'assert';
import {Contract, providers, utils} from 'ethers';
import {Artifact, Artifacts, BuildInfo} from 'hardhat/types';
import {TDF_BURN} from './tdfBurnCorrection';

export const BURN_INITIALIZER = 'src/diamond/upgradeInitializers/TDFBurnCorrection.sol:TDFBurnCorrection';

type Declaration = {id: number; name: string};
type ContractNode = {nodeType: string; name: string; nodes: Declaration[]};

/** Reconstruct runtime bytecode using the compiler's exact immutable locations. */
export function burnInitializerRuntime(artifact: Artifact, build: BuildInfo): string {
  assert(`${artifact.sourceName}:${artifact.contractName}` === BURN_INITIALIZER, 'Unexpected initializer artifact');
  const compiled = build.output.contracts[artifact.sourceName]?.[artifact.contractName];
  assert(compiled, 'Initializer compiler output is missing; run compile');
  assert(
    artifact.bytecode.toLowerCase() === `0x${compiled.evm.bytecode.object}`.toLowerCase(),
    'Stale initializer artifact'
  );
  let runtime = compiled.evm.deployedBytecode.object.toLowerCase();
  assert(artifact.deployedBytecode.toLowerCase() === `0x${runtime}`, 'Stale initializer runtime artifact');
  const ast = build.output.sources[artifact.sourceName]?.ast as {nodes: ContractNode[]} | undefined;
  const declarations = ast?.nodes.find(
    (node) => node.nodeType === 'ContractDefinition' && node.name === artifact.contractName
  )?.nodes;
  assert(declarations, 'Initializer declarations are missing from compiler output');
  const bindings: Record<string, string> = {expectedDiamond: TDF_BURN.diamond, expectedToken: TDF_BURN.token};
  const seen = new Set<string>();
  for (const [id, references] of Object.entries(compiled.evm.deployedBytecode.immutableReferences || {})) {
    const declaration = declarations.find((node) => node.id === Number(id));
    assert(declaration && bindings[declaration.name], 'Unexpected initializer immutable');
    assert(references.length > 0, 'Initializer immutable has no runtime references');
    seen.add(declaration.name);
    for (const {start, length} of references) {
      assert(length === 32 && start >= 0 && (start + length) * 2 <= runtime.length, 'Invalid immutable reference');
      const value = utils.hexZeroPad(bindings[declaration.name], length).slice(2).toLowerCase();
      runtime = runtime.slice(0, start * 2) + value + runtime.slice((start + length) * 2);
    }
  }
  assert(seen.size === 2, 'Expected both initializer immutable bindings');
  return `0x${runtime}`;
}

/** Reject stale or different deployed code, including incorrect constructor bindings. */
export async function verifyBurnInitializer(
  provider: providers.Provider,
  artifacts: Pick<Artifacts, 'readArtifact' | 'getBuildInfo'>,
  address: string,
  blockTag: providers.BlockTag = 'latest'
) {
  const artifact = await artifacts.readArtifact(BURN_INITIALIZER);
  const build = await artifacts.getBuildInfo(BURN_INITIALIZER);
  assert(build, 'Initializer build info is missing; run compile');
  const expected = burnInitializerRuntime(artifact, build);
  const code = await provider.getCode(utils.getAddress(address), blockTag);
  assert(code !== '0x', 'Initializer has no deployed code');
  assert(code.toLowerCase() === expected, 'Initializer bytecode does not match the compiled correction');
  const contract = new Contract(address, artifact.abi, provider);
  const overrides = {blockTag};
  assert((await contract.expectedDiamond(overrides)) === TDF_BURN.diamond, 'Wrong initializer Diamond');
  assert((await contract.expectedToken(overrides)) === TDF_BURN.token, 'Wrong initializer token');
  assert((await contract.COMPLETION_SLOT(overrides)) === TDF_BURN.completionSlot, 'Wrong completion slot');
  return {contract, codeHash: utils.keccak256(code)};
}
