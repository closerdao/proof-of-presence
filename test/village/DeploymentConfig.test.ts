import {expect} from 'chai';
import {ethers} from '../hardhat.js';
import {parseVillageDeploymentConfig} from '../../scripts/deployment/config.js';
import {normalizeModules, type NormalizedModules} from '../../scripts/deployment/village.js';
import {selectVillageProfileModule} from '../../ignition/modules/profiles/select.js';

describe('Village deployment config schema', function () {
  it('requires the current schema version, normalizes defaults, and rejects unknown fields', async function () {
    const [, owner, apiOperator] = await ethers.getSigners();
    const base = {
      schemaVersion: 3,
      villageSlug: 'schema-test',
      chainId: 31337,
      deploymentProfile: 'minimal-village',
      ownership: {finalOwner: {type: 'eoa', address: owner.address}},
      modules: [],
      apiOperator: apiOperator.address,
    } as const;

    const parsed = parseVillageDeploymentConfig(base);
    expect(parsed.schemaVersion).to.equal(3);
    expect(parsed.ownership.mode).to.equal('direct');
    expect(() => parseVillageDeploymentConfig({...base, owner: {type: 'eoa', address: owner.address}})).to.throw();
    expect(() => parseVillageDeploymentConfig({...base, roleAssignmentMode: 'initializer-seeded'})).to.throw();
    expect(() => parseVillageDeploymentConfig({...base, modules: ['membership']})).to.throw();
    const {schemaVersion: _schemaVersion, ...withoutSchemaVersion} = base;
    expect(() => parseVillageDeploymentConfig(withoutSchemaVersion)).to.throw();
    expect(() => parseVillageDeploymentConfig({...base, schemaVersion: 2})).to.throw();
  });

  it('accepts explicit handoff and rejects removed auto-Safe configuration', async function () {
    const [, owner, apiOperator] = await ethers.getSigners();
    const parsed = parseVillageDeploymentConfig({
      schemaVersion: 3,
      villageSlug: 'handoff-schema-test',
      chainId: 31337,
      deploymentProfile: 'minimal-village',
      ownership: {mode: 'deployer-handoff', finalOwner: {type: 'eoa', address: owner.address}},
      modules: [],
      apiOperator: apiOperator.address,
    });
    expect(parsed.ownership.mode).to.equal('deployer-handoff');
    expect(() =>
      parseVillageDeploymentConfig({
        ...parsed,
        ownership: {mode: 'direct', finalOwner: {type: 'auto-safe', address: owner.address}},
      }),
    ).to.throw();
  });

  it('rejects negative numeric values before deployment', async function () {
    const [, owner, apiOperator] = await ethers.getSigners();
    expect(() =>
      parseVillageDeploymentConfig({
        schemaVersion: 3,
        villageSlug: 'negative-value-test',
        chainId: 31337,
        deploymentProfile: 'token-village',
        ownership: {mode: 'direct', finalOwner: {type: 'eoa', address: owner.address}},
        modules: [],
        apiOperator: apiOperator.address,
        communityToken: {initialSupply: -1},
      }),
    ).to.throw();
  });

  it('selects stable Ignition graphs for every supported profile and custom composition', async function () {
    const [, owner, apiOperator, treasury] = await ethers.getSigners();
    const cases: Array<{
      profile: 'minimal-village' | 'token-village' | 'tokenized-stays-village' | 'tdf';
      modules: string[];
      expected: NormalizedModules;
      moduleId: string;
      nestedModuleId?: string;
    }> = [
      {
        profile: 'minimal-village',
        modules: [],
        expected: flags(),
        moduleId: 'MinimalVillageModule',
      },
      {
        profile: 'token-village',
        modules: [],
        expected: flags({communityToken: true}),
        moduleId: 'TokenVillageModule',
      },
      {
        profile: 'tokenized-stays-village',
        modules: [],
        expected: flags({communityToken: true, tokenizedStays: true}),
        moduleId: 'TokenizedStaysVillageModule',
      },
      {
        profile: 'tdf',
        modules: [],
        expected: flags({
          communityToken: true,
          presenceToken: true,
          sweatToken: true,
          tokenizedStays: true,
          tdfTransferPolicy: true,
        }),
        moduleId: 'TdfVillageModule',
      },
      {
        profile: 'minimal-village',
        modules: ['tdfTransferPolicy'],
        expected: flags({tdfTransferPolicy: true}),
        moduleId: 'TDFTransferPolicyModule',
      },
      {
        profile: 'minimal-village',
        modules: ['communityToken', 'presenceToken'],
        expected: flags({communityToken: true, presenceToken: true}),
        moduleId: 'CustomVillageModule_11000',
      },
      {
        profile: 'minimal-village',
        modules: ['communityToken', 'tdfTransferPolicy'],
        expected: flags({communityToken: true, tdfTransferPolicy: true}),
        moduleId: 'CustomVillageModule_10001',
        nestedModuleId: 'TdfCommunityTokenModule',
      },
      {
        profile: 'minimal-village',
        modules: ['communityToken', 'tokenizedStays', 'tdfTransferPolicy'],
        expected: flags({communityToken: true, tokenizedStays: true, tdfTransferPolicy: true}),
        moduleId: 'CustomVillageModule_10011',
        nestedModuleId: 'TdfTokenizedStaysModule',
      },
    ];

    for (const [index, testCase] of cases.entries()) {
      const config = parseVillageDeploymentConfig({
        schemaVersion: 3,
        villageSlug: `profile-selection-${index}`,
        chainId: 31337,
        deploymentProfile: testCase.profile,
        ownership: {mode: 'direct', finalOwner: {type: 'eoa', address: owner.address}},
        modules: testCase.modules,
        apiOperator: apiOperator.address,
        presenceToken: {decayRatePerDay: 288_617},
        sweatToken: {decayRatePerDay: 288_617},
        tdfTransferPolicy: {treasury: treasury.address},
      });
      const normalized = normalizeModules(config);
      const selected = selectVillageProfileModule(normalized);
      expect(normalized).to.deep.equal(testCase.expected);
      expect(selected.id).to.equal(testCase.moduleId);
      if (testCase.nestedModuleId) {
        expect(collectModuleIds(selected)).to.include(testCase.nestedModuleId);
      }
    }
  });
});

function collectModuleIds(module: ReturnType<typeof selectVillageProfileModule>): string[] {
  return [module.id, ...[...module.submodules].flatMap((child) => collectModuleIds(child))];
}

function flags(overrides: Partial<NormalizedModules> = {}): NormalizedModules {
  return {
    communityToken: false,
    presenceToken: false,
    sweatToken: false,
    tokenizedStays: false,
    tdfTransferPolicy: false,
    ...overrides,
  };
}
