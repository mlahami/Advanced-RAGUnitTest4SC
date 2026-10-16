const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("Token", function () {
  let token;
  let owner;
  let addr1;
  let addr2;

  beforeEach(async function () {
    [owner, addr1, addr2] = await ethers.getSigners();

    const Token = await ethers.getContractFactory("Token");
    token = await Token.deploy(1000n);
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

  describe("Transactions", function () {
    it("Should transfer tokens between accounts", async function () {
      await token.transfer(addr1.address, 50n);
      const addr1Balance = await token.balanceOf(addr1.address);
      expect(addr1Balance).to.equal(50n);

      await token.connect(addr1).transfer(addr2.address, 25n);
      const addr2Balance = await token.balanceOf(addr2.address);
      expect(addr2Balance).to.equal(25n);
    });

    it("Should fail if sender doesn't have enough tokens", async function () {
      const initialOwnerBalance = await token.balanceOf(owner.address);
      await expect(token.connect(addr1).transfer(owner.address, 1n))
        .to.be.revertedWith("insufficient balance");

      expect(await token.balanceOf(owner.address)).to.equal(initialOwnerBalance);
    });

    it("Should fail if transfer to zero address", async function () {
      await expect(token.transfer(ethers.ZeroAddress, 1n))
        .to.be.revertedWith("zero address");
    });

    it("Should emit Transfer events", async function () {
      await expect(token.transfer(addr1.address, 50n))
        .to.emit(token, "Transfer")
        .withArgs(owner.address, addr1.address, 50n);
    });
  });

  describe("Approvals", function () {
    it("Should approve and allow transferFrom", async function () {
      await token.approve(addr1.address, 100n);
      expect(await token.allowance(owner.address, addr1.address)).to.equal(100n);

      await token.connect(addr1).transferFrom(owner.address, addr2.address, 50n);
      expect(await token.balanceOf(addr2.address)).to.equal(50n);
      expect(await token.allowance(owner.address, addr1.address)).to.equal(50n);
    });

    it("Should fail if transferFrom exceeds allowance", async function () {
      await token.approve(addr1.address, 50n);
      await expect(token.connect(addr1).transferFrom(owner.address, addr2.address, 100n))
        .to.be.revertedWith("insufficient allowance");
    });

    it("Should fail if transferFrom exceeds balance", async function () {
      await token.approve(addr1.address, ethers.MaxUint256);
      await expect(token.connect(addr1).transferFrom(addr2.address, owner.address, 1n))
        .to.be.revertedWith("insufficient balance");
    });

    it("Should emit Approval events", async function () {
      await expect(token.approve(addr1.address, 100n))
        .to.emit(token, "Approval")
        .withArgs(owner.address, addr1.address, 100n);
    });
  });

  describe("Edge Cases", function () {
    it("Should handle zero value transfers", async function () {
      await expect(token.transfer(addr1.address, 0n))
        .to.emit(token, "Transfer")
        .withArgs(owner.address, addr1.address, 0n);
    });

    it("Should handle max uint256 value transfers", async function () {
      await token.transfer(addr1.address, ethers.MaxUint256);
      expect(await token.balanceOf(addr1.address)).to.equal(ethers.MaxUint256);
    });

    it("Should not allow self-transfer", async function () {
      const initialBalance = await token.balanceOf(owner.address);
      await token.transfer(owner.address, 100n);
      expect(await token.balanceOf(owner.address)).to.equal(initialBalance);
    });
  });
});