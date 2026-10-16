const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("CynthiaToken", function () {
  let CynthiaToken;
  let cynthiaToken;
  let owner;
  let addr1;
  let addr2;

  beforeEach(async function () {
    CynthiaToken = await ethers.getContractFactory("CynthiaToken");
    [owner, addr1, addr2] = await ethers.getSigners();
    cynthiaToken = await CynthiaToken.deploy(owner.address);
    await cynthiaToken.waitForDeployment();
  });

  describe("Deployment", function () {
    it("Should have the correct name and symbol", async function () {
        expect(await cynthiaToken.name()).to.equal("CynthiaToken");
        expect(await cynthiaToken.symbol()).to.equal("CYNTHIA");
      });

    it("Should have the correct total supply", async function () {
        const expectedSupply = ethers.parseEther("100000000"); // 100 million with 18 decimals
        expect(await cynthiaToken.TOTAL_SUPPLY()).to.equal(expectedSupply);
    });
    
    it("Should set the right owner", async function () {
      expect(await cynthiaToken.owner()).to.equal(owner.address);
    });

    it("Should assign the total supply of tokens to the owner", async function () {
      const ownerBalance = await cynthiaToken.balanceOf(owner.address);
      const totalSupply = await cynthiaToken.TOTAL_SUPPLY();
      expect(ownerBalance).to.equal(totalSupply);
    });
  });

  describe("Transactions", function () {
    it("Should allow for approved transfers", async function () {
        await cynthiaToken.approve(addr1.address, ethers.parseEther("1000"));
        await cynthiaToken.connect(addr1).transferFrom(owner.address, addr2.address, ethers.parseEther("1000"));
        expect(await cynthiaToken.balanceOf(addr2.address)).to.equal(ethers.parseEther("1000"));
    });

    it("Should emit Transfer event on transfer", async function () {
        await expect(cynthiaToken.transfer(addr1.address, ethers.parseEther("1000")))
          .to.emit(cynthiaToken, "Transfer")
          .withArgs(owner.address, addr1.address, ethers.parseEther("1000"));
    });
    
    it("Should transfer tokens between accounts", async function () {
      // Transfer 1000 tokens from owner to addr1
      await cynthiaToken.transfer(addr1.address, ethers.parseEther("1000"));
      expect(await cynthiaToken.balanceOf(addr1.address)).to.equal(ethers.parseEther("1000"));

      // Transfer 500 tokens from addr1 to addr2
      await cynthiaToken.connect(addr1).transfer(addr2.address, ethers.parseEther("500"));
      expect(await cynthiaToken.balanceOf(addr2.address)).to.equal(ethers.parseEther("500"));
    });

    it("Should fail if sender doesn't have enough tokens", async function () {
      const initialOwnerBalance = await cynthiaToken.balanceOf(owner.address);
      await expect(
        cynthiaToken.connect(addr1).transfer(owner.address, 1)
      ).to.be.revertedWithCustomError(cynthiaToken, "ERC20InsufficientBalance");
      expect(await cynthiaToken.balanceOf(owner.address)).to.equal(initialOwnerBalance);
    });
  });

  describe("Approval and TransferFrom", function () {
    it("Should approve and then transfer from another account", async function () {
      await cynthiaToken.approve(addr1.address, ethers.parseEther("100"));
      await cynthiaToken.connect(addr1).transferFrom(owner.address, addr2.address, ethers.parseEther("100"));
      expect(await cynthiaToken.balanceOf(addr2.address)).to.equal(ethers.parseEther("100"));
    });

    it("Should fail if trying to transfer more than approved amount", async function () {
      await cynthiaToken.approve(addr1.address, ethers.parseEther("99"));
      await expect(
        cynthiaToken.connect(addr1).transferFrom(owner.address, addr2.address, ethers.parseEther("100"))
      ).to.be.revertedWithCustomError(cynthiaToken, "ERC20InsufficientAllowance");
    });

    it("Should update allowance after transferFrom", async function () {
      await cynthiaToken.approve(addr1.address, ethers.parseEther("100"));
      await cynthiaToken.connect(addr1).transferFrom(owner.address, addr2.address, ethers.parseEther("50"));
      expect(await cynthiaToken.allowance(owner.address, addr1.address)).to.equal(ethers.parseEther("50"));
    });
  });

  describe("Ownership", function () {
    it("Should transfer ownership", async function () {
      await cynthiaToken.transferOwnership(addr1.address);
      expect(await cynthiaToken.owner()).to.equal(addr1.address);
    });

    it("Should not allow non-owners to transfer ownership", async function () {
      await expect(
        cynthiaToken.connect(addr1).transferOwnership(addr2.address)
      ).to.be.revertedWithCustomError(cynthiaToken, "OwnableUnauthorizedAccount");
    });

    it("Should allow new owner to transfer ownership", async function () {
      await cynthiaToken.transferOwnership(addr1.address);
      await cynthiaToken.connect(addr1).transferOwnership(addr2.address);
      expect(await cynthiaToken.owner()).to.equal(addr2.address);
    });
  });

  describe("Edge Cases", function () {
    it("Should allow transferring 0 tokens", async function () {
      await expect(cynthiaToken.transfer(addr1.address, 0))
        .to.emit(cynthiaToken, "Transfer")
        .withArgs(owner.address, addr1.address, 0);
      expect(await cynthiaToken.balanceOf(addr1.address)).to.equal(0);
    });

    it("Should fail when transferring to the zero address", async function () {
      await expect(
        cynthiaToken.transfer(ethers.ZeroAddress, ethers.parseEther("100"))
      ).to.be.revertedWithCustomError(cynthiaToken, "ERC20InvalidReceiver");
    });

    it("Should fail when transferring from the zero address", async function () {
      // This test is a bit tricky to set up directly, so we'll test it indirectly
      // by trying to transferFrom the zero address
      await expect(
        cynthiaToken.transferFrom(ethers.ZeroAddress, addr1.address, ethers.parseEther("100"))
      ).to.be.revertedWithCustomError(cynthiaToken, "ERC20InsufficientAllowance");
    });

    it("Should fail when approving the zero address", async function () {
      await expect(
        cynthiaToken.approve(ethers.ZeroAddress, ethers.parseEther("100"))
      ).to.be.revertedWithCustomError(cynthiaToken, "ERC20InvalidSpender");
    });
  });
});