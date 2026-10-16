const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("YourContract", function () {
  // We define a fixture to reuse the same setup in every test.
  let yourContract;
  let owner;
  let recipient;

  before(async () => {
    [owner, recipient] = await ethers.getSigners();
    const yourContractFactory = await ethers.getContractFactory("YourContract");
    yourContract = (await yourContractFactory.deploy());
    await yourContract.waitForDeployment();
  });

  describe("Deployment", function () {
    it("Should set the correct name and symbol", async function () {
      expect(await yourContract.name()).to.equal("POAPademyOnChain");
      expect(await yourContract.symbol()).to.equal("POAP");
    });

    it("Should set the deployer as owner", async function () {
      expect(await yourContract.owner()).to.equal(owner.address);
    });

    it("Should initialize tokenCounter to 1", async function () {
      expect(await yourContract.tokenCounter()).to.equal(1);
    });
  });

  describe("POAP Minting", function () {
    it("Should allow owner to mint a POAP", async function () {
      const courseId = 1;
      const courseName = "Blockchain Basics";
      const courseDescription = "Introduction to blockchain technology";

      await yourContract.mintPOAP(recipient.address, courseId, courseName, courseDescription);

      // Check token ownership
      expect(await yourContract.ownerOf(1)).to.equal(recipient.address);

      // Check certificate data
      const certData = await yourContract.certificateData(1);
      expect(certData.courseId).to.equal(courseId);
      expect(certData.courseName).to.equal(courseName);
      expect(certData.courseDescription).to.equal(courseDescription);

      // Check certificate exists mapping
      expect(await yourContract.certificateExists(courseId, recipient.address)).to.equal(true);
    });

    it("Should prevent duplicate certificates for the same course and recipient", async function () {
      const courseId = 2;
      const courseName = "Smart Contract Development";
      const courseDescription = "Learn to build smart contracts";

      await yourContract.mintPOAP(recipient.address, courseId, courseName, courseDescription);

      // Try to mint another certificate for the same course and recipient
      await expect(
        yourContract.mintPOAP(recipient.address, courseId, courseName, courseDescription),
      ).to.be.revertedWith("Certificate already minted for this course for this recipient");
    });

    it("Should prevent non-owners from minting POAPs", async function () {
      const courseId = 3;
      const courseName = "DeFi Fundamentals";
      const courseDescription = "Introduction to Decentralized Finance";

      // Try to mint as non-owner
      await expect(yourContract.connect(recipient).mintPOAP(recipient.address, courseId, courseName, courseDescription))
        .to.be.reverted;
    });
  });
});
