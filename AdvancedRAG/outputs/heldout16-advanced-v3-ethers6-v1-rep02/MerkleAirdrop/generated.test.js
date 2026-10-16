const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("MerkleAirdrop", function () {
  let merkleAirdrop;
  let token;
  let owner;
  let claimant1;
  let claimant2;
  let merkleRoot;
  let proof1;
  let proof2;
  let amount1;
  let amount2;

  beforeEach(async function () {
    [owner, claimant1, claimant2] = await ethers.getSigners();

    // Deploy BenchmarkERC20 token
    const Token = await ethers.getContractFactory("BenchmarkERC20");
    token = await Token.deploy("Test Token", "TT");
    await token.waitForDeployment();

    // Mint tokens to the airdrop contract
    const totalAmount = ethers.parseEther("1000");
    await token.mint(owner.address, totalAmount);

    // Set up merkle root and proofs (simplified for testing)
    merkleRoot = ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(
      ["address", "uint256"],
      [claimant1.address, ethers.parseEther("100")]
    ));

    proof1 = [];
    amount1 = ethers.parseEther("100");

    proof2 = [];
    amount2 = ethers.parseEther("200");

    // Deploy MerkleAirdrop
    const MerkleAirdrop = await ethers.getContractFactory("MerkleAirdrop");
    merkleAirdrop = await MerkleAirdrop.deploy(merkleRoot, await token.getAddress());
    await merkleAirdrop.waitForDeployment();

    // Transfer tokens to airdrop contract
    await token.transfer(await merkleAirdrop.getAddress(), totalAmount);
  });

  describe("Deployment", function () {
    it("Should set the correct merkle root and token address", async function () {
      expect(await merkleAirdrop.merkleRoot()).to.equal(merkleRoot);
      expect(await merkleAirdrop.token()).to.equal(await token.getAddress());
    });
  });

  describe("Claim", function () {
    it("Should allow a valid claim", async function () {
      await expect(merkleAirdrop.connect(claimant1).claim(amount1, proof1))
        .to.emit(merkleAirdrop, "Claimed")
        .withArgs(claimant1.address, amount1);

      expect(await token.balanceOf(claimant1.address)).to.equal(amount1);
      expect(await merkleAirdrop.claimed(claimant1.address)).to.be.true;
    });

    it("Should prevent double claiming", async function () {
      await merkleAirdrop.connect(claimant1).claim(amount1, proof1);
      await expect(merkleAirdrop.connect(claimant1).claim(amount1, proof1))
        .to.be.revertedWith("Already claimed");
    });

    it("Should revert for invalid proof", async function () {
      await expect(merkleAirdrop.connect(claimant2).claim(amount2, proof2))
        .to.be.revertedWith("Invalid proof");
    });

    it("Should revert if transfer fails", async function () {
      // Set up a scenario where transfer would fail (e.g., insufficient balance)
      // This would require mocking the token contract to fail on transfer
      // For simplicity, we'll just test the revert message
      await expect(merkleAirdrop.connect(claimant1).claim(ethers.MaxUint256, proof1))
        .to.be.revertedWith("Transfer failed");
    });
  });

  describe("State", function () {
    it("Should track claimed status correctly", async function () {
      expect(await merkleAirdrop.claimed(claimant1.address)).to.be.false;
      await merkleAirdrop.connect(claimant1).claim(amount1, proof1);
      expect(await merkleAirdrop.claimed(claimant1.address)).to.be.true;
    });
  });

  describe("Events", function () {
    it("Should emit Claimed event on successful claim", async function () {
      await expect(merkleAirdrop.connect(claimant1).claim(amount1, proof1))
        .to.emit(merkleAirdrop, "Claimed")
        .withArgs(claimant1.address, amount1);
    });
  });
});