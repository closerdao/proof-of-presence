import {getNamedAccounts, getUnnamedAccounts, ethers, run} from 'hardhat';
import {TDFToken, FakeEURToken, DynamicSale} from '../typechain';
import {Contract} from 'ethers';
import {formatEther, parseEther} from 'ethers/lib/utils';
import fs from 'fs-extra';
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
  await run('deploy');
  const namedAccounts = await getNamedAccounts();
  const users = await getUnnamedAccounts();
  const contracts = {
    token: <TDFToken>await ethers.getContract('TDFToken', namedAccounts.deployer),
    fakeEur: <FakeEURToken>await ethers.getContract('FakeEURToken', namedAccounts.deployer),
    sale: <DynamicSale>await ethers.getContract('DynamicSale', namedAccounts.deployer),
  };

  const user = await setupUser(users[0], contracts);
  const deployer = await setupUser(namedAccounts.deployer, contracts);

  // Make user millionare
  await user.fakeEur.faucet(parseEther('1000000000'));
  await user.fakeEur.approve(contracts.sale.address, parseEther('1000000000'));

  // Mint initial tokens
  await deployer.token.mint(deployer.address, parseEther('2433'));

  const data: {tokenSupply: string; amount: number; nextUnitPrice: string; amountCost: string}[] = [];
  const step = 1;
  for (let i = 2433; i < 6433; i += step) {
    data.push({
      tokenSupply: formatEther(await contracts.token.totalSupply()),
      amount: step,
      nextUnitPrice: formatEther(await contracts.sale.calculateTotalCost(parseEther('1'))),
      amountCost: formatEther(await contracts.sale.calculateTotalCost(parseEther(step.toString()))),
    });
    await user.sale.buy(parseEther(step.toString()));
  }

  await fs.writeJson(`pricesOutput_${step}_step.json`, data);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
