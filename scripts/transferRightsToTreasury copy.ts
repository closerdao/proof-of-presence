import {getNamedAccounts, ethers, run} from 'hardhat';
import {TDFTokenTest, TDFDiamond, DynamicSaleTest, FakeEURToken} from '../typechain';
import {Contract} from 'ethers';

import {ROLES} from '../utils';
import {parseEther} from 'ethers/lib/utils';
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
    token: <TDFTokenTest>await ethers.getContract('TDFTokenTest', namedAccounts.deployer),
    TDFDiamond: <TDFDiamond>await ethers.getContract('TDFDiamond', namedAccounts.deployer),
    sale: <DynamicSaleTest>await ethers.getContract('DynamicSaleTest', namedAccounts.deployer),
    fakeEur: <FakeEURToken>await ethers.getContract('FakeEURToken', namedAccounts.deployer),
  };

  const deployer = await setupUser(namedAccounts.deployer, contracts);
  // await deployer.fakeEur.faucet(parseEther('1000000000'));
  // await deployer.fakeEur.approve(contracts.sale.address, parseEther('1000000000'));

  // await deployer.token.mint(namedAccounts.TDFTokenBeneficiary, parseEther('5201'));

  // // // Grant Roles
  // await deployer.TDFDiamond.grantRole(ROLES['DEFAULT_ADMIN_ROLE'], namedAccounts.TDFTokenBeneficiary);

  // // Transfer Ownership
  // // Initiate 2 step transfer ownership. PLEASE NOTE: this transfer has to be accepted by the treasury
  // await deployer.token.transferOwnership(namedAccounts.TDFTokenBeneficiary);
  // await deployer.sale.transferOwnership(namedAccounts.TDFTokenBeneficiary);

  await deployer.sale.buy(parseEther('80'));
  console.log(1 * 10 ** 18);
  const supply = await deployer.token.totalSupply();
  console.log(supply.toString());
  const price = await deployer.sale.calculateCurrentPrice();
  console.log(price.toString());
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
