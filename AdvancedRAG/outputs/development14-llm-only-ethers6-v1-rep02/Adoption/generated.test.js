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
    it("Should set the correct initial state", async function () {
      const adopters = await adoption.getAdopters();
      expect(adopters.length).to.equal(16);
      for (let i = 0; i < 16; i++) {
        expect(adopters[i]).to.equal(ethers.ZeroAddress);
      }
    });
  });

  describe("Adopt", function () {
    it("Should adopt a pet and update the adopters array", async function () {
      const petId = 0n;
      await expect(adoption.connect(addr1).adopt(petId))
        .to.emit(adoption, "Adoption")
        .withArgs(addr1.address, petId);

      const adopters = await adoption.getAdopters();
      expect(adopters[petId]).to.equal(addr1.address);
    });

    it("Should return the correct petId", async function () {
      const petId = 5n;
      const result = await adoption.connect(addr2).adopt(petId);
      expect(result).to.equal(petId);
    });

    it("Should revert when trying to adopt an invalid pet", async function () {
      const invalidPetId = 16n;
      await expect(adoption.connect(addr1).adopt(invalidPetId))
        .to.be.revertedWith("invalid pet");
    });

    it("Should revert when trying to adopt an already adopted pet", async function () {
      const petId = 10n;
      await adoption.connect(addr1).adopt(petId);
      await expect(adoption.connect(addr2).adopt(petId))
        .to.be.revertedWith("invalid pet");
    });
  });

  describe("GetAdopters", function () {
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