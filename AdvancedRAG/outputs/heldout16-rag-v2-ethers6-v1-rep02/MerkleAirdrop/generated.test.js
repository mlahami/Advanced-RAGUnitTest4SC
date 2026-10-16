const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("MerkleAirdrop", function () {
  let merkleAirdrop;
  let token;
  let owner;
  let claimer1;
  let claimer2;
  const merkleRoot = "0x1234567890123456789012345678901234567890123456789012345678901234";
  const amount1 = ethers.parseEther("100");
  const amount2 = ethers.parseEther("200");

  beforeEach(async function () {
    [owner, claimer1, claimer2] = await ethers.getSigners();

    // Deploy BenchmarkERC20 token
    const Token = await ethers.getContractFactory("BenchmarkERC20");
    token = await Token.deploy("Test Token", "TT");
    await token.waitForDeployment();

    // Mint tokens to the airdrop contract
    await token.mint(await token.getAddress(), ethers.parseEther("1000000"));

    // Deploy MerkleAirdrop
    const MerkleAirdrop = await ethers.getContractFactory("MerkleAirdrop");
    merkleAirdrop = await MerkleAirdrop.deploy(merkleRoot, await token.getAddress());
    await merkleAirdrop.waitForDeployment();

    // Approve airdrop contract to spend tokens
    await token.approve(await merkleAirdrop.getAddress(), ethers.MaxUint256);
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
    it("Should allow valid claim with correct proof", async function () {
      // Generate a valid proof for claimer1
      const proof = [
        "0x0000000000000000000000000000000000000000000000000000000000000001",
        "0x0000000000000000000000000000000000000000000000000000000000000002"
      ];

      // Claim should succeed
      await expect(merkleAirdrop.connect(claimer1).claim(amount1, proof))
        .to.emit(merkleAirdrop, "Claimed")
        .withArgs(claimer1.address, amount1);

      // Verify claimer1's balance
      expect(await token.balanceOf(claimer1.address)).to.equal(amount1);

      // Verify claimed status
      expect(await merkleAirdrop.claimed(claimer1.address)).to.be.true;
    });

    it("Should prevent double claiming", async function () {
      const proof = [
        "0x0000000000000000000000000000000000000000000000000000000000000001",
        "0x0000000000000000000000000000000000000000000000000000000000000002"
      ];

      // First claim should succeed
      await merkleAirdrop.connect(claimer1).claim(amount1, proof);

      // Second claim should fail
      await expect(merkleAirdrop.connect(claimer1).claim(amount1, proof))
        .to.be.revertedWith("Already claimed");
    });

    it("Should reject invalid proof", async function () {
      // Invalid proof
      const invalidProof = [
        "0x0000000000000000000000000000000000000000000000000000000000000003",
        "0x0000000000000000000000000000000000000000000000000000000000000004"
      ];

      // Claim should fail with invalid proof
      await expect(merkleAirdrop.connect(claimer1).claim(amount1, invalidProof))
        .to.be.revertedWith("Invalid proof");
    });

    it("Should reject transfer failure", async function () {
      // Generate a valid proof for claimer1
      const proof = [
        "0x0000000000000000000000000000000000000000000000000000000000000001",
        "0x0000000000000000000000000000000000000000000000000000000000000002"
      ];

      // Revoke approval to make transfer fail
      await token.approve(await merkleAirdrop.getAddress(), 0n);

      // Claim should fail with transfer failure
      await expect(merkleAirdrop.connect(claimer1).claim(amount1, proof))
        .to.be.revertedWith("Transfer failed");
    });
  });

  describe("State", function () {
    it("Should correctly track claimed status", async function () {
      // Generate proofs for both claimers
      const proof1 = [
        "0x0000000000000000000000000000000000000000000000000000000000000001",
        "0x0000000000000000000000000000000000000000000000000000000000000002"
      ];
      const proof2 = [
        "0x0000000000000000000000000000000000000000000000000000000000000003",
        "0x0000000000000000000000000000000000000000000000000000000000000004"
      ];

      // Claim for claimer1
      await merkleAirdrop.connect(claimer1).claim(amount1, proof1);
      expect(await merkleAirdrop.claimed(claimer1.address)).to.be.true;
      expect(await merkleAirdrop.claimed(claimer2.address)).to.be.false;

      // Claim for claimer2
      await merkleAirdrop.connect(claimer2).claim(amount2, proof2);
      expect(await merkleAirdrop.claimed(claimer1.address)).to.be.true;
      expect(await merkleAirdrop.claimed(claimer2.address)).to.be.true;
    });
  });
});