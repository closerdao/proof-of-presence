import {expect} from 'chai';
import {ethers} from '../hardhat.js';
import {parseVillageDeploymentConfig} from '../../scripts/deployment/config.js';
import {
  normalizeModules,
  resolvedCloserFeeBps,
  TDF_MINIMUM_OPERATING_SUPPLY,
  validateVillageDeploymentConfig,
  type NormalizedModules,
  type VillageDeploymentConfig,
} from '../../scripts/deployment/village.js';
import {selectVillageProfileModule} from '../../ignition/modules/profiles/select.js';

describe('Village deployment config schema', function () {
  it('requires the current schema version, normalizes defaults, and rejects unknown fields', async function () {
    const [, owner, apiOperator] = await ethers.getSigners();
    const base = {
      schemaVersion: 4,
      villageSlug: 'schema-test',
      chainId: 31337,
      deploymentProfile: 'minimal-village',
      ownership: {finalOwner: {type: 'eoa', address: owner.address}},
      modules: [],
      apiOperator: apiOperator.address,
    } as const;

    const parsed = parseVillageDeploymentConfig(base);
    expect(parsed.schemaVersion).to.equal(4);
    expect(parsed.ownership.mode).to.equal('direct');
    expect(() => parseVillageDeploymentConfig({...base, owner: {type: 'eoa', address: owner.address}})).to.throw();
    expect(() => parseVillageDeploymentConfig({...base, roleAssignmentMode: 'initializer-seeded'})).to.throw();
    expect(() => parseVillageDeploymentConfig({...base, modules: ['membership']})).to.throw();
    const {schemaVersion: _schemaVersion, ...withoutSchemaVersion} = base;
    expect(() => parseVillageDeploymentConfig(withoutSchemaVersion)).to.throw();
    expect(() => parseVillageDeploymentConfig({...base, schemaVersion: 3})).to.throw();
  });

  it('accepts explicit handoff and rejects removed auto-Safe configuration', async function () {
    const [, owner, apiOperator] = await ethers.getSigners();
    const parsed = parseVillageDeploymentConfig({
      schemaVersion: 4,
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
        schemaVersion: 4,
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

  it('rejects custom module compositions with missing dependencies', async function () {
    const [, owner, apiOperator] = await ethers.getSigners();
    const config: VillageDeploymentConfig = {
      schemaVersion: 4,
      villageSlug: 'invalid-tokenized',
      chainId: 31337,
      deploymentProfile: 'minimal-village',
      ownership: {mode: 'direct', finalOwner: {type: 'eoa', address: owner.address}},
      modules: ['tokenizedStays'],
      apiOperator: apiOperator.address,
    };

    expect(() => validateVillageDeploymentConfig(config, config.chainId)).to.throw(
      'tokenizedStays requires communityToken',
    );
  });

  it('rejects conflicting external and deployed transfer policies', async function () {
    const [, owner, apiOperator, treasury] = await ethers.getSigners();
    const config: VillageDeploymentConfig = {
      schemaVersion: 4,
      villageSlug: 'conflicting-policies',
      chainId: 31337,
      deploymentProfile: 'tdf',
      ownership: {mode: 'direct', finalOwner: {type: 'eoa', address: owner.address}},
      modules: [],
      apiOperator: apiOperator.address,
      communityToken: {maxSupply: '18600000000000000000000', transferPolicy: treasury.address},
      presenceToken: {decayRatePerDay: 288_617},
      sweatToken: {decayRatePerDay: 288_617},
      tdfTransferPolicy: {treasury: treasury.address},
    };

    expect(() => validateVillageDeploymentConfig(config, config.chainId)).to.throw(
      'communityToken.transferPolicy cannot be set when the deployed TDFTransferPolicy is selected',
    );
  });

  it('defaults the TDF Closer fee to 5% but requires an explicit generic-sale fee', async function () {
    const [, owner, apiOperator, quoteToken, curve, treasury, closerFeeRecipient] = await ethers.getSigners();
    const sale = {
      quoteToken: quoteToken.address,
      bondingCurve: curve.address,
      villageTreasury: treasury.address,
      closerFeeRecipient: closerFeeRecipient.address,
      saleCap: '900',
      minimumPurchase: '1',
      maximumPurchase: '100',
      purchaseGranularity: '1',
      maximumRecipientBalance: '200',
    };
    const generic = parseVillageDeploymentConfig({
      schemaVersion: 4,
      villageSlug: 'generic-fee-required',
      chainId: 31337,
      deploymentProfile: 'minimal-village',
      ownership: {mode: 'direct', finalOwner: {type: 'eoa', address: owner.address}},
      modules: ['communityToken', 'dynamicPriceSale'],
      apiOperator: apiOperator.address,
      communityToken: {maxSupply: '1000'},
      dynamicPriceSale: sale,
    });
    expect(() => validateVillageDeploymentConfig(generic, 31337)).to.throw(
      'dynamicPriceSale.closerFeeBps is required outside the TDF profile',
    );

    const tdf = {...generic, deploymentProfile: 'tdf' as const};
    expect(resolvedCloserFeeBps(tdf)).to.equal(500);
  });

  it('requires the TDF operating supply needed by the complete purchase range', async function () {
    const [, owner, apiOperator, initialRecipient, quoteToken, treasury, closerFeeRecipient] =
      await ethers.getSigners();
    const config = parseVillageDeploymentConfig({
      schemaVersion: 4,
      villageSlug: 'tdf-operating-supply',
      chainId: 31337,
      deploymentProfile: 'tdf',
      ownership: {mode: 'direct', finalOwner: {type: 'eoa', address: owner.address}},
      modules: [],
      apiOperator: apiOperator.address,
      communityToken: {
        initialSupply: ethers.parseEther('5380').toString(),
        maxSupply: ethers.parseEther('18600').toString(),
        initialRecipient: initialRecipient.address,
      },
      presenceToken: {decayRatePerDay: 288_617},
      sweatToken: {decayRatePerDay: 288_617},
      tdfTransferPolicy: {treasury: treasury.address},
      dynamicPriceSale: {
        quoteToken: quoteToken.address,
        villageTreasury: treasury.address,
        closerFeeRecipient: closerFeeRecipient.address,
        saleCap: ethers.parseEther('15097.5').toString(),
        minimumPurchase: ethers.parseEther('1').toString(),
        maximumPurchase: ethers.parseEther('100').toString(),
        purchaseGranularity: ethers.parseEther('1').toString(),
        maximumRecipientBalance: ethers.parseEther('915').toString(),
      },
    });

    expect(() => validateVillageDeploymentConfig(config, config.chainId)).to.throw(
      `tdf initial supply must be at least ${TDF_MINIMUM_OPERATING_SUPPLY}`,
    );

    config.communityToken!.initialSupply = TDF_MINIMUM_OPERATING_SUPPLY.toString();
    expect(() => validateVillageDeploymentConfig(config, config.chainId)).not.to.throw();
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
          dynamicPriceSale: true,
        }),
        moduleId: 'TdfVillageDynamicPriceSaleModule',
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
      {
        profile: 'minimal-village',
        modules: ['communityToken', 'dynamicPriceSale'],
        expected: flags({communityToken: true, dynamicPriceSale: true}),
        moduleId: 'CustomVillageModule_100001',
        nestedModuleId: 'DynamicPriceSaleModule',
      },
    ];

    for (const [index, testCase] of cases.entries()) {
      const config = parseVillageDeploymentConfig({
        schemaVersion: 4,
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
      const selected = selectVillageProfileModule(normalized, testCase.profile === 'tdf');
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
    dynamicPriceSale: false,
    ...overrides,
  };
}
