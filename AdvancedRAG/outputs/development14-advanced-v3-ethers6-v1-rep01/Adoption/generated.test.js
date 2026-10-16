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
      const petId = 5n;
      await expect(adoption.connect(addr1).adopt(petId))
        .to.emit(adoption, "AdoptionEvent")
        .withArgs(addr1.address, petId);

      const adopters = await adoption.getAdopters();
      expect(adopters[petId]).to.equal(addr1.address);
    });

    it("Should return the adopted pet ID", async function () {
      const petId = 3n;
      const result = await adoption.connect(addr2).adopt(petId);
      expect(result).to.equal(petId);
    });

    it("Should revert when adopting a pet with invalid ID", async function () {
      const invalidPetId = 16n;
      await expect(adoption.connect(addr1).adopt(invalidPetId))
        .to.be.revertedWith("invalid pet");
    });

    it("Should revert when adopting an already adopted pet", async function () {
      const petId = 7n;
      await adoption.connect(addr1).adopt(petId);
      await expect(adoption.connect(addr2).adopt(petId))
        .to.be.revertedWith("pet already adopted");
    });
  });

  describe("Get Adopters", function () {
    it("Should return the correct adopters array", async function () {
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