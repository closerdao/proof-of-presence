import {expect} from 'chai';
import {id, MaxUint256, parseEther, Signature, ZeroAddress} from 'ethers';
import {ethers, type RuntimeContract} from '../../hardhat.js';

type Contract = RuntimeContract;

const MINTER_ROLE = id('MINTER_ROLE');

async function deployProxy(contractName: string, args: unknown[], signer: any): Promise<Contract> {
  const implementationFactory = await ethers.getContractFactory(contractName, signer);
  const implementation = await implementationFactory.deploy();
  await implementation.waitForDeployment();

  const proxyFactory = await ethers.getContractFactory('ERC1967ProxyForTest', signer);
  const data = implementationFactory.interface.encodeFunctionData('initialize', args);
  const proxy = await proxyFactory.deploy(await implementation.getAddress(), data);
  await proxy.waitForDeployment();
  return (await ethers.getContractAt(contractName, await proxy.getAddress(), signer)) as Contract;
}

async function setup() {
  const [deployer, owner, minter, member, relayer] = await ethers.getSigners();
  const access = await deployProxy(
    'VillageAccess',
    [owner.address, [{role: MINTER_ROLE, account: minter.address}]],
    deployer,
  );
  const token = await deployProxy(
    'CommunityToken',
    ['Village Token', 'VILLAGE', 0, MaxUint256, ZeroAddress, await access.getAddress(), ZeroAddress, owner.address],
    deployer,
  );
  const stays = await deployProxy(
    'TokenizedStays',
    [await token.getAddress(), await access.getAddress(), owner.address],
    deployer,
  );
  await token.connect(minter).mint(member.address, parseEther('20'));
  return {member, relayer, token, stays};
}

async function signPermit(
  token: Contract,
  signer: any,
  owner: string,
  spender: string,
  value: bigint,
  deadline: bigint,
) {
  const {chainId} = await ethers.provider.getNetwork();
  const signature = await signer.signTypedData(
    {
      name: await token.name(),
      version: '1',
      chainId,
      verifyingContract: await token.getAddress(),
    },
    {
      Permit: [
        {name: 'owner', type: 'address'},
        {name: 'spender', type: 'address'},
        {name: 'value', type: 'uint256'},
        {name: 'nonce', type: 'uint256'},
        {name: 'deadline', type: 'uint256'},
      ],
    },
    {
      owner,
      spender,
      value,
      nonce: await token.nonces(owner),
      deadline,
    },
  );
  return Signature.from(signature);
}

async function futureBooking(stays: Contract, offset: number, pricePerDate: bigint) {
  const dayId = (await stays.currentDayId()) + BigInt(offset);
  const [year, dayOfYear] = await stays.fromDayId(dayId);
  return {year: Number(year), dayOfYear: Number(dayOfYear), pricePerDate};
}

describe('TokenizedStays permit integration', function () {
  it('credits an exact permit-backed deposit and consumes its allowance', async function () {
    const {member, token, stays} = await setup();
    const amount = parseEther('3');
    const latest = await ethers.provider.getBlock('latest');
    const deadline = BigInt(latest!.timestamp + 3_600);
    const signature = await signPermit(token, member, member.address, await stays.getAddress(), amount, deadline);

    await expect(stays.connect(member).depositWithPermit(amount, deadline, signature.v, signature.r, signature.s))
      .to.emit(stays, 'Deposit')
      .withArgs(member.address, amount);

    expect(await stays.depositedBalanceOf(member.address)).to.equal(amount);
    expect(await stays.totalDepositedBalance()).to.equal(amount);
    expect(await token.allowance(member.address, await stays.getAddress())).to.equal(0n);
    expect(await token.nonces(member.address)).to.equal(1n);
  });

  it('accepts a deposit permit already consumed by a relayer when its allowance is sufficient', async function () {
    const {member, relayer, token, stays} = await setup();
    const amount = parseEther('3');
    const latest = await ethers.provider.getBlock('latest');
    const deadline = BigInt(latest!.timestamp + 3_600);
    const signature = await signPermit(token, member, member.address, await stays.getAddress(), amount, deadline);

    await token
      .connect(relayer)
      .permit(member.address, await stays.getAddress(), amount, deadline, signature.v, signature.r, signature.s);
    await stays.connect(member).depositWithPermit(amount, deadline, signature.v, signature.r, signature.s);

    expect(await stays.depositedBalanceOf(member.address)).to.equal(amount);
    expect(await token.allowance(member.address, await stays.getAddress())).to.equal(0n);
    expect(await token.nonces(member.address)).to.equal(1n);
  });

  it('falls back to sufficient existing allowance after any permit failure', async function () {
    const {member, relayer, token, stays} = await setup();
    const amount = parseEther('3');
    const latest = await ethers.provider.getBlock('latest');
    const deadline = BigInt(latest!.timestamp + 3_600);
    await token.connect(member).approve(await stays.getAddress(), amount);
    const invalidSignature = await signPermit(
      token,
      relayer,
      member.address,
      await stays.getAddress(),
      amount,
      deadline,
    );

    await stays
      .connect(member)
      .depositWithPermit(amount, deadline, invalidSignature.v, invalidSignature.r, invalidSignature.s);

    expect(await stays.depositedBalanceOf(member.address)).to.equal(amount);
    expect(await token.allowance(member.address, await stays.getAddress())).to.equal(0n);
    expect(await token.nonces(member.address)).to.equal(0n);
  });

  it('does not ignore a failed permit when existing allowance is insufficient', async function () {
    const {member, relayer, token, stays} = await setup();
    const amount = parseEther('3');
    const latest = await ethers.provider.getBlock('latest');
    const deadline = BigInt(latest!.timestamp + 3_600);
    await token.connect(member).approve(await stays.getAddress(), amount - 1n);
    const invalidSignature = await signPermit(
      token,
      relayer,
      member.address,
      await stays.getAddress(),
      amount,
      deadline,
    );

    await expect(
      stays
        .connect(member)
        .depositWithPermit(amount, deadline, invalidSignature.v, invalidSignature.r, invalidSignature.s),
    ).to.be.revertedWithCustomError(token, 'ERC2612InvalidSigner');

    expect(await stays.depositedBalanceOf(member.address)).to.equal(0n);
    expect(await token.allowance(member.address, await stays.getAddress())).to.equal(amount - 1n);
    expect(await token.nonces(member.address)).to.equal(0n);
  });

  it('permits and pulls only a partially funded booking deficit', async function () {
    const {member, token, stays} = await setup();
    const price = parseEther('5');
    const existingDeposit = parseEther('2');
    const deficit = price - existingDeposit;
    await token.connect(member).approve(await stays.getAddress(), existingDeposit);
    await stays.connect(member).deposit(existingDeposit);

    const booking = await futureBooking(stays, 30, price);
    const latest = await ethers.provider.getBlock('latest');
    const deadline = BigInt(latest!.timestamp + 3_600);
    const signature = await signPermit(token, member, member.address, await stays.getAddress(), deficit, deadline);

    await stays.connect(member).createBookingsWithPermit([booking], deadline, signature.v, signature.r, signature.s);

    expect(await stays.depositedBalanceOf(member.address)).to.equal(price);
    expect(await stays.requiredLockedBalance(member.address)).to.equal(price);
    const [exists, stored] = await stays.getBooking(member.address, booking.year, booking.dayOfYear);
    expect(exists).to.equal(true);
    expect(stored.pricePerDate).to.equal(price);
    expect(await token.allowance(member.address, await stays.getAddress())).to.equal(0n);
    expect(await token.balanceOf(await stays.getAddress())).to.equal(price);
  });

  it('accepts a booking permit already consumed by a relayer and pulls only the live deficit', async function () {
    const {member, relayer, token, stays} = await setup();
    const price = parseEther('5');
    const signedDeficit = parseEther('3');
    const booking = await futureBooking(stays, 30, price);

    await token.connect(member).approve(await stays.getAddress(), parseEther('2'));
    await stays.connect(member).deposit(parseEther('2'));
    const latest = await ethers.provider.getBlock('latest');
    const deadline = BigInt(latest!.timestamp + 3_600);
    const signature = await signPermit(
      token,
      member,
      member.address,
      await stays.getAddress(),
      signedDeficit,
      deadline,
    );
    await token
      .connect(relayer)
      .permit(member.address, await stays.getAddress(), signedDeficit, deadline, signature.v, signature.r, signature.s);

    // A later deposit reduces both the live deficit and the consumed permit allowance by the same amount.
    await stays.connect(member).deposit(parseEther('1'));
    await stays.connect(member).createBookingsWithPermit([booking], deadline, signature.v, signature.r, signature.s);

    expect(await stays.depositedBalanceOf(member.address)).to.equal(price);
    expect(await stays.requiredLockedBalance(member.address)).to.equal(price);
    expect(await token.allowance(member.address, await stays.getAddress())).to.equal(0n);
    expect(await token.nonces(member.address)).to.equal(1n);
  });

  it('rolls back a valid permit when Closer booking validation fails', async function () {
    const {member, token, stays} = await setup();
    const amount = parseEther('2');
    const booking = await futureBooking(stays, 30, amount);
    const latest = await ethers.provider.getBlock('latest');
    const deadline = BigInt(latest!.timestamp + 3_600);
    const initialPermit = await signPermit(token, member, member.address, await stays.getAddress(), amount, deadline);
    await stays
      .connect(member)
      .createBookingsWithPermit([booking], deadline, initialPermit.v, initialPermit.r, initialPermit.s);

    const nonceBefore = await token.nonces(member.address);
    const memberBalanceBefore = await token.balanceOf(member.address);
    const staysBalanceBefore = await token.balanceOf(await stays.getAddress());
    const duplicatePermit = await signPermit(token, member, member.address, await stays.getAddress(), amount, deadline);
    await expect(
      stays
        .connect(member)
        .createBookingsWithPermit([booking], deadline, duplicatePermit.v, duplicatePermit.r, duplicatePermit.s),
    ).to.be.revertedWithCustomError(stays, 'BookingConflict');

    expect(await stays.depositedBalanceOf(member.address)).to.equal(amount);
    expect(await stays.totalDepositedBalance()).to.equal(amount);
    const [exists, stored] = await stays.getBooking(member.address, booking.year, booking.dayOfYear);
    expect(exists).to.equal(true);
    expect(stored.pricePerDate).to.equal(amount);
    expect(await token.nonces(member.address)).to.equal(nonceBefore);
    expect(await token.allowance(member.address, await stays.getAddress())).to.equal(0n);
    expect(await token.balanceOf(member.address)).to.equal(memberBalanceBefore);
    expect(await token.balanceOf(await stays.getAddress())).to.equal(staysBalanceBefore);
  });

  it('rejects permit booking when the existing deposit already covers the live exposure', async function () {
    const {member, token, stays} = await setup();
    const amount = parseEther('2');
    await token.connect(member).approve(await stays.getAddress(), amount);
    await stays.connect(member).deposit(amount);
    const booking = await futureBooking(stays, 30, amount);
    const latest = await ethers.provider.getBlock('latest');
    const deadline = BigInt(latest!.timestamp + 3_600);
    const signature = await signPermit(token, member, member.address, await stays.getAddress(), 0n, deadline);

    await expect(
      stays.connect(member).createBookingsWithPermit([booking], deadline, signature.v, signature.r, signature.s),
    ).to.be.revertedWithCustomError(stays, 'NoBookingDepositDeficit');
    expect(await token.nonces(member.address)).to.equal(0n);
    const [exists] = await stays.getBooking(member.address, booking.year, booking.dayOfYear);
    expect(exists).to.equal(false);
  });

  it('atomically rejects a permit whose signed deficit became stale', async function () {
    const {member, token, stays} = await setup();
    const price = parseEther('5');
    const signedDeficit = parseEther('3');
    const booking = await futureBooking(stays, 30, price);

    await token.connect(member).approve(await stays.getAddress(), parseEther('2'));
    await stays.connect(member).deposit(parseEther('2'));
    const latest = await ethers.provider.getBlock('latest');
    const deadline = BigInt(latest!.timestamp + 3_600);
    const signature = await signPermit(
      token,
      member,
      member.address,
      await stays.getAddress(),
      signedDeficit,
      deadline,
    );

    // A later deposit lowers the live deficit from three tokens to two, making the exact permit stale.
    await token.connect(member).approve(await stays.getAddress(), parseEther('1'));
    await stays.connect(member).deposit(parseEther('1'));
    const nonceBefore = await token.nonces(member.address);

    await expect(
      stays.connect(member).createBookingsWithPermit([booking], deadline, signature.v, signature.r, signature.s),
    ).to.be.revertedWithCustomError(token, 'ERC2612InvalidSigner');

    expect(await token.nonces(member.address)).to.equal(nonceBefore);
    expect(await stays.depositedBalanceOf(member.address)).to.equal(parseEther('3'));
    const [exists] = await stays.getBooking(member.address, booking.year, booking.dayOfYear);
    expect(exists).to.equal(false);
  });
});
