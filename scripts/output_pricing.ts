import {getNamedAccounts, getUnnamedAccounts, ethers, runDeploy} from './hardhat3-compat.js';
import {formatEther, parseEther} from 'ethers';
import fs from 'fs-extra';
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
  await runDeploy();
  const namedAccounts = await getNamedAccounts();
  const users = await getUnnamedAccounts();
  const contracts = {
    token: (await ethers.getContract('TDFToken', namedAccounts.deployer)) as RuntimeContract,
    fakeEur: (await ethers.getContract('FakeEURToken', namedAccounts.deployer)) as RuntimeContract,
    sale: (await ethers.getContract('DynamicSale', namedAccounts.deployer)) as RuntimeContract,
  };

  const user = await setupUser(users[0], contracts);
  const deployer = await setupUser(namedAccounts.deployer, contracts);

  // Make user millionare
  await user.fakeEur.faucet(parseEther('1000000000'));
  await user.fakeEur.approve(await contracts.sale.getAddress(), parseEther('1000000000'));

  // Mint initial tokens
  await deployer.token.mint(deployer.address, parseEther('2433'));

  const data: {tokenSupply: string; amount: number; nextUnitPrice: string; amountCost: string}[] = [];
  const step = 1;
  for (let i = 2433; i < 6433; i += step) {
    const oneTokenCost = await contracts.sale.calculateTotalCost(parseEther('1'));
    const stepCost = await contracts.sale.calculateTotalCost(parseEther(step.toString()));
    data.push({
      tokenSupply: formatEther(await contracts.token.totalSupply()),
      amount: step,
      nextUnitPrice: formatEther(oneTokenCost.totalCost),
      amountCost: formatEther(stepCost.totalCost),
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
