import {getNamedAccounts, ethers} from 'hardhat';
import {TDFToken, Crowdsale, FakeEURToken} from '../typechain';
import {Contract} from 'ethers';
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
  const {TDFDevMultisig, TDFTokenBeneficiary, julienFirst, JulienSecond, sam, deployer} = await getNamedAccounts();
  const contracts = {
    token: <TDFToken>await ethers.getContract('TDFToken', deployer),
    fakeEur: <FakeEURToken>await ethers.getContract('FakeEURToken', deployer),
    crowdsale: <Crowdsale>await ethers.getContract('Crowdsale', deployer),
  };

  const beneficiary = await setupUser(TDFTokenBeneficiary, contracts);
  const multisig = await setupUser(TDFDevMultisig, contracts);
  const admin = await setupUser(deployer, contracts);

  await beneficiary.token.transfer(julienFirst, parseEther('10000'));
  await beneficiary.token.transfer(JulienSecond, parseEther('10000'));
  await beneficiary.token.transfer(sam, parseEther('10000'));
  await admin.fakeEur.transfer(julienFirst, parseEther('10000'));
  await admin.fakeEur.transfer(JulienSecond, parseEther('10000'));
  await admin.fakeEur.transfer(sam, parseEther('10000'));
  await multisig.token.approve(contracts.crowdsale.address, parseEther('10000'));
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
