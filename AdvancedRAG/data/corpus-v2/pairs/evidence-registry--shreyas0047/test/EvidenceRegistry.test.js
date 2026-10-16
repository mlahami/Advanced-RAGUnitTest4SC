const { expect } = require("chai");
const { ethers } = require("hardhat");
const { anyValue } = require("@nomicfoundation/hardhat-chai-matchers/withArgs");

describe('EvidenceRegistry', function () {
  let registry;
  let owner;
  let investigator;
  let verifier;

  const evidenceId = 'ev-001';
  const evidenceHash = ethers.hexlify(ethers.randomBytes(32));
  const investigationId = 'inv-001';
  const metadata = ethers.toUtf8Bytes('test-metadata');

  beforeEach(async function () {
    [owner, investigator, verifier] = await ethers.getSigners();
    const factory = await ethers.getContractFactory('EvidenceRegistry');
    registry = await factory.deploy();
    await registry.waitForDeployment();
  });

  describe('Contract Info', function () {
    it('should return correct contract info', async function () {
      const info = await registry.getContractInfo();
      expect(info[0]).to.equal('1.0.0');
      expect(info[1]).to.equal(owner.address);
      expect(info[2]).to.equal(0n);
    });

    it('should have owner set to deployer', async function () {
      expect(await registry.owner()).to.equal(owner.address);
    });

    it('should have evidenceCount starting at 0', async function () {
      expect(await registry.evidenceCount()).to.equal(0n);
    });
  });

  describe('Evidence Registration', function () {
    it('should register evidence and emit event', async function () {
      const tx = await registry.connect(investigator).registerEvidence(
        evidenceId, evidenceHash, investigationId, metadata
      );
      await expect(tx)
        .to.emit(registry, 'EvidenceRegistered')
        .withArgs(evidenceId, evidenceHash, investigator.address, anyValue, investigationId);

      expect(await registry.evidenceCount()).to.equal(1n);
      expect(await registry.checkEvidenceExists(evidenceId)).to.be.true;
    });

    it('should reject duplicate registration', async function () {
      await registry.connect(investigator).registerEvidence(
        evidenceId, evidenceHash, investigationId, metadata
      );
      await expect(
        registry.connect(investigator).registerEvidence(
          evidenceId, evidenceHash, investigationId, metadata
        )
      ).to.be.revertedWith('Evidence already registered');
    });

    it('should store evidence data correctly', async function () {
      await registry.connect(investigator).registerEvidence(
        evidenceId, evidenceHash, investigationId, metadata
      );

      const ev = await registry.getEvidence(evidenceId);
      expect(ev.evidenceId).to.equal(evidenceId);
      expect(ev.evidenceHash).to.equal(evidenceHash);
      expect(ev.investigator).to.equal(investigator.address);
      expect(ev.investigationId).to.equal(investigationId);
      expect(ev.verificationStatus).to.equal(1n);
    });

    it('should return correct hash and status', async function () {
      await registry.connect(investigator).registerEvidence(
        evidenceId, evidenceHash, investigationId, metadata
      );
      expect(await registry.getEvidenceHash(evidenceId)).to.equal(evidenceHash);
      expect(await registry.getEvidenceStatus(evidenceId)).to.equal(1n);
    });

    it('should batch register evidence and emit for each', async function () {
      const ids = ['ev-001', 'ev-002', 'ev-003'];
      const hashes = [
        ethers.hexlify(ethers.randomBytes(32)),
        ethers.hexlify(ethers.randomBytes(32)),
        ethers.hexlify(ethers.randomBytes(32)),
      ];

      const tx = await registry.connect(owner).batchRegisterEvidence(
        ids, hashes, investigationId
      );
      await expect(tx).to.emit(registry, 'EvidenceRegistered').withArgs(
        ids[2], hashes[2], owner.address, anyValue, investigationId
      );

      expect(await registry.evidenceCount()).to.equal(3n);
      expect(await registry.getInvestigationEvidenceCount(investigationId)).to.equal(3n);
    });
  });

  describe('Evidence Verification', function () {
    beforeEach(async function () {
      await registry.connect(investigator).registerEvidence(
        evidenceId, evidenceHash, investigationId, metadata
      );
    });

    it('should verify evidence with matching hash', async function () {
      await registry.verifyEvidence(evidenceId, evidenceHash);
      const history = await registry.getVerificationHistory(evidenceId);
      expect(history.length).to.equal(1n);
      expect(history[0].result).to.be.true;
    });

    it('should fail verification with non-matching hash', async function () {
      const badHash = ethers.hexlify(ethers.randomBytes(32));
      await registry.verifyEvidence(evidenceId, badHash);
      const history = await registry.getVerificationHistory(evidenceId);
      expect(history.length).to.equal(1n);
      expect(history[0].result).to.be.false;
    });

    it('should emit VerificationFailed on mismatch', async function () {
      const badHash = ethers.hexlify(ethers.randomBytes(32));
      const tx = await registry.connect(verifier).verifyEvidence(evidenceId, badHash);
      await expect(tx)
        .to.emit(registry, 'VerificationFailed')
        .withArgs(evidenceId, verifier.address, evidenceHash, badHash, anyValue);
    });

    it('should store verification history', async function () {
      await registry.verifyEvidence(evidenceId, evidenceHash);

      const history = await registry.getVerificationHistory(evidenceId);
      expect(history.length).to.equal(1n);
      expect(history[0].result).to.be.true;
      expect(history[0].expectedHash).to.equal(evidenceHash);
    });

    it('should reject verification for non-existent evidence', async function () {
      await expect(
        registry.verifyEvidence('nonexistent', evidenceHash)
      ).to.be.revertedWith('Evidence not found');
    });
  });

  describe('State Transitions', function () {
    it('should transition REGISTERED -> TRANSFERRED', async function () {
      await registry.connect(investigator).registerEvidence(
        evidenceId, evidenceHash, investigationId, metadata
      );
      await registry.updateEvidenceStatus(evidenceId, 2);
      expect(await registry.getEvidenceStatus(evidenceId)).to.equal(2n);
    });

    it('should transition REGISTERED -> LOCKED', async function () {
      await registry.connect(investigator).registerEvidence(
        evidenceId, evidenceHash, investigationId, metadata
      );
      await registry.updateEvidenceStatus(evidenceId, 3);
      expect(await registry.getEvidenceStatus(evidenceId)).to.equal(3n);
    });

    it('should reject invalid transition REGISTERED -> PENDING', async function () {
      await registry.connect(investigator).registerEvidence(
        evidenceId, evidenceHash, investigationId, metadata
      );
      await expect(
        registry.updateEvidenceStatus(evidenceId, 0)
      ).to.be.revertedWith('Invalid state transition');
    });

    it('should emit EvidenceStatusUpdated on valid transition', async function () {
      await registry.connect(investigator).registerEvidence(
        evidenceId, evidenceHash, investigationId, metadata
      );
      const tx = await registry.updateEvidenceStatus(evidenceId, 2);
      await expect(tx)
        .to.emit(registry, 'EvidenceStatusUpdated')
        .withArgs(evidenceId, 1n, 2n, owner.address, anyValue);
    });

    it('should transition TRANSFERRED -> LOCKED', async function () {
      await registry.connect(investigator).registerEvidence(
        evidenceId, evidenceHash, investigationId, metadata
      );
      await registry.updateEvidenceStatus(evidenceId, 2);
      await registry.updateEvidenceStatus(evidenceId, 3);
      expect(await registry.getEvidenceStatus(evidenceId)).to.equal(3n);
    });

    it('should reject LOCKED -> any', async function () {
      await registry.connect(investigator).registerEvidence(
        evidenceId, evidenceHash, investigationId, metadata
      );
      await registry.updateEvidenceStatus(evidenceId, 3);
      await expect(
        registry.updateEvidenceStatus(evidenceId, 2)
      ).to.be.revertedWith('Invalid state transition');
    });

    it('should mark evidence as invalid', async function () {
      await registry.connect(investigator).registerEvidence(
        evidenceId, evidenceHash, investigationId, metadata
      );
      await registry.markEvidenceInvalid(evidenceId, 'Compromised');
      expect(await registry.getEvidenceStatus(evidenceId)).to.equal(0n);
    });
  });

  describe('Audit', function () {
    it('should create and retrieve audit entry', async function () {
      const tx = await registry.createAuditEntry(
        0, 1, 'Test audit entry', investigationId, evidenceId, metadata
      );
      await expect(tx).to.emit(registry, 'AuditEntryCreated');

      const entry = await registry.getAuditEntry(0);
      expect(entry.category).to.equal(0n);
      expect(entry.severity).to.equal(1n);
      expect(entry.description).to.equal('Test audit entry');
      expect(entry.investigator).to.equal(owner.address);
    });

    it('should record evidence registration audit', async function () {
      const tx = await registry.recordEvidenceRegistration(
        evidenceId, investigationId, evidenceHash
      );
      await expect(tx).to.emit(registry, 'AuditEntryCreated');

      const audit = await registry.getEvidenceAudit(evidenceId);
      expect(audit.length).to.equal(1n);
    });

    it('should record verification result audit with event', async function () {
      const tx = await registry.recordVerificationResult(
        evidenceId, investigationId, true, evidenceHash, evidenceHash
      );
      await expect(tx)
        .to.emit(registry, 'VerificationAuditEvent')
        .withArgs(0n, evidenceId, true, owner.address, anyValue);
    });

    it('should record tamper detection audit', async function () {
      const badHash = ethers.hexlify(ethers.randomBytes(32));
      const tx = await registry.recordTamperDetection(
        evidenceId, investigationId, evidenceHash, badHash
      );
      await expect(tx).to.emit(registry, 'CriticalAuditEvent');
      await expect(tx).to.emit(registry, 'EvidenceAuditEvent');
    });

    it('should record system event', async function () {
      await registry.recordSystemEvent('System health check', ethers.toUtf8Bytes('ok'));
      expect(await registry.auditEntryCount()).to.equal(1n);
    });

    it('should get recent audit entries', async function () {
      for (let i = 0; i < 5; i++) {
        await registry.createAuditEntry(0, 0, `Entry ${i}`, '', '', ethers.toUtf8Bytes(''));
      }

      const recent = await registry.getRecentAuditEntries(3);
      expect(recent.length).to.equal(3n);
      expect(recent[0].description).to.equal('Entry 2');
      expect(recent[2].description).to.equal('Entry 4');
    });

    it('should get investigation audit entries', async function () {
      await registry.createAuditEntry(0, 0, 'Entry 1', 'inv-001', '', ethers.toUtf8Bytes(''));
      await registry.createAuditEntry(0, 0, 'Entry 2', 'inv-002', '', ethers.toUtf8Bytes(''));
      await registry.createAuditEntry(0, 0, 'Entry 3', 'inv-001', '', ethers.toUtf8Bytes(''));

      const audit = await registry.getInvestigationAudit('inv-001');
      expect(audit.length).to.equal(2n);
    });
  });

  describe('Evidence Listing', function () {
    it('should return all evidence IDs', async function () {
      const ids = ['ev-001', 'ev-002', 'ev-003'];
      for (const id of ids) {
        await registry.registerEvidence(
          id, ethers.hexlify(ethers.randomBytes(32)), investigationId, ethers.toUtf8Bytes('')
        );
      }

      const allIds = await registry.getAllEvidenceIds();
      expect(allIds.length).to.equal(3n);
    });

    it('should return investigation evidence count', async function () {
      await registry.registerEvidence('ev-001', ethers.hexlify(ethers.randomBytes(32)), 'inv-001', ethers.toUtf8Bytes(''));
      await registry.registerEvidence('ev-002', ethers.hexlify(ethers.randomBytes(32)), 'inv-002', ethers.toUtf8Bytes(''));
      await registry.registerEvidence('ev-003', ethers.hexlify(ethers.randomBytes(32)), 'inv-001', ethers.toUtf8Bytes(''));

      expect(await registry.getInvestigationEvidenceCount('inv-001')).to.equal(2n);
      expect(await registry.getInvestigationEvidenceCount('inv-002')).to.equal(1n);
    });
  });
});
