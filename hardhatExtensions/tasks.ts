import {task} from 'hardhat/config';
import {HardhatRuntimeEnvironment} from 'hardhat/types';
import {ROLES} from '../utils';
import {parseEther} from 'ethers/lib/utils';
import {Citizen} from '../typechain';

task('diamond:grant-role', 'set role to given address in TDFDiamond')
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
    await diamond.mintCommunityTokenTo(address, parseEther(amount));
  });

task('citizen:grant-role', 'set role to given address in Citizen contract')
  .addPositionalParam('address', 'address to assign the role')
  .addFlag('admin')
  .addFlag('minter')
  .addFlag('revoker')
  .addFlag('upgrader')
  .addFlag('dao')
  .setAction(async ({address, admin, minter, revoker, upgrader, dao}, hre) => {
    let role: string = ROLES.DEFAULT_ADMIN_ROLE;
    let role_name = 'admin';
    if (minter) {
      role = ROLES.MINTER_ROLE;
      role_name = 'minter';
    }
    if (revoker) {
      role = ROLES.REVOKER_ROLE;
      role_name = 'revoker';
    }
    if (upgrader) {
      role = ROLES.UPGRADER_ROLE;
      role_name = 'upgrader';
    }
    if (dao) {
      role = ROLES.DAO_ROLE;
      role_name = 'dao';
    }

    const citizen = await getCitizen(hre);
    console.log(`granting role ${role_name} to ${address} in Citizen contract...`);
    await citizen.grantRole(role, address);
    console.log('ROLE GRANTED');
  });

task('citizen:mint', 'Mint a new Citizen NFT')
  .addParam<string>('address', 'Destination address')
  .addParam<string>('uri', 'Token URI for the citizen metadata')
  .addParam<number>('level', 'Verification level (0-3)')
  .setAction(async ({address, uri, level}, hre) => {
    const citizen = await getCitizen(hre);
    console.log(`Minting Citizen NFT to ${address} with verification level ${level}...`);
    await citizen.safeMint(address, uri, level);
    console.log('Citizen NFT minted successfully');
  });

task('citizen:revoke', 'Revoke citizenship from an address')
  .addParam<string>('address', 'Address to revoke citizenship from')
  .addParam<string>('reason', 'Reason for revocation')
  .setAction(async ({address, reason}, hre) => {
    const citizen = await getCitizen(hre);
    console.log(`Revoking citizenship from ${address}...`);
    await citizen.revokeCitizenship(address, reason);
    console.log('Citizenship revoked successfully');
  });

task('citizen:update-level', 'Update verification level for a citizen')
  .addParam<string>('address', 'Citizen address')
  .addParam<number>('level', 'New verification level (0-3)')
  .setAction(async ({address, level}, hre) => {
    const citizen = await getCitizen(hre);
    console.log(`Updating verification level for ${address} to ${level}...`);
    await citizen.updateVerificationLevel(address, level);
    console.log('Verification level updated successfully');
  });

task('citizen:info', 'Get citizenship information for an address')
  .addParam<string>('address', 'Address to check')
  .setAction(async ({address}, hre) => {
    const citizen = await getCitizen(hre);
    const isCitizen = await citizen.hasCitizenship(address);
    console.log(`Is citizen: ${isCitizen}`);
    
    if (isCitizen) {
      const info = await citizen.citizenshipInfo(address);
      console.log(`Citizenship active: ${info.isActive}`);
      console.log(`Citizenship since: ${new Date(info.since.toNumber() * 1000).toISOString()}`);
      console.log(`Verification level: ${info.level}`);
    }
  });

const getDiamond = async (hre: HardhatRuntimeEnvironment) => {
  const deployment = await hre.deployments.getOrNull('TDFDiamond');
  if (!deployment) throw new Error('Factory Not Deployed');
  const {deployer} = await hre.getNamedAccounts();
  return (await hre.ethers.getContractAt('TDFDiamond', deployment.address)).connect(
    await hre.ethers.getSigner(deployer)
  );
};

const getCitizen = async (hre: HardhatRuntimeEnvironment) => {
  const deployment = await hre.deployments.getOrNull('Citizen');
  if (!deployment) throw new Error('Citizen Not Deployed');
  const {deployer} = await hre.getNamedAccounts();
  return (await hre.ethers.getContractAt('Citizen', deployment.address)).connect(
    await hre.ethers.getSigner(deployer)
  ) as Citizen;
};
