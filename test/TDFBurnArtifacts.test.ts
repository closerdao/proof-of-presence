import assert from 'assert';
import {expect} from './chai-setup';
import {artifacts, ethers} from 'hardhat';
import {providers} from 'ethers';
import {BURN_INITIALIZER, burnInitializerRuntime, verifyBurnInitializer} from '../utils/tdfBurnArtifacts';
import {TDF_BURN} from '../utils/tdfBurnCorrection';

describe('TDF burn initializer verification', () => {
  it('matches deployed runtime including both immutable bindings', async () => {
    const factory = await ethers.getContractFactory('TDFBurnCorrection');
    const initializer = await factory.deploy(TDF_BURN.diamond, TDF_BURN.token);
    await initializer.deployed();
    const verified = await verifyBurnInitializer(ethers.provider, artifacts, initializer.address);
    expect(verified.codeHash).to.eq(ethers.utils.keccak256(await ethers.provider.getCode(initializer.address)));
  });

  it('rejects an initializer whose getters have the same ABI but bind another token', async () => {
    const factory = await ethers.getContractFactory('TDFBurnCorrection');
    const initializer = await factory.deploy(TDF_BURN.diamond, TDF_BURN.safe);
    await initializer.deployed();
    await assert.rejects(
      verifyBurnInitializer(ethers.provider, artifacts, initializer.address),
      /bytecode does not match/
    );
  });

  it('rejects an address without deployed code', async () => {
    await assert.rejects(
      verifyBurnInitializer(ethers.provider, artifacts, ethers.constants.AddressZero),
      /no deployed code/
    );
  });

  it('rejects different runtime code even when the immutable values are unchanged', async () => {
    const artifact = await artifacts.readArtifact(BURN_INITIALIZER);
    const build = await artifacts.getBuildInfo(BURN_INITIALIZER);
    assert(build);
    const changed = `${burnInitializerRuntime(artifact, build)}00`;
    const provider = {getCode: async () => changed} as unknown as providers.Provider;
    await assert.rejects(verifyBurnInitializer(provider, artifacts, TDF_BURN.safe), /bytecode does not match/);
  });

  it('rejects an artifact that does not match its compiler output', async () => {
    const artifact = await artifacts.readArtifact(BURN_INITIALIZER);
    const build = await artifacts.getBuildInfo(BURN_INITIALIZER);
    assert(build);
    expect(() => burnInitializerRuntime({...artifact, deployedBytecode: '0x00'}, build)).to.throw('Stale initializer');
    expect(() => burnInitializerRuntime({...artifact, bytecode: '0x00'}, build)).to.throw('Stale initializer');
  });
});
