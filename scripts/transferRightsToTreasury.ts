import {getNamedAccounts, ethers} from 'hardhat';
import {TDFToken, TDFDiamond, DynamicSale, SweatToken} from '../typechain';
import {Contract} from 'ethers';

import {ROLES} from '../utils';
async function setupUser<T extends {[contractName: string]: Contract}>(
  address: string,
  contracts: T
): Promise<{address: string} & T> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const user: any = {address};
  for (const key of Object.keys(contracts)) {
    user[key] = contracts[key].connect(await ethers.getSigner(address));
  }
  return user as {address: string} & T;
}
async function main() {
  const namedAccounts = await getNamedAccounts();
  const contracts = {
    token: <TDFToken>await ethers.getContract('TDFToken', namedAccounts.deployer),
    TDFDiamond: <TDFDiamond>await ethers.getContract('TDFDiamond', namedAccounts.deployer),
    sale: <DynamicSale>await ethers.getContract('DynamicSale', namedAccounts.deployer),
    sweatToken: <SweatToken>await ethers.getContract('SweatToken', namedAccounts.deployer),
  };

  const deployer = await setupUser(namedAccounts.deployer, contracts);

  // Pause Dynamic Sale contract
  await deployer.sale.pause();

  // set DAO contract
  await deployer.token.setDAOContract(deployer.TDFDiamond.address);

  // Grant Roles
  await deployer.TDFDiamond.grantRole(ROLES['MINTER_ROLE'], deployer.sale.address);
  await deployer.TDFDiamond.grantRole(ROLES['DEFAULT_ADMIN_ROLE'], namedAccounts.TDFMultisig);

  // TODO only call these if it has actually these roles
  // Renounce Roles
  await deployer.TDFDiamond.renounceRole(ROLES['DEFAULT_ADMIN_ROLE'], deployer.address);
  await deployer.TDFDiamond.renounceRole(ROLES['MINTER_ROLE'], deployer.address);
  await deployer.TDFDiamond.renounceRole(ROLES['BOOKING_MANAGER_ROLE'], deployer.address);
  await deployer.TDFDiamond.renounceRole(ROLES['STAKE_MANAGER_ROLE'], deployer.address);
  await deployer.TDFDiamond.renounceRole(ROLES['VAULT_MANAGER_ROLE'], deployer.address);
  await deployer.TDFDiamond.renounceRole(ROLES['MEMBERSHIP_MANAGER_ROLE'], deployer.address);
  await deployer.TDFDiamond.renounceRole(ROLES['BOOKING_PLATFORM_ROLE'], deployer.address);

  // Transfer Ownership
  // Initiate 2 step transfer ownership. PLEASE NOTE: this transfer has to be accepted by the treasury
  await deployer.token.transferOwnership(namedAccounts.TDFMultisig);
  await deployer.sale.transferOwnership(namedAccounts.TDFMultisig);
  await deployer.sweatToken.transferOwnership(namedAccounts.TDFMultisig);

  // TODO also transfer diamond ownership!
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
