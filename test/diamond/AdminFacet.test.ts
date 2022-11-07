/* eslint-disable-next-line @typescript-eslint/no-unused-vars */
import {expect} from '../chai-setup';
import {setDiamondUser, setupContext, getterHelpers} from '../utils/diamond';

describe('AdminFacet', () => {
  it('Assigning roles', async () => {
    const context = await setupContext();
    const usertmp = context.users[1];

    const diamond = await getterHelpers({user: usertmp, ...context});
    const admin = await setDiamondUser({
      user: context.deployer,
      ...context,
    });

    await admin.grantRole('STAKE_MANAGER_ROLE', usertmp.address).success();
    await admin.grantRole('DEFAULT_ADMIN_ROLE', usertmp.address).success();
    await diamond.hasRole('STAKE_MANAGER_ROLE', usertmp.address).toEq(true);
    await diamond.hasRole('DEFAULT_ADMIN_ROLE', usertmp.address).toEq(true);
  });
});
