import {expect} from 'chai';
import {setDiamondUser, setupContext} from '../utils/diamond/index.js';
import {parseEther} from 'ethers';
import {ZERO_ADDRESS} from '../../utils/index.js';

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
    await admin.grantRole('MEMBERSHIP_MANAGER_ROLE', usertmp.address).success();
    const prevLength = await context.TDFDiamond.membersLength();
    await user.addMember(users[10].address).success();
    expect(await context.TDFDiamond.isMember(users[10].address)).to.eq(true);
    expect(await context.TDFDiamond.membersLength()).to.eq(prevLength + BigInt(1));

    await user.removeMember(users[10].address).success();
    expect(await context.TDFDiamond.membersLength()).to.eq(prevLength);
    expect(await context.TDFDiamond.isMember(users[10].address)).to.eq(false);
  });

  it('isTokenTransferPermitted', async () => {
    const {TDFDiamond, users} = await setupContext();
    expect(await TDFDiamond.isTokenTransferPermitted(ZERO_ADDRESS, users[9].address, parseEther('100'))).to.be.true;
    expect(await TDFDiamond.isTokenTransferPermitted(users[9].address, ZERO_ADDRESS, parseEther('100'))).to.be.true;
    const diamondAddress = await TDFDiamond.getAddress();
    expect(await TDFDiamond.isTokenTransferPermitted(users[9].address, diamondAddress, parseEther('100'))).to.be.true;
    expect(await TDFDiamond.isTokenTransferPermitted(diamondAddress, users[9].address, parseEther('100'))).to.be.true;
    expect(await TDFDiamond.isTokenTransferPermitted(users[1].address, users[9].address, parseEther('100'))).to.be
      .false;
  });
});
