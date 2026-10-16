const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("MerkleAirdrop", function () {
  let merkleAirdrop;
  let token;
  let owner;
  let claimant1;
  let claimant2;
  const merkleRoot = "0x5b7d3a3b3b3b3b3b3b3b3b3b3b3b3b3b3b3b3b3b3b3b3b3b3b3b3b3b3b3b3b3b";
  const amount1 = 100n;
  const amount2 = 200n;

  beforeEach(async function () {
    [owner, claimant1, claimant2] = await ethers.getSigners();

    // Deploy BenchmarkERC20 token
    const BenchmarkERC20 = await ethers.getContractFactory("BenchmarkERC20");
    token = await BenchmarkERC20.deploy("Test Token", "TT");
    await token.waitForDeployment();

    // Mint tokens to the airdrop contract
    await token.mint(owner.address, ethers.parseEther("1000"));

    // Deploy MerkleAirdrop
    const MerkleAirdrop = await ethers.getContractFactory("MerkleAirdrop");
    merkleAirdrop = await MerkleAirdrop.deploy(merkleRoot, await token.getAddress());
    await merkleAirdrop.waitForDeployment();

    // Transfer tokens to the airdrop contract
    await token.transfer(await merkleAirdrop.getAddress(), ethers.parseEther("1000"));
  });

  describe("Deployment", function () {
    it("Should set the correct merkle root", async function () {
      expect(await merkleAirdrop.merkleRoot()).to.equal(merkleRoot);
    });

    it("Should set the correct token address", async function () {
      expect(await merkleAirdrop.token()).to.equal(await token.getAddress());
    });
  });

  describe("Claim", function () {
    it("Should allow a valid claim", async function () {
      // Mock proof for claimant1
      const proof = [
        "0x3b3b3b3b3b3b3b3b3b3b3b3b3b3b3b3b3b3b3b3b3b3b3b3b3b3b3b3b3b3b3b3b",
        "0x4b4b4b4b4b4b4b4b4b4b4b4b4b4b4b4b4b4b4b4b4b4b4b4b4b4b4b4b4b4b4b4b"
      ];

      // Check initial balance
      const initialBalance = await token.balanceOf(claimant1.address);

      // Perform claim
      await expect(merkleAirdrop.connect(claimant1).claim(amount1, proof))
        .to.emit(merkleAirdrop, "Claimed")
        .withArgs(claimant1.address, amount1);

      // Check final balance
      const finalBalance = await token.balanceOf(claimant1.address);
      expect(finalBalance).to.equal(initialBalance + amount1);

      // Check claimed status
      expect(await merkleAirdrop.claimed(claimant1.address)).to.be.true;
    });

    it("Should prevent double claiming", async function () {
      // Mock proof for claimant1
      const proof = [
        "0x3b3b3b3b3b3b3b3b3b3b3b3b3b3b3b3b3b3b3b3b3b3b3b3b3b3b3b3b3b3b3b3b",
        "0x4b4b4b4b4b4b4b4b4b4b4b4b4b4b4b4b4b4b4b4b4b4b4b4b4b4b4b4b4b4b4b4b"
      ];

      // First claim should succeed
      await merkleAirdrop.connect(claimant1).claim(amount1, proof);

      // Second claim should fail
      await expect(merkleAirdrop.connect(claimant1).claim(amount1, proof))
        .to.be.revertedWith("Already claimed");
    });

    it("Should reject invalid proof", async function () {
      // Invalid proof
      const invalidProof = [
        "0x0000000000000000000000000000000000000000000000000000000000000000",
        "0x0000000000000000000000000000000000000000000000000000000000000000"
      ];

      await expect(merkleAirdrop.connect(claimant1).claim(amount1, invalidProof))
        .to.be.revertedWith("Invalid proof");
    });

    it("Should fail if transfer fails", async function () {
      // Mock proof for claimant1
      const proof = [
        "0x3b3b3b3b3b3b3b3b3b3b3b3b3b3b3b3b3b3b3b3b3b3b3b3b3b3b3b3b3b3b3b3b",
        "0x4b4b4b4b4b4b4b4b4b4b4b4b4b4b4b4b4b4b4b4b4b4b4b4b4b4b4b4b4b4b4b4b"
      ];

      // Set allowance to 0 to make transfer fail
      await token.approve(await merkleAirdrop.getAddress(), 0n);

      await expect(merkleAirdrop.connect(claimant1).claim(amount1, proof))
        .to.be.revertedWith("Transfer failed");
    });
  });

  describe("State", function () {
    it("Should correctly track claimed status", async function () {
      // Mock proof for claimant1
      const proof1 = [
        "0x3b3b3b3b3b3b3b3b3b3b3b3b3b3b3b3b3b3b3b3b3b3b3b3b3b3b3b3b3b3b3b3b",
        "0x4b4b4b4b4b4b4b4b4b4b4b4b4b4b4b4b4b4b4b4b4b4b4b4b4b4b4b4b4b4b4b4b"
      ];

      // Mock proof for claimant2
      const proof2 = [
        "0x5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b",
        "0x6b6b6b6b6b6b6b6b6b6b6b6b6b6b6b6b6b6b6b6b6b6b6b6b6b6b6b6b6b6b6b6b"
      ];

      // Check initial claimed status
      expect(await merkleAirdrop.claimed(claimant1.address)).to.be.false;
      expect(await merkleAirdrop.claimed(claimant2.address)).to.be.false;

      // Claimant1 claims
      await merkleAirdrop.connect(claimant1).claim(amount1, proof1);

      // Check claimed status after claimant1 claims
      expect(await merkleAirdrop.claimed(claimant1.address)).to.be.true;
      expect(await merkleAirdrop.claimed(claimant2.address)).to.be.false;

      // Claimant2 claims
      await merkleAirdrop.connect(claimant2).claim(amount2, proof2);

      // Check claimed status after both claim
      expect(await merkleAirdrop.claimed(claimant1.address)).to.be.true;
      expect(await merkleAirdrop.claimed(claimant2.address)).to.be.true;
    });
  });
});