const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("ClaimToken", function () {
  let claimToken;
  let owner;
  let user1;
  let user2;

  beforeEach(async function () {
    [owner, user1, user2] = await ethers.getSigners();

    const ClaimTokenFactory = await ethers.getContractFactory("ClaimToken");
    claimToken = await ClaimTokenFactory.deploy("ClaimToken", "CLAIM", owner.address);
    await claimToken.waitForDeployment();
  });

  describe("Deployment", function () {
    it("Should set the right owner", async function () {
      expect(await claimToken.owner()).to.equal(owner.address);
    });

    it("Should assign the initial supply to the owner", async function () {
      const ownerBalance = await claimToken.balanceOf(owner.address);
      expect(ownerBalance).to.equal(ethers.parseEther("10000"));
    });

    it("Should set the correct token details", async function () {
      expect(await claimToken.name()).to.equal("ClaimToken");
      expect(await claimToken.symbol()).to.equal("CLAIM");
      expect(await claimToken.decimals()).to.equal(18);
    });
  });

  describe("Token Claiming", function () {
    it("Should allow users to claim 10 tokens", async function () {
      const claimAmount = ethers.parseEther("10");

      await expect(claimToken.connect(user1).claimTokens())
        .to.emit(claimToken, "TokensClaimed")
        .withArgs(user1.address, claimAmount);

      const balance = await claimToken.balanceOf(user1.address);
      expect(balance).to.equal(claimAmount);
    });

    it("Should not allow the same address to claim twice", async function () {
      // First claim should succeed
      await claimToken.connect(user1).claimTokens();

      // Second claim should fail
      await expect(claimToken.connect(user1).claimTokens())
        .to.be.revertedWith("Address has already claimed tokens");
    });

    it("Should allow different addresses to claim", async function () {
      const claimAmount = ethers.parseEther("10");

      // User1 claims
      await claimToken.connect(user1).claimTokens();
      expect(await claimToken.balanceOf(user1.address)).to.equal(claimAmount);

      // User2 claims
      await claimToken.connect(user2).claimTokens();
      expect(await claimToken.balanceOf(user2.address)).to.equal(claimAmount);
    });

    it("Should not exceed maximum total supply", async function () {
      const maxSupply = await claimToken.MAX_TOTAL_SUPPLY();
      const currentSupply = await claimToken.totalSupply();
      const remainingSupply = maxSupply - currentSupply;

      // Mint tokens to get close to the max supply, leaving less than 10 tokens
      const mintAmount = remainingSupply - ethers.parseEther("5"); // Leave only 5 tokens remaining
      await claimToken.connect(owner).ownerMint(user1.address, mintAmount);

      // Now try to claim 10 tokens when only 5 are available
      await expect(claimToken.connect(user2).claimTokens())
        .to.be.revertedWith("Would exceed maximum total supply");
    });
  });

  describe("Claim Status Checking", function () {
    it("Should correctly report if user can claim tokens", async function () {
      const canClaim = await claimToken.canClaimTokens(user1.address);
      expect(canClaim).to.be.true;
    });

    it("Should correctly report that user cannot claim after claiming", async function () {
      await claimToken.connect(user1).claimTokens();

      const canClaim = await claimToken.canClaimTokens(user1.address);
      expect(canClaim).to.be.false;
    });

    it("Should track claimed status correctly", async function () {
      expect(await claimToken.hasClaimed(user1.address)).to.be.false;

      await claimToken.connect(user1).claimTokens();

      expect(await claimToken.hasClaimed(user1.address)).to.be.true;
    });
  });

  describe("Owner Functions", function () {
    it("Should allow owner to mint additional tokens", async function () {
      const mintAmount = ethers.parseEther("5000");

      await expect(claimToken.connect(owner).ownerMint(user1.address, mintAmount))
        .to.emit(claimToken, "Transfer")
        .withArgs(ethers.ZeroAddress, user1.address, mintAmount);

      const balance = await claimToken.balanceOf(user1.address);
      expect(balance).to.equal(mintAmount);
    });

    it("Should not allow non-owner to mint tokens", async function () {
      const mintAmount = ethers.parseEther("5000");

      await expect(claimToken.connect(user1).ownerMint(user2.address, mintAmount))
        .to.be.revertedWithCustomError(claimToken, "OwnableUnauthorizedAccount");
    });
  });

  describe("Supply Information", function () {
    it("Should correctly report remaining supply", async function () {
      const maxSupply = await claimToken.MAX_TOTAL_SUPPLY();
      const currentSupply = await claimToken.totalSupply();
      const expectedRemaining = maxSupply - currentSupply;

      const remainingSupply = await claimToken.getRemainingSupply();
      expect(remainingSupply).to.equal(expectedRemaining);
    });

    it("Should return correct claim amount", async function () {
      const claimAmount = await claimToken.getClaimAmount();
      expect(claimAmount).to.equal(ethers.parseEther("10"));
    });
  });
});