import {task} from 'hardhat/config';
import {HardhatRuntimeEnvironment} from 'hardhat/types';
import {ROLES} from '../utils';
import {parseEther} from 'ethers/lib/utils';

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

task('diamond:mint', 'mint TDFtokens for')
  .addParam<string>('address', 'destination address')
  .addParam<string>('amount', 'ETH amount, ex: 1.5, 10. this function converts the decimals')
  .setAction(async ({address, amount}, hre) => {
    const diamond = await getDiamond(hre);
    await diamond.mintTokensFor(address, parseEther(amount));
  });

const getDiamond = async (hre: HardhatRuntimeEnvironment) => {
  const deployment = await hre.deployments.getOrNull('TDFDiamond');
  if (!deployment) throw new Error('Factory Not Deployed');
  const {deployer} = await hre.getNamedAccounts();
  return (await hre.ethers.getContractAt('TDFDiamond', deployment.address)).connect(
    await hre.ethers.getSigner(deployer)
  );
};
