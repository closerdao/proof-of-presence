import {BigNumberish, Contract} from 'ethers';
import {expect} from '../../chai-setup';
import {deployments, getUnnamedAccounts, ethers} from 'hardhat';
import {EnumerableMapLibMock} from '../../../typechain';
import {setupUser, setupUsers} from '../../utils';
const BN = ethers.BigNumber;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function getMock(name: string, deployer: string, args: Array<any>): Promise<Contract> {
  await deployments.deploy(name, {from: deployer, args: args});
  return ethers.getContract(name, deployer);
}

const setup = deployments.createFixture(async (hre) => {
  const {deployments, getNamedAccounts} = hre;
  await deployments.fixture();

  const accounts = await getNamedAccounts();
  const users = await getUnnamedAccounts();
  const {deployer} = accounts;

  const contracts = {
    BUStorage: <EnumerableMapLibMock>await getMock('EnumerableMapLibMock', deployer, []),
  };

  const conf = {
    ...contracts,
    users: await setupUsers(users, contracts),
    deployer: await setupUser(deployer, contracts),
    accounts,
  };

  return conf;
});

describe('EnumerableMapLib', () => {
  const uintA = BN.from('7891');
  const uintB = BN.from('451');
  const uintC = BN.from('9592328');

  const bytesA = '0xdeadbeef'.padEnd(66, '0');
  const bytesB = '0x0123456789'.padEnd(66, '0');
  const bytesC = '0x42424242'.padEnd(66, '0');
  it('set and get', async () => {
    const {BUStorage, users} = await setup();
    const user = users[0];

    const testKV = async (k: string, v: BigNumberish) => {
      const noByte = '0x42424242783643'.padEnd(66, '0');
      await expect(user.BUStorage.set(k, v)).to.emit(BUStorage, 'OperationResult').withArgs(true);

      const [o, v1] = await user.BUStorage.tryGet(k);
      expect(o).to.eq(true);
      expect(v1).to.eq(v);
      expect(await user.BUStorage.get(k)).to.eq(v);
      expect(await user.BUStorage.getWithMessage(k, 'error')).to.eq(v);
      await expect(user.BUStorage.getWithMessage(noByte, 'error')).to.be.revertedWith('error');
    };
    await testKV(bytesA, uintA);
    expect(await user.BUStorage.length()).to.eq(1);
    const [kA, vA] = await user.BUStorage.at(0);
    expect(kA).to.eq(bytesA);
    expect(vA).to.eq(uintA);
    // --------
    await testKV(bytesB, uintB);
    expect(await user.BUStorage.length()).to.eq(2);
    const [kB, vB] = await user.BUStorage.at(1);
    expect(kB).to.eq(bytesB);
    expect(vB).to.eq(uintB);
    // --------
    await testKV(bytesC, uintC);
    expect(await user.BUStorage.length()).to.eq(3);
    const [kC, vC] = await user.BUStorage.at(2);
    expect(kC).to.eq(bytesC);
    expect(vC).to.eq(uintC);

    await expect(user.BUStorage.remove(bytesA)).to.emit(BUStorage, 'OperationResult').withArgs(true);
    expect(await user.BUStorage.length()).to.eq(2);
    const [kD, vD] = await user.BUStorage.at(1);
    expect(kD).to.eq(bytesB);
    expect(vD).to.eq(uintB);
  });
});
