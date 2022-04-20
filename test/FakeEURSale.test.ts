import {expect} from './chai-setup';
import {deployments, getUnnamedAccounts, ethers} from 'hardhat';
import {TDFToken} from '../typechain';
import {setupUser, setupUsers} from './utils';
import {Contract} from 'ethers';
import {parseEther} from 'ethers/lib/utils';

async function getMock(name: string, deployer: string, args: Array<any>): Promise<Contract> {
  await deployments.deploy(name, {from: deployer, args: args});
  return ethers.getContract(name, deployer);
}

async function deploySale(setup: any, price: string, minbuy: string) {
  const {TDFTokenBeneficiary, FakeEURToken, TDFToken, deployer} = setup;
  const addresses = await getUnnamedAccounts();

  // fund users with fake EUR
  addresses.map(async (e) => {
    await deployer.FakeEURToken.transfer(e, parseEther('10000'));
  });

  const p = parseEther(price);
  const min = parseEther(minbuy);

  // Deploy sell
  const c = await getMock('TDFSale', deployer.address, [
    TDFToken.address,
    FakeEURToken.address,
    TDFTokenBeneficiary.address,
    p,
    min,
  ]);
  const allowance = parseEther('500000');
  await TDFTokenBeneficiary.TDFToken.approve(c.address, allowance);
  return {
    saleUsers: await setupUsers(addresses, {Sale: c}),
    Sale: c,
  };
}

const setup = deployments.createFixture(async (hre) => {
  const {deployments, getNamedAccounts, ethers} = hre;
  await deployments.fixture();

  const accounts = await getNamedAccounts();
  const users = await getUnnamedAccounts();
  const {deployer, TDFTokenBeneficiary} = accounts;

  const token: TDFToken = await ethers.getContract('TDFToken', deployer);
  const eur = await getMock('FakeEURToken', deployer, []);
  const contracts = {
    TDFToken: token,
    FakeEURToken: eur,
  };

  const tokenBeneficiary = await setupUser(TDFTokenBeneficiary, contracts);

  return {
    ...contracts,
    users: await setupUsers(users, contracts),
    deployer: await setupUser(deployer, contracts),
    TDFTokenBeneficiary: tokenBeneficiary,
    accounts,
  };
});

describe('350 price', () => {
  it('[buy] - with two decimals', async () => {
    // SETUP
    const config = await setup();
    const {users, TDFTokenBeneficiary} = config;
    const {saleUsers, Sale} = await deploySale(config, '350', '1');

    // Balances
    const tdfBal = await TDFTokenBeneficiary.TDFToken.balanceOf(TDFTokenBeneficiary.address);
    const eurBal = await users[0].FakeEURToken.balanceOf(users[0].address);
    const rem = await saleUsers[0].Sale.remainingTokens();
    expect(rem).to.gt(parseEther('1'));

    // Approve
    await users[0].FakeEURToken.approve(Sale.address, parseEther('542.5'));

    // BUY -------------------------
    await saleUsers[0].Sale.buy(parseEther('1.55'));

    // Check results
    expect(await users[0].TDFToken.balanceOf(users[0].address)).to.eq(parseEther('1.55'));
    expect(await TDFTokenBeneficiary.FakeEURToken.balanceOf(TDFTokenBeneficiary.address)).to.eq(parseEther('542.5'));
    expect(await saleUsers[0].Sale.weiRaised()).to.eq(parseEther('542.5'));
    expect(await TDFTokenBeneficiary.TDFToken.balanceOf(TDFTokenBeneficiary.address)).to.lt(tdfBal);
    expect(await users[0].FakeEURToken.balanceOf(users[0].address)).to.lt(eurBal);
  });
});
