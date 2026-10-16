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
    it("Should set the correct initial adopters array", async function () {
      const adopters = await adoption.getAdopters();
      expect(adopters.length).to.equal(16);
      for (let i = 0; i < 16; i++) {
        expect(adopters[i]).to.equal(ethers.ZeroAddress);
      }
    });
  });

  describe("Adopt", function () {
    it("Should adopt a pet and update the adopters array", async function () {
      const petId = 5n;
      await adoption.connect(addr1).adopt(petId);

      const adopters = await adoption.getAdopters();
      expect(adopters[petId]).to.equal(addr1.address);
    });

    it("Should return the correct petId", async function () {
      const petId = 3n;
      const result = await adoption.connect(addr2).adopt(petId);
      expect(result).to.equal(petId);
    });

    it("Should revert when adopting a pet with invalid ID", async function () {
      const invalidPetId = 16n;
      await expect(adoption.connect(addr1).adopt(invalidPetId))
        .to.be.revertedWith("invalid pet");
    });

    it("Should allow multiple adoptions of the same pet by different addresses", async function () {
      const petId = 7n;
      await adoption.connect(addr1).adopt(petId);
      await adoption.connect(addr2).adopt(petId);

      const adopters = await adoption.getAdopters();
      expect(adopters[petId]).to.equal(addr2.address);
    });
  });

  describe("getAdopters", function () {
    it("Should return the correct adopters array", async function () {
      await adoption.connect(addr1).adopt(2n);
      await adoption.connect(addr2).adopt(4n);

      const adopters = await adoption.getAdopters();
      expect(adopters[2]).to.equal(addr1.address);
      expect(adopters[4]).to.equal(addr2.address);
      for (let i = 0; i < 16; i++) {
        if (i !== 2 && i !== 4) {
          expect(adopters[i]).to.equal(ethers.ZeroAddress);
        }
      }
    });
  });
});