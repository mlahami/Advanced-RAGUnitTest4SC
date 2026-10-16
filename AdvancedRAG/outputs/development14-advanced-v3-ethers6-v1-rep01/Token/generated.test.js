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
      const ownerBalance = await token.balanceOf(owner.address);
      expect(await token.totalSupply()).to.equal(ownerBalance);
    });

    it("Should have the correct name and symbol", async function () {
      expect(await token.name()).to.equal("SpToken");
      expect(await token.symbol()).to.equal("SP");
    });
  });

  describe("Transfers", function () {
    it("Should transfer tokens between accounts", async function () {
      const amount = 50n;
      await token.transfer(user1.address, amount);

      const ownerBalance = await token.balanceOf(owner.address);
      expect(ownerBalance).to.equal(INITIAL_SUPPLY - amount);

      const user1Balance = await token.balanceOf(user1.address);
      expect(user1Balance).to.equal(amount);
    });

    it("Should emit Transfer events", async function () {
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

  describe("Approvals", function () {
    it("Should approve tokens for delegated transfer", async function () {
      const amount = 50n;
      await token.approve(user1.address, amount);

      const allowance = await token.allowance(owner.address, user1.address);
      expect(allowance).to.equal(amount);
    });

    it("Should emit Approval events", async function () {
      const amount = 50n;
      await expect(token.approve(user1.address, amount))
        .to.emit(token, "Approval")
        .withArgs(owner.address, user1.address, amount);
    });

    it("Should allow delegated transfer", async function () {
      const amount = 50n;
      await token.approve(user1.address, amount);
      await token.connect(user1).transferFrom(owner.address, user2.address, amount);

      const ownerBalance = await token.balanceOf(owner.address);
      expect(ownerBalance).to.equal(INITIAL_SUPPLY - amount);

      const user2Balance = await token.balanceOf(user2.address);
      expect(user2Balance).to.equal(amount);
    });

    it("Should fail if delegated transfer exceeds allowance", async function () {
      const amount = 50n;
      await token.approve(user1.address, amount);
      await expect(token.connect(user1).transferFrom(owner.address, user2.address, amount + 1n))
        .to.be.revertedWith("insufficient allowance");
    });

    it("Should fail if delegated transfer exceeds balance", async function () {
      const amount = INITIAL_SUPPLY + 1n;
      await token.approve(user1.address, amount);
      await expect(token.connect(user1).transferFrom(owner.address, user2.address, amount))
        .to.be.revertedWith("insufficient balance");
    });
  });

  describe("Edge Cases", function () {
    it("Should handle maximum uint256 value correctly", async function () {
      const maxAmount = ethers.MaxUint256;
      await expect(token.transfer(user1.address, maxAmount)).to.be.revertedWith("insufficient balance");
    });

    it("Should handle zero value transfers", async function () {
      await expect(token.transfer(user1.address, 0n))
        .to.emit(token, "Transfer")
        .withArgs(owner.address, user1.address, 0n);

      const user1Balance = await token.balanceOf(user1.address);
      expect(user1Balance).to.equal(0n);
    });
  });
});