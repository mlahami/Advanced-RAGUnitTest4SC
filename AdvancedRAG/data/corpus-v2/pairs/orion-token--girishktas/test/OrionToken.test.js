const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("OrionToken", function () {
  let orionToken;
  let owner;
  let addr1;
  let addr2;

  beforeEach(async function () {
    [owner, addr1, addr2] = await ethers.getSigners();

    const OrionToken = await ethers.getContractFactory("OrionToken");
    orionToken = await OrionToken.deploy();
    await orionToken.waitForDeployment();
  });

  describe("Deployment", function () {
    it("Should have correct name and symbol", async function () {
      expect(await orionToken.name()).to.equal("Orion DAO Token");
      expect(await orionToken.symbol()).to.equal("ORION");
    });

    it("Should mint initial supply to owner", async function () {
      const initialSupply = ethers.parseEther("100000000"); // 100M
      expect(await orionToken.balanceOf(owner.address)).to.equal(initialSupply);
    });

    it("Should have correct total supply", async function () {
      const initialSupply = ethers.parseEther("100000000");
      expect(await orionToken.totalSupply()).to.equal(initialSupply);
    });

    it("Should set correct max supply", async function () {
      expect(await orionToken.MAX_SUPPLY()).to.equal(ethers.parseEther("1000000000"));
    });
  });

  describe("Minting", function () {
    it("Should allow owner to mint", async function () {
      const mintAmount = ethers.parseEther("1000");
      await orionToken.mint(addr1.address, mintAmount);
      expect(await orionToken.balanceOf(addr1.address)).to.equal(mintAmount);
    });

    it("Should not exceed max supply", async function () {
      const excessAmount = ethers.parseEther("1000000000"); // Would exceed max
      await expect(
        orionToken.mint(addr1.address, excessAmount)
      ).to.be.revertedWith("OrionToken: max supply exceeded");
    });

    it("Should not allow non-owner to mint", async function () {
      await expect(
        orionToken.connect(addr1).mint(addr2.address, ethers.parseEther("1000"))
      ).to.be.reverted;
    });
  });

  describe("Transfers", function () {
    beforeEach(async function () {
      await orionToken.transfer(addr1.address, ethers.parseEther("1000"));
    });

    it("Should transfer tokens", async function () {
      await orionToken.connect(addr1).transfer(addr2.address, ethers.parseEther("100"));
      expect(await orionToken.balanceOf(addr2.address)).to.equal(ethers.parseEther("100"));
    });

    it("Should fail with insufficient balance", async function () {
      await expect(
        orionToken.connect(addr1).transfer(addr2.address, ethers.parseEther("2000"))
      ).to.be.reverted;
    });
  });

  describe("Batch Transfer", function () {
    it("Should batch transfer to multiple addresses", async function () {
      const recipients = [addr1.address, addr2.address];
      const amounts = [ethers.parseEther("100"), ethers.parseEther("200")];

      await orionToken.batchTransfer(recipients, amounts);

      expect(await orionToken.balanceOf(addr1.address)).to.equal(ethers.parseEther("100"));
      expect(await orionToken.balanceOf(addr2.address)).to.equal(ethers.parseEther("200"));
    });

    it("Should fail with array length mismatch", async function () {
      const recipients = [addr1.address, addr2.address];
      const amounts = [ethers.parseEther("100")];

      await expect(
        orionToken.batchTransfer(recipients, amounts)
      ).to.be.revertedWith("OrionToken: array length mismatch");
    });
  });

  describe("Burning", function () {
    beforeEach(async function () {
      await orionToken.transfer(addr1.address, ethers.parseEther("1000"));
    });

    it("Should allow burning own tokens", async function () {
      const burnAmount = ethers.parseEther("100");
      const balanceBefore = await orionToken.balanceOf(addr1.address);

      await orionToken.connect(addr1).burn(burnAmount);

      const balanceAfter = await orionToken.balanceOf(addr1.address);
      expect(balanceBefore - balanceAfter).to.equal(burnAmount);
    });

    it("Should decrease total supply on burn", async function () {
      const burnAmount = ethers.parseEther("100");
      const supplyBefore = await orionToken.totalSupply();

      await orionToken.connect(addr1).burn(burnAmount);

      const supplyAfter = await orionToken.totalSupply();
      expect(supplyBefore - supplyAfter).to.equal(burnAmount);
    });
  });
});

