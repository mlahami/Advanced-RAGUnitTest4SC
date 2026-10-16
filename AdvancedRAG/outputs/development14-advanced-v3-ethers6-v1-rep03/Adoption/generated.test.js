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
    it("Should allow adoption of a pet", async function () {
      const petId = 0n;
      const tx = await adoption.connect(addr1).adopt(petId);
      await expect(tx).to.emit(adoption, "Adoption").withArgs(addr1.address, petId);

      const adopters = await adoption.getAdopters();
      expect(adopters[petId]).to.equal(addr1.address);
    });

    it("Should revert when adopting an invalid pet ID", async function () {
      const invalidPetId = 16n;
      await expect(adoption.connect(addr1).adopt(invalidPetId))
        .to.be.revertedWith("invalid pet");
    });

    it("Should allow multiple adoptions by different addresses", async function () {
      const petId1 = 0n;
      const petId2 = 1n;

      await adoption.connect(addr1).adopt(petId1);
      await adoption.connect(addr2).adopt(petId2);

      const adopters = await adoption.getAdopters();
      expect(adopters[petId1]).to.equal(addr1.address);
      expect(adopters[petId2]).to.equal(addr2.address);
    });

    it("Should allow re-adoption of a pet by the same address", async function () {
      const petId = 0n;
      await adoption.connect(addr1).adopt(petId);
      await adoption.connect(addr1).adopt(petId);

      const adopters = await adoption.getAdopters();
      expect(adopters[petId]).to.equal(addr1.address);
    });

    it("Should not allow re-adoption of a pet by a different address", async function () {
      const petId = 0n;
      await adoption.connect(addr1).adopt(petId);
      await adoption.connect(addr2).adopt(petId);

      const adopters = await adoption.getAdopters();
      expect(adopters[petId]).to.equal(addr2.address);
    });
  });

  describe("View Functions", function () {
    it("Should return correct adopters array", async function () {
      await adoption.connect(addr1).adopt(0n);
      await adoption.connect(addr2).adopt(1n);

      const adopters = await adoption.getAdopters();
      expect(adopters[0]).to.equal(addr1.address);
      expect(adopters[1]).to.equal(addr2.address);
      for (let i = 2; i < 16; i++) {
        expect(adopters[i]).to.equal(ethers.ZeroAddress);
      }
    });
  });
});