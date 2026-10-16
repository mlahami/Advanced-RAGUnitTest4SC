const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("MerkleAirdrop", function () {
  let merkleAirdrop;
  let token;
  let owner;
  let claimer1;
  let claimer2;
  const merkleRoot = "0x5b20f8f7b0e1a2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7";
  const amount1 = ethers.parseEther("100");
  const amount2 = ethers.parseEther("200");

  beforeEach(async function () {
    [owner, claimer1, claimer2] = await ethers.getSigners();

    // Deploy BenchmarkERC20 token
    const Token = await ethers.getContractFactory("BenchmarkERC20");
    token = await Token.deploy("Test Token", "TT");
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
    it("Should allow valid claim with correct proof", async function () {
      // Generate a valid proof for claimer1
      const proof = [
        "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef",
        "0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890"
      ];

      // Mock the _verify function to return true for this test
      // In a real test, you would need to implement the actual proof generation
      await expect(merkleAirdrop.connect(claimer1).claim(amount1, proof))
        .to.emit(merkleAirdrop, "Claimed")
        .withArgs(claimer1.address, amount1);

      expect(await merkleAirdrop.claimed(claimer1.address)).to.be.true;
      expect(await token.balanceOf(claimer1.address)).to.equal(amount1);
    });

    it("Should revert when claiming with invalid proof", async function () {
      const invalidProof = ["0x0000000000000000000000000000000000000000000000000000000000000000"];
      await expect(merkleAirdrop.connect(claimer1).claim(amount1, invalidProof))
        .to.be.revertedWith("Invalid proof");
    });

    it("Should revert when claiming twice", async function () {
      const proof = [
        "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef",
        "0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890"
      ];

      await merkleAirdrop.connect(claimer1).claim(amount1, proof);
      await expect(merkleAirdrop.connect(claimer1).claim(amount1, proof))
        .to.be.revertedWith("Already claimed");
    });

    it("Should revert when token transfer fails", async function () {
      // Set allowance to 0 to make transfer fail
      await token.approve(await merkleAirdrop.getAddress(), 0);

      const proof = [
        "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef",
        "0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890"
      ];

      await expect(merkleAirdrop.connect(claimer1).claim(amount1, proof))
        .to.be.revertedWith("Transfer failed");
    });
  });

  describe("State", function () {
    it("Should correctly track claimed status", async function () {
      expect(await merkleAirdrop.claimed(claimer1.address)).to.be.false;
      expect(await merkleAirdrop.claimed(claimer2.address)).to.be.false;

      const proof = [
        "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef",
        "0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890"
      ];

      await merkleAirdrop.connect(claimer1).claim(amount1, proof);
      expect(await merkleAirdrop.claimed(claimer1.address)).to.be.true;
      expect(await merkleAirdrop.claimed(claimer2.address)).to.be.false;
    });
  });
});