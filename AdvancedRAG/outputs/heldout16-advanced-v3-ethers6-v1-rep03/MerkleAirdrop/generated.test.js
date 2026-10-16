const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("MerkleAirdrop", function () {
  let merkleAirdrop;
  let token;
  let owner;
  let user1;
  let user2;
  let merkleRoot;
  let validProof;
  let invalidProof;

  beforeEach(async function () {
    [owner, user1, user2] = await ethers.getSigners();

    // Deploy BenchmarkERC20 token
    const Token = await ethers.getContractFactory("BenchmarkERC20");
    token = await Token.deploy("Test Token", "TT");
    await token.waitForDeployment();

    // Mint tokens to the airdrop contract
    const airdropAmount = ethers.parseEther("1000");
    await token.mint(owner.address, airdropAmount);

    // Set up merkle root and proofs (simplified for testing)
    merkleRoot = ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(
      ["address", "uint256"],
      [user1.address, ethers.parseEther("100")]
    ));

    validProof = [
      ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(
        ["address", "uint256"],
        [user1.address, ethers.parseEther("100")]
      ))
    ];

    invalidProof = [
      ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(
        ["address", "uint256"],
        [user2.address, ethers.parseEther("50")]
      ))
    ];

    // Deploy MerkleAirdrop
    const MerkleAirdrop = await ethers.getContractFactory("MerkleAirdrop");
    merkleAirdrop = await MerkleAirdrop.deploy(merkleRoot, await token.getAddress());
    await merkleAirdrop.waitForDeployment();

    // Transfer tokens to airdrop contract
    await token.transfer(await merkleAirdrop.getAddress(), airdropAmount);
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
      const claimAmount = ethers.parseEther("100");

      await expect(merkleAirdrop.connect(user1).claim(claimAmount, validProof))
        .to.emit(merkleAirdrop, "Claimed")
        .withArgs(user1.address, claimAmount);

      expect(await token.balanceOf(user1.address)).to.equal(claimAmount);
      expect(await merkleAirdrop.claimed(user1.address)).to.be.true;
    });

    it("Should revert when claiming twice", async function () {
      const claimAmount = ethers.parseEther("100");

      await merkleAirdrop.connect(user1).claim(claimAmount, validProof);
      await expect(merkleAirdrop.connect(user1).claim(claimAmount, validProof))
        .to.be.revertedWith("Already claimed");
    });

    it("Should revert with invalid proof", async function () {
      const claimAmount = ethers.parseEther("100");

      await expect(merkleAirdrop.connect(user1).claim(claimAmount, invalidProof))
        .to.be.revertedWith("Invalid proof");
    });

    it("Should revert when token transfer fails", async function () {
      // Set up a scenario where transfer will fail (e.g., insufficient balance)
      const claimAmount = ethers.parseEther("2000"); // More than available

      await expect(merkleAirdrop.connect(user1).claim(claimAmount, validProof))
        .to.be.revertedWith("Transfer failed");
    });

    it("Should revert when claiming with wrong amount", async function () {
      const wrongAmount = ethers.parseEther("50");

      await expect(merkleAirdrop.connect(user1).claim(wrongAmount, validProof))
        .to.be.revertedWith("Invalid proof");
    });
  });

  describe("State", function () {
    it("Should track claimed status", async function () {
      expect(await merkleAirdrop.claimed(user1.address)).to.be.false;

      const claimAmount = ethers.parseEther("100");
      await merkleAirdrop.connect(user1).claim(claimAmount, validProof);

      expect(await merkleAirdrop.claimed(user1.address)).to.be.true;
    });
  });
});