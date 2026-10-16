const { expect } = require("chai");
const { ethers } = require("hardhat");

function fakeHash(seed) {
  return ethers.keccak256(ethers.toUtf8Bytes(seed)).replace("0x", "").padEnd(64, "0");
}

describe("CertiChainRegistry", () => {
  let registry;
  let owner;
  let authorized;
  let unauthorized;

  const certId1 = "CC-2026-AABBCCDD";
  const certHash1 = fakeHash("certificate-1");

  const certId2 = "CC-2026-EEFF0011";
  const certHash2 = fakeHash("certificate-2");

  beforeEach(async () => {
    [owner, authorized, unauthorized] = await ethers.getSigners();

    const Factory = await ethers.getContractFactory("CertiChainRegistry");
    registry = (await Factory.deploy());
    await registry.waitForDeployment();
  });

  describe("registerCertificate()", () => {
    it("owner can register a certificate", async () => {
      await expect(registry.registerCertificate(certId1, certHash1))
        .to.emit(registry, "CertificateRegistered")
        .withArgs(
          certId1,
          ethers.keccak256(ethers.toUtf8Bytes(certHash1)),
          owner.address,
          await ethers.provider.getBlock("latest").then(b => b .timestamp + 1)
        );
    });

    it("authorized issuer can register a certificate", async () => {
      await registry.connect(owner).authorizeIssuer(authorized.address);
      await expect(
        registry.connect(authorized).registerCertificate(certId2, certHash2)
      ).to.emit(registry, "CertificateRegistered");
    });

    it("rejects duplicate hash registration", async () => {
      await registry.registerCertificate(certId1, certHash1);
      await expect(
        registry.registerCertificate("CC-2026-DUPLICATE", certHash1)
      ).to.be.revertedWith("CertiChain: certificate already registered");
    });

    it("rejects duplicate certificateId registration", async () => {
      await registry.registerCertificate(certId1, certHash1);
      await expect(
        registry.registerCertificate(certId1, certHash2)
      ).to.be.revertedWith("CertiChain: certificateId already registered");
    });

    it("rejects registration from unauthorized address", async () => {
      await expect(
        registry.connect(unauthorized).registerCertificate(certId1, certHash1)
      ).to.be.revertedWith("CertiChain: caller is not authorized");
    });
  });

  describe("verifyCertificate()", () => {
    beforeEach(async () => {
      await registry.registerCertificate(certId1, certHash1);
    });

    it("returns exists=true and revoked=false for a registered hash", async () => {
      const [exists, revoked, issuer, timestamp, certId] =
        await registry.verifyCertificate(certHash1);

      expect(exists).to.equal(true);
      expect(revoked).to.equal(false);
      expect(issuer).to.equal(owner.address);
      expect(timestamp).to.be.gt(0);
      expect(certId).to.equal(certId1);
    });

    it("returns exists=false for an unregistered hash", async () => {
      const wrongHash = fakeHash("wrong-certificate-data");
      const [exists] = await registry.verifyCertificate(wrongHash);
      expect(exists).to.equal(false);
    });

    it("isValid() returns true for registered, non-revoked certificate", async () => {
      expect(await registry.isValid(certHash1)).to.equal(true);
    });

    it("isValid() returns false for unregistered hash", async () => {
      expect(await registry.isValid(fakeHash("nonexistent"))).to.equal(false);
    });
  });

  describe("revokeCertificate()", () => {
    beforeEach(async () => {
      await registry.registerCertificate(certId1, certHash1);
    });

    it("owner can revoke a certificate", async () => {
      await expect(registry.revokeCertificate(certHash1))
        .to.emit(registry, "CertificateRevoked");

      const [exists, revoked] = await registry.verifyCertificate(certHash1);
      expect(exists).to.equal(true);
      expect(revoked).to.equal(true);
    });

    it("isValid() returns false after revocation", async () => {
      await registry.revokeCertificate(certHash1);
      expect(await registry.isValid(certHash1)).to.equal(false);
    });

    it("cannot revoke an already-revoked certificate", async () => {
      await registry.revokeCertificate(certHash1);
      await expect(
        registry.revokeCertificate(certHash1)
      ).to.be.revertedWith("CertiChain: certificate already revoked");
    });

    it("cannot revoke a non-existent certificate", async () => {
      await expect(
        registry.revokeCertificate(fakeHash("nonexistent"))
      ).to.be.revertedWith("CertiChain: certificate not found");
    });

    it("rejects revocation from unauthorized address", async () => {
      await expect(
        registry.connect(unauthorized).revokeCertificate(certHash1)
      ).to.be.revertedWith("CertiChain: caller is not authorized");
    });
  });

  describe("Issuer authorization", () => {
    it("owner can authorize and de-authorize issuers", async () => {
      await registry.authorizeIssuer(authorized.address);
      expect(await registry.authorizedIssuers(authorized.address)).to.equal(true);

      await registry.revokeIssuer(authorized.address);
      expect(await registry.authorizedIssuers(authorized.address)).to.equal(false);
    });

    it("non-owner cannot authorize issuers", async () => {
      await expect(
        registry.connect(unauthorized).authorizeIssuer(unauthorized.address)
      ).to.be.revertedWith("CertiChain: caller is not the owner");
    });

    it("de-authorized issuer cannot register new certificates", async () => {
      await registry.authorizeIssuer(authorized.address);
      await registry.revokeIssuer(authorized.address);

      await expect(
        registry.connect(authorized).registerCertificate(certId1, certHash1)
      ).to.be.revertedWith("CertiChain: caller is not authorized");
    });
  });
});
