const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("BatchMinter1155", function () {
  let batchMinter1155;
  let owner;
  let minter;
  let recipient;
  let anotherRecipient;
  let base1155;

  beforeEach(async function () {
    [owner, minter, recipient, anotherRecipient] = await ethers.getSigners();

    const BatchMinter1155 = await ethers.getContractFactory("BatchMinter1155");
    batchMinter1155 = await BatchMinter1155.deploy(owner.address, minter.address);
    const batchMinter1155Address = await batchMinter1155.getAddress();

    const Base1155 = await ethers.getContractFactory("Base1155");
    base1155 = await Base1155.deploy(owner.address, owner.address, owner.address, batchMinter1155Address, owner.address, 1000);
  });

  describe("setNFT", function () {
    it("Should allow minter to set NFT contract", async function () {
      const base1155Address = await base1155.getAddress();
      await batchMinter1155.connect(minter).setNFT(base1155Address);
      expect(await batchMinter1155.nft()).to.equal(base1155Address);
    });

    it("Should revert if not minter", async function () {
      const base1155Address = await base1155.getAddress();
      await expect(batchMinter1155.connect(owner).setNFT(base1155Address)).to.be.revertedWithCustomError(batchMinter1155, "AccessControlUnauthorizedAccount");
    });

    it("Should revert if setting to zero address", async function () {
      await expect(batchMinter1155.connect(minter).setNFT(ethers.ZeroAddress)).to.be.revertedWith("Invalid address.");
    });
  });


  describe("mintBatch", function () {
    beforeEach(async function () {
      const base1155Address = await base1155.getAddress();
      await batchMinter1155.connect(minter).setNFT(base1155Address);
      await base1155.grantRole(await base1155.MINTER_ROLE(), base1155Address);
    });

    it("Should allow minter to batch mint", async function () {
      const ids = [1, 2, 3];
      await batchMinter1155.connect(minter).mintBatch([recipient.address, recipient.address, anotherRecipient.address], ids);

      expect(await base1155.balanceOf(recipient.address, 1)).to.equal(1);
      expect(await base1155.balanceOf(recipient.address, 2)).to.equal(1);
      expect(await base1155.balanceOf(anotherRecipient.address, 3)).to.equal(1);
    });

    it("Should revert if not minter", async function () {
      const ids = [1, 2, 3];
      await expect(batchMinter1155.connect(recipient).mintBatch([recipient.address], ids)).to.be.revertedWithCustomError(batchMinter1155, "AccessControlUnauthorizedAccount");
    });

    it("Should revert if arrays length mismatch", async function () {
      const ids = [1, 2, 3];
      await expect(batchMinter1155.connect(minter).mintBatch([recipient.address, recipient.address], ids)).to.be.reverted;
    });

    it("Should revert if minting to zero address", async function () {
      const ids = [1, 2, 3];
      await expect(batchMinter1155.connect(minter).mintBatch([ethers.ZeroAddress, recipient.address, recipient.address], ids)).to.be.reverted;
    });
  });
});

