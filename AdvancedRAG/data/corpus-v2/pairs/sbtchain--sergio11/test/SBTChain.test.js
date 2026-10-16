const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("SBTChain Contract", function () {
  let SBTChain, sbtChain, owner, approvedRecipient, revoker, anotherAccount;
  let tokenId;

  beforeEach(async function () {
    // Get accounts from Hardhat
    [owner, approvedRecipient, revoker, anotherAccount] = await ethers.getSigners();

    // Deploy the contract
    SBTChain = await ethers.getContractFactory("SBTChain");
    sbtChain = await SBTChain.deploy(owner.address);  // Initialize contract with the owner address
    // Set revoker address
    await sbtChain.setRevoker(revoker.address);
  });

  describe("Approve Recipient", function () {
    it("should approve a recipient", async function () {
        // Approve the recipient
        await sbtChain.approveRecipient(approvedRecipient.address);
      
        // Check if the recipient's address is approved using the isRecipientApproved method
        expect(await sbtChain.isRecipientApproved(approvedRecipient.address)).to.be.true;
    });
      

    it("should not approve a non-owner", async function () {
      // Only the owner can approve recipients
      await expect(
        sbtChain.connect(anotherAccount).approveRecipient(approvedRecipient.address)
      ).to.be.reverted;
    });
  });

  describe("Minting SBTs", function () {
    beforeEach(async function () {
      // Approve the recipient before minting
      await sbtChain.approveRecipient(approvedRecipient.address);
    });

    it("should mint an SBT to an approved recipient", async function () {
      const uri = "https://example.com/metadata";
      const actionType = 1;  // Assuming ActionType is an enum where 1 represents a donation
      const description = "Donated to charity";
      const proofHash = ethers.keccak256(ethers.toUtf8Bytes(description));

      // Mint the SBT
      await sbtChain.connect(owner).mintSBT(approvedRecipient.address, uri, actionType, description, proofHash);

      tokenId = 1;  // First token ID minted
      const tokenOwner = await sbtChain.ownerOf(tokenId);
      const tokenURI = await sbtChain.tokenURI(tokenId);
      const sbtData = await sbtChain.getSBTData(tokenId);

      // Check if the SBT was minted correctly
      expect(tokenOwner).to.equal(approvedRecipient.address);
      expect(tokenURI).to.equal(uri);
      expect(sbtData.actionType).to.equal(actionType);
      expect(sbtData.description).to.equal(description);
      expect(sbtData.revoked).to.be.false;
    });

    it("should revert when minting an SBT for a non-approved recipient", async function () {
      const uri = "https://example.com/metadata";
      const actionType = 1;
      const description = "Donated to charity";
      const proofHash = ethers.keccak256(ethers.toUtf8Bytes(description));

      // Revert if the recipient is not approved
      await expect(
        sbtChain.connect(owner).mintSBT(anotherAccount.address, uri, actionType, description, proofHash)
      ).to.be.revertedWith("Recipient not approved");
    });

    it("should revert if the recipient has already received the same action type", async function () {
      const uri = "https://example.com/metadata";
      const actionType = 1;
      const description = "Donated to charity";
      const proofHash = ethers.keccak256(ethers.toUtf8Bytes(description));

      // Mint an SBT first
      await sbtChain.connect(owner).mintSBT(approvedRecipient.address, uri, actionType, description, proofHash);

      // Revert if the recipient has already received this action type
      await expect(
        sbtChain.connect(owner).mintSBT(approvedRecipient.address, uri, actionType, description, proofHash)
      ).to.be.revertedWith("Already received this action type");
    });
  });

  describe("Revoking SBTs", function () {
    beforeEach(async function () {
      const uri = "https://example.com/metadata";
      const actionType = 1;
      const description = "Donated to charity";
      const proofHash = ethers.keccak256(ethers.toUtf8Bytes(description));
      await sbtChain.approveRecipient(approvedRecipient.address);
      // Mint an SBT to the approved recipient
      await sbtChain.connect(owner).mintSBT(approvedRecipient.address, uri, actionType, description, proofHash);
      tokenId = 1;  // First token ID minted
    });

    it("should revoke an SBT by revoker", async function () {
      // Revoker should be able to revoke the SBT
      await sbtChain.connect(revoker).revokeSBT(tokenId);

      const sbtData = await sbtChain.getSBTData(tokenId);
      expect(sbtData.revoked).to.be.true;
    });

    it("should not allow revocation by non-revoker", async function () {
      // Only the designated revoker can revoke the SBT
      await expect(
        sbtChain.connect(anotherAccount).revokeSBT(tokenId)
      ).to.be.revertedWith("Not authorized to revoke");
    });

    it("should revert if SBT is already revoked", async function () {
      // Revoke the SBT once and try again
      await sbtChain.connect(revoker).revokeSBT(tokenId);
      await expect(
        sbtChain.connect(revoker).revokeSBT(tokenId)
      ).to.be.revertedWith("SBT already revoked");
    });
  });

  describe("Non-transferability of SBTs", function () {
    beforeEach(async function () {
      const uri = "https://example.com/metadata";
      const actionType = 1;
      const description = "Donated to charity";
      const proofHash = ethers.keccak256(ethers.toUtf8Bytes(description));
      await sbtChain.approveRecipient(approvedRecipient.address);
      // Mint an SBT to the approved recipient
      await sbtChain.connect(owner).mintSBT(approvedRecipient.address, uri, actionType, description, proofHash);
      tokenId = 1;
    });

    it("should prevent transfer of an SBT", async function () {
      // Revert if trying to transfer the SBT
      await expect(
        sbtChain.connect(approvedRecipient).transferFrom(approvedRecipient.address, anotherAccount.address, tokenId)
      ).to.be.revertedWith("SBTs are non-transferable");
    });

    it("should prevent safe transfer of an SBT", async function () {
        // Revert if trying to safe transfer the SBT
        await expect(
          sbtChain.connect(approvedRecipient).safeTransferFrom(approvedRecipient.address, anotherAccount.address, tokenId)
        ).to.be.revertedWith("SBTs are non-transferable");
    });
  });

  describe("Burning an SBT", function () {
    beforeEach(async function () {
      const uri = "https://example.com/metadata";
      const actionType = 1;
      const description = "Donated to charity";
      const proofHash = ethers.keccak256(ethers.toUtf8Bytes(description));
      await sbtChain.approveRecipient(approvedRecipient.address);
      // Mint an SBT to the approved recipient
      await sbtChain.connect(owner).mintSBT(approvedRecipient.address, uri, actionType, description, proofHash);
      tokenId = 1;
    });

    it("should allow the owner to burn the SBT", async function () {
      // The recipient should be able to burn their own SBT
      await sbtChain.connect(approvedRecipient).burn(tokenId);
      await expect(sbtChain.ownerOf(tokenId)).to.be.reverted;
    });

    it("should allow the contract owner to burn the SBT", async function () {
      // The contract owner should also be able to burn the SBT
      await sbtChain.connect(owner).burn(tokenId);
      await expect(sbtChain.ownerOf(tokenId)).to.be.reverted;
    });

    it("should not allow others to burn the SBT", async function () {
      // Others should not be allowed to burn the SBT
      await expect(
        sbtChain.connect(anotherAccount).burn(tokenId)
      ).to.be.reverted;
    });
  });
});