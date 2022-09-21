import {expect} from '../chai-setup';
import {setDiamondUser, setupContext} from '../utils/diamond';
import {ethers} from 'hardhat';

const BN = ethers.BigNumber;

describe('MembershipFacet', () => {
  it('adding and removing members', async () => {
    const context = await setupContext();
    const users = context.users;
    const usertmp = context.users[1];

    const user = await setDiamondUser({
      user: usertmp,
      ...context,
    });
    const admin = await setDiamondUser({
      user: context.deployer,
      ...context,
    });

    await user.addMember(users[10].address).reverted.onlyRole();
    await user.removeMember(users[10].address).reverted.onlyRole();
    await admin.grantRole.success('MEMBERSHIP_MANAGER_ROLE', usertmp.address);
    const prevLength = await context.TDFDiamond.membersLength();
    await user.addMember(users[10].address).success();
    expect(await context.TDFDiamond.isMember(users[10].address)).to.eq(true);
    expect(await context.TDFDiamond.membersLength()).to.eq(prevLength.add(BN.from(1)));

    await user.removeMember(users[10].address).success();
    expect(await context.TDFDiamond.membersLength()).to.eq(prevLength);
    expect(await context.TDFDiamond.isMember(users[10].address)).to.eq(false);
  });
});
