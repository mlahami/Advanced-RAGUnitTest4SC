const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("MerkleAirdrop", function () {
  let merkleAirdrop;
  let token;
  let owner;
  let claimant;
  let merkleRoot;
  let validProof;
  let invalidProof;
  const amount = ethers.parseEther("1");

  beforeEach(async function () {
    [owner, claimant] = await ethers.getSigners();

    // Deploy BenchmarkERC20 token
    const BenchmarkERC20 = await ethers.getContractFactory("BenchmarkERC20");
    token = await BenchmarkERC20.deploy("Test Token", "TT");
    await token.waitForDeployment();

    // Mint tokens to the airdrop contract
    await token.mint(await token.getAddress(), ethers.parseEther("1000"));

    // Set up merkle root and proof (simplified for testing)
    merkleRoot = ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(
      ["address", "uint256"],
      [claimant.address, amount]
    ));

    // Valid proof is empty array for this simplified test
    validProof = [];
    invalidProof = [ethers.keccak256("0x1234")];

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
    it("Should allow valid claim", async function () {
      const initialBalance = await token.balanceOf(claimant.address);

      await expect(merkleAirdrop.connect(claimant).claim(amount, validProof))
        .to.emit(merkleAirdrop, "Claimed")
        .withArgs(claimant.address, amount);

      expect(await token.balanceOf(claimant.address)).to.equal(initialBalance + amount);
      expect(await merkleAirdrop.claimed(claimant.address)).to.be.true;
    });

    it("Should revert when already claimed", async function () {
      await merkleAirdrop.connect(claimant).claim(amount, validProof);
      await expect(merkleAirdrop.connect(claimant).claim(amount, validProof))
        .to.be.revertedWith("Already claimed");
    });

    it("Should revert with invalid proof", async function () {
      await expect(merkleAirdrop.connect(claimant).claim(amount, invalidProof))
        .to.be.revertedWith("Invalid proof");
    });

    it("Should revert when transfer fails", async function () {
      // Set up a scenario where transfer would fail (e.g., insufficient balance)
      // This is a simplified test - in a real scenario you might need to mock the token contract
      await expect(merkleAirdrop.connect(claimant).claim(ethers.parseEther("1001"), validProof))
        .to.be.revertedWith("Transfer failed");
    });
  });

  describe("State", function () {
    it("Should track claimed status", async function () {
      expect(await merkleAirdrop.claimed(claimant.address)).to.be.false;
      await merkleAirdrop.connect(claimant).claim(amount, validProof);
      expect(await merkleAirdrop.claimed(claimant.address)).to.be.true;
    });
  });

  describe("Verification", function () {
    it("Should verify correct proof", async function () {
      const leaf = ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(
        ["address", "uint256"],
        [claimant.address, amount]
      ));
      const isValid = await merkleAirdrop._verify.staticCall(validProof, merkleRoot, leaf);
      expect(isValid).to.be.true;
    });

    it("Should reject incorrect proof", async function () {
      const leaf = ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(
        ["address", "uint256"],
        [claimant.address, amount]
      ));
      const isValid = await merkleAirdrop._verify.staticCall(invalidProof, merkleRoot, leaf);
      expect(isValid).to.be.false;
    });
  });
});