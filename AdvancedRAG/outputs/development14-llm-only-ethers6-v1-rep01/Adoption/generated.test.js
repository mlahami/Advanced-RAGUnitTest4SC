const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("Adoption", function () {
  let adoption;
  let owner;
  let addr1;
  let addr2;

  beforeEach(async function () {
    [owner, addr1, addr2] = await ethers.getSigners();

    const Adoption = await ethers.getContractFactory("Adoption");
    adoption = await Adoption.deploy();
    await adoption.waitForDeployment();
  });

  describe("Deployment", function () {
    it("Should initialize with empty adopters array", async function () {
      const adopters = await adoption.getAdopters();
      expect(adopters.length).to.equal(16);
      for (let i = 0; i < 16; i++) {
        expect(adopters[i]).to.equal(ethers.ZeroAddress);
      }
    });
  });

  describe("Adopt", function () {
    it("Should adopt a pet and update adopters array", async function () {
      const petId = 0n;
      const tx = await adoption.connect(addr1).adopt(petId);
      await expect(tx).to.emit(adoption, "Adoption").withArgs(addr1.address, petId);

      const adopters = await adoption.getAdopters();
      expect(adopters[petId]).to.equal(addr1.address);
    });

    it("Should return the adopted pet ID", async function () {
      const petId = 1n;
      const result = await adoption.connect(addr2).adopt(petId);
      expect(result).to.equal(petId);
    });

    it("Should revert when adopting a pet with ID >= 16", async function () {
      const invalidPetId = 16n;
      await expect(adoption.connect(addr1).adopt(invalidPetId))
        .to.be.revertedWith("invalid pet");
    });

    it("Should allow multiple adoptions by different addresses", async function () {
      const petId1 = 2n;
      const petId2 = 3n;

      await adoption.connect(addr1).adopt(petId1);
      await adoption.connect(addr2).adopt(petId2);

      const adopters = await adoption.getAdopters();
      expect(adopters[petId1]).to.equal(addr1.address);
      expect(adopters[petId2]).to.equal(addr2.address);
    });

    it("Should allow the same address to adopt multiple pets", async function () {
      const petId1 = 4n;
      const petId2 = 5n;

      await adoption.connect(addr1).adopt(petId1);
      await adoption.connect(addr1).adopt(petId2);

      const adopters = await adoption.getAdopters();
      expect(adopters[petId1]).to.equal(addr1.address);
      expect(adopters[petId2]).to.equal(addr1.address);
    });
  });

  describe("Get Adopters", function () {
    it("Should return the correct adopters array", async function () {
      const petId1 = 6n;
      const petId2 = 7n;

      await adoption.connect(addr1).adopt(petId1);
      await adoption.connect(addr2).adopt(petId2);

      const adopters = await adoption.getAdopters();
      expect(adopters[petId1]).to.equal(addr1.address);
      expect(adopters[petId2]).to.equal(addr2.address);
      for (let i = 0; i < 16; i++) {
        if (i !== petId1 && i !== petId2) {
          expect(adopters[i]).to.equal(ethers.ZeroAddress);
        }
      }
    });
  });
});