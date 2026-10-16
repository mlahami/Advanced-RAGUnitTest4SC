const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("MerkleAirdrop", function () {
  let merkleAirdrop;
  let token;
  let owner;
  let claimant;
  let merkleRoot;
  let amount;
  let proof;

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

    // Deploy MerkleAirdrop
    const MerkleAirdrop = await ethers.getContractFactory("MerkleAirdrop");
    merkleAirdrop = await MerkleAirdrop.deploy(merkleRoot, await token.getAddress());
    await merkleAirdrop.waitForDeployment();

    // Create a proof (empty array for this simple test case)
    proof = [];
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
      const initialBalance = await token.balanceOf(claimant.address);

      await expect(merkleAirdrop.connect(claimant).claim(amount, proof))
        .to.emit(merkleAirdrop, "Claimed")
        .withArgs(claimant.address, amount);

      const finalBalance = await token.balanceOf(claimant.address);
      expect(finalBalance).to.equal(initialBalance + amount);
      expect(await merkleAirdrop.claimed(claimant.address)).to.be.true;
    });

    it("Should revert if already claimed", async function () {
      await merkleAirdrop.connect(claimant).claim(amount, proof);
      await expect(merkleAirdrop.connect(claimant).claim(amount, proof))
        .to.be.revertedWith("Already claimed");
    });

    it("Should revert with invalid proof", async function () {
      const invalidProof = [ethers.keccak256(ethers.toUtf8Bytes("invalid"))];
      await expect(merkleAirdrop.connect(claimant).claim(amount, invalidProof))
        .to.be.revertedWith("Invalid proof");
    });

    it("Should revert if transfer fails", async function () {
      // Create a new MerkleAirdrop with a token that doesn't have enough balance
      const newMerkleAirdrop = await ethers.getContractFactory("MerkleAirdrop");
      const newAirdrop = await newMerkleAirdrop.deploy(merkleRoot, await token.getAddress());
      await newAirdrop.waitForDeployment();

      // Burn all tokens from the contract to make transfer fail
      await token.burnFrom(await newAirdrop.getAddress(), amount);

      await expect(newAirdrop.connect(claimant).claim(amount, proof))
        .to.be.revertedWith("Transfer failed");
    });
  });

  describe("State", function () {
    it("Should correctly track claimed status", async function () {
      expect(await merkleAirdrop.claimed(claimant.address)).to.be.false;
      await merkleAirdrop.connect(claimant).claim(amount, proof);
      expect(await merkleAirdrop.claimed(claimant.address)).to.be.true;
    });
  });

  describe("Events", function () {
    it("Should emit Claimed event on successful claim", async function () {
      await expect(merkleAirdrop.connect(claimant).claim(amount, proof))
        .to.emit(merkleAirdrop, "Claimed")
        .withArgs(claimant.address, amount);
    });
  });
});