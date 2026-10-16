const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("Token", function () {
  let token;
  let owner;
  let user1;
  let user2;

  const INITIAL_SUPPLY = 1000n;
  const ZERO_ADDRESS = ethers.ZeroAddress;

  beforeEach(async function () {
    [owner, user1, user2] = await ethers.getSigners();

    const Token = await ethers.getContractFactory("Token");
    token = await Token.deploy(INITIAL_SUPPLY);
    await token.waitForDeployment();
  });

  describe("Deployment", function () {
    it("Should set the right owner", async function () {
      expect(await token.ownerOfContract()).to.equal(owner.address);
    });

    it("Should assign the total supply of tokens to the owner", async function () {
      expect(await token.balanceOf(owner.address)).to.equal(INITIAL_SUPPLY);
    });

    it("Should set the correct total supply", async function () {
      expect(await token.totalSupply()).to.equal(INITIAL_SUPPLY);
    });

    it("Should have the correct name and symbol", async function () {
      expect(await token.name()).to.equal("SpToken");
      expect(await token.symbol()).to.equal("SP");
    });
  });

  describe("Transfer", function () {
    it("Should transfer tokens between accounts", async function () {
      const amount = 50n;
      await token.transfer(user1.address, amount);
      expect(await token.balanceOf(owner.address)).to.equal(INITIAL_SUPPLY - amount);
      expect(await token.balanceOf(user1.address)).to.equal(amount);
    });

    it("Should emit Transfer event on transfer", async function () {
      const amount = 50n;
      await expect(token.transfer(user1.address, amount))
        .to.emit(token, "Transfer")
        .withArgs(owner.address, user1.address, amount);
    });

    it("Should fail if sender doesn't have enough tokens", async function () {
      const amount = INITIAL_SUPPLY + 1n;
      await expect(token.transfer(user1.address, amount)).to.be.revertedWith("insufficient balance");
    });

    it("Should fail if transferring to zero address", async function () {
      const amount = 50n;
      await expect(token.transfer(ZERO_ADDRESS, amount)).to.be.revertedWith("zero address");
    });
  });

  describe("Approve", function () {
    it("Should approve tokens for spending", async function () {
      const amount = 100n;
      await token.approve(user1.address, amount);
      expect(await token.allowance(owner.address, user1.address)).to.equal(amount);
    });

    it("Should emit Approval event on approval", async function () {
      const amount = 100n;
      await expect(token.approve(user1.address, amount))
        .to.emit(token, "Approval")
        .withArgs(owner.address, user1.address, amount);
    });

    it("Should allow unlimited approval", async function () {
      await token.approve(user1.address, ethers.MaxUint256);
      expect(await token.allowance(owner.address, user1.address)).to.equal(ethers.MaxUint256);
    });
  });

  describe("TransferFrom", function () {
    it("Should transfer tokens using allowance", async function () {
      const amount = 50n;
      await token.approve(user1.address, amount);
      await token.connect(user1).transferFrom(owner.address, user2.address, amount);

      expect(await token.balanceOf(owner.address)).to.equal(INITIAL_SUPPLY - amount);
      expect(await token.balanceOf(user2.address)).to.equal(amount);
      expect(await token.allowance(owner.address, user1.address)).to.equal(0n);
    });

    it("Should emit Transfer event on transferFrom", async function () {
      const amount = 50n;
      await token.approve(user1.address, amount);
      await expect(token.connect(user1).transferFrom(owner.address, user2.address, amount))
        .to.emit(token, "Transfer")
        .withArgs(owner.address, user2.address, amount);
    });

    it("Should fail if sender doesn't have enough tokens", async function () {
      const amount = INITIAL_SUPPLY + 1n;
      await token.approve(user1.address, amount);
      await expect(token.connect(user1).transferFrom(owner.address, user2.address, amount))
        .to.be.revertedWith("insufficient balance");
    });

    it("Should fail if allowance is insufficient", async function () {
      const amount = 50n;
      await token.approve(user1.address, amount - 1n);
      await expect(token.connect(user1).transferFrom(owner.address, user2.address, amount))
        .to.be.revertedWith("insufficient allowance");
    });

    it("Should fail if transferring to zero address", async function () {
      const amount = 50n;
      await token.approve(user1.address, amount);
      await expect(token.connect(user1).transferFrom(owner.address, ZERO_ADDRESS, amount))
        .to.be.revertedWith("zero address");
    });
  });

  describe("Edge Cases", function () {
    it("Should handle zero value transfers", async function () {
      await expect(token.transfer(user1.address, 0n))
        .to.emit(token, "Transfer")
        .withArgs(owner.address, user1.address, 0n);
    });

    it("Should handle zero value approvals", async function () {
      await expect(token.approve(user1.address, 0n))
        .to.emit(token, "Approval")
        .withArgs(owner.address, user1.address, 0n);
    });

    it("Should handle zero value transferFrom", async function () {
      await token.approve(user1.address, 1n);
      await expect(token.connect(user1).transferFrom(owner.address, user2.address, 0n))
        .to.emit(token, "Transfer")
        .withArgs(owner.address, user2.address, 0n);
    });
  });
});