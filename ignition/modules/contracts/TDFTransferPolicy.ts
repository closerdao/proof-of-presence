import {buildModule} from '@nomicfoundation/hardhat-ignition/modules';

export const TDF_TRANSFER_POLICY_MODULE_ID = 'TDFTransferPolicyModule';

export default buildModule(TDF_TRANSFER_POLICY_MODULE_ID, (m) => {
  const treasury = m.getParameter<string>('treasury');
  const owner = m.getParameter<string>('owner');
  // The contract itself starts restricted. Counterparties can be configured later
  // without leaving ordinary transfers open during deployment.
  const tdfTransferPolicy = m.contract('TDFTransferPolicy', [treasury, owner], {
    id: 'TDFTransferPolicy',
  });

  return {tdfTransferPolicy};
});
