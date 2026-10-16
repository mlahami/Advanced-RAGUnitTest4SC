const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("MerkleAirdrop", function () {
  let merkleAirdrop;
  let token;
  let owner;
  let claimant;
  let merkleRoot;
  let proof;
  let amount;

  beforeEach(async function () {
    [owner, claimant] = await ethers.getSigners();

    // Deploy BenchmarkERC20 token
    const BenchmarkERC20 = await ethers.getContractFactory("BenchmarkERC20");
    token = await BenchmarkERC20.deploy("Test Token", "TT");
    await token.waitForDeployment();

    // Mint tokens to the contract
    amount = ethers.parseEther("100");
    await token.mint(await merkleAirdrop.getAddress(), amount);

    // Create a simple Merkle tree for testing
    // In a real scenario, you would use a proper Merkle tree library
    merkleRoot = ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(
      ["address", "uint256"],
      [claimant.address, amount]
    ));

    // Simple proof for the test case
    proof = [ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(
      ["address", "uint256"],
      [claimant.address, amount]
    ))];

    // Deploy MerkleAirdrop
    const MerkleAirdrop = await ethers.getContractFactory("MerkleAirdrop");
    merkleAirdrop = await MerkleAirdrop.deploy(merkleRoot, await token.getAddress());
    await merkleAirdrop.waitForDeployment();
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
      await expect(merkleAirdrop.connect(claimant).claim(amount, proof))
        .to.emit(merkleAirdrop, "Claimed")
        .withArgs(claimant.address, amount);

      expect(await token.balanceOf(claimant.address)).to.equal(amount);
      expect(await merkleAirdrop.claimed(claimant.address)).to.be.true;
    });

    it("Should revert if already claimed", async function () {
      await merkleAirdrop.connect(claimant).claim(amount, proof);
      await expect(merkleAirdrop.connect(claimant).claim(amount, proof))
        .to.be.revertedWith("Already claimed");
    });

    it("Should revert with invalid proof", async function () {
      const invalidProof = [ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(
        ["address", "uint256"],
        [owner.address, amount]
      ))];

      await expect(merkleAirdrop.connect(claimant).claim(amount, invalidProof))
        .to.be.revertedWith("Invalid proof");
    });

    it("Should revert if transfer fails", async function () {
      // Create a new contract with zero balance
      const MerkleAirdrop = await ethers.getContractFactory("MerkleAirdrop");
      const emptyAirdrop = await MerkleAirdrop.deploy(merkleRoot, await token.getAddress());
      await emptyAirdrop.waitForDeployment();

      await expect(emptyAirdrop.connect(claimant).claim(amount, proof))
        .to.be.revertedWith("Transfer failed");
    });
  });

  describe("State", function () {
    it("Should update claimed status", async function () {
      expect(await merkleAirdrop.claimed(claimant.address)).to.be.false;
      await merkleAirdrop.connect(claimant).claim(amount, proof);
      expect(await merkleAirdrop.claimed(claimant.address)).to.be.true;
    });
  });

  describe("Events", function () {
    it("Should emit Claimed event", async function () {
      await expect(merkleAirdrop.connect(claimant).claim(amount, proof))
        .to.emit(merkleAirdrop, "Claimed")
        .withArgs(claimant.address, amount);
    });
  });
});