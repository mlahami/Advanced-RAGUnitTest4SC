# agent-registry--m31527

- domain: registries-identity (identity-registry)
- level: moderate
- origin: human
- convention: hardhat2-ethers6
- source: https://github.com/m31527/AgentDID @ 879fea04ab67ea30ce052e31c87bae1bda90afe3
- license: MIT
- targets: AgentRegistry.sol
- validation: 24 passing tests, 0 failing; statement coverage AgentRegistry.sol 100.0 %

## Contract: AgentRegistry.sol (primary target)

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title AgentDID — AgentRegistry
 * @author AgentDID Contributors (https://github.com/m31527/AgentDID)
 * @notice Core registry for the AgentDID open protocol.
 *
 * AgentDID is a non-commercial, open-source protocol for decentralized
 * AI agent and robot identity — governed by the global community, not
 * any single corporation or nation-state.
 *
 * DID method: did:agent:<address>
 * Spec:       https://github.com/m31527/AgentDID/blob/main/docs/did-spec.md
 * Demo:       https://agentdid.net
 *
 * Each AI agent is assigned an Ethereum address as its cryptographic
 * identity (its "passport"). The owner registers agents with a full
 * capability declaration; agents call logAction() to record every step,
 * creating a tamper-proof, community-auditable history.
 *
 * Anyone may call flagAnomaly() to report behavior that deviates from
 * the agent's declared capabilities — enabling decentralized oversight.
 *
 * Reputation is computed on-chain via getReputation():
 *   - New agents start at 80 / 100
 *   - Successful actions push toward 100
 *   - Each anomaly report deducts 10 points (floor: 0)
 *
 * @dev Non-upgradeable by design — immutability is a feature, not a bug.
 */
contract AgentRegistry {
    // ============ Enums ============

    enum RiskLevel { LOW, MEDIUM, HIGH, CRITICAL }

    enum AgentCategory {
        GENERAL,
        RESEARCH,
        FINANCE,
        MEDICAL,
        LEGAL,
        INFRASTRUCTURE,
        SOCIAL
    }

    // ============ Data Structures ============

    struct AgentIdentity {
        string name;              // Human-readable agent name
        string version;           // Semantic version string
        address owner;            // Wallet that registered this agent
        uint256 registeredAt;     // Unix timestamp of registration
        bool active;              // Can be deactivated by owner or agent
        string metadataURI;       // Pointer to off-chain capability declaration (IPFS)
        uint256 actionCount;      // Total number of logged actions
        bytes32 capabilityHash;   // keccak256 of the off-chain capability declaration JSON
        RiskLevel riskLevel;      // Declared risk level
        AgentCategory category;   // Agent function category
        uint256 anomalyCount;     // Total anomaly reports received
        uint256 successCount;     // Total successful actions (used for reputation)
    }

    // ============ State ============

    mapping(address => AgentIdentity) public agents;
    mapping(address => bool) public isRegistered;

    // ============ Events ============

    event AgentRegistered(
        address indexed agentAddress,
        string name,
        string version,
        address indexed owner,
        uint256 timestamp,
        string metadataURI,
        bytes32 capabilityHash,
        RiskLevel riskLevel,
        AgentCategory category
    );

    /**
     * @dev Emitted every time an agent logs an action.
     *
     * inputHash  = keccak256(abi.encodePacked(rawInput))
     * outputHash = keccak256(abi.encodePacked(rawOutput))
     *
     * Anyone holding the original input/output can verify the hashes match.
     */
    event ActionLogged(
        address indexed agentAddress,
        uint256 indexed actionIndex,
        string actionType,
        bytes32 inputHash,
        bytes32 outputHash,
        bool success,
        uint256 timestamp
    );

    event AgentDeactivated(address indexed agentAddress, uint256 timestamp);

    /**
     * @dev Emitted when any address reports an anomaly for an agent.
     *      severity is 1 (minor) to 10 (critical).
     *      Enables decentralized, community-driven risk monitoring.
     */
    event AnomalyFlagged(
        address indexed agentAddress,
        address indexed reporter,
        string reason,
        uint8 severity,
        uint256 timestamp
    );

    // ============ Modifiers ============

    modifier onlyRegistered() {
        require(isRegistered[msg.sender], "AgentRegistry: not registered");
        _;
    }

    modifier onlyActive() {
        require(agents[msg.sender].active, "AgentRegistry: agent not active");
        _;
    }

    // ============ Registration ============

    /**
     * @dev Register a new AI agent. The caller becomes the owner.
     *      The agentAddress can be a separate hot wallet used by the agent process.
     *
     * @param agentAddress    Ethereum address the agent will use to sign transactions
     * @param name            Human-readable name (e.g. "ResearchBot-v1")
     * @param version         Semantic version string (e.g. "1.0.0")
     * @param metadataURI     URI for the off-chain capability declaration (IPFS recommended)
     * @param capabilityHash  keccak256 of the capability declaration JSON — proves document integrity
     * @param riskLevel       Declared risk classification
     * @param category        Functional category of this agent
     */
    function registerAgent(
        address agentAddress,
        string calldata name,
        string calldata version,
        string calldata metadataURI,
        bytes32 capabilityHash,
        RiskLevel riskLevel,
        AgentCategory category
    ) external {
        require(agentAddress != address(0), "AgentRegistry: zero address");
        require(!isRegistered[agentAddress], "AgentRegistry: already registered");
        require(bytes(name).length > 0, "AgentRegistry: empty name");

        agents[agentAddress] = AgentIdentity({
            name: name,
            version: version,
            owner: msg.sender,
            registeredAt: block.timestamp,
            active: true,
            metadataURI: metadataURI,
            actionCount: 0,
            capabilityHash: capabilityHash,
            riskLevel: riskLevel,
            category: category,
            anomalyCount: 0,
            successCount: 0
        });

        isRegistered[agentAddress] = true;

        emit AgentRegistered(
            agentAddress,
            name,
            version,
            msg.sender,
            block.timestamp,
            metadataURI,
            capabilityHash,
            riskLevel,
            category
        );
    }

    // ============ Action Logging ============

    /**
     * @dev Called BY the agent to log an action on-chain.
     *      Must be called from the agent's registered address.
     *      Increments successCount when success == true (used for reputation).
     *
     * @param actionType  Category string (e.g. "llm_query", "tool_use", "web_search")
     * @param inputHash   keccak256 hash of the action's input data
     * @param outputHash  keccak256 hash of the action's output data
     * @param success     Whether the action completed successfully
     */
    function logAction(
        string calldata actionType,
        bytes32 inputHash,
        bytes32 outputHash,
        bool success
    ) external onlyRegistered onlyActive {
        AgentIdentity storage agent = agents[msg.sender];
        uint256 actionIndex = agent.actionCount;
        agent.actionCount++;
        if (success) agent.successCount++;

        emit ActionLogged(
            msg.sender,
            actionIndex,
            actionType,
            inputHash,
            outputHash,
            success,
            block.timestamp
        );
    }

    // ============ Anomaly Reporting ============

    /**
     * @dev Anyone may flag an anomaly for a registered agent.
     *      This enables decentralized community oversight — no central authority required.
     *      Off-chain systems (dashboards, risk scanners) can aggregate these reports.
     *
     * @param agentAddress  The agent being reported
     * @param reason        Human-readable description of the anomaly
     * @param severity      Severity score 1 (minor) to 10 (critical)
     */
    function flagAnomaly(
        address agentAddress,
        string calldata reason,
        uint8 severity
    ) external {
        require(isRegistered[agentAddress], "AgentRegistry: not registered");
        require(severity >= 1 && severity <= 10, "AgentRegistry: severity must be 1-10");
        require(bytes(reason).length > 0, "AgentRegistry: empty reason");

        agents[agentAddress].anomalyCount++;

        emit AnomalyFlagged(
            agentAddress,
            msg.sender,
            reason,
            severity,
            block.timestamp
        );
    }

    // ============ Reputation ============

    /**
     * @dev Compute an agent's on-chain reputation score (0–100).
     *
     * Formula:
     *   base        = 80
     *   actionBonus = (successCount / actionCount) * 20   [0–20, requires ≥1 action]
     *   penalty     = anomalyCount * 10
     *   score       = clamp(base + actionBonus - penalty, 0, 100)
     *
     * Interpretation:
     *   80–100  Trusted — strong track record, no anomalies
     *   60–79   Good    — some anomalies or limited history
     *   40–59   Caution — multiple anomaly reports
     *   0–39    Flagged — significant community concern
     *
     * Inactive agents always return 0.
     *
     * @param agentAddress  The agent to evaluate
     * @return score        Reputation score 0–100
     */
    function getReputation(address agentAddress)
        external
        view
        returns (uint256 score)
    {
        if (!isRegistered[agentAddress]) return 0;
        AgentIdentity storage agent = agents[agentAddress];
        if (!agent.active) return 0;

        uint256 base = 80;

        // Action bonus: up to +20 based on success rate
        uint256 actionBonus = 0;
        if (agent.actionCount > 0) {
            actionBonus = (agent.successCount * 20) / agent.actionCount;
        }

        // Anomaly penalty: -10 per report
        uint256 penalty = agent.anomalyCount * 10;

        uint256 raw = base + actionBonus;
        if (penalty >= raw) return 0;
        score = raw - penalty;
        if (score > 100) score = 100;
    }

    // ============ View Functions ============

    function getAgent(address agentAddress)
        external
        view
        returns (AgentIdentity memory)
    {
        return agents[agentAddress];
    }

    // ============ Management ============

    /**
     * @dev Deactivate an agent. Only the owner or agent itself may do this.
     *      Irreversible — immutability is a core protocol guarantee.
     */
    function deactivateAgent(address agentAddress) external {
        require(isRegistered[agentAddress], "AgentRegistry: not registered");
        AgentIdentity storage agent = agents[agentAddress];
        require(
            msg.sender == agentAddress || msg.sender == agent.owner,
            "AgentRegistry: unauthorized"
        );
        agent.active = false;
        emit AgentDeactivated(agentAddress, block.timestamp);
    }
}
```

## Tests: AgentRegistry.test.js

```javascript
const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture } = require("@nomicfoundation/hardhat-network-helpers");
const { anyValue } = require("@nomicfoundation/hardhat-chai-matchers/withArgs");

describe("AgentRegistry", function () {
  // ── Shared fixture ─────────────────────────────────────────────────────
  async function deployFixture() {
    const [owner, agent, stranger] = await ethers.getSigners();
    const AgentRegistry = await ethers.getContractFactory("AgentRegistry");
    const registry = await AgentRegistry.deploy();
    await registry.waitForDeployment();
    return { registry, owner, agent, stranger };
  }

  // Helper: register an agent with default capability params
  async function register(registry, owner, agent, opts
   ) {
    const capHash = opts?.capabilityHash
      ?? ethers.keccak256(ethers.toUtf8Bytes("{}"));
    return registry.connect(owner).registerAgent(
      agent.address,
      opts?.name ?? "TestBot",
      opts?.version ?? "1.0.0",
      opts?.metadataURI ?? "ipfs://test",
      capHash,
      opts?.riskLevel ?? 0, // RiskLevel.LOW
      opts?.category ?? 0, // AgentCategory.GENERAL
    );
  }

  // ── Registration ──────────────────────────────────────────────────────
  describe("registerAgent", function () {
    it("registers a new agent and emits AgentRegistered", async function () {
      const { registry, owner, agent } = await loadFixture(deployFixture);
      const capHash = ethers.keccak256(ethers.toUtf8Bytes("{}"));

      await expect(register(registry, owner, agent, { capabilityHash: capHash }))
        .to.emit(registry, "AgentRegistered")
        .withArgs(
          agent.address, "TestBot", "1.0.0", owner.address,
          anyValue, "ipfs://test", capHash, 0, 0,
        );
    });

    it("sets identity fields correctly including capability fields", async function () {
      const { registry, owner, agent } = await loadFixture(deployFixture);
      const capHash = ethers.keccak256(ethers.toUtf8Bytes('{"schema":"agentdid-capability/v1"}'));

      await registry.connect(owner).registerAgent(
        agent.address, "Bot", "2.0.0", "ipfs://meta",
        capHash, 2, 1, // riskLevel=HIGH, category=RESEARCH
      );

      const id = await registry.getAgent(agent.address);
      expect(id.name).to.equal("Bot");
      expect(id.version).to.equal("2.0.0");
      expect(id.owner).to.equal(owner.address);
      expect(id.active).to.be.true;
      expect(id.actionCount).to.equal(0n);
      expect(id.successCount).to.equal(0n);
      expect(id.capabilityHash).to.equal(capHash);
      expect(id.riskLevel).to.equal(2); // HIGH
      expect(id.category).to.equal(1); // RESEARCH
      expect(id.anomalyCount).to.equal(0n);
    });

    it("marks address as registered", async function () {
      const { registry, owner, agent } = await loadFixture(deployFixture);
      expect(await registry.isRegistered(agent.address)).to.be.false;
      await register(registry, owner, agent);
      expect(await registry.isRegistered(agent.address)).to.be.true;
    });

    it("reverts on duplicate registration", async function () {
      const { registry, owner, agent } = await loadFixture(deployFixture);
      await register(registry, owner, agent);
      await expect(register(registry, owner, agent, { name: "Bot2" }))
        .to.be.revertedWith("AgentRegistry: already registered");
    });

    it("reverts on zero address", async function () {
      const { registry, owner } = await loadFixture(deployFixture);
      const capHash = ethers.keccak256(ethers.toUtf8Bytes("{}"));
      await expect(
        registry.connect(owner).registerAgent(
          ethers.ZeroAddress, "Bot", "1.0.0", "", capHash, 0, 0,
        ),
      ).to.be.revertedWith("AgentRegistry: zero address");
    });

    it("reverts on empty name", async function () {
      const { registry, owner, agent } = await loadFixture(deployFixture);
      const capHash = ethers.keccak256(ethers.toUtf8Bytes("{}"));
      await expect(
        registry.connect(owner).registerAgent(
          agent.address, "", "1.0.0", "", capHash, 0, 0,
        ),
      ).to.be.revertedWith("AgentRegistry: empty name");
    });
  });

  // ── Action Logging ────────────────────────────────────────────────────
  describe("logAction", function () {
    async function registeredFixture() {
      const base = await loadFixture(deployFixture);
      await register(base.registry, base.owner, base.agent);
      return base;
    }

    it("logs action and emits ActionLogged", async function () {
      const { registry, agent } = await loadFixture(registeredFixture);
      const inputHash = ethers.keccak256(ethers.toUtf8Bytes("hello"));
      const outputHash = ethers.keccak256(ethers.toUtf8Bytes("world"));

      await expect(
        registry.connect(agent).logAction("llm_query", inputHash, outputHash, true),
      ).to.emit(registry, "ActionLogged");
    });

    it("increments actionCount and successCount", async function () {
      const { registry, agent } = await loadFixture(registeredFixture);
      const h = ethers.keccak256(ethers.toUtf8Bytes("x"));
      await registry.connect(agent).logAction("test", h, h, true); // success
      await registry.connect(agent).logAction("test", h, h, false); // fail
      await registry.connect(agent).logAction("test", h, h, true); // success
      const id = await registry.getAgent(agent.address);
      expect(id.actionCount).to.equal(3n);
      expect(id.successCount).to.equal(2n);
    });

    it("reverts for unregistered address", async function () {
      const { registry, stranger } = await loadFixture(registeredFixture);
      const h = ethers.keccak256(ethers.toUtf8Bytes("x"));
      await expect(
        registry.connect(stranger).logAction("test", h, h, true),
      ).to.be.revertedWith("AgentRegistry: not registered");
    });
  });

  // ── Anomaly Flagging ──────────────────────────────────────────────────
  describe("flagAnomaly", function () {
    async function registeredFixture() {
      const base = await loadFixture(deployFixture);
      await register(base.registry, base.owner, base.agent);
      return base;
    }

    it("anyone can flag an anomaly and emits AnomalyFlagged", async function () {
      const { registry, agent, stranger } = await loadFixture(registeredFixture);

      await expect(
        registry.connect(stranger).flagAnomaly(
          agent.address, "Unexpected financial transaction", 8,
        ),
      )
        .to.emit(registry, "AnomalyFlagged")
        .withArgs(agent.address, stranger.address, "Unexpected financial transaction", 8, anyValue);
    });

    it("increments anomalyCount on the agent", async function () {
      const { registry, agent, stranger } = await loadFixture(registeredFixture);

      await registry.connect(stranger).flagAnomaly(agent.address, "Reason A", 3);
      await registry.connect(stranger).flagAnomaly(agent.address, "Reason B", 5);

      const id = await registry.getAgent(agent.address);
      expect(id.anomalyCount).to.equal(2n);
    });

    it("reverts for unregistered agent", async function () {
      const { registry, stranger } = await loadFixture(deployFixture);
      await expect(
        registry.connect(stranger).flagAnomaly(stranger.address, "Test", 5),
      ).to.be.revertedWith("AgentRegistry: not registered");
    });

    it("reverts for severity out of range", async function () {
      const { registry, agent, stranger } = await loadFixture(registeredFixture);
      await expect(
        registry.connect(stranger).flagAnomaly(agent.address, "Test", 0),
      ).to.be.revertedWith("AgentRegistry: severity must be 1-10");
      await expect(
        registry.connect(stranger).flagAnomaly(agent.address, "Test", 11),
      ).to.be.revertedWith("AgentRegistry: severity must be 1-10");
    });

    it("reverts for empty reason", async function () {
      const { registry, agent, stranger } = await loadFixture(registeredFixture);
      await expect(
        registry.connect(stranger).flagAnomaly(agent.address, "", 5),
      ).to.be.revertedWith("AgentRegistry: empty reason");
    });
  });

  // ── Deactivation ──────────────────────────────────────────────────────
  describe("deactivateAgent", function () {
    async function registeredFixture() {
      const base = await loadFixture(deployFixture);
      await register(base.registry, base.owner, base.agent);
      return base;
    }

    it("owner can deactivate", async function () {
      const { registry, owner, agent } = await loadFixture(registeredFixture);
      await registry.connect(owner).deactivateAgent(agent.address);
      const id = await registry.getAgent(agent.address);
      expect(id.active).to.be.false;
    });

    it("agent can deactivate itself", async function () {
      const { registry, agent } = await loadFixture(registeredFixture);
      await registry.connect(agent).deactivateAgent(agent.address);
      const id = await registry.getAgent(agent.address);
      expect(id.active).to.be.false;
    });

    it("stranger cannot deactivate", async function () {
      const { registry, stranger, agent } = await loadFixture(registeredFixture);
      await expect(
        registry.connect(stranger).deactivateAgent(agent.address),
      ).to.be.revertedWith("AgentRegistry: unauthorized");
    });

    it("deactivated agent cannot log actions", async function () {
      const { registry, owner, agent } = await loadFixture(registeredFixture);
      await registry.connect(owner).deactivateAgent(agent.address);
      const h = ethers.keccak256(ethers.toUtf8Bytes("x"));
      await expect(
        registry.connect(agent).logAction("test", h, h, true),
      ).to.be.revertedWith("AgentRegistry: agent not active");
    });
  });

  // ── Reputation ────────────────────────────────────────────────────────
  describe("getReputation", function () {
    async function registeredFixture() {
      const base = await loadFixture(deployFixture);
      await register(base.registry, base.owner, base.agent);
      return base;
    }

    it("new agent starts at 80", async function () {
      const { registry, agent } = await loadFixture(registeredFixture);
      expect(await registry.getReputation(agent.address)).to.equal(80n);
    });

    it("all successful actions push score to 100", async function () {
      const { registry, agent } = await loadFixture(registeredFixture);
      const h = ethers.keccak256(ethers.toUtf8Bytes("x"));
      // 10 successful actions → actionBonus = (10/10)*20 = 20
      for (let i = 0; i < 10; i++) {
        await registry.connect(agent).logAction("test", h, h, true);
      }
      expect(await registry.getReputation(agent.address)).to.equal(100n);
    });

    it("each anomaly deducts 10 points", async function () {
      const { registry, agent, stranger } = await loadFixture(registeredFixture);
      await registry.connect(stranger).flagAnomaly(agent.address, "Bad", 5);
      await registry.connect(stranger).flagAnomaly(agent.address, "Worse", 8);
      // 80 - 20 = 60
      expect(await registry.getReputation(agent.address)).to.equal(60n);
    });

    it("score floors at 0 with many anomalies", async function () {
      const { registry, agent, stranger } = await loadFixture(registeredFixture);
      for (let i = 0; i < 10; i++) {
        await registry.connect(stranger).flagAnomaly(agent.address, "Report", 5);
      }
      expect(await registry.getReputation(agent.address)).to.equal(0n);
    });

    it("returns 0 for unregistered address", async function () {
      const { registry, stranger } = await loadFixture(deployFixture);
      expect(await registry.getReputation(stranger.address)).to.equal(0n);
    });

    it("returns 0 for deactivated agent", async function () {
      const { registry, owner, agent } = await loadFixture(registeredFixture);
      await registry.connect(owner).deactivateAgent(agent.address);
      expect(await registry.getReputation(agent.address)).to.equal(0n);
    });
  });
});
```
