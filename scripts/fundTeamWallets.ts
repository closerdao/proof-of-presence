import {getNamedAccounts, ethers} from './hardhat3-compat.js';
import {parseEther} from 'ethers';
import type {ContractMap, ConnectedContractMap, RuntimeContract} from '../utils/runtimeContract.js';

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
  const {TDFMultisig, TDFTokenBeneficiary, julienFirst, JulienSecond, sam, deployer} = await getNamedAccounts();
  const contracts = {
    token: (await ethers.getContract('TDFToken', deployer)) as RuntimeContract,
    fakeEur: (await ethers.getContract('FakeEURToken', deployer)) as RuntimeContract,
    crowdsale: (await ethers.getContract('Crowdsale', deployer)) as RuntimeContract,
  };

  const beneficiary = await setupUser(TDFTokenBeneficiary, contracts);
  const multisig = await setupUser(TDFMultisig, contracts);
  const admin = await setupUser(deployer, contracts);

  await beneficiary.token.transfer(julienFirst, parseEther('10000'));
  await beneficiary.token.transfer(JulienSecond, parseEther('10000'));
  await beneficiary.token.transfer(sam, parseEther('10000'));
  await admin.fakeEur.transfer(julienFirst, parseEther('10000'));
  await admin.fakeEur.transfer(JulienSecond, parseEther('10000'));
  await admin.fakeEur.transfer(sam, parseEther('10000'));
  await multisig.token.approve(await contracts.crowdsale.getAddress(), parseEther('10000'));
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
