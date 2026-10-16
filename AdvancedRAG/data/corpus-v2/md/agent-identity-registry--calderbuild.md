# agent-identity-registry--calderbuild

- domain: registries-identity (identity-registry)
- level: simple
- origin: human
- convention: hardhat2-ethers6
- source: https://github.com/calderbuild/SafeReceipt @ ae78bdae89f72b9ac68370136269774d36bb7b7a
- license: MIT
- targets: AgentIdentityRegistry.sol
- validation: 9 passing tests, 0 failing; statement coverage AgentIdentityRegistry.sol 100.0 %

## Contract: AgentIdentityRegistry.sol (primary target)

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";

/**
 * @notice ERC-8004-inspired agent identity registry (v1, founder-custodied).
 * Each agent in a solo builder's fleet gets a verifiable on-chain identity
 * (an ERC-721 token) whose tokenURI resolves to an off-chain JSON profile
 * (name, role, model, capabilities, controllerAddress). v1 scope: identities
 * are custodied by the founder's wallet, not agent-controlled signing keys --
 * see README for the disclosed v1/v2 boundary.
 */
contract AgentIdentityRegistry is ERC721 {
    uint256 public nextAgentId = 1;

    mapping(uint256 => string) private _tokenURIs;
    mapping(uint256 => bool) public revoked;

    event AgentRegistered(uint256 indexed agentId, address indexed owner, string tokenURI);
    event AgentRevoked(uint256 indexed agentId);

    constructor() ERC721("SafeReceipt Agent Identity", "SRAI") {}

    function registerAgent(string calldata agentTokenURI) external returns (uint256 agentId) {
        agentId = nextAgentId++;
        _tokenURIs[agentId] = agentTokenURI; // set before _safeMint's receiver callback
        _safeMint(msg.sender, agentId);

        emit AgentRegistered(agentId, msg.sender, agentTokenURI);
    }

    function revokeAgent(uint256 agentId) external {
        require(ownerOf(agentId) == msg.sender, "Not agent owner");
        require(!revoked[agentId], "Already revoked");

        revoked[agentId] = true;

        emit AgentRevoked(agentId);
    }

    function tokenURI(uint256 agentId) public view override returns (string memory) {
        _requireOwned(agentId);
        return _tokenURIs[agentId];
    }

    function isActive(uint256 agentId) external view returns (bool) {
        _requireOwned(agentId);
        return !revoked[agentId];
    }
}
```

## Tests: AgentIdentityRegistry.test.js

```javascript
const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("AgentIdentityRegistry", function () {
  let registry;
  let owner;
  let addr1;

  beforeEach(async function () {
    [owner, addr1] = await ethers.getSigners();
    const Factory = await ethers.getContractFactory("AgentIdentityRegistry");
    registry = await Factory.deploy();
    await registry.waitForDeployment();
  });

  describe("Deployment", function () {
    it("Should set the correct initial agent ID and ERC-721 metadata", async function () {
      expect(await registry.nextAgentId()).to.equal(1);
      expect(await registry.name()).to.equal("SafeReceipt Agent Identity");
      expect(await registry.symbol()).to.equal("SRAI");
    });
  });

  describe("Agent Registration", function () {
    const profileURI = "https://safereceipt.vercel.app/agents/doc-researcher.json";

    it("Should register an agent and mint it to the caller", async function () {
      await registry.registerAgent(profileURI);

      expect(await registry.ownerOf(1)).to.equal(owner.address);
      expect(await registry.tokenURI(1)).to.equal(profileURI);
      expect(await registry.isActive(1)).to.equal(true);
    });

    it("Should emit AgentRegistered event", async function () {
      await expect(registry.registerAgent(profileURI))
        .to.emit(registry, "AgentRegistered")
        .withArgs(1, owner.address, profileURI);
    });

    it("Should increment agent ID across registrations from different callers", async function () {
      await registry.registerAgent(profileURI);
      await registry.connect(addr1).registerAgent("https://example.com/agents/code-reviewer.json");

      expect(await registry.nextAgentId()).to.equal(3);
      expect(await registry.ownerOf(1)).to.equal(owner.address);
      expect(await registry.ownerOf(2)).to.equal(addr1.address);
    });
  });

  describe("Agent Revocation", function () {
    const profileURI = "https://safereceipt.vercel.app/agents/rogue-agent.json";

    beforeEach(async function () {
      await registry.registerAgent(profileURI);
    });

    it("Should let the owner revoke their agent", async function () {
      await registry.revokeAgent(1);
      expect(await registry.isActive(1)).to.equal(false);
      expect(await registry.revoked(1)).to.equal(true);
    });

    it("Should emit AgentRevoked event", async function () {
      await expect(registry.revokeAgent(1)).to.emit(registry, "AgentRevoked").withArgs(1);
    });

    it("Should reject revocation from a non-owner", async function () {
      await expect(registry.connect(addr1).revokeAgent(1)).to.be.revertedWith("Not agent owner");
    });

    it("Should reject double revocation", async function () {
      await registry.revokeAgent(1);
      await expect(registry.revokeAgent(1)).to.be.revertedWith("Already revoked");
    });
  });

  describe("Edge Cases", function () {
    it("Should revert tokenURI for a non-existent agent", async function () {
      await expect(registry.tokenURI(999)).to.be.reverted;
    });
  });
});
```
