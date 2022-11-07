import {expect} from '../chai-setup';
import {setDiamondUser, setupContext, getterHelpers, roleTesters, yearData} from '../utils/diamond';

describe('AccessControl Roles', () => {
  it('All methods are accessible by some role', async () => {
    const context = await setupContext();
    const {users, deployer} = context;

    const diamond = await getterHelpers({user: users[1], ...context});
    const user = await roleTesters({
      user: deployer,
      ...context,
    });

    await diamond.hasRole('DEFAULT_ADMIN_ROLE', deployer.address).toEq(true);
    await diamond.hasRole('MINTER_ROLE', deployer.address).toEq(true);
    await diamond.hasRole('BOOKING_MANAGER_ROLE', deployer.address).toEq(true);
    await diamond.hasRole('STAKE_MANAGER_ROLE', deployer.address).toEq(true);
    await diamond.hasRole('VAULT_MANAGER_ROLE', deployer.address).toEq(true);
    await diamond.hasRole('MEMBERSHIP_MANAGER_ROLE', deployer.address).toEq(true);
    // -- END SETUP

    await user.can.addMember(users[9].address);
    await user.can.removeMember(users[9].address);

    const yearAttrs = yearData()['2028'];
    await user.can.addAccommodationYear({...yearAttrs, number: 3100, enabled: false});
    await user.can.enableAccommodationYear(3100, true);
    await user.can.updateAccommodationYear({...yearAttrs, number: 3100, enabled: false});
    await user.can.removeAccommodationYear(3100);

    await user.can.grantRole('MEMBERSHIP_MANAGER_ROLE', users[9].address);
    await user.can.revokeRole('MEMBERSHIP_MANAGER_ROLE', users[9].address);

    await user.can.pause();
    await user.can.unpause();

    await user.can.setRoleAdmin('MEMBERSHIP_MANAGER_ROLE', 'VAULT_MANAGER_ROLE');
    await user.can.cancelAccommodationFor();
    await user.can.confirmAccommodationFor();
    await user.can.checkinAccommodationFor();
  });
  it('DEFAULT_ADMIN_ROLE', async () => {
    const context = await setupContext();
    const {users, deployer} = context;

    const diamond = await getterHelpers({user: users[1], ...context});
    const user = await roleTesters({
      user: users[0],
      ...context,
    });
    const admin = await setDiamondUser({
      user: deployer,
      ...context,
    });
    await admin.grantRole('DEFAULT_ADMIN_ROLE', users[0].address).success();

    await diamond.hasRole('DEFAULT_ADMIN_ROLE', users[0].address).toEq(true);
    await diamond.hasRole('MINTER_ROLE', users[0].address).toEq(false);
    await diamond.hasRole('BOOKING_MANAGER_ROLE', users[0].address).toEq(false);
    await diamond.hasRole('STAKE_MANAGER_ROLE', users[0].address).toEq(false);
    await diamond.hasRole('VAULT_MANAGER_ROLE', users[0].address).toEq(false);
    await diamond.hasRole('MEMBERSHIP_MANAGER_ROLE', users[0].address).toEq(false);
    // -- END SETUP

    await user.cannot.addMember(users[9].address);
    await user.cannot.removeMember(users[9].address);

    const yearAttrs = yearData()['2028'];
    await user.cannot.addAccommodationYear({...yearAttrs, enabled: false});
    await user.cannot.enableAccommodationYear(2028, true);
    await user.cannot.updateAccommodationYear({...yearAttrs, enabled: false});
    await user.cannot.removeAccommodationYear(2028);

    await user.can.grantRole('MEMBERSHIP_MANAGER_ROLE', users[9].address);
    await user.can.revokeRole('MEMBERSHIP_MANAGER_ROLE', users[9].address);

    await user.can.pause();
    await user.can.unpause();

    await user.can.setRoleAdmin('MEMBERSHIP_MANAGER_ROLE', 'VAULT_MANAGER_ROLE');
    await user.cannot.cancelAccommodationFor();
    await user.cannot.confirmAccommodationFor();
    await user.cannot.checkinAccommodationFor();
  });
  it('MINTER_ROLE', async () => {
    const context = await setupContext();
    const {users, deployer} = context;

    const diamond = await getterHelpers({user: users[1], ...context});
    const user = await roleTesters({
      user: users[0],
      ...context,
    });
    const admin = await setDiamondUser({
      user: deployer,
      ...context,
    });
    await admin.grantRole('MINTER_ROLE', users[0].address).success();

    await diamond.hasRole('DEFAULT_ADMIN_ROLE', users[0].address).toEq(false);
    await diamond.hasRole('MINTER_ROLE', users[0].address).toEq(true);
    await diamond.hasRole('BOOKING_MANAGER_ROLE', users[0].address).toEq(false);
    await diamond.hasRole('STAKE_MANAGER_ROLE', users[0].address).toEq(false);
    await diamond.hasRole('VAULT_MANAGER_ROLE', users[0].address).toEq(false);
    await diamond.hasRole('MEMBERSHIP_MANAGER_ROLE', users[0].address).toEq(false);
    // -- END SETUP

    await user.cannot.addMember(users[9].address);
    await user.cannot.removeMember(users[9].address);

    const yearAttrs = yearData()['2028'];
    await user.cannot.addAccommodationYear({...yearAttrs, enabled: false});
    await user.cannot.enableAccommodationYear(2028, true);
    await user.cannot.updateAccommodationYear({...yearAttrs, enabled: false});
    await user.cannot.removeAccommodationYear(2028);

    await user.cannot.grantRole('MEMBERSHIP_MANAGER_ROLE', users[9].address);
    await user.cannot.revokeRole('MEMBERSHIP_MANAGER_ROLE', users[9].address);

    await user.cannot.pause();
    await user.cannot.unpause();

    await user.cannot.setRoleAdmin('MEMBERSHIP_MANAGER_ROLE', 'VAULT_MANAGER_ROLE');
    await user.cannot.cancelAccommodationFor();
    await user.cannot.confirmAccommodationFor();
    await user.cannot.checkinAccommodationFor();
  });
  it('BOOKING_MANAGER_ROLE', async () => {
    const context = await setupContext();
    const {users, deployer} = context;

    const diamond = await getterHelpers({user: users[1], ...context});
    const user = await roleTesters({
      user: users[0],
      ...context,
    });
    const admin = await setDiamondUser({
      user: deployer,
      ...context,
    });
    await admin.grantRole('BOOKING_MANAGER_ROLE', users[0].address).success();

    await diamond.hasRole('DEFAULT_ADMIN_ROLE', users[0].address).toEq(false);
    await diamond.hasRole('MINTER_ROLE', users[0].address).toEq(false);
    await diamond.hasRole('BOOKING_MANAGER_ROLE', users[0].address).toEq(true);
    await diamond.hasRole('STAKE_MANAGER_ROLE', users[0].address).toEq(false);
    await diamond.hasRole('VAULT_MANAGER_ROLE', users[0].address).toEq(false);
    await diamond.hasRole('MEMBERSHIP_MANAGER_ROLE', users[0].address).toEq(false);
    // -- END SETUP

    await user.cannot.addMember(users[9].address);
    await user.cannot.removeMember(users[9].address);

    const yearAttrs = yearData()['2028'];
    await user.can.addAccommodationYear({...yearAttrs, number: 3100, enabled: false});
    await user.can.enableAccommodationYear(3100, true);
    await user.can.updateAccommodationYear({...yearAttrs, number: 3100, enabled: false});
    await user.can.removeAccommodationYear(3100);

    await user.cannot.grantRole('MEMBERSHIP_MANAGER_ROLE', users[9].address);
    await user.cannot.revokeRole('MEMBERSHIP_MANAGER_ROLE', users[9].address);

    await user.cannot.pause();
    await user.cannot.unpause();

    await user.cannot.setRoleAdmin('MEMBERSHIP_MANAGER_ROLE', 'VAULT_MANAGER_ROLE');
    await user.can.cancelAccommodationFor();
    await user.can.confirmAccommodationFor();
    await user.can.checkinAccommodationFor();
  });
  it('STAKE_MANAGER_ROLE', async () => {
    const context = await setupContext();
    const {users, deployer} = context;

    const diamond = await getterHelpers({user: users[1], ...context});
    const user = await roleTesters({
      user: users[0],
      ...context,
    });
    const admin = await setDiamondUser({
      user: deployer,
      ...context,
    });
    await admin.grantRole('STAKE_MANAGER_ROLE', users[0].address).success();

    await diamond.hasRole('DEFAULT_ADMIN_ROLE', users[0].address).toEq(false);
    await diamond.hasRole('MINTER_ROLE', users[0].address).toEq(false);
    await diamond.hasRole('BOOKING_MANAGER_ROLE', users[0].address).toEq(false);
    await diamond.hasRole('STAKE_MANAGER_ROLE', users[0].address).toEq(true);
    await diamond.hasRole('VAULT_MANAGER_ROLE', users[0].address).toEq(false);
    await diamond.hasRole('MEMBERSHIP_MANAGER_ROLE', users[0].address).toEq(false);
    // -- END SETUP

    await user.cannot.addMember(users[9].address);
    await user.cannot.removeMember(users[9].address);

    const yearAttrs = yearData()['2028'];
    await user.cannot.addAccommodationYear({...yearAttrs, enabled: false});
    await user.cannot.enableAccommodationYear(2028, true);
    await user.cannot.updateAccommodationYear({...yearAttrs, enabled: false});
    await user.cannot.removeAccommodationYear(2028);

    await user.cannot.grantRole('MEMBERSHIP_MANAGER_ROLE', users[9].address);
    await user.cannot.revokeRole('MEMBERSHIP_MANAGER_ROLE', users[9].address);

    await user.cannot.pause();
    await user.cannot.unpause();

    await user.cannot.setRoleAdmin('MEMBERSHIP_MANAGER_ROLE', 'VAULT_MANAGER_ROLE');
    await user.cannot.cancelAccommodationFor();
    await user.cannot.confirmAccommodationFor();
    await user.cannot.checkinAccommodationFor();
  });
  it('VAULT_MANAGER_ROLE', async () => {
    const context = await setupContext();
    const {users, deployer} = context;

    const diamond = await getterHelpers({user: users[1], ...context});
    const user = await roleTesters({
      user: users[0],
      ...context,
    });
    const admin = await setDiamondUser({
      user: deployer,
      ...context,
    });
    await admin.grantRole('VAULT_MANAGER_ROLE', users[0].address).success();

    await diamond.hasRole('DEFAULT_ADMIN_ROLE', users[0].address).toEq(false);
    await diamond.hasRole('MINTER_ROLE', users[0].address).toEq(false);
    await diamond.hasRole('BOOKING_MANAGER_ROLE', users[0].address).toEq(false);
    await diamond.hasRole('STAKE_MANAGER_ROLE', users[0].address).toEq(false);
    await diamond.hasRole('VAULT_MANAGER_ROLE', users[0].address).toEq(true);
    await diamond.hasRole('MEMBERSHIP_MANAGER_ROLE', users[0].address).toEq(false);
    // -- END SETUP

    await user.cannot.addMember(users[9].address);
    await user.cannot.removeMember(users[9].address);

    const yearAttrs = yearData()['2028'];
    await user.cannot.addAccommodationYear({...yearAttrs, enabled: false});
    await user.cannot.enableAccommodationYear(2028, true);
    await user.cannot.updateAccommodationYear({...yearAttrs, enabled: false});
    await user.cannot.removeAccommodationYear(2028);

    await user.cannot.grantRole('MEMBERSHIP_MANAGER_ROLE', users[9].address);
    await user.cannot.revokeRole('MEMBERSHIP_MANAGER_ROLE', users[9].address);

    await user.cannot.pause();
    await user.cannot.unpause();

    await user.cannot.setRoleAdmin('MEMBERSHIP_MANAGER_ROLE', 'VAULT_MANAGER_ROLE');
    await user.cannot.cancelAccommodationFor();
    await user.cannot.confirmAccommodationFor();
    await user.cannot.checkinAccommodationFor();
  });
  it('MEMBERSHIP_MANAGER_ROLE', async () => {
    const context = await setupContext();
    const {users, deployer} = context;

    const diamond = await getterHelpers({user: users[1], ...context});
    const user = await roleTesters({
      user: users[0],
      ...context,
    });
    const admin = await setDiamondUser({
      user: deployer,
      ...context,
    });
    await admin.grantRole('MEMBERSHIP_MANAGER_ROLE', users[0].address).success();

    await diamond.hasRole('DEFAULT_ADMIN_ROLE', users[0].address).toEq(false);
    await diamond.hasRole('MINTER_ROLE', users[0].address).toEq(false);
    await diamond.hasRole('BOOKING_MANAGER_ROLE', users[0].address).toEq(false);
    await diamond.hasRole('STAKE_MANAGER_ROLE', users[0].address).toEq(false);
    await diamond.hasRole('VAULT_MANAGER_ROLE', users[0].address).toEq(false);
    await diamond.hasRole('MEMBERSHIP_MANAGER_ROLE', users[0].address).toEq(true);
    // -- END SETUP

    await user.can.addMember(users[9].address);
    await user.can.removeMember(users[9].address);

    const yearAttrs = yearData()['2028'];
    await user.cannot.addAccommodationYear({...yearAttrs, enabled: false});
    await user.cannot.enableAccommodationYear(2028, true);
    await user.cannot.updateAccommodationYear({...yearAttrs, enabled: false});
    await user.cannot.removeAccommodationYear(2028);

    await user.cannot.grantRole('MEMBERSHIP_MANAGER_ROLE', users[9].address);
    await user.cannot.revokeRole('MEMBERSHIP_MANAGER_ROLE', users[9].address);

    await user.cannot.pause();
    await user.cannot.unpause();

    await user.cannot.setRoleAdmin('MEMBERSHIP_MANAGER_ROLE', 'VAULT_MANAGER_ROLE');
    await user.cannot.cancelAccommodationFor();
    await user.cannot.confirmAccommodationFor();
    await user.cannot.checkinAccommodationFor();
  });
});
