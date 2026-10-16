const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("TokenizedStock", function () {
  let tokenizedStock;
  let owner;
  let user1;
  let user2;

  beforeEach(async function () {
    [owner, user1, user2] = await ethers.getSigners();

    const TokenizedStockFactory = await ethers.getContractFactory("TokenizedStock");
    tokenizedStock = await TokenizedStockFactory.deploy(
      "Apple Inc. Token",
      "AAPL",
      "AAPL",
      ethers.parseEther("1000000")
    );

    await tokenizedStock.waitForDeployment();
  });

  describe("Deployment", function () {
    it("Should set the correct name and symbol", async function () {
      expect(await tokenizedStock.name()).to.equal("Apple Inc. Token");
      expect(await tokenizedStock.symbol()).to.equal("AAPL");
    });

    it("Should set the correct total authorized supply", async function () {
      expect(await tokenizedStock.totalAuthorizedSupply()).to.equal(ethers.parseEther("1000000"));
    });

    it("Should grant roles to deployer", async function () {
      const MINTER_ROLE = await tokenizedStock.MINTER_ROLE();
      const COMPLIANCE_ROLE = await tokenizedStock.COMPLIANCE_ROLE();

      expect(await tokenizedStock.hasRole(MINTER_ROLE, owner.address)).to.be.true;
      expect(await tokenizedStock.hasRole(COMPLIANCE_ROLE, owner.address)).to.be.true;
    });
  });

  describe("Minting", function () {
    it("Should mint tokens to an address", async function () {
      const amount = ethers.parseEther("1000");
      await tokenizedStock.mint(user1.address, amount);

      expect(await tokenizedStock.balanceOf(user1.address)).to.equal(amount);
    });

    it("Should prevent minting more than authorized supply", async function () {
      const maxAmount = ethers.parseEther("1000000");
      const excessAmount = ethers.parseEther("1");

      await expect(
        tokenizedStock.mint(user1.address, maxAmount + excessAmount)
      ).to.be.revertedWith("TokenizedStock: Exceeds authorized supply");
    });
  });

  describe("Compliance", function () {
    it("Should update whitelist status", async function () {
      await tokenizedStock.updateWhitelist(user1.address, true);
      expect(await tokenizedStock.whitelist(user1.address)).to.be.true;
    });

    it("Should prevent transfer if sender not whitelisted", async function () {
      const amount = ethers.parseEther("1000");
      await tokenizedStock.mint(user1.address, amount);
      await tokenizedStock.updateWhitelist(user2.address, true); // Only receiver is whitelisted

      await expect(
        tokenizedStock.connect(user1).transfer(user2.address, amount)
      ).to.be.revertedWith("TokenizedStock: Transfer not allowed - compliance check failed");
    });

    it("Should prevent transfer if receiver not whitelisted", async function () {
      const amount = ethers.parseEther("1000");
      await tokenizedStock.mint(user1.address, amount);
      await tokenizedStock.updateWhitelist(user1.address, true); // Only sender is whitelisted

      await expect(
        tokenizedStock.connect(user1).transfer(user2.address, amount)
      ).to.be.revertedWith("TokenizedStock: Transfer not allowed - compliance check failed");
    });

    it("Should allow transfer when both are whitelisted", async function () {
      const amount = ethers.parseEther("1000");
      await tokenizedStock.mint(user1.address, amount);
      await tokenizedStock.updateWhitelist(user1.address, true);
      await tokenizedStock.updateWhitelist(user2.address, true);

      await tokenizedStock.connect(user1).transfer(user2.address, amount);
      expect(await tokenizedStock.balanceOf(user2.address)).to.equal(amount);
      expect(await tokenizedStock.balanceOf(user1.address)).to.equal(0);
    });

    it("Should emit WhitelistUpdated event", async function () {
      await expect(tokenizedStock.updateWhitelist(user1.address, true))
        .to.emit(tokenizedStock, "WhitelistUpdated")
        .withArgs(user1.address, true);
    });
  });
});
