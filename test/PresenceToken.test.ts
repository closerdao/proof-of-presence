import {expect} from 'chai';
import {deployments, ethers} from 'hardhat';
import {PresenceToken, TDFDiamond} from '../typechain';
import {Address} from 'hardhat-deploy/types';
import {SignerWithAddress} from '@nomiclabs/hardhat-ethers/dist/src/signers';
import {
  DEFAULT_PRESENCE_TOKEN_DECAY_RATE_PER_DAY,
  DEFAULT_PRESENCE_TOKEN_NAME,
  DEFAULT_PRESENCE_TOKEN_SYMBOL,
} from '../deploy/006_deploy_presenceToken';

const setup = deployments.createFixture(async () => {
  await deployments.fixture();
  const [deployer, user] = await ethers.getSigners();
  const presenceTokenContract = (await ethers.getContract('PresenceToken', deployer)) as PresenceToken;
  const daoContract = (await ethers.getContract('TDFDiamond', deployer)) as TDFDiamond;

  return {
    deployer,
    presenceToken: presenceTokenContract,
    daoContractAddress: daoContract.address,
    user,
  };
});

describe('PresenceToken Contract', function () {
  let presenceToken: PresenceToken, owner: SignerWithAddress, dao: Address, user: SignerWithAddress;

  beforeEach(async () => {
    const testData = await setup();
    owner = testData.deployer;
    presenceToken = testData.presenceToken;
    dao = testData.daoContractAddress;
    user = testData.user;
  });

  describe('Initialization', function () {
    it('should have correct name and symbol', async function () {
      expect(await presenceToken.name()).to.equal(DEFAULT_PRESENCE_TOKEN_NAME);
      expect(await presenceToken.symbol()).to.equal(DEFAULT_PRESENCE_TOKEN_SYMBOL);
    });

    it('should set the correct decay rate', async function () {
      expect(await presenceToken.decayRatePerDay()).to.equal(DEFAULT_PRESENCE_TOKEN_DECAY_RATE_PER_DAY);
    });
  });

  describe('Minting', function () {
    it('should mint tokens successfully by owner', async function () {
      // Assume DAO has appropriate role for minting
      await presenceToken.connect(owner).mint(user.address, 1000);
      expect(await presenceToken.balanceOf(user.address)).to.equal(1000);
    });

    it('should fail to mint if not authorized', async function () {
      await expect(presenceToken.connect(user).mint(user.address, 1000)).to.be.revertedWith('Unauthorized');
    });
  });

  describe('Burning', function () {
    beforeEach(async () => {
      await presenceToken.connect(owner).mint(user.address, 1000);
    });

    it('should burn tokens successfully', async function () {
      await presenceToken.connect(owner).burn(user.address, [{amount: 500, daysAgo: 0}]);
      expect(await presenceToken.balanceOf(user.address)).to.equal(500);
    });

    it('should burn all tokens', async function () {
      await presenceToken.connect(owner).burnAll(user.address);
      expect(await presenceToken.balanceOf(user.address)).to.equal(0);
    });
  });

  describe('Decay Rate Management', function () {
    it('should set a new decay rate by owner', async function () {
      const newDecayRate = 30000;
      await presenceToken.connect(owner).setDecayRatePerDay(newDecayRate);
      expect(await presenceToken.decayRatePerDay()).to.equal(newDecayRate);
    });

    it('should fail to set decay rate if exceeding max limit', async function () {
      const tooHighDecayRate = 300001; // example exceeding value
      await presenceToken.connect(owner);
      await expect(presenceToken.setDecayRatePerDay(tooHighDecayRate)).to.be.revertedWith('InvalidDecayRatePerDay');
    });

    it('should fail to set a decay if not authorized', async function () {
      const newDecayRate = 30000;
      await expect(presenceToken.connect(user).setDecayRatePerDay(newDecayRate)).to.be.revertedWith('Unauthorized');
    });
  });

  describe('Non-Transferable Token Behavior', function () {
    it('should not allow token transfers', async function () {
      await expect(presenceToken.connect(user).transfer(dao, 100)).to.be.revertedWith('TransferNotAllowed');
    });

    it('should not allow approval', async function () {
      await expect(presenceToken.connect(user).approve(dao, 100)).to.be.revertedWith('ApproveNotAllowed');
    });
  });

  describe('Balance Calculation', function () {
    it('should return non-decayed balance', async function () {
      await presenceToken.connect(owner).mint(user.address, 1000);
      expect(await presenceToken.nonDecayedBalanceOf(user.address)).to.equal(1000);
    });

    it('should calculate decayed balance correctly', async function () {
      await presenceToken.connect(owner).mint(user.address, 1000);
      // Simulate time passing and check balance
      await ethers.provider.send('evm_increaseTime', [86400]); // 1 day

      // TODO I think calling evm_mine is probably unnecessary, need to check it
      await ethers.provider.send('evm_mine', []); // mine a block

      const decayedBalance = await presenceToken.balanceOf(user.address);

      // TODO why is conversion to Number necessary here? shouldn't it work with BigNumber as well?
      expect(Number(decayedBalance)).to.be.lessThan(1000);
      // TODO add exact number to check to also test if the calculations are correct
    });
  });
});
