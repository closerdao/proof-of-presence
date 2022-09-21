import {expect} from '../chai-setup';
import {setDiamondUser, setupContext, getterHelpers} from '../utils/diamond';

describe('AdminFacet', () => {
  it('Assigning roles', async () => {
    const context = await setupContext();
    const usertmp = context.users[1];

    const diamond = await getterHelpers({user: usertmp, ...context});
    const user = await setDiamondUser({
      user: usertmp,
      ...context,
    });
    const admin = await setDiamondUser({
      user: context.deployer,
      ...context,
    });

    await user.setLockingTimePeriodDays.reverted.onlyRole(3);
    await admin.grantRole.success('STAKE_MANAGER_ROLE', usertmp.address);
    await admin.grantRole.success('DEFAULT_ADMIN_ROLE', usertmp.address);
    await diamond.hasRole('STAKE_MANAGER_ROLE', usertmp.address).toEq(true);
    await diamond.hasRole('DEFAULT_ADMIN_ROLE', usertmp.address).toEq(true);
    await user.setLockingTimePeriodDays.reverted.zero(0);
    await user.setLockingTimePeriodDays.success(365);
  });
});
