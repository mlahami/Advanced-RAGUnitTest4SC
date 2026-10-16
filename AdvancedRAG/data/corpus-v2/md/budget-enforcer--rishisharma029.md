# budget-enforcer--rishisharma029

- domain: rate-limiting (rate-limiting)
- level: moderate
- origin: human
- convention: hardhat2-ethers6
- source: https://github.com/Rishisharma029/w3a-1 @ c69dc51459ddd666b3cc7f8df1bbf76dcd9f27c3
- license: MIT
- targets: BudgetEnforcer.sol, IBudgetEnforcer.sol
- validation: 33 passing tests, 0 failing; statement coverage BudgetEnforcer.sol 100.0 %, IBudgetEnforcer.sol 100.0 %

## Contract: BudgetEnforcer.sol (primary target)

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "./IBudgetEnforcer.sol";

/// @title BudgetEnforcer
/// @author W3A-1 Team
/// @notice Authoritative, on-chain spending cap for an AI agent.
///
/// Security model
/// ==============
/// - Only `owner` can set budget / designate the agent.
/// - Only `agent` can call `authorize`.  The agent cannot modify its own
///   spending cap — it can only REQUEST authorization.
/// - Each `reqId` is a bytes32 one-time token.  Once used, it is permanently
///   marked — preventing replay / double-charge at the contract level.
/// - `totalSpent` is monotonically increasing; it is never decremented.
/// - If `totalSpent + amount` would exceed `maxBudget`, the call reverts and
///   ALL state changes are rolled back (including the reqId mark).
/// - The budget can only be increased by the owner (never decreased), so the
///   owner cannot retroactively invalidate already-recorded spend.
/// - Providers call the view function `verifyAuthorization` to confirm that a
///   reqId was authorized for exactly the right amount before delivering
///   content.  This is a cheap read-only call — no gas cost for providers.
///
/// Attack resistance
/// =================
/// - Agent attempting overspend → reverts (check before state change).
/// - Agent replaying an old reqId → reverts (usedRequests check first).
/// - Unauthorized address calling authorize → reverts (onlyAgent modifier).
/// - Reentrancy during authorize → blocked by ReentrancyGuard.
/// - Provider verifying an unrecognized reqId → returns false (no delivery).
/// - Owner trying to decrease budget below totalSpent → reverts.
///
contract BudgetEnforcer is IBudgetEnforcer, ReentrancyGuard {
    // State

    address public override owner;
    address public override agent;
    uint256 public override maxBudget;
    uint256 public override totalSpent;

    /// @dev reqId → true when this request has been authorized.
    ///      Set atomically inside `authorize` AFTER all checks pass.
    mapping(bytes32 => bool) private _usedRequests;

    /// @dev reqId → the amount that was authorized for this request.
    ///      Allows providers to verify the exact price they quoted.
    mapping(bytes32 => uint256) private _authorizedAmounts;
    // Modifiers

    modifier onlyOwner() {
        require(msg.sender == owner, "BudgetEnforcer: caller is not owner");
        _;
    }

    modifier onlyAgent() {
        require(msg.sender == agent, "BudgetEnforcer: caller is not agent");
        _;
    }
    // Constructor

    /// @param _owner          Address that controls budget and agent assignment.
    /// @param _agent          Address of the AI agent wallet.
    /// @param _maxBudget      Initial hard spending ceiling (in budget units).
    constructor(address _owner, address _agent, uint256 _maxBudget) {
        require(_owner != address(0), "BudgetEnforcer: owner is zero address");
        require(_agent != address(0), "BudgetEnforcer: agent is zero address");
        require(_maxBudget > 0,       "BudgetEnforcer: budget must be > 0");

        owner     = _owner;
        agent     = _agent;
        maxBudget = _maxBudget;

        emit BudgetSet(_maxBudget);
        emit AgentSet(_agent);
    }
    // Admin functions

    /// @inheritdoc IBudgetEnforcer
    /// @dev Budget can only be increased to avoid retroactively invalidating
    ///      already-authorized spend.
    function setBudget(uint256 newMaxBudget) external override onlyOwner {
        require(
            newMaxBudget > maxBudget,
            "BudgetEnforcer: new budget must be greater than current"
        );
        maxBudget = newMaxBudget;
        emit BudgetSet(newMaxBudget);
    }

    /// @inheritdoc IBudgetEnforcer
    function setAgent(address newAgent) external override onlyOwner {
        require(newAgent != address(0), "BudgetEnforcer: agent is zero address");
        agent = newAgent;
        emit AgentSet(newAgent);
    }
    // Agent authorization

    /// @notice Atomically authorize spending for a unique service request.
    ///         Called by the AI agent BEFORE paying the provider.
    ///         Execution order: (1) caller check, (2) replay guard, (3) cap guard, (4) effects, (5) events.
    ///         ReentrancyGuard provides defense-in-depth even without external calls.
    /// @param reqId   Provider-generated unique request identifier.
    /// @param amount  Service cost in budget units.
    function authorize(bytes32 reqId, uint256 amount)
        external
        override
        onlyAgent
        nonReentrant
    {
        require(amount > 0, "BudgetEnforcer: amount must be > 0");

        // --- Replay protection (CHECKS) ---
        if (_usedRequests[reqId]) {
            emit ReplayRejected(reqId);
            revert("BudgetEnforcer: request ID already used");
        }

        // --- Budget cap (CHECKS) ---
        uint256 newTotal = totalSpent + amount;
        if (newTotal > maxBudget) {
            emit OverspendRejected(reqId, amount, maxBudget - totalSpent);
            revert("BudgetEnforcer: spending cap exceeded");
        }

        // --- State update (EFFECTS) ---
        _usedRequests[reqId]      = true;
        _authorizedAmounts[reqId] = amount;
        totalSpent                = newTotal;

        emit PaymentAuthorized(reqId, amount, totalSpent);
    }
    // View functions

    /// @inheritdoc IBudgetEnforcer
    function verifyAuthorization(bytes32 reqId, uint256 amount)
        external
        view
        override
        returns (bool)
    {
        return _usedRequests[reqId] && _authorizedAmounts[reqId] == amount;
    }

    /// @inheritdoc IBudgetEnforcer
    function remainingBudget() external view override returns (uint256) {
        return maxBudget - totalSpent;
    }

    /// @inheritdoc IBudgetEnforcer
    function authorizedAmount(bytes32 reqId)
        external
        view
        override
        returns (uint256)
    {
        return _authorizedAmounts[reqId];
    }
}
```

## Contract: IBudgetEnforcer.sol (dependency)

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title IBudgetEnforcer
/// @notice Interface for the W3A-1 budget enforcement contract.
///         The contract is the single authoritative source of truth for
///         whether an AI agent is allowed to spend a given amount.
interface IBudgetEnforcer {
    // Events

    /// @notice Emitted when the owner sets or updates the maximum budget.
    event BudgetSet(uint256 maxBudget);

    /// @notice Emitted when the owner designates a new agent address.
    event AgentSet(address indexed agent);

    /// @notice Emitted when a payment is successfully authorized.
    /// @param reqId       Unique request identifier supplied by the provider.
    /// @param amount      Amount authorized for this request.
    /// @param totalSpent  Running total of all authorized spend after this call.
    event PaymentAuthorized(
        bytes32 indexed reqId,
        uint256 amount,
        uint256 totalSpent
    );

    /// @notice Emitted when a payment attempt is rejected because it would
    ///         exceed the remaining budget.  No state is changed.
    /// @param reqId      The request ID that was rejected.
    /// @param attempted  The amount the agent tried to spend.
    /// @param remaining  Remaining budget at the time of rejection.
    event OverspendRejected(
        bytes32 indexed reqId,
        uint256 attempted,
        uint256 remaining
    );

    /// @notice Emitted when the same request ID is submitted a second time.
    ///         No state is changed.
    event ReplayRejected(bytes32 indexed reqId);
    // Admin functions (owner only)

    /// @notice Set the hard spending ceiling.
    ///         Can only be increased, never decreased, to prevent
    ///         owner from retroactively invalidating recorded spend.
    function setBudget(uint256 maxBudget) external;

    /// @notice Designate which address is allowed to call `authorize`.
    function setAgent(address agent) external;
    // Agent function

    /// @notice Atomically authorize spending for a unique service request.
    ///         Called by the AI agent BEFORE paying the provider.
    ///
    ///         Guarantees:
    ///         - Only the designated agent address can call this.
    ///         - `reqId` must never have been used before (replay protection).
    ///         - `totalSpent + amount` must not exceed `maxBudget`.
    ///         - On any violation the call reverts and state is unchanged.
    ///
    /// @param reqId   Provider-generated unique request identifier.
    /// @param amount  Service cost in budget units.
    function authorize(bytes32 reqId, uint256 amount) external;
    // View functions

    /// @notice Returns true if `reqId` has been successfully authorized.
    ///         Providers call this to verify payment before delivering content.
    /// @param reqId    The request identifier to check.
    /// @param amount   The expected authorized amount (must match exactly).
    function verifyAuthorization(bytes32 reqId, uint256 amount)
        external
        view
        returns (bool);

    /// @notice Remaining budget = maxBudget - totalSpent.
    function remainingBudget() external view returns (uint256);

    /// @notice Returns the amount authorized for a specific request ID.
    ///         Returns 0 if the request has not been authorized.
    function authorizedAmount(bytes32 reqId) external view returns (uint256);
    // State getters (auto-generated, listed here for documentation)

    function owner() external view returns (address);
    function agent() external view returns (address);
    function maxBudget() external view returns (uint256);
    function totalSpent() external view returns (uint256);
}
```

## Tests: BudgetEnforcer.test.js

```javascript
const { expect }        = require("chai");
const { ethers }        = require("hardhat");
const { keccak256, toUtf8Bytes } = ethers;
// Helper — deterministic bytes32 request IDs
function makeReqId(label) {
  return keccak256(toUtf8Bytes(label));
}
// BudgetEnforcer — Unit Tests
// All 12 judge-required scenarios are covered below.
describe("BudgetEnforcer", function () {
  let enforcer;
  let owner, agent, stranger, provider;

  const MAX_BUDGET = 10n; // 10 budget units

  beforeEach(async function () {
    [owner, agent, stranger, provider] = await ethers.getSigners();

    const Factory = await ethers.getContractFactory("BudgetEnforcer");
    enforcer = await Factory.deploy(owner.address, agent.address, MAX_BUDGET);
    await enforcer.waitForDeployment();
  });

  // =========================================================================
  // 1. Deployment / initial state
  // =========================================================================
  describe("Deployment", function () {
    it("sets owner, agent, maxBudget correctly", async function () {
      expect(await enforcer.owner()).to.equal(owner.address);
      expect(await enforcer.agent()).to.equal(agent.address);
      expect(await enforcer.maxBudget()).to.equal(MAX_BUDGET);
      expect(await enforcer.totalSpent()).to.equal(0n);
      expect(await enforcer.remainingBudget()).to.equal(MAX_BUDGET);
    });

    it("emits BudgetSet and AgentSet on deployment", async function () {
      const Factory = await ethers.getContractFactory("BudgetEnforcer");
      const tx = Factory.getDeployTransaction(
        owner.address, agent.address, MAX_BUDGET
      );
      // Verify events exist by re-deploying and checking
      const c = await Factory.deploy(owner.address, agent.address, MAX_BUDGET);
      const receipt = await c.deploymentTransaction().wait();
      const budgetEvt = receipt.logs.find(
        (l) => l.fragment && l.fragment.name === "BudgetSet"
      );
      const agentEvt = receipt.logs.find(
        (l) => l.fragment && l.fragment.name === "AgentSet"
      );
      expect(budgetEvt).to.not.be.undefined;
      expect(agentEvt).to.not.be.undefined;
    });

    it("reverts if owner is zero address", async function () {
      const Factory = await ethers.getContractFactory("BudgetEnforcer");
      await expect(
        Factory.deploy(ethers.ZeroAddress, agent.address, MAX_BUDGET)
      ).to.be.revertedWith("BudgetEnforcer: owner is zero address");
    });

    it("reverts if agent is zero address", async function () {
      const Factory = await ethers.getContractFactory("BudgetEnforcer");
      await expect(
        Factory.deploy(owner.address, ethers.ZeroAddress, MAX_BUDGET)
      ).to.be.revertedWith("BudgetEnforcer: agent is zero address");
    });

    it("reverts if budget is zero", async function () {
      const Factory = await ethers.getContractFactory("BudgetEnforcer");
      await expect(
        Factory.deploy(owner.address, agent.address, 0n)
      ).to.be.revertedWith("BudgetEnforcer: budget must be > 0");
    });
  });

  // =========================================================================
  // 2. Admin functions
  // =========================================================================
  describe("setBudget", function () {
    it("owner can increase budget", async function () {
      await enforcer.connect(owner).setBudget(20n);
      expect(await enforcer.maxBudget()).to.equal(20n);
    });

    it("emits BudgetSet event", async function () {
      await expect(enforcer.connect(owner).setBudget(20n))
        .to.emit(enforcer, "BudgetSet")
        .withArgs(20n);
    });

    it("reverts if non-owner calls setBudget", async function () {
      await expect(
        enforcer.connect(stranger).setBudget(20n)
      ).to.be.revertedWith("BudgetEnforcer: caller is not owner");
    });

    it("reverts if new budget <= current budget", async function () {
      await expect(
        enforcer.connect(owner).setBudget(MAX_BUDGET)
      ).to.be.revertedWith(
        "BudgetEnforcer: new budget must be greater than current"
      );
    });

    it("reverts if new budget < current budget", async function () {
      await expect(
        enforcer.connect(owner).setBudget(5n)
      ).to.be.revertedWith(
        "BudgetEnforcer: new budget must be greater than current"
      );
    });
  });

  describe("setAgent", function () {
    it("owner can change agent", async function () {
      await enforcer.connect(owner).setAgent(stranger.address);
      expect(await enforcer.agent()).to.equal(stranger.address);
    });

    it("emits AgentSet event", async function () {
      await expect(enforcer.connect(owner).setAgent(stranger.address))
        .to.emit(enforcer, "AgentSet")
        .withArgs(stranger.address);
    });

    it("reverts if non-owner calls setAgent", async function () {
      await expect(
        enforcer.connect(stranger).setAgent(stranger.address)
      ).to.be.revertedWith("BudgetEnforcer: caller is not owner");
    });

    it("reverts if new agent is zero address", async function () {
      await expect(
        enforcer.connect(owner).setAgent(ethers.ZeroAddress)
      ).to.be.revertedWith("BudgetEnforcer: agent is zero address");
    });
  });

  // =========================================================================
  // 3. authorize — Happy path
  // =========================================================================
  describe("authorize — happy path", function () {
    // Judge requirement 1: purchase under budget succeeds
    it("TC-01 — purchase under budget succeeds", async function () {
      const reqId = makeReqId("REQ-001");
      await expect(enforcer.connect(agent).authorize(reqId, 4n))
        .to.emit(enforcer, "PaymentAuthorized")
        .withArgs(reqId, 4n, 4n);

      expect(await enforcer.totalSpent()).to.equal(4n);
      expect(await enforcer.remainingBudget()).to.equal(6n);
    });

    // Judge requirement 2: purchase exactly equal to remaining budget succeeds
    it("TC-02 — purchase exactly equal to remaining budget succeeds", async function () {
      const r1 = makeReqId("REQ-001");
      await enforcer.connect(agent).authorize(r1, 4n);

      const r2 = makeReqId("REQ-002");
      await expect(enforcer.connect(agent).authorize(r2, 6n))
        .to.emit(enforcer, "PaymentAuthorized")
        .withArgs(r2, 6n, 10n);

      expect(await enforcer.remainingBudget()).to.equal(0n);
    });

    // Judge requirement 8: successful payment → spend increases exactly once
    it("TC-08 — totalSpent increases by exactly the authorized amount", async function () {
      const reqId = makeReqId("REQ-001");
      const before = await enforcer.totalSpent();
      await enforcer.connect(agent).authorize(reqId, 3n);
      const after = await enforcer.totalSpent();
      expect(after - before).to.equal(3n);
    });
  });

  // =========================================================================
  // 4. authorize — Rejection scenarios
  // =========================================================================
  describe("authorize — rejections", function () {
    // Judge requirement 3: purchase above remaining budget → rejected
    it("TC-03 — purchase above remaining budget reverts", async function () {
      const reqId = makeReqId("REQ-overspend");

      // Transaction reverts — the OverspendRejected event is emitted
      // inside the function body but rolled back with the transaction.
      // We verify the correct revert reason and that state is unchanged.
      await expect(
        enforcer.connect(agent).authorize(reqId, 11n)
      ).to.be.revertedWith("BudgetEnforcer: spending cap exceeded");

      // State must be unchanged after the revert
      expect(await enforcer.totalSpent()).to.equal(0n);
      expect(await enforcer.remainingBudget()).to.equal(MAX_BUDGET);

      // The rejected reqId is NOT marked as used
      expect(await enforcer.verifyAuthorization(reqId, 11n)).to.be.false;
    });

    // Judge requirement 3 (variant): partially spent, then overspend
    it("TC-03b — overspend after partial spend reverts with correct remaining", async function () {
      await enforcer.connect(agent).authorize(makeReqId("R1"), 7n);

      const reqId = makeReqId("R2-overspend");
      // Only 3 units remain; trying to spend 4 must revert
      await expect(
        enforcer.connect(agent).authorize(reqId, 4n)
      ).to.be.revertedWith("BudgetEnforcer: spending cap exceeded");

      // Spend must not have changed from the first purchase
      expect(await enforcer.totalSpent()).to.equal(7n);
      expect(await enforcer.remainingBudget()).to.equal(3n);
    });

    // Judge requirement 4: agent tries to bypass budget via own request → rejected
    it("TC-04 — agent cannot authorize above its own cap (same result as TC-03)", async function () {
      // An agent with a malicious intent simply calling authorize with a huge amount
      const reqId = makeReqId("malicious-large-request");
      await expect(
        enforcer.connect(agent).authorize(reqId, 9999n)
      ).to.be.revertedWith("BudgetEnforcer: spending cap exceeded");

      expect(await enforcer.totalSpent()).to.equal(0n);
    });

    // Judge requirement 5: unauthorized agent address → rejected
    it("TC-05 — unauthorized address cannot call authorize", async function () {
      const reqId = makeReqId("REQ-stranger");
      await expect(
        enforcer.connect(stranger).authorize(reqId, 1n)
      ).to.be.revertedWith("BudgetEnforcer: caller is not agent");

      // Owner also cannot call authorize (separation of concerns)
      await expect(
        enforcer.connect(owner).authorize(makeReqId("REQ-owner"), 1n)
      ).to.be.revertedWith("BudgetEnforcer: caller is not agent");
    });

    // Judge requirement 6: same request ID submitted twice → no double charge
    it("TC-06 — duplicate reqId reverts on second call", async function () {
      const reqId = makeReqId("REQ-replay");
      // First call succeeds
      await enforcer.connect(agent).authorize(reqId, 3n);
      const spentAfterFirst = await enforcer.totalSpent();

      // Second call with the same reqId must revert
      await expect(
        enforcer.connect(agent).authorize(reqId, 3n)
      ).to.be.revertedWith("BudgetEnforcer: request ID already used");

      // totalSpent must not have changed
      expect(await enforcer.totalSpent()).to.equal(spentAfterFirst);
    });

    it("TC-06b — duplicate reqId with different amount still reverts", async function () {
      const reqId = makeReqId("REQ-replay-diff-amt");
      await enforcer.connect(agent).authorize(reqId, 2n);

      await expect(
        enforcer.connect(agent).authorize(reqId, 1n) // different amount, same ID
      ).to.be.revertedWith("BudgetEnforcer: request ID already used");
    });

    // Judge requirement 7: failed/reverted payment → budget state unchanged
    it("TC-07 — reverted authorize leaves totalSpent unchanged", async function () {
      const spentBefore = await enforcer.totalSpent();

      // This will revert (overspend)
      try {
        await enforcer.connect(agent).authorize(makeReqId("REQ-fail"), 999n);
      } catch (_) {}

      expect(await enforcer.totalSpent()).to.equal(spentBefore);
    });

    it("reverts if amount is zero", async function () {
      await expect(
        enforcer.connect(agent).authorize(makeReqId("REQ-zero"), 0n)
      ).to.be.revertedWith("BudgetEnforcer: amount must be > 0");
    });
  });

  // =========================================================================
  // 5. verifyAuthorization
  // =========================================================================
  describe("verifyAuthorization", function () {
    // Judge requirement 9: delivery proof exists after successful purchase
    it("TC-09 — verifyAuthorization returns true after successful authorize", async function () {
      const reqId = makeReqId("REQ-verify");
      await enforcer.connect(agent).authorize(reqId, 5n);

      expect(await enforcer.verifyAuthorization(reqId, 5n)).to.be.true;
    });

    it("returns false for unknown reqId", async function () {
      const unknownId = makeReqId("REQ-unknown");
      expect(await enforcer.verifyAuthorization(unknownId, 5n)).to.be.false;
    });

    it("returns false if amount does not match authorized amount", async function () {
      const reqId = makeReqId("REQ-wrong-amt");
      await enforcer.connect(agent).authorize(reqId, 5n);

      // Same reqId but wrong amount — provider catches price manipulation
      expect(await enforcer.verifyAuthorization(reqId, 4n)).to.be.false;
      expect(await enforcer.verifyAuthorization(reqId, 6n)).to.be.false;
    });

    it("authorizedAmount view returns the correct amount", async function () {
      const reqId = makeReqId("REQ-amt-check");
      await enforcer.connect(agent).authorize(reqId, 7n);
      expect(await enforcer.authorizedAmount(reqId)).to.equal(7n);
    });

    it("authorizedAmount returns 0 for unknown reqId", async function () {
      expect(
        await enforcer.authorizedAmount(makeReqId("REQ-unknown-amt"))
      ).to.equal(0n);
    });
  });

  // =========================================================================
  // 6. Idempotency — double-charge protection (contract layer)
  // =========================================================================
  describe("Idempotency", function () {
    // Judge requirement 11: retry after simulated network timeout → no second charge
    it("TC-11 — retry with same reqId does NOT increase totalSpent", async function () {
      const reqId = makeReqId("REQ-timeout-retry");

      // First call succeeds
      await enforcer.connect(agent).authorize(reqId, 4n);
      const spentAfterFirst = await enforcer.totalSpent();

      // Simulate a network timeout → agent retries with the same reqId
      await expect(
        enforcer.connect(agent).authorize(reqId, 4n)
      ).to.be.revertedWith("BudgetEnforcer: request ID already used");

      // Spend must not have changed
      expect(await enforcer.totalSpent()).to.equal(spentAfterFirst);
    });
  });

  // =========================================================================
  // 7. Overspend rejection — balance integrity
  // =========================================================================
  describe("Overspend rejection", function () {
    // Judge requirement 12: overspend rejection leaves accounting unchanged
    it("TC-12 — overspend rejection leaves funds/spend accounting unchanged", async function () {
      // Spend 7 successfully
      await enforcer.connect(agent).authorize(makeReqId("R1"), 7n);
      const spentBefore = await enforcer.totalSpent();
      const remainingBefore = await enforcer.remainingBudget();

      // Attempt to spend 4 (only 3 left)
      const badReqId = makeReqId("R2-bad");
      await expect(
        enforcer.connect(agent).authorize(badReqId, 4n)
      ).to.be.revertedWith("BudgetEnforcer: spending cap exceeded");

      // Both values unchanged
      expect(await enforcer.totalSpent()).to.equal(spentBefore);
      expect(await enforcer.remainingBudget()).to.equal(remainingBefore);

      // The rejected reqId is NOT marked as used (provider would see unverified)
      expect(await enforcer.verifyAuthorization(badReqId, 4n)).to.be.false;
    });
  });

  // =========================================================================
  // 8. Multi-purchase sequence
  // =========================================================================
  describe("Multi-purchase sequence", function () {
    it("three sequential purchases track spend correctly", async function () {
      await enforcer.connect(agent).authorize(makeReqId("R1"), 3n);
      expect(await enforcer.remainingBudget()).to.equal(7n);

      await enforcer.connect(agent).authorize(makeReqId("R2"), 4n);
      expect(await enforcer.remainingBudget()).to.equal(3n);

      await enforcer.connect(agent).authorize(makeReqId("R3"), 3n);
      expect(await enforcer.remainingBudget()).to.equal(0n);

      // Next purchase must fail
      await expect(
        enforcer.connect(agent).authorize(makeReqId("R4"), 1n)
      ).to.be.revertedWith("BudgetEnforcer: spending cap exceeded");
    });
  });
});
```
