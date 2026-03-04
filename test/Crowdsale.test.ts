import {expect} from 'chai';
import {deployments, getUnnamedAccounts} from './hardhat-compat.js';
import {TDFToken} from '../types/ethers-contracts/index.js';
import {setupUser, setupUsers, getMock} from './utils/index.js';
import {getAddress, parseEther} from 'ethers';

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
    await TDFToken.getAddress(),
    await FakeEURToken.getAddress(),
    TDFTokenBeneficiary.address,
    p,
    min,
  ]);
  const allowance = parseEther('500000');
  await TDFTokenBeneficiary.TDFToken.approve(await c.getAddress(), allowance);
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
  xit('[buy] - price 350 - with two decimals', async () => {
    // SETUP
    const config = await setup();
    const {users, TDFTokenBeneficiary, FakeEURToken, TDFToken} = config;
    const {saleUsers, Sale} = await deploySale(config, '350', '1');

    // Balances
    const tdfBal = await TDFToken.balanceOf(TDFTokenBeneficiary.address);
    const eurBal = await FakeEURToken.balanceOf(users[0].address);
    const rem = await Sale.remainingTokens();
    expect(rem).to.gt(parseEther('1'));

    // Approve
    await users[0].FakeEURToken.approve(await Sale.getAddress(), parseEther('542.5'));

    // BUY -------------------------
    await expect(saleUsers[0].Sale.buy(parseEther('1.55')))
      .to.emit(Sale, 'TokensPurchased')
      .withArgs(
        getAddress(saleUsers[0].address),
        getAddress(saleUsers[0].address),
        parseEther('1.55'),
        parseEther('542.5'),
      );

    // Check results
    expect(await TDFToken.balanceOf(users[0].address)).to.eq(parseEther('1.55'));
    expect(await FakeEURToken.balanceOf(TDFTokenBeneficiary.address)).to.eq(parseEther('542.5'));
    // wei raised
    expect(await Sale.weiRaised()).to.eq(parseEther('542.5'));

    expect(await TDFToken.balanceOf(TDFTokenBeneficiary.address)).to.lt(tdfBal);
    expect(await FakeEURToken.balanceOf(users[0].address)).to.lt(eurBal);
  });

  it('getters', async () => {
    // SETUP
    const config = await setup();
    const {TDFTokenBeneficiary, TDFToken, FakeEURToken} = config;
    const {Sale} = await deploySale(config, '350', '1');

    expect(getAddress(await Sale.token())).to.eq(getAddress(await TDFToken.getAddress()));
    expect(getAddress(await Sale.quote())).to.eq(getAddress(await FakeEURToken.getAddress()));
    expect(getAddress(await Sale.wallet())).to.eq(getAddress(TDFTokenBeneficiary.address));
    expect(await Sale.price()).to.eq(parseEther('350'));
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
    expect(await Sale.paused()).to.be.false;
    await expect(user.Sale.pause()).to.be.revertedWith('Ownable: caller is not the owner');
    expect(await Sale.paused()).to.be.false;
    await expect(deployer.Sale.pause()).to.emit(Sale, 'Paused');
    expect(await Sale.paused()).to.be.true;
    await expect(user.Sale.unpause()).to.be.revertedWith('Ownable: caller is not the owner');

    // TransferOwnership
    expect(await Sale.owner()).to.eq(getAddress(deployer.address));
    await expect(deployer.Sale.transferOwnership(user.address))
      .to.emit(Sale, 'OwnershipTransferred')
      .withArgs(getAddress(deployer.address), getAddress(user.address));
    expect(await Sale.owner()).to.eq(getAddress(user.address));
    await expect(user.Sale.unpause()).to.emit(Sale, 'Unpaused');
  });

  xit('pausable', async () => {
    // SETUP
    const config = await setup();
    const {users} = config;
    const {saleUsers, saleDeployer, Sale} = await deploySale(config, '350', '1');
    const user = saleUsers[0];
    const deployer = saleDeployer;

    // Approve
    await users[0].FakeEURToken.approve(await Sale.getAddress(), parseEther('350'));

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
      .withArgs(getAddress(user.address), getAddress(user.address), parseEther('1'), parseEther('350'));
  });
});
