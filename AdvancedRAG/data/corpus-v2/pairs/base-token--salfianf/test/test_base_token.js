const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("BaseToken", function () {
  let token, owner, addr1, addr2;

  beforeEach(async function () {
    [owner, addr1, addr2] = await ethers.getSigners();
    const BaseToken = await ethers.getContractFactory("BaseToken");
    token = await BaseToken.deploy("BaseToken", "BTK");
    await token.waitForDeployment();
  });

  describe("Deployment", function () {
    it("Should set correct name and symbol", async function () {
      expect(await token.name()).to.equal("BaseToken");
      expect(await token.symbol()).to.equal("BTK");
    });

    it("Should mint 100M initial supply to deployer", async function () {
      const initial = ethers.parseEther("100000000");
      expect(await token.totalSupply()).to.equal(initial);
      expect(await token.balanceOf(owner.address)).to.equal(initial);
    });

    it("Should set owner correctly", async function () {
      expect(await token.owner()).to.equal(owner.address);
    });
  });

  describe("Minting", function () {
    it("Should allow owner to mint tokens", async function () {
      await token.mint(addr1.address, ethers.parseEther("1000"));
      expect(await token.balanceOf(addr1.address)).to.equal(ethers.parseEther("1000"));
    });

    it("Should reject mint from non-owner", async function () {
      await expect(
        token.connect(addr1).mint(addr1.address, ethers.parseEther("1"))
      ).to.be.revertedWithCustomError(token, "OwnableUnauthorizedAccount");
    });

    it("Should enforce MAX_SUPPLY cap", async function () {
      const max = ethers.parseEther("1000000000");
      const current = await token.totalSupply();
      const overflow = max - current + 1n;
      await expect(
        token.mint(addr1.address, overflow)
      ).to.be.revertedWith("BaseToken: max supply exceeded");
    });
  });

  describe("Pausable", function () {
    it("Should allow owner to pause", async function () {
      await token.pause();
      expect(await token.paused()).to.equal(true);
    });

    it("Should block transfers when paused", async function () {
      await token.pause();
      await expect(
        token.transfer(addr1.address, ethers.parseEther("1"))
      ).to.be.revertedWithCustomError(token, "EnforcedPause");
    });

    it("Should allow owner to unpause", async function () {
      await token.pause();
      await token.unpause();
      expect(await token.paused()).to.equal(false);
    });

    it("Should allow transfers after unpause", async function () {
      await token.pause();
      await token.unpause();
      await token.transfer(addr1.address, ethers.parseEther("100"));
      expect(await token.balanceOf(addr1.address)).to.equal(ethers.parseEther("100"));
    });

    it("Should reject pause from non-owner", async function () {
      await expect(
        token.connect(addr1).pause()
      ).to.be.revertedWithCustomError(token, "OwnableUnauthorizedAccount");
    });
  });

  describe("Transfers", function () {
    beforeEach(async function () {
      await token.transfer(addr1.address, ethers.parseEther("1000"));
    });

    it("Should transfer tokens between accounts", async function () {
      await token.connect(addr1).transfer(addr2.address, ethers.parseEther("500"));
      expect(await token.balanceOf(addr1.address)).to.equal(ethers.parseEther("500"));
      expect(await token.balanceOf(addr2.address)).to.equal(ethers.parseEther("500"));
    });

    it("Should reject transfer exceeding balance", async function () {
      await expect(
        token.connect(addr1).transfer(addr2.address, ethers.parseEther("2000"))
      ).to.be.revertedWithCustomError(token, "ERC20InsufficientBalance");
    });
  });
});
