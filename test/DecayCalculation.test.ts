import { expect } from "chai";
import { deployments, ethers } from "hardhat";
import { parseUnits } from "ethers/lib/utils";
import { PresenceToken, TDFDiamond } from "../typechain";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/dist/src/signers";
import { Address } from "hardhat-deploy/types";

const DAY_IN_SECONDS = 86_400

const setup = deployments.createFixture(async () => {
    await deployments.fixture();
    const [deployer, user] = await ethers.getSigners();
    const presenceTokenContract = (await ethers.getContract('PresenceToken', deployer)) as PresenceToken;
    const daoContract = (await ethers.getContract('TDFDiamond', deployer)) as TDFDiamond;

    // TODO should we also set here a decayRatePerDay?
  
    return {
      deployer,
      presenceToken: presenceTokenContract,
      daoContractAddress: daoContract.address,
      user,
    };
  });

describe('Token Decay Tests', function () {
    let presenceToken: PresenceToken, owner: SignerWithAddress, dao: Address, user: SignerWithAddress;

    beforeEach(async () => {
        const testData = await setup();
        owner = testData.deployer;
        presenceToken = testData.presenceToken;
        dao = testData.daoContractAddress;
        user = testData.user;
      });

      // TODO maybe parametrize some of the tests to make sure it's run with a lot of 
      //  different test data?

  describe('Decay Calculations', function () {
    it('should calculate decay correctly over time', async function() {
        let passedDays = 0
        
        await presenceToken.connect(owner).mint(user.address, parseUnits('1', 18));
        expect(await presenceToken.balanceOf(user.address)).to.be.equal(parseUnits('1', 18));

        // just to check if not decaying before the full day passes
        await ethers.provider.send('evm_increaseTime', [DAY_IN_SECONDS - 3600]);
        await ethers.provider.send('evm_mine', []);
        expect(await presenceToken.balanceOf(user.address)).to.be.equal(parseUnits('1', 18));

        // initial day + 1
        await ethers.provider.send('evm_increaseTime', [DAY_IN_SECONDS]);
        await ethers.provider.send('evm_mine', []);
        expect(await presenceToken.balanceOf(user.address)).to.be.equal(parseUnits('0.999711383', 18));
        passedDays++;

        // initial day + 2
        await ethers.provider.send('evm_increaseTime', [DAY_IN_SECONDS]);
        await ethers.provider.send('evm_mine', []);
        expect(await presenceToken.balanceOf(user.address)).to.be.equal(parseUnits('0.999422849299772689', 18));
        passedDays++;

        // initial day + 3
        await ethers.provider.send('evm_increaseTime', [DAY_IN_SECONDS]);
        await ethers.provider.send('evm_mine', []);
        // exact: 0.999134398875276336505818887
        expect(await presenceToken.balanceOf(user.address)).to.be.equal(parseUnits('0.999134398875276336', 18));
        passedDays++;

        // initial day + 4
        await ethers.provider.send('evm_increaseTime', [DAY_IN_SECONDS]);
        await ethers.provider.send('evm_mine', []);
        // exact: 0.998846031702476150875405587070290721
        expect(await presenceToken.balanceOf(user.address)).to.be.equal(parseUnits('0.998846031702476150', 18));
        passedDays++;

        // initidal day + 5
        await ethers.provider.send('evm_increaseTime', [DAY_IN_SECONDS]);
        await ethers.provider.send('evm_mine', []);
        // exact: 0.998557747757344277316168380135967254902977143
        // NOTE: here it seems like a contract is little bit off, as the result is different from calculation in the last digit (7 vs 6)
        expect(await presenceToken.balanceOf(user.address)).to.be.equal(parseUnits('0.998557747757344276', 18));
        passedDays++;

        // initial day + 6
        await ethers.provider.send('evm_increaseTime', [DAY_IN_SECONDS]);
        await ethers.provider.send('evm_mine', []);
        // exact: 0.998269547015859795882882219566597552441768810445918769
        expect(await presenceToken.balanceOf(user.address)).to.be.equal(parseUnits('0.998269547015859795', 18));
        passedDays++;

        // initial day + 1 year
        await ethers.provider.send('evm_increaseTime', [(365 - passedDays) * DAY_IN_SECONDS]);
        await ethers.provider.send('evm_mine', []);
        // exact: 0.900000094971245039757371874626758... (truncated)
        // NOTE: when calculated via calculator, the result was along 0.900000094971245039, meanwhile 
        //  our contract returns 0.900000094971244942, which makes the result from calculator being 97 wei bigger
        expect(await presenceToken.balanceOf(user.address)).to.be.equal(parseUnits('0.900000094971244942', 18));
        passedDays = 365

        // initial day + 2 years
        await ethers.provider.send('evm_increaseTime', [365 * DAY_IN_SECONDS]);
        await ethers.provider.send('evm_mine', []);
        // exact: 0.810000170948250091100653775967376345823085825... (truncated)
        // NOTE: our contract returns 0.810000170948249916 , meanwhile from calculator the result is 0.810000170948250091
        //  which makes the result from calculator being 175 wei bigger over span of 2 years
        expect(await presenceToken.balanceOf(user.address)).to.be.equal(parseUnits('0.810000170948249916', 18));
        passedDays += 365

        // initial day + 10 years
        await ethers.provider.send('evm_increaseTime', [(365 * 8) * DAY_IN_SECONDS]);
        await ethers.provider.send('evm_mine', []);
        // exact: 0.348678808038236660144620377765137818088958921... (truncated)
        // NOTE: our contract returns 0.348678808038236280 , meanwhile from calculator the result is 0.348678808038236660
        //  which makes the result from calculator being 380 wei bigger over span of 10 years
        expect(await presenceToken.balanceOf(user.address)).to.be.equal(parseUnits('0.348678808038236280', 18));
        passedDays += 8 * 365

        // initial day + 100 years
        await ethers.provider.send('evm_increaseTime', [(365 * 90) * DAY_IN_SECONDS]);
        await ethers.provider.send('evm_mine', []);
        // exact: 0.000026561679174509569310931235817533064423412... (truncated)
        // weirdly enough, there is no difference in this case between what is returned from calculator and what contract
        //  returns, so the results here are equal without any rounding/decimal point difference
        expect(await presenceToken.balanceOf(user.address)).to.be.equal(parseUnits('0.000026561679174509', 18));
        passedDays += 90 * 365
    })

    it('should handle zero balance correctly', async function () {
      const balance = await presenceToken.balanceOf(user.address);
      expect(balance).to.be.equal(0);
    });

    it('should handle decaying of minted tokens overtime correctly', async function () {
        for (let i = 0; i < 5; i++) {
          await presenceToken.connect(owner).mint(user.address, parseUnits('1', 18));
          if (i !== 4) {
            // do not decay the last minted token
            await ethers.provider.send('evm_increaseTime', [DAY_IN_SECONDS]);
            await ethers.provider.send('evm_mine', []);
          }
        }
  
        expect(await presenceToken.balanceOf(user.address)).to.be.equal(parseUnits('4.997114662877525175', 18))

        // wait 2 days
        await ethers.provider.send('evm_increaseTime', [2 * DAY_IN_SECONDS]);
        await ethers.provider.send('evm_mine', []);
        expect(await presenceToken.balanceOf(user.address)).to.be.equal(parseUnits('4.994230574650729248', 18))
        // mint 1 additional token
        await presenceToken.connect(owner).mint(user.address, parseUnits('1', 18));
        expect(await presenceToken.balanceOf(user.address)).to.be.equal(parseUnits('5.994230574650729248', 18))
      
        // wait 1 day
        await ethers.provider.send('evm_increaseTime', [DAY_IN_SECONDS]);
        await ethers.provider.send('evm_mine', []);
        expect(await presenceToken.balanceOf(user.address)).to.be.equal(parseUnits('5.992500537804965278', 18))
      
        // wait 30 days
        await ethers.provider.send('evm_increaseTime', [30 * DAY_IN_SECONDS]);
        await ethers.provider.send('evm_mine', []);
        // calculator: 5.940830968847357642 , contract: 5.940830968847357593 == 49 wei difference
        expect(await presenceToken.balanceOf(user.address)).to.be.equal(parseUnits('5.940830968847357593', 18))

        await ethers.provider.send('evm_increaseTime', [60 * DAY_IN_SECONDS]);
        await ethers.provider.send('evm_mine', []);
        // calculator: 5.838824532279330922 , contract: 5.838824532279330815 == 107 wei difference
        expect(await presenceToken.balanceOf(user.address)).to.be.equal(parseUnits('5.838824532279330815', 18))
      });

    it('arithemtic difference should not be too big', async function () {
      await presenceToken.connect(owner).mint(user.address, parseUnits('1000', 18));
      await ethers.provider.send('evm_increaseTime', [365 * DAY_IN_SECONDS]);
      await ethers.provider.send('evm_mine', []);

      // exact: 900.00009497124503975737187462675835700009138426014159119322378181299840208475649272935384486916737564058134278089122007038629188
      // calculator: 900.000094971245039757 , contract: 900.000094971244942000 == 97 757 wei difference
      expect(await presenceToken.balanceOf(user.address)).to.be.equal(parseUnits('900.000094971244942000', 18))

      await ethers.provider.send('evm_increaseTime', [365 * DAY_IN_SECONDS]);
      await ethers.provider.send('evm_mine', []);
      // exact: 810.00017094825009110065377596737634582308582593734464323849886116360656315383912671105120641864372809144953675865066884919826663025106479459869220402925201847372789960668894713966843290079785713084523
      // calculator: 810.000170948250091100 , contract: 810.000170948249916000 == 175 100 wei difference
      expect(await presenceToken.balanceOf(user.address)).to.be.equal(parseUnits('810.000170948249916000', 18))
    })
  });

  describe('Burn Functionality', function () {
    // TODO make here some test case that is testing passing/reverting depending on the data
    //  of burning tokens in the past? e.g. mint 1 token, wait for 3 days, burn 1 token with arg 3 days ago
    //  and check if the balanceOf really returns 0
    //   then also possible to check various combinations of minting, waiting, minting, waiting, and then burning

    // TODO make test for reverting when burning more than the user have?
  });

  describe('Complex Mint and Burn Scenarios', function () {
    it('should handle mint-burn-mint-burn sequence correctly', async function () {
      // First mint
      await presenceToken.connect(owner).mint(user.address, parseUnits('1', 18));
      
      // Wait 2 days
      await ethers.provider.send('evm_increaseTime', [DAY_IN_SECONDS * 2]);
      await ethers.provider.send('evm_mine', []);

      expect(await presenceToken.balanceOf(user.address)).to.be.equal(parseUnits('0.999422849299772689', 18))

      // First burn
      const burnData1 = [{
        amount: parseUnits('1', 18),
        daysAgo: 2
      }];
      await presenceToken.connect(owner).burn(user.address, burnData1);
      expect(await presenceToken.nonDecayedBalanceOf(user.address)).to.be.equal(0)
      expect(await presenceToken.balanceOf(user.address)).to.be.equal(0)

      await presenceToken.connect(owner).mint(user.address, parseUnits('1', 18));
      await ethers.provider.send('evm_increaseTime', [DAY_IN_SECONDS]);
      await ethers.provider.send('evm_mine', []);

      await presenceToken.connect(owner).mint(user.address, parseUnits('1', 18));
      await ethers.provider.send('evm_increaseTime', [DAY_IN_SECONDS]);
      await ethers.provider.send('evm_mine', []);

      await presenceToken.connect(owner).mint(user.address, parseUnits('1', 18));
      await ethers.provider.send('evm_increaseTime', [DAY_IN_SECONDS]);
      await ethers.provider.send('evm_mine', []);

      expect(await presenceToken.nonDecayedBalanceOf(user.address)).to.be.equal(parseUnits("3", 18))
      expect(await presenceToken.balanceOf(user.address)).to.be.equal(parseUnits("2.998268631175049025", 18))

      const burnData2 = [
        {
          amount: parseUnits('1', 18),
          daysAgo: 3
        },
        // intentional gap between days
        {
          amount: parseUnits('1', 18),
          daysAgo: 1
        },
      ];
      await presenceToken.connect(owner).burn(user.address, burnData2);
      expect(await presenceToken.nonDecayedBalanceOf(user.address)).to.be.equal(parseUnits("1", 18))
      // balance should be only the decayed token from 2 days ago
      expect(await presenceToken.balanceOf(user.address)).to.be.equal(parseUnits("0.999422849299772689", 18))

      await presenceToken.connect(owner).mint(user.address, parseUnits('1', 18));
      expect(await presenceToken.balanceOf(user.address)).to.be.equal(parseUnits("1.999422849299772689", 18))
      
      await ethers.provider.send('evm_increaseTime', [DAY_IN_SECONDS]);
      await ethers.provider.send('evm_mine', []);

      // 1998845781875276336505818887
      // 1998845781875276336
      // 1999422849299772689
      expect(await presenceToken.balanceOf(user.address)).to.be.equal(parseUnits("1.998845781875276336", 18))

      const burnData3 = [
        // intentional gap between days
        {
          amount: parseUnits('1', 18),
          daysAgo: 1
        },
      ];

      await presenceToken.connect(owner).burn(user.address, burnData3)
      // only left the minted token from 3 days ago
      expect(await presenceToken.balanceOf(user.address)).to.be.equal(parseUnits("0.999134398875276336", 18))

      // move 60 days to the future, so 63 days ago was the token minted
      await ethers.provider.send('evm_increaseTime', [60 * DAY_IN_SECONDS]);
      await ethers.provider.send('evm_mine', []);

      // calculation: 0.999134398875276336 × (1 − 0.0288617 / 100)^60
      // exact: 0.981978862854096031004688104894428... (truncated)
      // contracty returns 981978862854096013, so the difference is 18 wei

      // TODO why is there difference of 1 wei here?
      expect(await presenceToken.balanceOf(user.address)).to.be.equal(parseUnits("0.981978862854096013", 18))
      expect(await presenceToken.calculateDecayForDays(parseUnits('1', 18), 63)).to.be.equal(parseUnits("0.981978862854096014", 18))

      await expect(presenceToken.connect(owner).burn(user.address, [{ amount: parseUnits('1', 18), daysAgo: 62 }]), "did not revert on too big amount to burn").to.be.reverted
      await expect(presenceToken.connect(owner).burn(user.address, [{ amount: parseUnits('2', 18), daysAgo: 63 }])).to.be.reverted
      await presenceToken.connect(owner).burn(user.address, [{ amount: parseUnits('1', 18), daysAgo: 63 }])
      expect(await presenceToken.nonDecayedBalanceOf(user.address)).to.be.equal(0)
      expect(await presenceToken.balanceOf(user.address)).to.be.equal(0)
    });

    it('should handle burning with zero days ago', async function () {
        await presenceToken.connect(owner).mint(user.address, parseUnits('1', 18));
  
        const burnData = [{
          amount: parseUnits('1', 18),
          daysAgo: 0
        }];
  
        await presenceToken.connect(owner).burn(user.address, burnData);
        expect(await presenceToken.balanceOf(user.address)).to.equal(0);
      });
  });
})