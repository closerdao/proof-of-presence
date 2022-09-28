import {task} from 'hardhat/config';
import {HardhatRuntimeEnvironment} from 'hardhat/types';
import {ROLES} from '../utils';

task('diamond:set_locking_period', 'change staking locking period')
  .addPositionalParam('amount', 'amount to set')
  .addFlag('minutes')
  .addFlag('days')
  .setAction(async ({days, minutes, amount}, hre) => {
    const to_minutes = (n: number) => n * 3600;
    const to_days = (n: number) => n * 86400;
    let seconds: number = amount ? amount : 864000;
    let unit = 'seconds';
    if (days) {
      seconds = to_days(amount);
      unit = 'days';
    }
    if (minutes) {
      seconds = to_minutes(amount);
      unit = 'minutes';
    }
    const diamond = await getDiamond(hre);
    console.log(`Setting staking locking time period to: ${amount} ${unit}`);
    await diamond.setLockingTimePeriodSeconds(seconds);
    console.log('SUCCESS');
  });

task('diamond:grant-role', 'set role to given address')
  .addPositionalParam('address', 'address to assign the role')
  .addFlag('admin')
  .addFlag('minter')
  .addFlag('bookingManager')
  .addFlag('stakeManager')
  .addFlag('vaultManager')
  .addFlag('membershipManager')
  .setAction(async ({address, minter, booking_manager, stake_manager, vault_manager, membership_manager}, hre) => {
    let role: string = ROLES.DEFAULT_ADMIN_ROLE;
    let role_name = 'admin';
    if (minter) {
      role = ROLES.MINTER_ROLE;
      role_name = 'minter';
    }
    if (booking_manager) {
      role = ROLES.BOOKING_MANAGER_ROLE;
      role_name = 'booking_manager';
    }
    if (stake_manager) {
      role = ROLES.STAKE_MANAGER_ROLE;
      role_name = 'stake_manager';
    }
    if (vault_manager) {
      role = ROLES.VAULT_MANAGER_ROLE;
      role_name = 'vault_manager';
    }
    if (membership_manager) {
      role = ROLES.MEMBERSHIP_MANAGER_ROLE;
      role_name = 'membership_manager';
    }

    const diamond = await getDiamond(hre);
    console.log(`granting role ${role_name} to ${address} ...`);
    await diamond.grantRole(role, address);
    console.log('ROLE GRANTED');
  });

const getDiamond = async (hre: HardhatRuntimeEnvironment) => {
  const deployment = await hre.deployments.getOrNull('TDFDiamond');
  if (!deployment) throw new Error('Factory Not Deployed');
  const {deployer} = await hre.getNamedAccounts();
  return await (
    await hre.ethers.getContractAt('TDFDiamond', deployment.address)
  ).connect(await hre.ethers.getSigner(deployer));
};
