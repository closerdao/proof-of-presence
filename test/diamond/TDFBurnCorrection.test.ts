import {expect} from '../chai-setup';
import {deployments, ethers, getNamedAccounts, network} from 'hardhat';
import {TDF_BURN} from '../../utils/tdfBurnCorrection';

const setup = deployments.createFixture(async () => {
  await deployments.fixture();
  const {deployer, TDFMultisig} = await getNamedAccounts();
  const token = await ethers.getContract('TDFToken', deployer);
  const diamond = await ethers.getContract('TDFDiamond', deployer);
  const factory = await ethers.getContractFactory('TDFBurnCorrection');
  const initializer = await factory.deploy(diamond.address, token.address);
  await initializer.deployed();

  for (const {account, amount} of TDF_BURN.targets) {
    await token.mint(account, amount.add(ethers.utils.parseEther('0.002')));
  }
  // Nonzero stakes exercise separation between wallet tokens and staking accounting.
  const staker = TDF_BURN.targets[1].account;
  await token.mint(staker, ethers.utils.parseEther('6.5'));
  await network.provider.send('hardhat_setBalance', [staker, '0x56BC75E2D63100000']);
  await network.provider.send('hardhat_impersonateAccount', [staker]);
  await diamond.connect(await ethers.getSigner(staker)).depositStake(ethers.utils.parseEther('6.5'));
  await network.provider.send('hardhat_stopImpersonatingAccount', [staker]);

  const untouched = '0xF0f4610ef547E1a5201CD1526565B8a6F92Eb515';
  await token.mint(untouched, ethers.utils.parseEther('30'));
  const data = initializer.interface.encodeFunctionData('execute');
  const execute = () => diamond.diamondCut([], initializer.address, data);
  const completion = async () =>
    ethers.BigNumber.from(await ethers.provider.getStorageAt(diamond.address, TDF_BURN.completionSlot));
  return {token, diamond, factory, initializer, data, execute, completion, deployer, TDFMultisig, untouched};
});

describe('TDFBurnCorrection', () => {
  it('burns exactly 41 TDF once, preserving selectors, stakes, roles, and other balances', async () => {
    const {token, diamond, initializer, execute, completion, TDFMultisig, untouched, deployer} = await setup();
    const supply = await token.totalSupply();
    const facets = await diamond.facets();
    const accounts = [TDFMultisig, diamond.address, untouched];
    const balances = await Promise.all(accounts.map((account) => token.balanceOf(account)));
    const stake = await diamond.stakedBalanceOf(TDF_BURN.targets[1].account);
    const deposits = await diamond.depositsStakedFor(TDF_BURN.targets[1].account);
    const years = await diamond.getAccommodationYears();
    const membership = await diamond.memberList();
    const role = ethers.constants.HashZero;
    const adminBefore = await diamond.hasRole(role, deployer);
    const slot0 = await ethers.provider.getStorageAt(diamond.address, 0);

    const tx = await execute();
    const receipt = await tx.wait();
    const burns = receipt.logs.filter(
      (log: {address: string; topics: string[]}) =>
        log.address.toLowerCase() === token.address.toLowerCase() &&
        log.topics[0] === token.interface.getEventTopic('Transfer')
    );
    expect(burns).to.have.lengthOf(4);
    for (let i = 0; i < TDF_BURN.targets.length; i++) {
      const {account, amount} = TDF_BURN.targets[i];
      const event = token.interface.parseLog(burns[i]);
      expect(event.args.from).to.eq(account);
      expect(event.args.to).to.eq(ethers.constants.AddressZero);
      expect(event.args.value).to.eq(amount);
      expect(await token.balanceOf(account)).to.eq(ethers.utils.parseEther('0.002'));
      expect(await token.allowance(account, diamond.address)).to.eq(ethers.constants.MaxUint256);
    }
    const eventAtDiamond = initializer.attach(diamond.address);
    await expect(Promise.resolve(tx)).to.emit(eventAtDiamond, 'TDFBurnCorrectionCompleted').withArgs(TDF_BURN.total);
    expect(await token.totalSupply()).to.eq(supply.sub(TDF_BURN.total));
    expect(await completion()).to.eq(1);
    expect(await diamond.facets()).to.deep.eq(facets);
    expect(await diamond.stakedBalanceOf(TDF_BURN.targets[1].account)).to.eq(stake);
    expect(await diamond.depositsStakedFor(TDF_BURN.targets[1].account)).to.deep.eq(deposits);
    expect(await diamond.getAccommodationYears()).to.deep.eq(years);
    expect(await diamond.memberList()).to.deep.eq(membership);
    expect(await diamond.hasRole(role, deployer)).to.eq(adminBefore);
    expect(await ethers.provider.getStorageAt(diamond.address, 0)).to.eq(slot0);
    expect(await token.getDAOContract()).to.eq(diamond.address);
    for (let i = 0; i < accounts.length; i++) expect(await token.balanceOf(accounts[i])).to.eq(balances[i]);
    expect(await diamond.facetAddress(initializer.interface.getSighash('execute'))).to.eq(ethers.constants.AddressZero);
    await expect(eventAtDiamond.execute()).to.be.reverted;
    expect(
      ethers.BigNumber.from(await ethers.provider.getStorageAt(initializer.address, TDF_BURN.completionSlot))
    ).to.eq(0);
  });

  it('rejects replay even after replenishment and redeployment', async () => {
    const {token, diamond, factory, data, execute, completion} = await setup();
    await execute();
    for (const {account, amount} of TDF_BURN.targets) await token.mint(account, amount);
    const supply = await token.totalSupply();
    await expect(execute()).to.be.revertedWith('TDFBurnCorrection: already executed');
    const replacement = await factory.deploy(diamond.address, token.address);
    await expect(diamond.diamondCut([], replacement.address, data)).to.be.revertedWith(
      'TDFBurnCorrection: already executed'
    );
    expect(await token.totalSupply()).to.eq(supply);
    expect(await completion()).to.eq(1);
  });

  it('requires the Diamond owner and rejects direct calls', async () => {
    const {diamond, initializer, data, completion} = await setup();
    const [, other] = await ethers.getSigners();
    await expect(diamond.connect(other).diamondCut([], initializer.address, data)).to.be.reverted;
    await expect(initializer.execute()).to.be.reverted;
    expect(await completion()).to.eq(0);
  });

  it('rejects wrong Diamond or token bindings and zero constructor addresses', async () => {
    const {token, diamond, factory, data, completion} = await setup();
    const wrong = ethers.Wallet.createRandom().address;
    const wrongDiamond = await factory.deploy(wrong, token.address);
    const wrongToken = await factory.deploy(diamond.address, wrong);
    await expect(diamond.diamondCut([], wrongDiamond.address, data)).to.be.revertedWith(
      'TDFBurnCorrection: wrong diamond'
    );
    await expect(diamond.diamondCut([], wrongToken.address, data)).to.be.revertedWith('TDFBurnCorrection: wrong token');
    await expect(factory.deploy(ethers.constants.AddressZero, token.address)).to.be.reverted;
    await expect(factory.deploy(diamond.address, ethers.constants.AddressZero)).to.be.reverted;
    expect(await completion()).to.eq(0);
  });

  it('rejects a different token DAO without retaining the completion flag', async () => {
    const {token, execute, completion, untouched} = await setup();
    const supply = await token.totalSupply();
    await token.setDAOContract(untouched);
    await expect(execute()).to.be.revertedWith('TDFBurnCorrection: wrong DAO');
    expect(await token.totalSupply()).to.eq(supply);
    expect(await completion()).to.eq(0);
  });

  for (let index = 0; index < TDF_BURN.targets.length; index++) {
    it(`reverts the whole correction when target ${index + 1} has insufficient funds`, async () => {
      const {token, execute, completion} = await setup();
      const account = TDF_BURN.targets[index].account;
      await network.provider.send('hardhat_setBalance', [account, '0x56BC75E2D63100000']);
      await network.provider.send('hardhat_impersonateAccount', [account]);
      await token.connect(await ethers.getSigner(account)).burn(ethers.utils.parseEther('1'));
      await network.provider.send('hardhat_stopImpersonatingAccount', [account]);
      const supply = await token.totalSupply();
      const balances = await Promise.all(TDF_BURN.targets.map((target) => token.balanceOf(target.account)));
      await expect(execute()).to.be.revertedWith('TDFBurnCorrection: insufficient balance');
      expect(await token.totalSupply()).to.eq(supply);
      expect(await completion()).to.eq(0);
      for (let i = 0; i < balances.length; i++)
        expect(await token.balanceOf(TDF_BURN.targets[i].account)).to.eq(balances[i]);
      await token.mint(account, ethers.utils.parseEther('1'));
      await execute();
      expect(await completion()).to.eq(1);
    });
  }

  it('rolls back the completion flag when the paused token rejects burning, allowing retry', async () => {
    const {token, execute, completion} = await setup();
    const supply = await token.totalSupply();
    await token.pause();
    await expect(execute()).to.be.revertedWith('ERC20Pausable: token transfer while paused');
    expect(await completion()).to.eq(0);
    expect(await token.totalSupply()).to.eq(supply);
    await token.unpause();
    await execute();
    expect(await completion()).to.eq(1);
  });
});
