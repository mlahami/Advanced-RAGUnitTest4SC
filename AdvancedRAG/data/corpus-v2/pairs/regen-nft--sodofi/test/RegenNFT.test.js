const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("RegenNFT", function () {
  let regenNFT;
  let owner;
  let addr1;
  let addr2;

  const NFT_NAME = "Regen NFT";
  const NFT_SYMBOL = "REGEN";
  const BASE_URI = "https://api.regennft.com/metadata/";

  beforeEach(async function () {
    [owner, addr1, addr2] = await ethers.getSigners();

    const RegenNFTFactory = await ethers.getContractFactory("RegenNFT");
    regenNFT = await RegenNFTFactory.deploy(NFT_NAME, NFT_SYMBOL, BASE_URI);
    await regenNFT.waitForDeployment();
  });

  describe("Deployment", function () {
    it("Should set the right name and symbol", async function () {
      expect(await regenNFT.name()).to.equal(NFT_NAME);
      expect(await regenNFT.symbol()).to.equal(NFT_SYMBOL);
    });

    it("Should set the right owner", async function () {
      expect(await regenNFT.owner()).to.equal(owner.address);
    });

    it("Should start with zero total supply", async function () {
      expect(await regenNFT.totalSupply()).to.equal(0);
    });
  });

  describe("Minting", function () {
    it("Should mint NFT to specified address", async function () {
      const tokenURI = "token1.json";
      const impactData = "Carbon offset: 10 tons CO2";

      await expect(regenNFT.mintNFT(addr1.address, tokenURI, impactData))
        .to.emit(regenNFT, "NFTMinted")
        .withArgs(addr1.address, 0, tokenURI);

      expect(await regenNFT.balanceOf(addr1.address)).to.equal(1);
      expect(await regenNFT.ownerOf(0)).to.equal(addr1.address);
      expect(await regenNFT.totalSupply()).to.equal(1);
    });

    it("Should set token URI correctly", async function () {
      const tokenURI = "token1.json";
      const impactData = "Carbon offset: 10 tons CO2";

      await regenNFT.mintNFT(addr1.address, tokenURI, impactData);
      expect(await regenNFT.tokenURI(0)).to.equal(BASE_URI + tokenURI);
    });

    it("Should store impact data correctly", async function () {
      const tokenURI = "token1.json";
      const impactData = "Carbon offset: 10 tons CO2";

      await regenNFT.mintNFT(addr1.address, tokenURI, impactData);
      expect(await regenNFT.getImpactData(0)).to.equal(impactData);
    });

    it("Should only allow owner to mint", async function () {
      const tokenURI = "token1.json";
      const impactData = "Carbon offset: 10 tons CO2";

      await expect(
        regenNFT.connect(addr1).mintNFT(addr2.address, tokenURI, impactData)
      ).to.be.revertedWithCustomError(regenNFT, "OwnableUnauthorizedAccount");
    });

    it("Should batch mint multiple NFTs", async function () {
      const tokenURIs = ["token1.json", "token2.json", "token3.json"];
      const impactDataArray = [
        "Carbon offset: 10 tons CO2",
        "Reforestation: 100 trees planted",
        "Ocean cleanup: 50kg plastic removed"
      ];

      await regenNFT.batchMintNFT(addr1.address, tokenURIs, impactDataArray);

      expect(await regenNFT.balanceOf(addr1.address)).to.equal(3);
      expect(await regenNFT.totalSupply()).to.equal(3);

      for (let i = 0; i < tokenURIs.length; i++) {
        expect(await regenNFT.ownerOf(i)).to.equal(addr1.address);
        expect(await regenNFT.getImpactData(i)).to.equal(impactDataArray[i]);
      }
    });

    it("Should revert batch mint with mismatched arrays", async function () {
      const tokenURIs = ["token1.json", "token2.json"];
      const impactDataArray = ["Carbon offset: 10 tons CO2"];

      await expect(
        regenNFT.batchMintNFT(addr1.address, tokenURIs, impactDataArray)
      ).to.be.revertedWith("Arrays length mismatch");
    });
  });

  describe("Impact Data Management", function () {
    beforeEach(async function () {
      await regenNFT.mintNFT(addr1.address, "token1.json", "Initial impact data");
    });

    it("Should update impact data", async function () {
      const newImpactData = "Updated: Carbon offset: 20 tons CO2";

      await expect(regenNFT.updateImpactData(0, newImpactData))
        .to.emit(regenNFT, "ImpactDataUpdated")
        .withArgs(0, newImpactData);

      expect(await regenNFT.getImpactData(0)).to.equal(newImpactData);
    });

    it("Should only allow owner to update impact data", async function () {
      const newImpactData = "Updated impact data";

      await expect(
        regenNFT.connect(addr1).updateImpactData(0, newImpactData)
      ).to.be.revertedWithCustomError(regenNFT, "OwnableUnauthorizedAccount");
    });

    it("Should revert when updating non-existent token", async function () {
      await expect(
        regenNFT.updateImpactData(999, "Some data")
      ).to.be.revertedWith("Token does not exist");
    });
  });

  describe("Base URI Management", function () {
    it("Should update base URI", async function () {
      const newBaseURI = "https://new-api.regennft.com/metadata/";

      await expect(regenNFT.setBaseURI(newBaseURI))
        .to.emit(regenNFT, "BaseURIUpdated")
        .withArgs(newBaseURI);

      // Mint a token to test the new base URI
      await regenNFT.mintNFT(addr1.address, "token1.json", "Impact data");
      expect(await regenNFT.tokenURI(0)).to.equal(newBaseURI + "token1.json");
    });

    it("Should only allow owner to update base URI", async function () {
      const newBaseURI = "https://new-api.regennft.com/metadata/";

      await expect(
        regenNFT.connect(addr1).setBaseURI(newBaseURI)
      ).to.be.revertedWithCustomError(regenNFT, "OwnableUnauthorizedAccount");
    });
  });

  describe("Token Queries", function () {
    beforeEach(async function () {
      await regenNFT.mintNFT(addr1.address, "token1.json", "Impact data 1");
      await regenNFT.mintNFT(addr2.address, "token2.json", "Impact data 2");
    });

    it("Should return correct total supply", async function () {
      expect(await regenNFT.totalSupply()).to.equal(2);
    });

    it("Should revert when querying impact data for non-existent token", async function () {
      await expect(regenNFT.getImpactData(999)).to.be.revertedWith("Token does not exist");
    });

    it("Should support ERC721 interface", async function () {
      const ERC721_INTERFACE_ID = "0x80ac58cd";
      expect(await regenNFT.supportsInterface(ERC721_INTERFACE_ID)).to.be.true;
    });
  });
});