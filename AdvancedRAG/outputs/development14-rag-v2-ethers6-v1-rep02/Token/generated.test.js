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
  });

  describe("Transfer", function () {
    it("Should transfer tokens between accounts", async function () {
      await token.transfer(addr1.address, 50n);

      const ownerBalance = await token.balanceOf(owner.address);
      expect(ownerBalance).to.equal(950n);

      const addr1Balance = await token.balanceOf(addr1.address);
      expect(addr1Balance).to.equal(50n);
    });

    it("Should emit Transfer event", async function () {
      await expect(token.transfer(addr1.address, 50n))
        .to.emit(token, "Transfer")
        .withArgs(owner.address, addr1.address, 50n);
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
  });

  describe("Approve", function () {
    it("Should approve spending", async function () {
      await token.approve(addr1.address, 100n);

      const allowance = await token.allowance(owner.address, addr1.address);
      expect(allowance).to.equal(100n);
    });

    it("Should emit Approval event", async function () {
      await expect(token.approve(addr1.address, 100n))
        .to.emit(token, "Approval")
        .withArgs(owner.address, addr1.address, 100n);
    });
  });

  describe("TransferFrom", function () {
    it("Should transfer tokens when approved", async function () {
      await token.approve(addr1.address, 100n);
      await token.connect(addr1).transferFrom(owner.address, addr2.address, 50n);

      const ownerBalance = await token.balanceOf(owner.address);
      expect(ownerBalance).to.equal(950n);

      const addr2Balance = await token.balanceOf(addr2.address);
      expect(addr2Balance).to.equal(50n);
    });

    it("Should emit Transfer event", async function () {
      await token.approve(addr1.address, 100n);
      await expect(token.connect(addr1).transferFrom(owner.address, addr2.address, 50n))
        .to.emit(token, "Transfer")
        .withArgs(owner.address, addr2.address, 50n);
    });

    it("Should fail if sender doesn't have enough tokens", async function () {
      await token.approve(addr1.address, 100n);

      await expect(token.connect(addr1).transferFrom(owner.address, addr2.address, 1001n))
        .to.be.revertedWith("insufficient balance");
    });

    it("Should fail if allowance is insufficient", async function () {
      await token.approve(addr1.address, 50n);

      await expect(token.connect(addr1).transferFrom(owner.address, addr2.address, 100n))
        .to.be.revertedWith("insufficient allowance");
    });
  });

  describe("Constants", function () {
    it("Should have correct name and symbol", async function () {
      expect(await token.name()).to.equal("SpToken");
      expect(await token.symbol()).to.equal("SP");
    });
  });
});