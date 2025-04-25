import {expect} from 'chai';
import {deployments, ethers} from 'hardhat';
import {Citizen, TDFDiamond} from '../typechain';
import {Address} from 'hardhat-deploy/types';
import {SignerWithAddress} from '@nomiclabs/hardhat-ethers/dist/src/signers';
import {
  DEFAULT_CITIZEN_NAME,
  DEFAULT_CITIZEN_SYMBOL,
  DEFAULT_CITIZEN_BASE_URI
} from '../deploy/007_deploy_citizen';

const setup = deployments.createFixture(async () => {
  await deployments.fixture();
  const [deployer, user, user2] = await ethers.getSigners();
  const citizenContract = (await ethers.getContract('Citizen', deployer)) as Citizen;
  const daoContract = (await ethers.getContract('TDFDiamond', deployer)) as TDFDiamond;

  return {
    deployer,
    citizen: citizenContract,
    daoContractAddress: daoContract.address,
    user,
    user2,
  };
});

describe('Citizen Contract', function () {
  let citizen: Citizen, owner: SignerWithAddress, dao: Address, user: SignerWithAddress, user2: SignerWithAddress;

  beforeEach(async () => {
    const testData = await setup();
    owner = testData.deployer;
    citizen = testData.citizen;
    dao = testData.daoContractAddress;
    user = testData.user;
    user2 = testData.user2;
  });

  describe('Initialization', function () {
    it('should have correct name, symbol, and base URI', async function () {
      expect(await citizen.name()).to.equal(DEFAULT_CITIZEN_NAME);
      expect(await citizen.symbol()).to.equal(DEFAULT_CITIZEN_SYMBOL);
      // Base URI is private, so we can't directly check it
    });
  });

  describe('Minting', function () {
    it('should mint citizenship NFT successfully by account with MINTER_ROLE', async function () {
      await citizen.connect(owner).safeMint(user.address, 'citizen-metadata-1.json', 1);
      
      expect(await citizen.balanceOf(user.address)).to.equal(1);
      expect(await citizen.ownerOf(1)).to.equal(user.address);
      expect(await citizen.tokenURI(1)).to.equal(`${DEFAULT_CITIZEN_BASE_URI}citizen-metadata-1.json`);
      expect(await citizen.isCitizen(user.address)).to.be.true;
      expect(await citizen.hasCitizenship(user.address)).to.be.true;
      expect(await citizen.verificationLevel(user.address)).to.equal(1);
      
      const citizenInfo = await citizen.citizenshipInfo(user.address);
      expect(citizenInfo.isActive).to.be.true;
      expect(citizenInfo.level).to.equal(1);
      // We can't predict the exact timestamp, but it should be set
      expect(citizenInfo.since).to.be.gt(0);
    });

    it('should fail to mint if not authorized', async function () {
      await expect(
        citizen.connect(user).safeMint(user.address, 'citizen-metadata-1.json', 1)
      ).to.be.revertedWith('AccessControl');
    });

    it('should fail to mint if address is already a citizen', async function () {
      await citizen.connect(owner).safeMint(user.address, 'citizen-metadata-1.json', 1);
      
      await expect(
        citizen.connect(owner).safeMint(user.address, 'citizen-metadata-2.json', 2)
      ).to.be.revertedWith('Citizen: Address is already a citizen');
    });

    it('should fail to mint with invalid verification level', async function () {
      await expect(
        citizen.connect(owner).safeMint(user.address, 'citizen-metadata-1.json', 4)
      ).to.be.revertedWith('Citizen: Invalid verification level');
    });
  });

  describe('Citizenship Management', function () {
    beforeEach(async () => {
      await citizen.connect(owner).safeMint(user.address, 'citizen-metadata-1.json', 1);
    });

    it('should update verification level successfully', async function () {
      await citizen.connect(owner).updateVerificationLevel(user.address, 2);
      expect(await citizen.verificationLevel(user.address)).to.equal(2);
      
      const citizenInfo = await citizen.citizenshipInfo(user.address);
      expect(citizenInfo.level).to.equal(2);
    });

    it('should fail to update verification level if not authorized', async function () {
      await expect(
        citizen.connect(user).updateVerificationLevel(user.address, 2)
      ).to.be.revertedWith('AccessControl');
    });

    it('should fail to update verification level for non-citizen', async function () {
      await expect(
        citizen.connect(owner).updateVerificationLevel(user2.address, 2)
      ).to.be.revertedWith('Citizen: Address is not a citizen');
    });

    it('should fail to update verification level with invalid level', async function () {
      await expect(
        citizen.connect(owner).updateVerificationLevel(user.address, 4)
      ).to.be.revertedWith('Citizen: Invalid verification level');
    });

    it('should revoke citizenship successfully', async function () {
      await citizen.connect(owner).revokeCitizenship(user.address, 'Violation of terms');
      
      expect(await citizen.isCitizen(user.address)).to.be.false;
      expect(await citizen.hasCitizenship(user.address)).to.be.false;
      
      const citizenInfo = await citizen.citizenshipInfo(user.address);
      expect(citizenInfo.isActive).to.be.false;
      
      // Token should be burned
      await expect(citizen.ownerOf(1)).to.be.revertedWith('ERC721: invalid token ID');
    });

    it('should fail to revoke citizenship if not authorized', async function () {
      await expect(
        citizen.connect(user).revokeCitizenship(user.address, 'Violation of terms')
      ).to.be.revertedWith('AccessControl');
    });

    it('should fail to revoke citizenship for non-citizen', async function () {
      await expect(
        citizen.connect(owner).revokeCitizenship(user2.address, 'Violation of terms')
      ).to.be.revertedWith('Citizen: Address is not a citizen');
    });
  });

  describe('Soulbound Token Behavior', function () {
    beforeEach(async () => {
      await citizen.connect(owner).safeMint(user.address, 'citizen-metadata-1.json', 1);
    });

    it('should not allow token transfers by regular users', async function () {
      await expect(
        citizen.connect(user).transferFrom(user.address, user2.address, 1)
      ).to.be.revertedWith('Citizen: Citizenship tokens are soulbound and cannot be transferred');
      
      await expect(
        citizen.connect(user).safeTransferFrom(user.address, user2.address, 1, '0x')
      ).to.be.revertedWith('Citizen: Citizenship tokens are soulbound and cannot be transferred');
    });

    it('should allow token transfers by authorized roles', async function () {
      // Owner has MINTER_ROLE by default
      await citizen.connect(owner).transferFrom(user.address, user2.address, 1);
      
      expect(await citizen.ownerOf(1)).to.equal(user2.address);
      expect(await citizen.isCitizen(user.address)).to.be.false;
      expect(await citizen.isCitizen(user2.address)).to.be.true;
    });
  });

  describe('Metadata Management', function () {
    it('should set base URI successfully', async function () {
      await citizen.connect(owner).safeMint(user.address, 'citizen-metadata-1.json', 1);
      const initialTokenURI = await citizen.tokenURI(1);
      
      const newBaseURI = 'https://new-metadata.tdf.org/citizen/';
      await citizen.connect(owner).setBaseURI(newBaseURI);
      
      expect(await citizen.tokenURI(1)).to.equal(`${newBaseURI}citizen-metadata-1.json`);
      expect(await citizen.tokenURI(1)).to.not.equal(initialTokenURI);
    });

    it('should fail to set base URI if not authorized', async function () {
      await expect(
        citizen.connect(user).setBaseURI('https://new-metadata.tdf.org/citizen/')
      ).to.be.revertedWith('AccessControl');
    });
  });

  describe('Utility Functions', function () {
    it('should return correct total citizens count', async function () {
      expect(await citizen.totalCitizens()).to.equal(0);
      
      await citizen.connect(owner).safeMint(user.address, 'citizen-metadata-1.json', 1);
      expect(await citizen.totalCitizens()).to.equal(1);
      
      await citizen.connect(owner).safeMint(user2.address, 'citizen-metadata-2.json', 2);
      expect(await citizen.totalCitizens()).to.equal(2);
      
      await citizen.connect(owner).revokeCitizenship(user.address, 'Violation of terms');
      expect(await citizen.totalCitizens()).to.equal(1);
    });
  });
});
