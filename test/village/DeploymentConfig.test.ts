import {expect} from 'chai';
import {MaxUint256, parseEther} from 'ethers';
import {ethers} from '../hardhat.js';
import projectConfig from '../../config/project.json';
import {canonicalJsonStringify} from '../../scripts/deployment/canonical-json.js';
import {CONTRACT_NAMES, CONTRACT_REGISTRY, UUPS_CONTRACT_NAMES} from '../../scripts/deployment/contract-registry.js';
import {parseTdfDeploymentConfig, parseVillageDeploymentConfig} from '../../scripts/deployment/spec.js';
import {
  dependencyAdditions,
  graphIdForSpec,
  MAX_DECAY_RATE_PER_DAY,
  TDF_COMMUNITY_TOKEN_MAX_SUPPLY,
  TDF_DEFAULT_CLOSER_FEE_BPS,
  TDF_DYNAMIC_PRICE_SALE_CAP,
  TDF_MINIMUM_OPERATING_SUPPLY,
} from '../../scripts/deployment/spec.js';
import {deriveInitialRoleGrants, ROLE_IDS, validateVillageDeploymentConfig} from '../../scripts/deployment/village.js';
import {buildVillageGraph} from '../../ignition/modules/VillageGraph.js';

describe('Deployment schema and resolution', function () {
  it('keeps deployment, UUPS, and production security inventories aligned', function () {
    const productionNames = projectConfig.productionContracts.map(([, contractName]) => contractName);
    expect(productionNames).to.include.members([...CONTRACT_NAMES, 'VillageUUPSProxy']);
    expect([...UUPS_CONTRACT_NAMES]).to.deep.equal(
      CONTRACT_NAMES.filter((name) => CONTRACT_REGISTRY[name].kind === 'uups'),
    );
    expect(CONTRACT_NAMES).to.deep.equal(['TDFTransferPolicy', ...UUPS_CONTRACT_NAMES]);
  });

  it('canonicalizes durable JSON independently of object key order', function () {
    expect(canonicalJsonStringify({z: 1, a: {d: 2, b: 3}, omitted: undefined})).to.equal('{"a":{"b":3,"d":2},"z":1}');
  });

  it('accepts only schema 2 and removes the profile/module hierarchy', async function () {
    const [, owner, operator] = await ethers.getSigners();
    const input = accessInput(owner.address, operator.address);
    const spec = parseVillageDeploymentConfig(input);
    expect(spec.schemaVersion).to.equal(2);
    expect(spec.requestedContracts).to.deep.equal(['VillageAccess']);
    expect(spec.contracts).to.deep.equal(['VillageAccess']);
    expect(() => parseVillageDeploymentConfig({...input, schemaVersion: 1})).to.throw();
    expect(() => parseVillageDeploymentConfig({...input, deploymentProfile: 'minimal-village'})).to.throw(
      'Unrecognized key',
    );
    expect(() => parseVillageDeploymentConfig({...input, modules: []})).to.throw('Unrecognized key');
  });

  it('auto-adds transitive dependencies in canonical order', async function () {
    const [, owner, operator] = await ethers.getSigners();
    const spec = parseVillageDeploymentConfig({
      ...accessInput(owner.address, operator.address),
      contracts: ['TokenizedStays'],
      communityToken: {maxSupply: MaxUint256.toString()},
    });
    expect(spec.requestedContracts).to.deep.equal(['TokenizedStays']);
    expect(spec.contracts).to.deep.equal(['VillageAccess', 'CommunityToken', 'TokenizedStays']);
    expect(dependencyAdditions(spec)).to.deep.equal(['VillageAccess', 'CommunityToken']);
  });

  it('rejects missing and unused contract configuration', async function () {
    const [, owner, operator] = await ethers.getSigners();
    const input = accessInput(owner.address, operator.address);
    expect(() => parseVillageDeploymentConfig({...input, contracts: ['CommunityToken']})).to.throw(
      'communityToken configuration is required',
    );
    expect(() =>
      parseVillageDeploymentConfig({
        ...input,
        communityToken: {maxSupply: '1000'},
      }),
    ).to.throw('communityToken configuration is unused');
  });

  it('keeps graph identity stable for equivalent sets and distinct for different sets', async function () {
    const [, owner, operator] = await ethers.getSigners();
    const common = {
      ...accessInput(owner.address, operator.address),
      communityToken: {maxSupply: '1000'},
      citizenNft: {baseURI: 'ipfs://citizens/'},
    };
    const first = parseVillageDeploymentConfig({
      ...common,
      contracts: ['VillageCitizenNFT', 'CommunityToken'],
    });
    const second = parseVillageDeploymentConfig({
      ...common,
      contracts: ['CommunityToken', 'VillageCitizenNFT'],
    });
    const access = parseVillageDeploymentConfig(accessInput(owner.address, operator.address));
    expect(graphIdForSpec(first)).to.equal(graphIdForSpec(second));
    expect(buildVillageGraph(first).id).to.equal(graphIdForSpec(first));
    expect(graphIdForSpec(access)).not.to.equal(graphIdForSpec(first));
  });

  it('applies the locked TDF preset and keeps village-specific input explicit', async function () {
    const [, owner, operator, recipient, quote, treasury, feeRecipient] = await ethers.getSigners();
    const spec = parseTdfDeploymentConfig({
      schemaVersion: 2,
      villageSlug: 'tdf-preset-test',
      chainId: 31337,
      finalOwner: {type: 'eoa', address: owner.address},
      apiOperator: operator.address,
      communityToken: {
        initialSupply: TDF_MINIMUM_OPERATING_SUPPLY.toString(),
        initialRecipient: recipient.address,
      },
      citizenNft: {baseURI: 'ipfs://citizens/'},
      presenceToken: {decayRatePerDay: '288617'},
      sweatToken: {decayRatePerDay: '288617'},
      tdfTransferPolicy: {treasury: treasury.address},
      dynamicPriceSale: {
        quoteToken: quote.address,
        villageTreasury: treasury.address,
        closerFeeRecipient: feeRecipient.address,
      },
    });
    expect(spec.preset).to.equal('tdf');
    expect(spec.communityToken?.maxSupply).to.equal(TDF_COMMUNITY_TOKEN_MAX_SUPPLY.toString());
    expect(spec.dynamicPriceSale?.saleCap).to.equal(TDF_DYNAMIC_PRICE_SALE_CAP.toString());
    expect(spec.dynamicPriceSale?.closerFeeBps).to.equal(TDF_DEFAULT_CLOSER_FEE_BPS);
    expect(spec.dynamicPriceSale?.bondingCurve).to.equal(undefined);
    expect(spec.contracts).to.have.length(8);
    expect(graphIdForSpec({...spec, preset: undefined})).not.to.equal(graphIdForSpec(spec));
  });

  it('rejects TDF inputs that try to override preset policy', async function () {
    const [, owner, operator, recipient, quote, treasury, feeRecipient] = await ethers.getSigners();
    const input = {
      schemaVersion: 2,
      villageSlug: 'tdf-override-test',
      chainId: 31337,
      finalOwner: {type: 'eoa' as const, address: owner.address},
      apiOperator: operator.address,
      communityToken: {
        initialSupply: parseEther('5381').toString(),
        initialRecipient: recipient.address,
      },
      citizenNft: {baseURI: 'ipfs://citizens/'},
      presenceToken: {decayRatePerDay: '1'},
      sweatToken: {decayRatePerDay: '1'},
      tdfTransferPolicy: {treasury: treasury.address},
      dynamicPriceSale: {
        quoteToken: quote.address,
        villageTreasury: treasury.address,
        closerFeeRecipient: feeRecipient.address,
      },
    };
    expect(() => parseTdfDeploymentConfig({...input, contracts: ['VillageAccess']})).to.throw('Unrecognized key');
    expect(() =>
      parseTdfDeploymentConfig({
        ...input,
        communityToken: {...input.communityToken, maxSupply: MaxUint256.toString()},
      }),
    ).to.throw('Unrecognized key');
    expect(() =>
      parseTdfDeploymentConfig({
        ...input,
        communityToken: {
          ...input.communityToken,
          initialSupply: (TDF_MINIMUM_OPERATING_SUPPLY - 1n).toString(),
        },
      }),
    ).to.throw('tdf initial supply must be at least');
  });

  it('derives operational roles and validates the selected chain', async function () {
    const [, owner, operator] = await ethers.getSigners();
    const spec = parseVillageDeploymentConfig({
      ...accessInput(owner.address, operator.address),
      contracts: ['VillagePresenceToken'],
      presenceToken: {decayRatePerDay: '42'},
    });
    expect(deriveInitialRoleGrants(spec)).to.deep.include({
      role: ROLE_IDS.BOOKING_PLATFORM_ROLE,
      roleName: 'BOOKING_PLATFORM_ROLE',
      account: operator.address,
      source: 'module-derived',
    });
    expect(() => validateVillageDeploymentConfig(spec, 42220)).to.throw('does not match selected network');
  });

  it('requires unsigned integer deployment values to be decimal strings', async function () {
    const [, owner, operator] = await ethers.getSigners();
    const input = {
      ...accessInput(owner.address, operator.address),
      contracts: ['VillagePresenceToken'],
    };
    expect(() =>
      parseVillageDeploymentConfig({
        ...input,
        presenceToken: {decayRatePerDay: 42},
      }),
    ).to.throw('decimal string');
    expect(() =>
      parseVillageDeploymentConfig({
        ...input,
        presenceToken: {decayRatePerDay: Number.MAX_SAFE_INTEGER + 1},
      }),
    ).to.throw('decimal string');
    expect(
      parseVillageDeploymentConfig({
        ...input,
        presenceToken: {decayRatePerDay: '42'},
      }).presenceToken?.decayRatePerDay,
    ).to.equal('42');
  });

  it('rejects decimal deployment values outside their Solidity bounds', async function () {
    const [, owner, operator] = await ethers.getSigners();
    const input = accessInput(owner.address, operator.address);
    expect(() =>
      parseVillageDeploymentConfig({
        ...input,
        contracts: ['CommunityToken'],
        communityToken: {maxSupply: (MaxUint256 + 1n).toString()},
      }),
    ).to.throw('must fit in a uint256');

    expect(() =>
      parseVillageDeploymentConfig({
        ...input,
        contracts: ['VillagePresenceToken'],
        presenceToken: {decayRatePerDay: (MAX_DECAY_RATE_PER_DAY + 1n).toString()},
      }),
    ).to.throw(`must not exceed ${MAX_DECAY_RATE_PER_DAY}`);
    expect(() =>
      parseVillageDeploymentConfig({
        ...input,
        contracts: ['CommunityToken'],
        communityToken: {maxSupply: 'not-a-number'},
      }),
    ).to.throw('decimal string');

    const boundary = parseVillageDeploymentConfig({
      ...input,
      contracts: ['VillagePresenceToken'],
      presenceToken: {decayRatePerDay: MAX_DECAY_RATE_PER_DAY.toString()},
    });
    expect(boundary.presenceToken?.decayRatePerDay).to.equal(MAX_DECAY_RATE_PER_DAY.toString());

    const implementation = await ethers.deployContract('VillagePresenceToken');
    await implementation.waitForDeployment();
    expect(await implementation.MAX_DECAY_RATE_PER_DAY()).to.equal(MAX_DECAY_RATE_PER_DAY);
  });

  it('requires an exact, internally valid Safe owner set and threshold', async function () {
    const [, safe, firstOwner, secondOwner, operator] = await ethers.getSigners();
    const input = accessInput(safe.address, operator.address);
    expect(() =>
      parseVillageDeploymentConfig({
        ...input,
        finalOwner: {type: 'safe', address: safe.address},
      }),
    ).to.throw();
    expect(() =>
      parseVillageDeploymentConfig({
        ...input,
        finalOwner: {
          type: 'safe',
          address: safe.address,
          expectedOwners: [firstOwner.address, firstOwner.address],
          expectedThreshold: 1,
        },
      }),
    ).to.throw('duplicate owners');
    expect(() =>
      parseVillageDeploymentConfig({
        ...input,
        finalOwner: {
          type: 'safe',
          address: safe.address,
          expectedOwners: [firstOwner.address, secondOwner.address],
          expectedThreshold: 3,
        },
      }),
    ).to.throw('must not exceed');

    const parsed = parseVillageDeploymentConfig({
      ...input,
      finalOwner: {
        type: 'safe',
        address: safe.address,
        expectedOwners: [firstOwner.address, secondOwner.address],
        expectedThreshold: 2,
      },
    });
    expect(parsed.finalOwner).to.deep.include({expectedThreshold: 2});
  });
});

function accessInput(owner: string, apiOperator: string) {
  return {
    schemaVersion: 2 as const,
    villageSlug: 'schema-test',
    chainId: 31337,
    contracts: ['VillageAccess'] as const,
    finalOwner: {type: 'eoa' as const, address: owner},
    apiOperator,
  };
}
