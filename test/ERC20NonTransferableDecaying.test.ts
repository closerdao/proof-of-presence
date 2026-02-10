import {expect} from './chai-setup';
import {deployments, ethers} from 'hardhat';
import {PresenceToken, SweatToken, TDFDiamond} from '../typechain';
import {Address} from 'hardhat-deploy/types';
import {SignerWithAddress} from '@nomiclabs/hardhat-ethers/dist/src/signers';
import {
  DEFAULT_PRESENCE_TOKEN_DECAY_RATE_PER_DAY,
  DEFAULT_PRESENCE_TOKEN_NAME,
  DEFAULT_PRESENCE_TOKEN_SYMBOL,
} from '../deploy/006_deploy_presenceToken';
import {
  DEFAULT_SWEAT_TOKEN_DECAY_RATE_PER_DAY,
  DEFAULT_SWEAT_TOKEN_NAME,
  DEFAULT_SWEAT_TOKEN_SYMBOL,
} from '../deploy/005_deploy_sweatToken';
import {parseUnits} from 'ethers/lib/utils';

const ONE_TOKEN = parseUnits('1', 18);
const DAY_IN_SECONDS = 86_400;

const moveTimeToFuture = async (secondsToFuture: number) => {
  await ethers.provider.send('evm_increaseTime', [secondsToFuture]);
  await ethers.provider.send('evm_mine', []);
};

const setup = deployments.createFixture(async () => {
  await deployments.fixture();
  const [deployer, user, user2] = await ethers.getSigners();
  const tokenContract = (await ethers.getContract('PresenceToken', deployer)) as PresenceToken;
  const daoContract = (await ethers.getContract('TDFDiamond', deployer)) as TDFDiamond;

  return {
    deployer,
    token: tokenContract,
    daoContractAddress: daoContract.address,
    user,
    user2,
  };
});

describe('ERC20NonTransferableDecaying (tested via PresenceToken)', function () {
  let token: PresenceToken,
    owner: SignerWithAddress,
    dao: Address,
    user: SignerWithAddress,
    user2: SignerWithAddress;

  beforeEach(async () => {
    const testData = await setup();
    owner = testData.deployer;
    token = testData.token;
    dao = testData.daoContractAddress;
    user = testData.user;
    user2 = testData.user2;
  });

  describe('Initialization', function () {
    it('should have correct name, symbol, decay rate and DAO address', async function () {
      expect(await token.name()).to.equal(DEFAULT_PRESENCE_TOKEN_NAME);
      expect(await token.symbol()).to.equal(DEFAULT_PRESENCE_TOKEN_SYMBOL);
      expect(await token.decayRatePerDay()).to.equal(DEFAULT_PRESENCE_TOKEN_DECAY_RATE_PER_DAY);
      expect(await token.daoAddress()).to.equal(dao);
    });
  });

  describe('DAO Address Management', function () {
    it('should change DAO address by owner', async function () {
      // token.address is a valid contract address
      await token.connect(owner).setDaoAddress(token.address);
      expect(await token.daoAddress()).to.equal(token.address);
    });

    it('should emit DaoAddressChanged event', async function () {
      const oldAddress = await token.daoAddress();
      await expect(token.connect(owner).setDaoAddress(token.address))
        .to.emit(token, 'DaoAddressChanged')
        .withArgs(oldAddress, token.address);
    });

    it('should revert on address(0)', async function () {
      await expect(token.connect(owner).setDaoAddress(ethers.constants.AddressZero)).to.be.revertedWith(
        'InvalidDaoAddress'
      );
    });

    it('should revert on EOA (non-contract) address', async function () {
      await expect(token.connect(owner).setDaoAddress(user.address)).to.be.revertedWith('InvalidDaoAddress');
    });

    it('should revert when called by non-owner', async function () {
      await expect(token.connect(user).setDaoAddress(token.address)).to.be.revertedWith(
        'Ownable: caller is not the owner'
      );
    });
  });

  describe('Minting', function () {
    // in the 003_deploy_diamond during the DiamondInit.init function the deployer
    //  gets granted all the roles, so that's why we can use here owner address
    it('should mint tokens successfully by account with allowed role', async function () {
      await token.connect(owner).mint(user.address, ONE_TOKEN, 0);
      expect(await token.balanceOf(user.address)).to.equal(ONE_TOKEN);
      expect(await token.nonDecayedBalanceOf(user.address)).to.equal(ONE_TOKEN);
      expect(await token.totalSupply()).to.be.equal(ONE_TOKEN);
      expect(await token.nonDecayedTotalSupply()).to.be.equal(ONE_TOKEN);
      expect(await token.lastDecayedBalance(user.address)).to.be.equal(ONE_TOKEN);

      const blockNumber = await ethers.provider.getBlockNumber();
      const block = await ethers.provider.getBlock(blockNumber);
      expect(await token.lastDecayTimestamp(user.address)).to.be.equal(block.timestamp);

      // checking if holders mapping + array is also correctly calculated
      expect(await token.isHolder(user.address)).to.be.true;
      expect(await token.isHolder(owner.address)).to.be.false;
      expect(await token.holders(0)).to.be.equal(user.address);
    });

    it('should fail to mint if not authorized', async function () {
      await expect(token.connect(user).mint(user.address, ONE_TOKEN, 0)).to.be.revertedWith('Unauthorized');
    });

    it('should handle minting for past days ago', async function () {
      await token.connect(owner).mint(user.address, ONE_TOKEN, 1);
      expect(await token.balanceOf(user.address)).to.be.equal(parseUnits('0.999711383', 18));
      await moveTimeToFuture(3600);
      expect(await token.balanceOf(user.address)).to.be.equal(parseUnits('0.999711383', 18));
      await moveTimeToFuture(DAY_IN_SECONDS);
      expect(await token.balanceOf(user.address)).to.be.equal(parseUnits('0.999422849299772689', 18));
    });

    it('should handle batch minting', async function () {
      await token.connect(owner).mintBatch([
        {account: user.address, amount: ONE_TOKEN, daysAgo: 0},
        {account: user.address, amount: ONE_TOKEN, daysAgo: 1},
        {account: user.address, amount: ONE_TOKEN, daysAgo: 2},
        {account: user2.address, amount: ONE_TOKEN, daysAgo: 3},
        {account: user.address, amount: ONE_TOKEN, daysAgo: 3},
        {account: user2.address, amount: ONE_TOKEN, daysAgo: 2},
      ]);

      expect(await token.balanceOf(user.address)).to.be.equal(parseUnits('3.998268631175049025', 18));
      expect(await token.balanceOf(user2.address)).to.be.equal(parseUnits('1.998557248175049025', 18));
    });

    it('should revert on mint with zero amount', async function () {
      await expect(token.connect(owner).mint(user.address, 0, 0)).to.be.revertedWith('MintWithZeroAmount');
    });

    it('should revert on empty mintBatch', async function () {
      await expect(token.connect(owner).mintBatch([])).to.be.revertedWith('MintDataEmpty');
    });
  });

  describe('Decay Rate Management', function () {
    it('should set a new decay rate by owner', async function () {
      const newDecayRate = 100_000;
      await token.connect(owner).setDecayRatePerDay(newDecayRate);
      expect(await token.decayRatePerDay()).to.equal(newDecayRate);
    });

    it('should fail to set decay rate if exceeding max limit', async function () {
      const tooHighDecayRate = 4_399_712;
      await expect(token.connect(owner).setDecayRatePerDay(tooHighDecayRate)).to.be.revertedWith(
        'InvalidDecayRatePerDay'
      );
    });

    it('should fail to set a decay if not authorized', async function () {
      const newDecayRate = 100_000;
      await expect(token.connect(user).setDecayRatePerDay(newDecayRate)).to.be.revertedWith(
        'Ownable: caller is not the owner'
      );
    });

    it('should return correct result for getDecayRatePerYear', async function () {
      await token.connect(owner).setDecayRatePerDay(DEFAULT_PRESENCE_TOKEN_DECAY_RATE_PER_DAY);
      // 9 == decay rate decimals precision
      expect(await token.getCurrentDecayRatePerYear()).to.be.equal(parseUnits('0.099999905', 9));
    });

    it('should return correct result for getDecayRatePerDay', async function () {
      // 0.1 == 10% decay rate per year
      // 9 == decay rate decimals precision
      expect(await token.getDecayRatePerDay(parseUnits('0.1', 9))).to.be.equal(
        DEFAULT_PRESENCE_TOKEN_DECAY_RATE_PER_DAY
      );
    });

    it('getDecayRatePerYear -> getDecayRatePerDay should return almost same value', async function () {
      const initialDecayRatePerDay = DEFAULT_PRESENCE_TOKEN_DECAY_RATE_PER_DAY;
      const firstDecayRatePerYear = await token.getDecayRatePerYear(initialDecayRatePerDay);
      const calculatedDecayRatePerDay = await token.getDecayRatePerDay(firstDecayRatePerYear);
      // 1 is the arithemtic error difference, however should be negligible
      expect(calculatedDecayRatePerDay).to.be.equal(initialDecayRatePerDay - 1);
    });
  });

  describe('Non-Transferable Token Behavior', function () {
    it('should not allow token transfers', async function () {
      await expect(token.connect(user).transfer(dao, 100)).to.be.revertedWith('TransferNotAllowed');
      await expect(token.connect(user).transferFrom(user.address, dao, 100)).to.be.revertedWith('TransferNotAllowed');
    });

    it('should not allow approval', async function () {
      await expect(token.connect(user).approve(dao, 100)).to.be.revertedWith('ApproveNotAllowed');
      await expect(token.connect(user).increaseAllowance(dao, 100)).to.be.revertedWith('ApproveNotAllowed');
    });
  });

  // TODO maybe parametrize these decay calculation tests to make sure it's run with a lot of different test data?
  describe('Decay Calculations', async function () {
    it('should calculate decay correctly over time', async function () {
      let passedDays = 0;

      await token.connect(owner).mint(user.address, parseUnits('1', 18), 0);
      expect(await token.balanceOf(user.address)).to.be.equal(parseUnits('1', 18));

      // just to check if not decaying before the full day passes
      await moveTimeToFuture(DAY_IN_SECONDS - 3600);
      expect(await token.balanceOf(user.address)).to.be.equal(parseUnits('1', 18));

      // initial day + 1
      await moveTimeToFuture(DAY_IN_SECONDS);
      expect(await token.balanceOf(user.address)).to.be.equal(parseUnits('0.999711383', 18));
      passedDays++;

      // initial day + 2
      await moveTimeToFuture(DAY_IN_SECONDS);
      expect(await token.balanceOf(user.address)).to.be.equal(parseUnits('0.999422849299772689', 18));
      passedDays++;

      // initial day + 3
      await moveTimeToFuture(DAY_IN_SECONDS);
      // exact: 0.999134398875276336505818887
      expect(await token.balanceOf(user.address)).to.be.equal(parseUnits('0.999134398875276336', 18));
      passedDays++;

      // initial day + 4
      await moveTimeToFuture(DAY_IN_SECONDS);
      // exact: 0.998846031702476150875405587070290721
      expect(await token.balanceOf(user.address)).to.be.equal(parseUnits('0.998846031702476150', 18));
      passedDays++;

      // initidal day + 5
      await moveTimeToFuture(DAY_IN_SECONDS);
      // exact: 0.998557747757344277316168380135967254902977143
      // NOTE: here it seems like a contract is little bit off, as the result is different from calculation in the last digit (7 vs 6)
      expect(await token.balanceOf(user.address)).to.be.equal(parseUnits('0.998557747757344276', 18));
      passedDays++;

      // initial day + 6
      await moveTimeToFuture(DAY_IN_SECONDS);
      // exact: 0.998269547015859795882882219566597552441768810445918769
      expect(await token.balanceOf(user.address)).to.be.equal(parseUnits('0.998269547015859795', 18));
      passedDays++;

      // initial day + 1 year
      await moveTimeToFuture((365 - passedDays) * DAY_IN_SECONDS);
      // exact: 0.900000094971245039757371874626758... (truncated)
      // NOTE: when calculated via calculator, the result was along 0.900000094971245039, meanwhile
      //  our contract returns 0.900000094971244942, which makes the result from calculator being 97 wei bigger
      expect(await token.balanceOf(user.address)).to.be.equal(parseUnits('0.900000094971244942', 18));
      passedDays = 365;

      // initial day + 2 years
      await moveTimeToFuture(365 * DAY_IN_SECONDS);
      // exact: 0.810000170948250091100653775967376345823085825... (truncated)
      // NOTE: our contract returns 0.810000170948249916 , meanwhile from calculator the result is 0.810000170948250091
      //  which makes the result from calculator being 175 wei bigger over span of 2 years
      expect(await token.balanceOf(user.address)).to.be.equal(parseUnits('0.810000170948249916', 18));
      passedDays += 365;

      // initial day + 10 years
      await moveTimeToFuture(365 * 8 * DAY_IN_SECONDS);
      // exact: 0.348678808038236660144620377765137818088958921... (truncated)
      // NOTE: our contract returns 0.348678808038236280 , meanwhile from calculator the result is 0.348678808038236660
      //  which makes the result from calculator being 380 wei bigger over span of 10 years
      expect(await token.balanceOf(user.address)).to.be.equal(parseUnits('0.348678808038236280', 18));
      passedDays += 8 * 365;

      // initial day + 100 years
      await moveTimeToFuture(365 * 90 * DAY_IN_SECONDS);
      // exact: 0.000026561679174509569310931235817533064423412... (truncated)
      // weirdly enough, there is no difference in this case between what is returned from calculator and what contract
      //  returns, so the results here are equal without any rounding/decimal point difference
      expect(await token.balanceOf(user.address)).to.be.equal(parseUnits('0.000026561679174509', 18));
      passedDays += 90 * 365;
    });

    it('should handle zero balance correctly', async function () {
      expect(await token.balanceOf(user.address)).to.be.equal(0);
    });

    it('should handle decaying of minted tokens overtime correctly', async function () {
      for (let i = 0; i < 5; i++) {
        await token.connect(owner).mint(user.address, parseUnits('1', 18), 0);
        if (i !== 4) {
          // do not decay the last minted token
          await moveTimeToFuture(DAY_IN_SECONDS);
        }
      }

      expect(await token.balanceOf(user.address)).to.be.equal(parseUnits('4.997114662877525175', 18));
      expect(await token.totalSupply()).to.be.equal(parseUnits('4.997114662877525175', 18));
      expect(await token.nonDecayedBalanceOf(user.address)).to.be.equal(parseUnits('5', 18));
      expect(await token.nonDecayedTotalSupply()).to.be.equal(parseUnits('5', 18));

      // wait 2 days
      await moveTimeToFuture(2 * DAY_IN_SECONDS);
      expect(await token.balanceOf(user.address)).to.be.equal(parseUnits('4.994230574650729248', 18));
      // mint 1 additional token
      await token.connect(owner).mint(user.address, parseUnits('1', 18), 0);
      expect(await token.balanceOf(user.address)).to.be.equal(parseUnits('5.994230574650729248', 18));

      // wait 1 day
      await moveTimeToFuture(DAY_IN_SECONDS);
      expect(await token.balanceOf(user.address)).to.be.equal(parseUnits('5.992500537804965278', 18));

      // wait 30 days
      await moveTimeToFuture(30 * DAY_IN_SECONDS);
      // calculator: 5.940830968847357642 , contract: 5.940830968847357593 == 49 wei difference
      expect(await token.balanceOf(user.address)).to.be.equal(parseUnits('5.940830968847357593', 18));

      await moveTimeToFuture(60 * DAY_IN_SECONDS);
      // calculator: 5.838824532279330922 , contract: 5.838824532279330815 == 107 wei difference
      expect(await token.balanceOf(user.address)).to.be.equal(parseUnits('5.838824532279330815', 18));
    });

    it('arithmetic difference should not be too big', async function () {
      await token.connect(owner).mint(user.address, parseUnits('1000', 18), 0);
      await moveTimeToFuture(365 * DAY_IN_SECONDS);
      // exact: 900.00009497124503975737187462675835700009138426014159119322378181299840208475649272935384486916737564058134278089122007038629188
      // calculator: 900.000094971245039757 , contract: 900.000094971244942000 == 97 757 wei difference
      expect(await token.balanceOf(user.address)).to.be.equal(parseUnits('900.000094971244942000', 18));

      await moveTimeToFuture(365 * DAY_IN_SECONDS);
      // exact: 810.00017094825009110065377596737634582308582593734464323849886116360656315383912671105120641864372809144953675865066884919826663025106479459869220402925201847372789960668894713966843290079785713084523
      // calculator: 810.000170948250091100 , contract: 810.000170948249916000 == 175 100 wei difference
      expect(await token.balanceOf(user.address)).to.be.equal(parseUnits('810.000170948249916000', 18));
    });
  });

  describe('Burn Functionality', function () {
    it('should burn tokens successfully', async function () {
      await token.connect(owner).mint(user.address, ONE_TOKEN, 0);

      await token.connect(owner).burn(user.address, [{amount: ONE_TOKEN.div(2), daysAgo: 0}]);
      expect(await token.balanceOf(user.address)).to.equal(ONE_TOKEN.div(2));
      expect(await token.nonDecayedBalanceOf(user.address)).to.equal(ONE_TOKEN.div(2));
    });

    it('should burn all tokens', async function () {
      await token.connect(owner).mint(user.address, ONE_TOKEN, 0);

      await token.connect(owner).burnAll(user.address);
      expect(await token.balanceOf(user.address)).to.equal(0);
    });

    it('should fail to burn if not owner or does not have roles', async function () {
      await token.connect(owner).mint(user.address, ONE_TOKEN, 0);

      const randomAddress = '0x4410C9De0B7523B48b6EF4190eeb439aaCc5f4d2';
      await ethers.provider.send('hardhat_impersonateAccount', [randomAddress]);
      const randomAddressSigner = await ethers.getSigner(randomAddress);
      await ethers.provider.send('hardhat_setBalance', [randomAddressSigner.address, '0x1BC16D674EC80000']);
      await expect(
        token.connect(randomAddressSigner).burn(user.address, [{amount: ONE_TOKEN, daysAgo: 0}])
      ).to.be.revertedWith('Unauthorized');
      await expect(token.connect(randomAddressSigner).burnAll(user.address)).to.be.revertedWith(
        'Ownable: caller is not the owner'
      );
      await ethers.provider.send('hardhat_stopImpersonatingAccount', [randomAddressSigner.address]);
    });

    it('should revert on burn with empty array', async function () {
      await token.connect(owner).mint(user.address, ONE_TOKEN, 0);
      await expect(token.connect(owner).burn(user.address, [])).to.be.revertedWith('BurnDataEmpty');
    });
  });

  describe('Complex Mint and Burn Scenarios', function () {
    it('should handle mint-burn-mint-burn sequence correctly', async function () {
      // First mint
      await token.connect(owner).mint(user.address, parseUnits('1', 18), 0);

      // Wait 2 days
      await moveTimeToFuture(2 * DAY_IN_SECONDS);
      expect(await token.balanceOf(user.address)).to.be.equal(parseUnits('0.999422849299772689', 18));

      // First burn
      const burnData1 = [
        {
          amount: parseUnits('1', 18),
          daysAgo: 2,
        },
      ];
      await token.connect(owner).burn(user.address, burnData1);
      expect(await token.nonDecayedBalanceOf(user.address)).to.be.equal(0);
      expect(await token.balanceOf(user.address)).to.be.equal(0);

      await token.connect(owner).mint(user.address, parseUnits('1', 18), 0);
      await moveTimeToFuture(DAY_IN_SECONDS);

      await token.connect(owner).mint(user.address, parseUnits('1', 18), 0);
      await moveTimeToFuture(DAY_IN_SECONDS);

      await token.connect(owner).mint(user.address, parseUnits('1', 18), 0);
      await moveTimeToFuture(DAY_IN_SECONDS);

      expect(await token.nonDecayedBalanceOf(user.address)).to.be.equal(parseUnits('3', 18));
      expect(await token.balanceOf(user.address)).to.be.equal(parseUnits('2.998268631175049025', 18));

      const burnData2 = [
        {
          amount: parseUnits('1', 18),
          daysAgo: 3,
        },
        // intentional gap between days
        {
          amount: parseUnits('1', 18),
          daysAgo: 1,
        },
      ];
      await token.connect(owner).burn(user.address, burnData2);
      expect(await token.nonDecayedBalanceOf(user.address)).to.be.equal(parseUnits('1', 18));
      // balance should be only the decayed token from 2 days ago
      expect(await token.balanceOf(user.address)).to.be.equal(parseUnits('0.999422849299772689', 18));
      expect(await token.totalSupply()).to.be.equal(parseUnits('0.999422849299772689', 18));
      expect(await token.nonDecayedTotalSupply()).to.be.equal(parseUnits('1', 18));

      await token.connect(owner).mint(user.address, parseUnits('1', 18), 0);
      expect(await token.balanceOf(user.address)).to.be.equal(parseUnits('1.999422849299772689', 18));

      await moveTimeToFuture(DAY_IN_SECONDS);
      expect(await token.balanceOf(user.address)).to.be.equal(parseUnits('1.998845781875276336', 18));

      const burnData3 = [
        // intentional gap between days
        {
          amount: parseUnits('1', 18),
          daysAgo: 1,
        },
      ];

      await token.connect(owner).burn(user.address, burnData3);
      // only left the minted token from 3 days ago
      expect(await token.balanceOf(user.address)).to.be.equal(parseUnits('0.999134398875276336', 18));

      // move 60 days to the future, so 63 days ago was the token minted
      await moveTimeToFuture(60 * DAY_IN_SECONDS);

      // calculation: 0.999134398875276336 × (1 − 0.0288617 / 100)^60
      // exact: 0.981978862854096031004688104894428... (truncated)
      // contracty returns 981978862854096013, so the difference is 18 wei
      expect(await token.balanceOf(user.address)).to.be.equal(parseUnits('0.981978862854096013', 18));
      // TODO why is there difference of 1 wei here (above one ends with 013, below one with 014)?
      expect(await token.calculateDecayForDays(parseUnits('1', 18), 63)).to.be.equal(
        parseUnits('0.981978862854096014', 18)
      );

      await expect(
        token.connect(owner).burn(user.address, [{amount: parseUnits('1', 18), daysAgo: 62}])
      ).to.be.revertedWith('BurnAmountExceedsDecayedBalance');
      await expect(
        token.connect(owner).burn(user.address, [{amount: parseUnits('2', 18), daysAgo: 63}])
      ).to.be.revertedWith('BurnAmountExceedsDecayedBalance');
      await token.connect(owner).burn(user.address, [{amount: parseUnits('1', 18), daysAgo: 63}]);
      expect(await token.nonDecayedBalanceOf(user.address)).to.be.equal(0);
      expect(await token.balanceOf(user.address)).to.be.equal(0);
    });

    it('should handle burning with zero days ago', async function () {
      await token.connect(owner).mint(user.address, parseUnits('1', 18), 0);

      const burnData = [
        {
          amount: parseUnits('1', 18),
          daysAgo: 0,
        },
      ];

      await token.connect(owner).burn(user.address, burnData);
      expect(await token.balanceOf(user.address)).to.equal(0);
    });

    it('should handle minting and burning with daysAgo > 0', async function () {
      await token.connect(owner).mint(user.address, parseUnits('1', 18), 1);
      await token.connect(owner).burn(user.address, [{amount: ONE_TOKEN, daysAgo: 1}]);
      expect(await token.balanceOf(user.address)).to.equal(0);

      await token.connect(owner).mint(user.address, parseUnits('1', 18), 2);
      await expect(token.connect(owner).burn(user.address, [{amount: ONE_TOKEN, daysAgo: 1}])).to.be.reverted;
      await moveTimeToFuture(DAY_IN_SECONDS);
      await token.connect(owner).burn(user.address, [{amount: ONE_TOKEN, daysAgo: 3}]);
      expect(await token.balanceOf(user.address)).to.equal(0);
    });
  });

  describe('Event Emissions', function () {
    it('should emit MintWithDecay on mint', async function () {
      await expect(token.connect(owner).mint(user.address, ONE_TOKEN, 0))
        .to.emit(token, 'MintWithDecay')
        .withArgs(user.address, ONE_TOKEN, ONE_TOKEN, 0);
    });

    it('should emit MintWithDecay on mint with daysAgo', async function () {
      const daysAgo = 2;
      const decayedAmount = await token.calculateDecayForDays(ONE_TOKEN, daysAgo);
      await expect(token.connect(owner).mint(user.address, ONE_TOKEN, daysAgo))
        .to.emit(token, 'MintWithDecay')
        .withArgs(user.address, ONE_TOKEN, decayedAmount, daysAgo);
    });

    it('should emit BurnWithDecay on burn', async function () {
      await token.connect(owner).mint(user.address, ONE_TOKEN, 0);
      await expect(token.connect(owner).burn(user.address, [{amount: ONE_TOKEN, daysAgo: 0}]))
        .to.emit(token, 'BurnWithDecay')
        .withArgs(user.address, ONE_TOKEN, ONE_TOKEN, 0);
    });

    it('should emit BurnAllUserTokens on burnAll', async function () {
      await token.connect(owner).mint(user.address, ONE_TOKEN, 0);
      await expect(token.connect(owner).burnAll(user.address))
        .to.emit(token, 'BurnAllUserTokens')
        .withArgs(user.address);
    });

    it('should emit DecayRatePerDayChanged on setDecayRatePerDay', async function () {
      const oldRate = await token.decayRatePerDay();
      const newRate = 100_000;
      await expect(token.connect(owner).setDecayRatePerDay(newRate))
        .to.emit(token, 'DecayRatePerDayChanged')
        .withArgs(oldRate, newRate);
    });
  });
});

describe('SweatToken deploy smoke test', function () {
  it('should have correct name, symbol, decay rate and DAO address', async function () {
    await deployments.fixture();
    const [deployer] = await ethers.getSigners();
    const sweatToken = (await ethers.getContract('SweatToken', deployer)) as SweatToken;
    const daoContract = (await ethers.getContract('TDFDiamond', deployer)) as TDFDiamond;

    expect(await sweatToken.name()).to.equal(DEFAULT_SWEAT_TOKEN_NAME);
    expect(await sweatToken.symbol()).to.equal(DEFAULT_SWEAT_TOKEN_SYMBOL);
    expect(await sweatToken.decayRatePerDay()).to.equal(DEFAULT_SWEAT_TOKEN_DECAY_RATE_PER_DAY);
    expect(await sweatToken.daoAddress()).to.equal(daoContract.address);
  });
});
