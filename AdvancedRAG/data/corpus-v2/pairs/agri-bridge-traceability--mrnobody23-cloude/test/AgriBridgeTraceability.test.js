const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("AgriBridgeTraceability Contract", function () {
    let contract;
    let owner, farmer, exporter, transporter, regulator, stranger;

    const FARMER_ROLE     = ethers.keccak256(ethers.toUtf8Bytes("FARMER_ROLE"));
    const EXPORTER_ROLE   = ethers.keccak256(ethers.toUtf8Bytes("EXPORTER_ROLE"));
    const TRANSPORTER_ROLE = ethers.keccak256(ethers.toUtf8Bytes("TRANSPORTER_ROLE"));
    const REGULATOR_ROLE  = ethers.keccak256(ethers.toUtf8Bytes("REGULATOR_ROLE"));
    const ADMIN_ROLE      = ethers.keccak256(ethers.toUtf8Bytes("ADMIN_ROLE"));

    beforeEach(async function () {
        [owner, farmer, exporter, transporter, regulator, stranger] = await ethers.getSigners();
        const ContractFactory = await ethers.getContractFactory("AgriBridgeTraceability");
        contract = await ContractFactory.deploy();
        await contract.waitForDeployment();

        // Grant supply chain roles
        await contract.grantRole(FARMER_ROLE,     farmer.address);
        await contract.grantRole(EXPORTER_ROLE,   exporter.address);
        await contract.grantRole(TRANSPORTER_ROLE, transporter.address);
        await contract.grantRole(REGULATOR_ROLE,  regulator.address);
    });

    // ── Role Management ─────────────────────────────────────────────────────

    it("Deployer has ADMIN_ROLE", async function () {
        expect(await contract.hasRole(ADMIN_ROLE, owner.address)).to.be.true;
    });

    it("Admin can grant and revoke roles", async function () {
        await contract.grantRole(FARMER_ROLE, stranger.address);
        expect(await contract.hasRole(FARMER_ROLE, stranger.address)).to.be.true;

        await contract.revokeRole(FARMER_ROLE, stranger.address);
        expect(await contract.hasRole(FARMER_ROLE, stranger.address)).to.be.false;
    });

    it("Non-admin cannot grant roles", async function () {
        await expect(
            contract.connect(stranger).grantRole(FARMER_ROLE, stranger.address)
        ).to.be.revertedWith("AgriBridge: caller is not an admin");
    });

    it("Admin cannot self-revoke ADMIN_ROLE (lockout prevention)", async function () {
        await expect(
            contract.revokeRole(ADMIN_ROLE, owner.address)
        ).to.be.revertedWith("AgriBridge: cannot self-revoke ADMIN_ROLE");
    });

    // ── Batch Registration ───────────────────────────────────────────────────

    it("Farmer can register a batch with SHA-256 hash", async function () {
        const batchId   = "AGR-2026-UK-001";
        const sha256Hash = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";

        await contract.connect(farmer).registerBatch(batchId, sha256Hash);

        const retrievedHash = await contract.getBatchHash(batchId);
        expect(retrievedHash).to.equal(sha256Hash);

        const [hash, , registeredBy, exists] = await contract.verifyBatch(batchId);
        expect(exists).to.be.true;
        expect(hash).to.equal(sha256Hash);
        expect(registeredBy).to.equal(farmer.address);
    });

    it("Non-farmer cannot register a batch", async function () {
        await expect(
            contract.connect(stranger).registerBatch("AGR-HACK-999", "0xdeadbeef")
        ).to.be.revertedWith("AgriBridge: caller does not have required role");
    });

    it("Duplicate batch registration is rejected", async function () {
        const batchId = "AGR-2026-EU-002";
        const hash    = "a94a8fe5ccb19ba61c4c0873d391e987982fbbd3";

        await contract.connect(farmer).registerBatch(batchId, hash);

        await expect(
            contract.connect(farmer).registerBatch(batchId, hash)
        ).to.be.revertedWith("AgriBridge: Batch ID already registered");
    });

    // ── Supply Chain Events ──────────────────────────────────────────────────

    it("Exporter can add a supply chain event", async function () {
        const batchId = "AGR-2026-UK-003";
        const hash    = "b94a8fe5ccb19ba61c4c0873d391e987982fbbd4";

        await contract.connect(farmer).registerBatch(batchId, hash);
        await contract.connect(exporter).addSupplyChainEvent(
            batchId, "EXPORTED", "EXPORTER", "JNPT Port Mumbai", "Container MAEU9912"
        );

        const count = await contract.getBatchEventsCount(batchId);
        expect(count).to.equal(2n); // FARM_REGISTERED + EXPORTED

        const [eventType, actorRole, location] = await contract.getBatchEvent(batchId, 1);
        expect(eventType).to.equal("EXPORTED");
        expect(actorRole).to.equal("EXPORTER");
        expect(location).to.equal("JNPT Port Mumbai");
    });

    it("Transporter can add a transit event", async function () {
        const batchId = "AGR-2026-EU-004";
        const hash    = "c04a8fe5ccb19ba61c4c0873d391e987982fbbd5";

        await contract.connect(farmer).registerBatch(batchId, hash);
        await contract.connect(transporter).addSupplyChainEvent(
            batchId, "IN_TRANSIT", "TRANSPORTER", "Arabian Sea", "Temp: 12.5°C"
        );

        const count = await contract.getBatchEventsCount(batchId);
        expect(count).to.equal(2n);
    });

    it("Regulator can add an inspection event", async function () {
        const batchId = "AGR-2026-US-005";
        const hash    = "d14a8fe5ccb19ba61c4c0873d391e987982fbbd6";

        await contract.connect(farmer).registerBatch(batchId, hash);
        await contract.connect(regulator).addSupplyChainEvent(
            batchId, "INSPECTED", "REGULATOR", "UK Border Control", "Grade A — Passed"
        );

        const count = await contract.getBatchEventsCount(batchId);
        expect(count).to.equal(2n);
    });

    it("Stranger without any role cannot add events", async function () {
        const batchId = "AGR-2026-UK-006";
        const hash    = "e24a8fe5ccb19ba61c4c0873d391e987982fbbd7";

        await contract.connect(farmer).registerBatch(batchId, hash);

        await expect(
            contract.connect(stranger).addSupplyChainEvent(
                batchId, "MALICIOUS", "HACKER", "Unknown", "inject"
            )
        ).to.be.revertedWith("AgriBridge: caller does not have a supply chain role");
    });

    it("Adding event to non-existent batch is rejected", async function () {
        await expect(
            contract.connect(exporter).addSupplyChainEvent(
                "FAKE-BATCH", "EXPORTED", "EXPORTER", "Nowhere", ""
            )
        ).to.be.revertedWith("AgriBridge: Batch ID does not exist");
    });

    it("getBatchEvent bounds check works", async function () {
        const batchId = "AGR-2026-UK-007";
        const hash    = "f34a8fe5ccb19ba61c4c0873d391e987982fbbd8";

        await contract.connect(farmer).registerBatch(batchId, hash);

        await expect(
            contract.getBatchEvent(batchId, 99)
        ).to.be.revertedWith("AgriBridge: Index out of bounds");
    });
});
