const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("MerkleAirdrop", function () {
  let merkleAirdrop;
  let token;
  let owner;
  let user1;
  let user2;
  const merkleRoot = ethers.keccak256(ethers.toUtf8Bytes("test"));
  const amount = ethers.parseEther("100");

  beforeEach(async function () {
    [owner, user1, user2] = await ethers.getSigners();

    // Deploy BenchmarkERC20 token
    const Token = await ethers.getContractFactory("BenchmarkERC20");
    token = await Token.deploy("Test Token", "TT");
    await token.waitForDeployment();

    // Mint tokens to the airdrop contract
    await token.mint(owner.address, ethers.parseEther("1000000"));

    // Deploy MerkleAirdrop
    const MerkleAirdrop = await ethers.getContractFactory("MerkleAirdrop");
    merkleAirdrop = await MerkleAirdrop.deploy(merkleRoot, await token.getAddress());
    await merkleAirdrop.waitForDeployment();

    // Transfer tokens to the airdrop contract
    await token.transfer(await merkleAirdrop.getAddress(), ethers.parseEther("1000000"));
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
      // Create a valid proof for user1
      const leaf = ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(["address", "uint256"], [user1.address, amount]));
      const proof = [ethers.keccak256(ethers.toUtf8Bytes("proof"))]; // Simplified proof for testing

      // User1 claims
      await expect(merkleAirdrop.connect(user1).claim(amount, proof))
        .to.emit(merkleAirdrop, "Claimed")
        .withArgs(user1.address, amount);

      // Check user1's balance
      expect(await token.balanceOf(user1.address)).to.equal(amount);

      // Check claimed status
      expect(await merkleAirdrop.claimed(user1.address)).to.be.true;
    });

    it("Should revert when claiming twice", async function () {
      const leaf = ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(["address", "uint256"], [user1.address, amount]));
      const proof = [ethers.keccak256(ethers.toUtf8Bytes("proof"))];

      // First claim succeeds
      await merkleAirdrop.connect(user1).claim(amount, proof);

      // Second claim fails
      await expect(merkleAirdrop.connect(user1).claim(amount, proof))
        .to.be.revertedWith("Already claimed");
    });

    it("Should revert with invalid proof", async function () {
      const invalidProof = [ethers.keccak256(ethers.toUtf8Bytes("invalid"))];

      await expect(merkleAirdrop.connect(user1).claim(amount, invalidProof))
        .to.be.revertedWith("Invalid proof");
    });

    it("Should revert when token transfer fails", async function () {
      // Create a scenario where the contract doesn't have enough tokens
      const largeAmount = ethers.parseEther("2000000");
      const leaf = ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(["address", "uint256"], [user1.address, largeAmount]));
      const proof = [ethers.keccak256(ethers.toUtf8Bytes("proof"))];

      await expect(merkleAirdrop.connect(user1).claim(largeAmount, proof))
        .to.be.revertedWith("Transfer failed");
    });
  });

  describe("Merkle Proof Verification", function () {
    it("Should correctly verify a valid proof", async function () {
      // This test verifies the internal _verify function through the claim function
      const leaf = ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(["address", "uint256"], [user1.address, amount]));
      const proof = [ethers.keccak256(ethers.toUtf8Bytes("proof"))];

      // The actual verification happens in the contract, so we just check that a valid proof doesn't revert
      await expect(merkleAirdrop.connect(user1).claim(amount, proof))
        .to.emit(merkleAirdrop, "Claimed");
    });

    it("Should reject an invalid proof", async function () {
      const invalidProof = [ethers.keccak256(ethers.toUtf8Bytes("invalid"))];

      await expect(merkleAirdrop.connect(user1).claim(amount, invalidProof))
        .to.be.revertedWith("Invalid proof");
    });
  });
});