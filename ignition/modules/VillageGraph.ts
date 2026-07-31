import {buildModule} from '@nomicfoundation/hardhat-ignition/modules';
import type {ContractFuture, IgnitionModule, IgnitionModuleResult} from '@nomicfoundation/ignition-core';
import type {ResolvedDeploymentSpec} from '../../scripts/deployment/spec.js';
import {contractSelection, graphIdForSpec} from '../../scripts/deployment/spec.js';
import CommunityTokenModule, {deployCommunityToken} from './contracts/CommunityToken.js';
import DynamicPriceSaleModule, {deployDynamicPriceSale} from './contracts/DynamicPriceSale.js';
import TDFTransferPolicyModule from './contracts/TDFTransferPolicy.js';
import TokenizedStaysModule, {deployTokenizedStays} from './contracts/TokenizedStays.js';
import VillageAccessModule from './contracts/VillageAccess.js';
import VillageCitizenNFTModule from './contracts/VillageCitizenNFT.js';
import VillagePresenceTokenModule from './contracts/VillagePresenceToken.js';
import VillageSweatTokenModule from './contracts/VillageSweatToken.js';

/**
 * Builds the one root graph accepted by Ignition.
 *
 * Contract-specific Modules remain reusable, while address-dependent links are
 * expressed directly in this root so shared dependencies are deployed exactly once.
 */
export function buildVillageGraph(spec: ResolvedDeploymentSpec): IgnitionModule {
  const selected = contractSelection(spec);
  return buildModule(graphIdForSpec(spec), (m) => {
    const results: IgnitionModuleResult<string> = {};
    let villageAccess: ContractFuture<string> | undefined;
    let communityToken: ContractFuture<string> | undefined;
    let tdfTransferPolicy: ContractFuture<string> | undefined;

    if (spec.contracts.includes('VillageAccess')) {
      const access = m.useModule(VillageAccessModule);
      Object.assign(results, access);
      villageAccess = access.villageAccess;
    }

    if (selected.tdfTransferPolicy) {
      const policy = m.useModule(TDFTransferPolicyModule);
      Object.assign(results, policy);
      tdfTransferPolicy = policy.tdfTransferPolicy;
    }

    if (selected.communityToken) {
      if (tdfTransferPolicy) {
        const deployed = deployCommunityToken(m, villageAccess!, tdfTransferPolicy);
        Object.assign(results, {
          communityToken: deployed.instance,
          communityTokenImplementation: deployed.implementation,
          communityTokenProxy: deployed.proxy,
        });
        communityToken = deployed.instance;
      } else {
        const token = m.useModule(CommunityTokenModule);
        Object.assign(results, token);
        communityToken = token.communityToken;
      }
    }

    if (selected.presenceToken) Object.assign(results, m.useModule(VillagePresenceTokenModule));
    if (selected.sweatToken) Object.assign(results, m.useModule(VillageSweatTokenModule));
    if (selected.citizenNft) Object.assign(results, m.useModule(VillageCitizenNFTModule));

    if (selected.tokenizedStays) {
      if (tdfTransferPolicy) {
        const deployed = deployTokenizedStays(m, communityToken!, villageAccess!);
        Object.assign(results, {
          tokenizedStays: deployed.instance,
          tokenizedStaysImplementation: deployed.implementation,
          tokenizedStaysProxy: deployed.proxy,
        });
      } else {
        Object.assign(results, m.useModule(TokenizedStaysModule));
      }
    }

    if (selected.dynamicPriceSale) {
      if (tdfTransferPolicy || spec.preset === 'tdf') {
        const bondingCurve =
          spec.preset === 'tdf'
            ? m.contract('TDFV1BondingCurve', [], {id: 'TDFV1BondingCurve'})
            : m.getParameter<string>('bondingCurve');
        if (spec.preset === 'tdf') results.tdfBondingCurve = bondingCurve as ContractFuture<string>;
        const deployed = deployDynamicPriceSale(m, communityToken!, bondingCurve);
        Object.assign(results, {
          dynamicPriceSale: deployed.instance,
          dynamicPriceSaleImplementation: deployed.implementation,
          dynamicPriceSaleProxy: deployed.proxy,
        });
      } else {
        Object.assign(results, m.useModule(DynamicPriceSaleModule));
      }
    }

    return results;
  });
}
