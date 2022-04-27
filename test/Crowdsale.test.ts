import {expect} from './chai-setup';
import {deployments, getUnnamedAccounts, ethers} from 'hardhat';
import {TDFToken} from '../typechain';
import {setupUser, setupUsers} from './utils';
import {Contract} from 'ethers';
import {parseEther} from 'ethers/lib/utils';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function getMock(name: string, deployer: string, args: Array<any>): Promise<Contract> {
  await deployments.deploy(name, {from: deployer, args: args});
  return ethers.getContract(name, deployer);
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function deploySale(setup: Record<string, any>, price: string, minbuy: string) {
  const {TDFTokenBeneficiary, FakeEURToken, TDFToken, deployer} = setup;
  const addresses = await getUnnamedAccounts();

  // fund users with fake EUR
  addresses.map(async (e) => {
    await deployer.FakeEURToken.transfer(e, parseEther('10000'));
  });

  const p = parseEther(price);
  const min = parseEther(minbuy);

  // Deploy sell
  const c = await getMock('Crowdsale', deployer.address, [
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
    saleDeployer: await setupUser(deployer.address, {Sale: c}),
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

describe('Crowdsale', () => {
  it('[buy] - price 350 - with two decimals', async () => {
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
    await expect(saleUsers[0].Sale.buy(parseEther('1.55')))
      .to.emit(Sale, 'TokensPurchased')
      .withArgs(saleUsers[0].address, saleUsers[0].address, parseEther('1.55'), parseEther('542.5'));

    // Check results
    expect(await users[0].TDFToken.balanceOf(users[0].address)).to.eq(parseEther('1.55'));
    expect(await TDFTokenBeneficiary.FakeEURToken.balanceOf(TDFTokenBeneficiary.address)).to.eq(parseEther('542.5'));
    // wei raised
    expect(await saleUsers[0].Sale.weiRaised()).to.eq(parseEther('542.5'));

    expect(await TDFTokenBeneficiary.TDFToken.balanceOf(TDFTokenBeneficiary.address)).to.lt(tdfBal);
    expect(await users[0].FakeEURToken.balanceOf(users[0].address)).to.lt(eurBal);
  });

  it('getters', async () => {
    // SETUP
    const config = await setup();
    const {TDFTokenBeneficiary, TDFToken, FakeEURToken} = config;
    const {saleUsers} = await deploySale(config, '350', '1');
    const user = saleUsers[0];

    expect(await user.Sale.token()).to.eq(TDFToken.address);
    expect(await user.Sale.quote()).to.eq(FakeEURToken.address);
    expect(await user.Sale.wallet()).to.eq(TDFTokenBeneficiary.address);
    expect(await user.Sale.price()).to.eq(parseEther('350'));
  });

  it('ownable', async () => {
    // SETUP
    const config = await setup();
    const {saleUsers, saleDeployer, Sale} = await deploySale(config, '150', '1');
    const user = saleUsers[0];
    const deployer = saleDeployer;

    // Set Price
    await expect(deployer.Sale.setPrice(parseEther('1'))).to.be.revertedWith('Price to low');
    await expect(deployer.Sale.setPrice(parseEther('350')))
      .to.emit(Sale, 'PriceChanged')
      .withArgs(parseEther('150'), parseEther('350'));
    expect(await user.Sale.price()).to.eq(parseEther('350'));
    await expect(user.Sale.setPrice(parseEther('340'))).to.be.revertedWith('Ownable: caller is not the owner');

    // Pause
    expect(await user.Sale.paused()).to.be.false;
    await expect(user.Sale.pause()).to.be.revertedWith('Ownable: caller is not the owner');
    expect(await user.Sale.paused()).to.be.false;
    await expect(deployer.Sale.pause()).to.emit(Sale, 'Paused');
    expect(await user.Sale.paused()).to.be.true;
    await expect(user.Sale.unpause()).to.be.revertedWith('Ownable: caller is not the owner');

    // TransferOwnership
    expect(await deployer.Sale.owner()).to.eq(deployer.address);
    await expect(deployer.Sale.transferOwnership(user.address))
      .to.emit(Sale, 'OwnershipTransferred')
      .withArgs(deployer.address, user.address);
    expect(await user.Sale.owner()).to.eq(user.address);
    await expect(user.Sale.unpause()).to.emit(Sale, 'Unpaused');
  });

  it('pausable', async () => {
    // SETUP
    const config = await setup();
    const {users} = config;
    const {saleUsers, saleDeployer, Sale} = await deploySale(config, '350', '1');
    const user = saleUsers[0];
    const deployer = saleDeployer;

    // Approve
    await users[0].FakeEURToken.approve(Sale.address, parseEther('350'));

    // Pause the contract
    await expect(deployer.Sale.pause()).to.emit(Sale, 'Paused');

    // BUY Reverted -------------
    await expect(user.Sale.buy(parseEther('1'))).to.be.revertedWith('Pausable: paused');
    await expect(deployer.Sale.buy(parseEther('1'))).to.be.revertedWith('Pausable: paused');

    // Unpause the contract
    await expect(deployer.Sale.unpause()).to.emit(Sale, 'Unpaused');

    // BUY -------------------------
    await expect(user.Sale.buy(parseEther('1')))
      .to.emit(Sale, 'TokensPurchased')
      .withArgs(user.address, user.address, parseEther('1'), parseEther('350'));
  });
});
