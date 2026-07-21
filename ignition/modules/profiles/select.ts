import {buildModule} from '@nomicfoundation/hardhat-ignition/modules';
import type {IgnitionModule, IgnitionModuleResult} from '@nomicfoundation/ignition-core';
import type {NormalizedModules} from '../../../scripts/deployment/village.js';
import VillageAccessModule from '../contracts/VillageAccess.js';
import CommunityTokenModule from '../contracts/CommunityToken.js';
import VillagePresenceTokenModule from '../contracts/VillagePresenceToken.js';
import VillageSweatTokenModule from '../contracts/VillageSweatToken.js';
import TokenizedStaysModule from '../contracts/TokenizedStays.js';
import TDFTransferPolicyModule from '../contracts/TDFTransferPolicy.js';
import MinimalVillageModule from './MinimalVillage.js';
import TokenVillageModule from './TokenVillage.js';
import TokenizedStaysVillageModule from './TokenizedStaysVillage.js';
import TdfCommunityTokenModule from './TdfCommunityToken.js';
import TdfTokenizedStaysModule from './TdfTokenizedStays.js';
import TdfVillageModule from './TdfVillage.js';

function deploymentBits(modules: NormalizedModules): string {
  // Keep this field order stable: the bit string is part of a custom graph's persistent Ignition Module ID.
  return [
    modules.communityToken,
    modules.presenceToken,
    modules.sweatToken,
    modules.tokenizedStays,
    modules.tdfTransferPolicy,
  ]
    .map((enabled) => (enabled ? '1' : '0'))
    .join('');
}

/**
 * Selects a static, stable graph while still supporting village-specific module combinations.
 * Known profiles reuse named Modules; other combinations receive a deterministic ID so reruns resume the same journal.
 */
export function selectVillageProfileModule(modules: NormalizedModules): IgnitionModule {
  const bits = deploymentBits(modules);
  if (bits === '00001') return TDFTransferPolicyModule;
  if (bits === '00000') return MinimalVillageModule;
  if (bits === '10000') return TokenVillageModule;
  if (bits === '10010') return TokenizedStaysVillageModule;
  if (bits === '11111') return TdfVillageModule;

  return buildModule(`CustomVillageModule_${bits}`, (m) => {
    const results: IgnitionModuleResult<string> = {};
    Object.assign(results, m.useModule(VillageAccessModule));
    if (modules.communityToken && modules.tdfTransferPolicy) {
      Object.assign(results, m.useModule(modules.tokenizedStays ? TdfTokenizedStaysModule : TdfCommunityTokenModule));
    } else if (modules.communityToken) {
      Object.assign(results, m.useModule(CommunityTokenModule));
    }
    if (modules.presenceToken) Object.assign(results, m.useModule(VillagePresenceTokenModule));
    if (modules.sweatToken) Object.assign(results, m.useModule(VillageSweatTokenModule));
    if (modules.tokenizedStays && !modules.tdfTransferPolicy) {
      Object.assign(results, m.useModule(TokenizedStaysModule));
    }
    if (modules.tdfTransferPolicy && !modules.communityToken) {
      Object.assign(results, m.useModule(TDFTransferPolicyModule));
    }
    return results;
  });
}
