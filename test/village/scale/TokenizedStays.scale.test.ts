import {expect} from 'chai';
import {id, parseEther, ZeroAddress} from 'ethers';
import {ethers} from '../../hardhat-compat.js';
import type {RuntimeContract} from '../../../utils/runtimeContract.js';

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

async function setup(balance: bigint) {
  const [deployer, owner, minter, member] = await ethers.getSigners();
  const access = await deployProxy(
    'VillageAccess',
    [owner.address, [{role: MINTER_ROLE, account: minter.address}]],
    deployer,
  );
  const token = await deployProxy(
    'CommunityToken',
    ['Village Token', 'VILLAGE', 0, ZeroAddress, await access.getAddress(), ZeroAddress, owner.address],
    deployer,
  );
  const stays = await deployProxy(
    'TokenizedStays',
    [await token.getAddress(), await access.getAddress(), owner.address],
    deployer,
  );
  await token.connect(minter).mint(member.address, balance);
  await token.connect(member).approve(await stays.getAddress(), balance);
  return {member, stays};
}

describe('V2 TokenizedStays gas boundary', function () {
  it('books a full 365-night year below a normal block gas limit', async function () {
    this.timeout(120_000);
    const {member, stays} = await setup(parseEther('500'));
    const [currentYear] = await stays.fromDayId(await stays.currentDayId());
    const bookingYear = Number(currentYear) + 1;
    const bookings = Array.from({length: 365}, (_, index) => ({
      year: bookingYear,
      dayOfYear: index + 1,
      pricePerDate: parseEther('1'),
    }));

    const transaction = await stays.connect(member).createBookings(bookings);
    const receipt = await transaction.wait();
    expect(receipt!.gasUsed).to.be.lessThan(24_000_000n);
    expect(await stays.requiredLockedBalance(member.address)).to.equal(parseEther('365'));
  });
});

const describeTenYearScale = process.env.RUN_V2_SCALE === '1' ? describe : describe.skip;

describeTenYearScale('V2 TokenizedStays ten-year scale', function () {
  it('supports a continuous ten-calendar-year stay across normal yearly transactions', async function () {
    this.timeout(180_000);
    const {member, stays} = await setup(parseEther('500'));
    const [currentYear] = await stays.fromDayId(await stays.currentDayId());
    const firstYear = Number(currentYear) + 1;
    for (let year = firstYear; year < firstYear + 10; year += 1) {
      const yearDays = Number(await stays.daysInYear(year));
      const bookings = Array.from({length: yearDays}, (_, index) => ({
        year,
        dayOfYear: index + 1,
        pricePerDate: 1n,
      }));
      await stays.connect(member).createBookings(bookings);
      expect(await stays.bookingCountForYear(member.address, year)).to.equal(BigInt(yearDays));
    }

    expect(await stays.latestBookedYear(member.address)).to.equal(BigInt(firstYear + 9));
    expect(await stays.requiredLockedBalance(member.address)).to.equal(365n);
  });
});
