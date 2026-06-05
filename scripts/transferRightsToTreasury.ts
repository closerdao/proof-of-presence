import {getNamedAccounts, ethers} from './hardhat3-compat.js';
import type {ContractMap, ConnectedContractMap, RuntimeContract} from '../utils/runtimeContract.js';

import {ROLES} from '../utils/index.js';

async function setupUser<T extends ContractMap>(
  address: string,
  contracts: T,
): Promise<{address: string} & ConnectedContractMap<T>> {
  const user: any = {address};
  for (const key of Object.keys(contracts)) {
    user[key] = contracts[key].connect(await ethers.getSigner(address));
  }
  return user as {address: string} & ConnectedContractMap<T>;
}
async function main() {
  const namedAccounts = await getNamedAccounts();
  const contracts = {
    token: (await ethers.getContract('TDFToken', namedAccounts.deployer)) as RuntimeContract,
    TDFDiamond: (await ethers.getContract('TDFDiamond', namedAccounts.deployer)) as RuntimeContract,
    sale: (await ethers.getContract('DynamicSale', namedAccounts.deployer)) as RuntimeContract,
    sweatToken: (await ethers.getContract('SweatToken', namedAccounts.deployer)) as RuntimeContract,
    // note: same address as TDFDiamond, doing this here for typing
    ownershipFacet: (await ethers.getContract('TDFDiamond', namedAccounts.deployer)) as RuntimeContract,
  };

  const deployer = await setupUser(namedAccounts.deployer, contracts);

  // Pause Dynamic Sale contract
  await deployer.sale.pause();

  // set DAO contract
  await deployer.token.setDAOContract(await deployer.TDFDiamond.getAddress());

  // Grant Roles
  await deployer.TDFDiamond.grantRole(ROLES['MINTER_ROLE'], await deployer.sale.getAddress());
  await deployer.TDFDiamond.grantRole(ROLES['DEFAULT_ADMIN_ROLE'], namedAccounts.TDFMultisig);

  // Renounce Roles
  await deployer.TDFDiamond.renounceRole(ROLES['DEFAULT_ADMIN_ROLE'], deployer.address);
  await deployer.TDFDiamond.renounceRole(ROLES['MINTER_ROLE'], deployer.address);
  await deployer.TDFDiamond.renounceRole(ROLES['BOOKING_MANAGER_ROLE'], deployer.address);
  await deployer.TDFDiamond.renounceRole(ROLES['STAKE_MANAGER_ROLE'], deployer.address);
  await deployer.TDFDiamond.renounceRole(ROLES['VAULT_MANAGER_ROLE'], deployer.address);
  await deployer.TDFDiamond.renounceRole(ROLES['MEMBERSHIP_MANAGER_ROLE'], deployer.address);
  await deployer.TDFDiamond.renounceRole(ROLES['BOOKING_PLATFORM_ROLE'], deployer.address);

  // Transfer Ownership
  await deployer.ownershipFacet.transferOwnership(namedAccounts.TDFMultisig);

  // Initiate 2 step transfer ownership. PLEASE NOTE: this transfer has to be accepted by the treasury
  await deployer.token.transferOwnership(namedAccounts.TDFMultisig);
  await deployer.sale.transferOwnership(namedAccounts.TDFMultisig);
  await deployer.sweatToken.transferOwnership(namedAccounts.TDFMultisig);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
