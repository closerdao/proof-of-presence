import {expect} from './chai-setup';
import {deployments, getUnnamedAccounts, ethers} from 'hardhat';
import {TDFToken, TDFSale, IWeth} from '../typechain';
import {setupUser, setupUsers, getInactiveContract, topUpFunds, getActiveContract} from './utils';
import {BigNumber} from 'ethers';

const setup = deployments.createFixture(async (hre) => {
  const {deployments, getNamedAccounts, ethers} = hre;
  await deployments.fixture();

  const accounts = await getNamedAccounts();
  const {deployer, weth, TDFTokenBeneficiary} = accounts;
  const contracts = {
    TDFToken: <TDFToken>await ethers.getContract('TDFToken', deployer),
    TDFSale: <TDFSale>await getInactiveContract('TDFSale'),
    WETH: <IWeth>await getActiveContract('weth'),
  };

  return {
    ...contracts,
    users: await setupUsers(await getUnnamedAccounts(), contracts),
    deployer: await setupUser(deployer, contracts),
    TDFTokenBeneficiary: await setupUser(TDFTokenBeneficiary, contracts),
    accounts,
  };
});

describe('TDFSale', () => {
  it('WETH 1:1 Sale', async () => {
    const {users, TDFSale, TDFTokenBeneficiary, accounts} = await setup();

    const seller = TDFTokenBeneficiary;
    const buyer = users[0];
    const funds = '10.0';
    const BNFunds = ethers.utils.parseUnits(funds, 18);
    await topUpFunds('weth', buyer.address, funds);
    const amount = ethers.utils.parseUnits('1', 18);
    await buyer.WETH.approve(TDFSale.address, amount);
    await TDFTokenBeneficiary.TDFToken.approve(TDFSale.address, amount);
    const walletBalance = await seller.TDFToken.balanceOf(seller.address);
    const zero = ethers.utils.parseUnits('0', 18);

    // EXECUTE ----------
    await buyer.TDFSale.buy(ethers.utils.parseUnits('1', 18));
    // --------------------
    // Buyer balances
    expect(await buyer.TDFToken.balanceOf(buyer.address)).to.eq(amount);
    expect(await buyer.WETH.balanceOf(buyer.address)).to.eq(BNFunds.sub(amount));
    // seller balances
    expect(await seller.WETH.balanceOf(seller.address)).to.eq(amount);
    expect(await seller.TDFToken.balanceOf(seller.address)).to.eq(walletBalance.sub(amount));
    // Contract balances
    expect(await users[1].TDFToken.balanceOf(TDFSale.address)).to.eq(zero);
    expect(await users[1].WETH.balanceOf(TDFSale.address)).to.eq(zero);
  });
});
