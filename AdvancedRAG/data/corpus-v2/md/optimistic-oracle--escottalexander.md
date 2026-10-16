# optimistic-oracle--escottalexander

- domain: price-oracles (oracle)
- level: complex
- origin: human
- convention: hardhat2-ethers6
- source: https://github.com/escottalexander/oracle-challenge @ 62acb5c13ec3e777a79a767b0893cf5f9edf81b8
- license: MIT
- targets: OptimisticOracle.sol, Decider.sol
- validation: 34 passing tests, 0 failing; statement coverage OptimisticOracle.sol 89.87 %, Decider.sol 75.0 %

## Contract: Decider.sol (dependency)

```solidity
// SPDX-License-Identifier: MIT
pragma solidity >=0.8.0 <0.9.0;

import "./OptimisticOracle.sol";

contract Decider {
    address public owner;
    OptimisticOracle public oracle;
    
    event DisputeSettled(uint256 indexed assertionId, bool resolvedValue);
    
    constructor(address _oracle) {
        owner = msg.sender;
        oracle = OptimisticOracle(_oracle);
    }
    
    /**
     * @notice Settle a dispute by determining the true/false outcome
     * @param assertionId The ID of the assertion to settle
     * @param resolvedValue The true/false outcome determined by the decider
     */
    function settleDispute(uint256 assertionId, bool resolvedValue) external {
        require(assertionId >= 1, "Invalid assertion ID");
        
        // Call the oracle's settleAssertion function
        oracle.settleAssertion(assertionId, resolvedValue);
        
        emit DisputeSettled(assertionId, resolvedValue);
    }
    
    function setOracle(address newOracle) external {
        require(msg.sender == owner, "Only owner can set oracle");
        oracle = OptimisticOracle(newOracle);
    }

    /**
     * @notice Allow the contract to receive ETH
     */
    receive() external payable {}
}
```

## Contract: OptimisticOracle.sol (primary target)

```solidity
// SPDX-License-Identifier: MIT
pragma solidity >=0.8.0 <0.9.0;

contract OptimisticOracle {
    enum State { Invalid, Asserted, Proposed, Disputed, Settled, Expired }

    error AssertionNotFound();
    error AssertionProposed();
    error NotEnoughValue();
    error InvalidTime();
    error ProposalDisputed();
    error NotProposedAssertion();
    error AlreadyClaimed();
    error AlreadySettled();
    error AwaitingDecider();
    error NotDisputedAssertion();
    error OnlyDecider();
    error OnlyOwner();
    error TransferFailed();

    struct EventAssertion {
        address asserter;
        address proposer;
        address disputer;
        bool proposedOutcome;
        bool resolvedOutcome;
        uint256 reward;
        uint256 bond;
        uint256 startTime;
        uint256 endTime;
        bool claimed;
        address winner;
        string description;
    }
    uint256 public constant MINIMUM_ASSERTION_WINDOW = 3 minutes;
    uint256 public constant MINIMUM_DISPUTE_WINDOW = 3 minutes;
    address public decider;
    address public owner;
    uint256 public nextAssertionId = 1;
    mapping(uint256 => EventAssertion) public assertions;

    event EventAsserted(uint256 assertionId, address asserter, string description, uint256 reward);
    event OutcomeProposed(uint256 assertionId, address proposer, bool outcome);
    event OutcomeDisputed(uint256 assertionId, address disputer);
    event AssertionSettled(uint256 assertionId, bool outcome, address winner);
    event DeciderUpdated(address oldDecider, address newDecider);
    event RewardClaimed(uint256 assertionId, address winner, uint256 amount);
    event RefundClaimed(uint256 assertionId, address asserter, uint256 amount);

    modifier onlyDecider() {
        if (msg.sender != decider) revert OnlyDecider();
        _;
    }

    modifier onlyOwner() {
        if (msg.sender != owner) revert OnlyOwner();
        _;
    }

    constructor(address _decider) {
        decider = _decider;
        owner = msg.sender;
    }

    /**
     * @notice Update the decider address (for deployment integration)
     */
    function setDecider(address _decider) external onlyOwner {
        address oldDecider = address(decider);
        decider = _decider;
        emit DeciderUpdated(oldDecider, _decider);
    }

    /**
     * @notice Get the assertion details.
     */
    function getAssertion(uint256 assertionId) external view returns (EventAssertion memory) {
        return assertions[assertionId];
    }

    /**
     * @notice Assert that an event will have a true/false outcome.
     * @dev The `description` is used to identify the event (e.g. "Did X happen by time Y?")
     * @param description The description of the event
     * @param startTime When proposals can begin (0 for current time)
     * @param endTime When the assertion expires (0 for startTime + minimum window)
     */
    function assertEvent(string memory description, uint256 startTime, uint256 endTime) external payable returns (uint256) {
        uint256 assertionId = nextAssertionId;
        nextAssertionId++;
        if (msg.value == 0) revert NotEnoughValue();

        // Set default times if not provided
        if (startTime == 0) {
            startTime = block.timestamp;
        }
        if (endTime == 0) {
            endTime = startTime + MINIMUM_ASSERTION_WINDOW;
        }

        if (startTime < block.timestamp) revert InvalidTime();
        if (endTime < startTime + MINIMUM_ASSERTION_WINDOW) revert InvalidTime();

        assertions[assertionId] = EventAssertion({
            asserter: msg.sender,
            proposer: address(0),
            disputer: address(0),
            proposedOutcome: false,
            resolvedOutcome: false,
            reward: msg.value,
            bond: msg.value * 2,
            startTime: startTime,
            endTime: endTime,
            claimed: false,
            winner: address(0),
            description: description
        });

        emit EventAsserted(assertionId, msg.sender, description, msg.value);
        return assertionId;
    }

    /**
     * @notice Propose the outcome (true or false) for an asserted event.
     */
    function proposeOutcome(uint256 assertionId, bool outcome) external payable {
        EventAssertion storage assertion = assertions[assertionId];

        if (assertion.asserter == address(0)) revert AssertionNotFound();
        if (assertion.proposer != address(0)) revert AssertionProposed();
        if (block.timestamp < assertion.startTime) revert InvalidTime();
        if (block.timestamp > assertion.endTime) revert InvalidTime();
        if (msg.value != assertion.bond) revert NotEnoughValue();

        assertion.proposer = msg.sender;
        assertion.proposedOutcome = outcome;
        assertion.endTime = block.timestamp + MINIMUM_DISPUTE_WINDOW;

        emit OutcomeProposed(assertionId, msg.sender, outcome);
    }

    /**
     * @notice Dispute the proposed outcome by bonding ETH.
     */
    function disputeOutcome(uint256 assertionId) external payable {
        EventAssertion storage assertion = assertions[assertionId];

        if (assertion.proposer == address(0)) revert NotProposedAssertion();
        if (assertion.disputer != address(0)) revert ProposalDisputed();
        if (block.timestamp > assertion.endTime) revert InvalidTime();
        if (msg.value != assertion.bond) revert NotEnoughValue();

        assertion.disputer = msg.sender;

        emit OutcomeDisputed(assertionId, msg.sender);
    }

    /**
     * @notice Claim reward for uncontested assertions after dispute window expires.
     * @dev The claim can be triggered by anyone, and the rewards are transferred to the proposer.
     */
    function claimUndisputedReward(uint256 assertionId) external {
        EventAssertion storage assertion = assertions[assertionId];

        if (assertion.proposer == address(0)) revert NotProposedAssertion();
        if (assertion.disputer != address(0)) revert ProposalDisputed();
        if (block.timestamp <= assertion.endTime) revert InvalidTime();
        if (assertion.claimed) revert AlreadyClaimed();

        assertion.claimed = true;
        assertion.resolvedOutcome = assertion.proposedOutcome;
        assertion.winner = assertion.proposer;

        uint256 totalReward = (assertion.reward + assertion.bond);

        // Send reward to winner
        (bool winnerSuccess, ) = payable(assertion.proposer).call{value: totalReward}("");
        if (!winnerSuccess) revert TransferFailed();

        emit RewardClaimed(assertionId, assertion.proposer, totalReward);
    }

    /**
     * @notice Claim reward for disputed assertions after decider settlement.
     * @dev The claim can be triggered by anyone, and the rewards are transferred to the winner.
     */
    function claimDisputedReward(uint256 assertionId) external {
        EventAssertion storage assertion = assertions[assertionId];

        if (assertion.proposer == address(0)) revert NotProposedAssertion();
        if (assertion.disputer == address(0)) revert NotDisputedAssertion();
        if (assertion.winner == address(0)) revert AwaitingDecider();
        if (assertion.claimed) revert AlreadyClaimed();

        assertion.claimed = true;

        // Send decider fee
        (bool deciderSuccess, ) = payable(decider).call{value: assertion.bond}("");
        if (!deciderSuccess) revert TransferFailed();
        
        uint256 totalReward = assertion.reward + assertion.bond; // reward + proposer bond

        // Send reward to winner
        (bool winnerSuccess, ) = payable(assertion.winner).call{value: totalReward}("");
        if (!winnerSuccess) revert TransferFailed();

        emit RewardClaimed(assertionId, assertion.winner, totalReward);
    }

    /**
     * @notice Claim refund for any assertion that does not get a proposal before deadline.
     * @dev The claim can be triggered by anyone, and the refunds are transferred to the asserter.
     */
    function claimRefund(uint256 assertionId) external {
        EventAssertion storage assertion = assertions[assertionId];

        if (assertion.proposer != address(0)) revert AssertionProposed();
        if (block.timestamp <= assertion.endTime) revert InvalidTime();
        if (assertion.claimed) revert AlreadyClaimed();

        assertion.claimed = true;

        (bool refundSuccess, ) = payable(assertion.asserter).call{value: assertion.reward}("");
        if (!refundSuccess) revert TransferFailed();
        emit RefundClaimed(assertionId, assertion.asserter, assertion.reward);
    }

    /**
     * @notice Decider resolves disputed assertions and sets the winner.
     * @dev Only the decider can call this. The winner must then call claimDisputedReward.
     */
    function settleAssertion(uint256 assertionId, bool resolvedOutcome) external onlyDecider {
        EventAssertion storage assertion = assertions[assertionId];

        if (assertion.proposer == address(0)) revert NotProposedAssertion();
        if (assertion.disputer == address(0)) revert NotDisputedAssertion();
        if (assertion.winner != address(0)) revert AlreadySettled();

        assertion.resolvedOutcome = resolvedOutcome;
        
        // Set the winner based on whether the proposed outcome was correct
        assertion.winner = (resolvedOutcome == assertion.proposedOutcome)
            ? assertion.proposer
            : assertion.disputer;

        emit AssertionSettled(assertionId, resolvedOutcome, assertion.winner);
    }

    /**
     * @notice Returns the current state of an assertion.
     */
    function getState(uint256 assertionId) external view returns (State) {
        EventAssertion storage a = assertions[assertionId];

        if (a.asserter == address(0)) return State.Invalid;
        
        // If there's a winner, it's settled
        if (a.winner != address(0)) return State.Settled;
        
        // If there's a dispute, it's disputed
        if (a.disputer != address(0)) return State.Disputed;
        
        // If no proposal yet, check if deadline has passed
        if (a.proposer == address(0)) {
            if (block.timestamp > a.endTime) return State.Expired;
            return State.Asserted;
        }
        
        // If no dispute and deadline passed, it's settled (can be claimed)
        if (block.timestamp > a.endTime) return State.Settled;
        
        // Otherwise it's proposed
        return State.Proposed;
    }

    /**
     * @notice Get the resolution of an assertion.
     */
    function getResolution(uint256 assertionId) external view returns (bool) {
        EventAssertion storage a = assertions[assertionId];
        if (a.asserter == address(0)) revert AssertionNotFound();

        if (a.disputer == address(0)) {
            if (block.timestamp <= a.endTime) revert InvalidTime();
            return a.proposedOutcome;
        } else {
            if (a.winner == address(0)) revert AwaitingDecider();
            return a.resolvedOutcome;
        }
    }
}
```

## Tests: OptimisticOracle.js

```javascript
const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("OptimisticOracle", function () {
  let optimisticOracle;
  let deciderContract;
  let owner;
  let asserter;
  let proposer;
  let disputer;
  let otherUser;

  // Enum for state
  const State = {
    Invalid: 0n,
    Asserted: 1n,
    Proposed: 2n,
    Disputed: 3n,
    Settled: 4n,
    Expired: 5n,
  };

  beforeEach(async function () {
    [owner, asserter, proposer, disputer, otherUser] = await ethers.getSigners();

    // Deploy OptimisticOracle with temporary decider (owner)
    const OptimisticOracleFactory = await ethers.getContractFactory("OptimisticOracle");
    optimisticOracle = await OptimisticOracleFactory.deploy(owner.address);

    // Deploy Decider
    const DeciderFactory = await ethers.getContractFactory("Decider");
    deciderContract = await DeciderFactory.deploy(optimisticOracle.target);

    // Set the decider in the oracle
    await optimisticOracle.setDecider(deciderContract.target);
  });

  describe("Deployment", function () {
    it("Should deploy successfully", function () {
      // eslint-disable-next-line @typescript-eslint/no-unused-expressions
      expect(optimisticOracle.target).to.not.be.undefined;
    });

    it("Should set the correct owner", async function () {
      const contractOwner = await optimisticOracle.owner();
      expect(contractOwner).to.equal(owner.address);
    });

    it("Should have correct constants", async function () {
      const minimumAssertionWindow = await optimisticOracle.MINIMUM_ASSERTION_WINDOW();
      const minimumDisputeWindow = await optimisticOracle.MINIMUM_DISPUTE_WINDOW();

      expect(minimumAssertionWindow).to.equal(180n); // 3 minutes
      expect(minimumDisputeWindow).to.equal(180n); // 3 minutes
    });

    it("Should start with nextAssertionId at 1", async function () {
      const nextAssertionId = await optimisticOracle.nextAssertionId();
      expect(nextAssertionId).to.equal(1n);
    });

    it("Should return correct assertionId for first assertion", async function () {
      const description = "Will Bitcoin reach $1m by end of 2026?";
      const reward = ethers.parseEther("1");

      const tx = await optimisticOracle.connect(asserter).assertEvent(description, 0, 0, { value: reward });
      const receipt = await tx.wait();
      // Get the assertionId from the event
      const event = receipt .logs.find(
        log => optimisticOracle.interface.parseLog(log)?.name === "EventAsserted",
      );
      const parsedEvent = optimisticOracle.interface.parseLog(event);
      const assertionId = parsedEvent .args[0];

      expect(assertionId).to.equal(1n);
    });
  });

  describe("Event Assertion", function () {
    it("Should allow users to assert events with reward", async function () {
      const description = "Will Bitcoin reach $1m by end of 2026?";
      const reward = ethers.parseEther("1");

      const tx = await optimisticOracle.connect(asserter).assertEvent(description, 0, 0, { value: reward });
      const receipt = await tx.wait();

      // Get the assertionId from the event
      const event = receipt .logs.find(
        log => optimisticOracle.interface.parseLog(log)?.name === "EventAsserted",
      );
      const parsedEvent = optimisticOracle.interface.parseLog(event);
      const assertionId = parsedEvent .args[0];

      expect(tx)
        .to.emit(optimisticOracle, "EventAsserted")
        .withArgs(assertionId, asserter.address, description, reward);

      const state = await optimisticOracle.getState(assertionId);
      expect(state).to.equal(State.Asserted); // Asserted state
    });

    it("Should reject assertions with insufficient reward", async function () {
      const description = "Will Bitcoin reach $1m by end of 2026?";
      const insufficientReward = ethers.parseEther("0.0");

      await expect(
        optimisticOracle.connect(asserter).assertEvent(description, 0, 0, { value: insufficientReward }),
      ).to.be.revertedWithCustomError(optimisticOracle, "NotEnoughValue");
    });
  });

  describe("Outcome Proposal", function () {
    let assertionId;
    let description;
    let reward;

    beforeEach(async function () {
      description = "Will Bitcoin reach $1m by end of 2026?";
      reward = ethers.parseEther("1");
      const tx = await optimisticOracle.connect(asserter).assertEvent(description, 0, 0, { value: reward });
      const receipt = await tx.wait();
      // Get the assertionId from the event
      const event = receipt .logs.find(
        log => optimisticOracle.interface.parseLog(log)?.name === "EventAsserted",
      );
      const parsedEvent = optimisticOracle.interface.parseLog(event);
      assertionId = parsedEvent .args[0];
    });

    it("Should allow proposing outcomes with correct bond", async function () {
      const bond = reward * 2n;
      const outcome = true;

      const tx = await optimisticOracle.connect(proposer).proposeOutcome(assertionId, outcome, { value: bond });

      expect(tx).to.emit(optimisticOracle, "OutcomeProposed").withArgs(assertionId, proposer.address, outcome);

      // Check that the proposal was recorded by checking the state
      const state = await optimisticOracle.getState(assertionId);
      expect(state).to.equal(State.Proposed); // Proposed state
    });

    it("Should reject proposals with incorrect bond", async function () {
      const wrongBond = ethers.parseEther("0.05");
      const outcome = true;

      await expect(
        optimisticOracle.connect(proposer).proposeOutcome(assertionId, outcome, { value: wrongBond }),
      ).to.be.revertedWithCustomError(optimisticOracle, "NotEnoughValue");
    });

    it("Should reject duplicate proposals", async function () {
      const bond = reward * 2n;
      const outcome = true;

      await optimisticOracle.connect(proposer).proposeOutcome(assertionId, outcome, { value: bond });

      await expect(
        optimisticOracle.connect(otherUser).proposeOutcome(assertionId, !outcome, { value: bond }),
      ).to.be.revertedWithCustomError(optimisticOracle, "AssertionProposed");
    });
  });

  describe("Outcome Dispute", function () {
    let assertionId;
    let description;
    let reward;

    beforeEach(async function () {
      description = "Will Bitcoin reach $1m by end of 2026?";
      reward = ethers.parseEther("1");
      const tx = await optimisticOracle.connect(asserter).assertEvent(description, 0, 0, { value: reward });
      const receipt = await tx.wait();
      const event = receipt .logs.find(
        log => optimisticOracle.interface.parseLog(log)?.name === "EventAsserted",
      );
      const parsedEvent = optimisticOracle.interface.parseLog(event);
      assertionId = parsedEvent .args[0];

      const bond = reward * 2n;
      await optimisticOracle.connect(proposer).proposeOutcome(assertionId, true, { value: bond });
    });

    it("Should allow disputing outcomes with correct bond", async function () {
      const bond = reward * 2n;

      const tx = await optimisticOracle.connect(disputer).disputeOutcome(assertionId, { value: bond });

      expect(tx).to.emit(optimisticOracle, "OutcomeDisputed").withArgs(assertionId, disputer.address);

      // Check that the dispute was recorded by checking the state
      const state = await optimisticOracle.getState(assertionId);
      expect(state).to.equal(State.Disputed); // Disputed state
    });

    it("Should reject disputes with incorrect bond", async function () {
      const wrongBond = ethers.parseEther("0.05");

      await expect(
        optimisticOracle.connect(disputer).disputeOutcome(assertionId, { value: wrongBond }),
      ).to.be.revertedWithCustomError(optimisticOracle, "NotEnoughValue");
    });

    it("Should reject disputes after deadline", async function () {
      // Fast forward time past dispute window
      await ethers.provider.send("evm_increaseTime", [181]); // 3 minutes + 1 second
      await ethers.provider.send("evm_mine");

      const bond = reward * 2n;
      await expect(
        optimisticOracle.connect(disputer).disputeOutcome(assertionId, { value: bond }),
      ).to.be.revertedWithCustomError(optimisticOracle, "InvalidTime");
    });

    it("Should reject duplicate disputes", async function () {
      const bond = reward * 2n;
      await optimisticOracle.connect(disputer).disputeOutcome(assertionId, { value: bond });

      await expect(
        optimisticOracle.connect(otherUser).disputeOutcome(assertionId, { value: bond }),
      ).to.be.revertedWithCustomError(optimisticOracle, "ProposalDisputed");
    });
  });

  describe("Undisputed Reward Claiming", function () {
    let assertionId;
    let description;
    let reward;

    beforeEach(async function () {
      description = "Will Bitcoin reach $1m by end of 2026?";
      reward = ethers.parseEther("1");
      const tx = await optimisticOracle.connect(asserter).assertEvent(description, 0, 0, { value: reward });
      const receipt = await tx.wait();
      const event = receipt .logs.find(
        log => optimisticOracle.interface.parseLog(log)?.name === "EventAsserted",
      );
      const parsedEvent = optimisticOracle.interface.parseLog(event);
      assertionId = parsedEvent .args[0];

      const bond = reward * 2n;
      await optimisticOracle.connect(proposer).proposeOutcome(assertionId, true, { value: bond });
    });

    it("Should allow claiming undisputed rewards after deadline", async function () {
      // Fast forward time past dispute window
      await ethers.provider.send("evm_increaseTime", [181]);
      await ethers.provider.send("evm_mine");

      const initialBalance = await ethers.provider.getBalance(proposer.address);
      const tx = await optimisticOracle.connect(proposer).claimUndisputedReward(assertionId);
      const receipt = await tx.wait();
      const finalBalance = await ethers.provider.getBalance(proposer.address);

      // Check that proposer received the reward (reward + bond - gas costs)
      const expectedReward = reward + reward * 2n;
      const gasCost = receipt .gasUsed * receipt .gasPrice;
      expect(finalBalance - initialBalance + gasCost).to.equal(expectedReward);
    });

    it("Should reject claiming before deadline", async function () {
      await expect(optimisticOracle.connect(proposer).claimUndisputedReward(assertionId)).to.be.revertedWithCustomError(
        optimisticOracle,
        "InvalidTime",
      );
    });

    it("Should reject claiming disputed assertions", async function () {
      const bond = reward * 2n;
      await optimisticOracle.connect(disputer).disputeOutcome(assertionId, { value: bond });

      await expect(optimisticOracle.connect(proposer).claimUndisputedReward(assertionId)).to.be.revertedWithCustomError(
        optimisticOracle,
        "ProposalDisputed",
      );
    });

    it("Should reject claiming already claimed rewards", async function () {
      // Fast forward time and claim
      await ethers.provider.send("evm_increaseTime", [181]);
      await ethers.provider.send("evm_mine");
      await optimisticOracle.connect(proposer).claimUndisputedReward(assertionId);

      await expect(optimisticOracle.connect(proposer).claimUndisputedReward(assertionId)).to.be.revertedWithCustomError(
        optimisticOracle,
        "AlreadyClaimed",
      );
    });
  });

  describe("Disputed Reward Claiming", function () {
    let assertionId;
    let description;
    let reward;

    beforeEach(async function () {
      description = "Will Bitcoin reach $1m by end of 2026?";
      reward = ethers.parseEther("1");
      const tx = await optimisticOracle.connect(asserter).assertEvent(description, 0, 0, { value: reward });
      const receipt = await tx.wait();
      const event = receipt .logs.find(
        log => optimisticOracle.interface.parseLog(log)?.name === "EventAsserted",
      );
      const parsedEvent = optimisticOracle.interface.parseLog(event);
      assertionId = parsedEvent .args[0];

      const bond = reward * 2n;
      await optimisticOracle.connect(proposer).proposeOutcome(assertionId, true, { value: bond });
      await optimisticOracle.connect(disputer).disputeOutcome(assertionId, { value: bond });
    });

    it("Should allow winner to claim disputed rewards after settlement", async function () {
      // Settle with proposer winning
      await deciderContract.connect(owner).settleDispute(assertionId, true);

      const initialBalance = await ethers.provider.getBalance(proposer.address);
      const tx = await optimisticOracle.connect(proposer).claimDisputedReward(assertionId);
      const receipt = await tx.wait();
      const finalBalance = await ethers.provider.getBalance(proposer.address);

      // Check that proposer received the reward (reward + bond - gas costs)
      const expectedReward = reward * 3n;
      const gasCost = receipt .gasUsed * receipt .gasPrice;
      expect(finalBalance - initialBalance + gasCost).to.equal(expectedReward);
    });

    it("Should allow disputer to claim when they win", async function () {
      // Settle with disputer winning
      await deciderContract.connect(owner).settleDispute(assertionId, false);

      const initialBalance = await ethers.provider.getBalance(disputer.address);
      const tx = await optimisticOracle.connect(disputer).claimDisputedReward(assertionId);
      const receipt = await tx.wait();
      const finalBalance = await ethers.provider.getBalance(disputer.address);

      // Check that disputer received the reward
      const expectedReward = reward * 3n;
      const gasCost = receipt .gasUsed * receipt .gasPrice;
      expect(finalBalance - initialBalance + gasCost).to.equal(expectedReward);
    });

    it("Should reject claiming before settlement", async function () {
      await expect(optimisticOracle.connect(proposer).claimDisputedReward(assertionId)).to.be.revertedWithCustomError(
        optimisticOracle,
        "AwaitingDecider",
      );
    });

    it("Should reject claiming already claimed rewards", async function () {
      await deciderContract.connect(owner).settleDispute(assertionId, true);
      await optimisticOracle.connect(proposer).claimDisputedReward(assertionId);

      await expect(optimisticOracle.connect(proposer).claimDisputedReward(assertionId)).to.be.revertedWithCustomError(
        optimisticOracle,
        "AlreadyClaimed",
      );
    });
  });

  describe("Refund Claiming", function () {
    let assertionId;
    let description;
    let reward;

    beforeEach(async function () {
      description = "Will Bitcoin reach $1m by end of 2026?";
      reward = ethers.parseEther("1");
      const tx = await optimisticOracle.connect(asserter).assertEvent(description, 0, 0, { value: reward });
      const receipt = await tx.wait();
      const event = receipt .logs.find(
        log => optimisticOracle.interface.parseLog(log)?.name === "EventAsserted",
      );
      const parsedEvent = optimisticOracle.interface.parseLog(event);
      assertionId = parsedEvent .args[0];
    });

    it("Should allow asserter to claim refund for assertions without proposals", async function () {
      // Fast forward time past dispute window
      await ethers.provider.send("evm_increaseTime", [181]);
      await ethers.provider.send("evm_mine");

      const initialBalance = await ethers.provider.getBalance(asserter.address);
      const tx = await optimisticOracle.connect(asserter).claimRefund(assertionId);
      const receipt = await tx.wait();
      const finalBalance = await ethers.provider.getBalance(asserter.address);

      // Check that asserter received the refund (reward - gas costs)
      const gasCost = receipt .gasUsed * receipt .gasPrice;
      expect(finalBalance - initialBalance + gasCost).to.equal(reward);
    });

    it("Should reject refund claiming for assertions with proposals", async function () {
      const bond = reward * 2n;
      await optimisticOracle.connect(proposer).proposeOutcome(assertionId, true, { value: bond });

      await expect(optimisticOracle.connect(asserter).claimRefund(assertionId)).to.be.revertedWithCustomError(
        optimisticOracle,
        "AssertionProposed",
      );
    });

    it("Should reject claiming already claimed refunds", async function () {
      // Fast forward time and claim
      await ethers.provider.send("evm_increaseTime", [181]);
      await ethers.provider.send("evm_mine");
      await optimisticOracle.connect(asserter).claimRefund(assertionId);

      await expect(optimisticOracle.connect(asserter).claimRefund(assertionId)).to.be.revertedWithCustomError(
        optimisticOracle,
        "AlreadyClaimed",
      );
    });
  });

  describe("Dispute Settlement", function () {
    let assertionId;
    let description;
    let reward;

    beforeEach(async function () {
      description = "Will Bitcoin reach $1m by end of 2026?";
      reward = ethers.parseEther("1");
      const tx = await optimisticOracle.connect(asserter).assertEvent(description, 0, 0, { value: reward });
      const receipt = await tx.wait();
      const event = receipt .logs.find(
        log => optimisticOracle.interface.parseLog(log)?.name === "EventAsserted",
      );
      const parsedEvent = optimisticOracle.interface.parseLog(event);
      assertionId = parsedEvent .args[0];

      const bond = reward * 2n;
      await optimisticOracle.connect(proposer).proposeOutcome(assertionId, true, { value: bond });
      await optimisticOracle.connect(disputer).disputeOutcome(assertionId, { value: bond });
    });

    it("Should allow decider to settle disputed assertions", async function () {
      const resolvedOutcome = true;
      const tx = await deciderContract.connect(owner).settleDispute(assertionId, resolvedOutcome);

      expect(tx).to.emit(optimisticOracle, "AssertionSettled").withArgs(assertionId, resolvedOutcome, proposer.address);

      // Check that the assertion was settled correctly by checking the state
      const state = await optimisticOracle.getState(assertionId);
      expect(state).to.equal(State.Settled); // Settled state
    });

    it("Should reject settlement by non-decider", async function () {
      const resolvedOutcome = true;

      await expect(
        optimisticOracle.connect(otherUser).settleAssertion(assertionId, resolvedOutcome),
      ).to.be.revertedWithCustomError(optimisticOracle, "OnlyDecider");
    });

    it("Should reject settling undisputed assertions", async function () {
      // Create a new undisputed assertion
      const newDescription = "Will Ethereum reach $10k by end of 2024?";
      const newTx = await optimisticOracle.connect(asserter).assertEvent(newDescription, 0, 0, { value: reward });
      const newReceipt = await newTx.wait();
      const newEvent = newReceipt .logs.find(
        log => optimisticOracle.interface.parseLog(log)?.name === "EventAsserted",
      );
      const newParsedEvent = optimisticOracle.interface.parseLog(newEvent);
      const newAssertionId = newParsedEvent .args[0];

      const bond = reward * 2n;
      await optimisticOracle.connect(proposer).proposeOutcome(newAssertionId, true, { value: bond });

      const resolvedOutcome = true;
      await expect(
        deciderContract.connect(owner).settleDispute(newAssertionId, resolvedOutcome),
      ).to.be.revertedWithCustomError(optimisticOracle, "NotDisputedAssertion");
    });
  });

  describe("State Management", function () {
    it("Should return correct states for different scenarios", async function () {
      const description = "Will Bitcoin reach $1m by end of 2026?";
      const reward = ethers.parseEther("1");

      // Invalid state for non-existent assertion
      let state = await optimisticOracle.getState(999n);
      expect(state).to.equal(State.Invalid); // Invalid

      // Asserted state
      const tx = await optimisticOracle.connect(asserter).assertEvent(description, 0, 0, { value: reward });
      const receipt = await tx.wait();
      const event = receipt .logs.find(
        log => optimisticOracle.interface.parseLog(log)?.name === "EventAsserted",
      );
      const parsedEvent = optimisticOracle.interface.parseLog(event);
      const assertionId = parsedEvent .args[0];

      state = await optimisticOracle.getState(assertionId);
      expect(state).to.equal(State.Asserted); // Asserted

      // Proposed state
      const bond = reward * 2n;
      await optimisticOracle.connect(proposer).proposeOutcome(assertionId, true, { value: bond });
      state = await optimisticOracle.getState(assertionId);
      expect(state).to.equal(State.Proposed); // Proposed

      // Disputed state
      await optimisticOracle.connect(disputer).disputeOutcome(assertionId, { value: bond });
      state = await optimisticOracle.getState(assertionId);
      expect(state).to.equal(State.Disputed); // Disputed

      // Settled state (after decider resolution)
      await deciderContract.connect(owner).settleDispute(assertionId, true);
      state = await optimisticOracle.getState(assertionId);
      expect(state).to.equal(State.Settled); // Settled
    });

    it("Should show settled state for claimable uncontested assertions", async function () {
      const description = "Will Ethereum reach $10k by end of 2024?";
      const reward = ethers.parseEther("1");

      const tx = await optimisticOracle.connect(asserter).assertEvent(description, 0, 0, { value: reward });
      const receipt = await tx.wait();
      const event = receipt .logs.find(
        log => optimisticOracle.interface.parseLog(log)?.name === "EventAsserted",
      );
      const parsedEvent = optimisticOracle.interface.parseLog(event);
      const assertionId = parsedEvent .args[0];

      const bond = reward * 2n;
      await optimisticOracle.connect(proposer).proposeOutcome(assertionId, true, { value: bond });

      // Fast forward time past dispute window
      await ethers.provider.send("evm_increaseTime", [181]);
      await ethers.provider.send("evm_mine");

      const state = await optimisticOracle.getState(assertionId);
      expect(state).to.equal(State.Settled); // Settled (can be claimed)
    });

    it("Should show expired state for assertions without proposals after deadline", async function () {
      const description = "Will Ethereum reach $10k by end of 2024?";
      const reward = ethers.parseEther("1");

      const tx = await optimisticOracle.connect(asserter).assertEvent(description, 0, 0, { value: reward });
      const receipt = await tx.wait();
      const event = receipt .logs.find(
        log => optimisticOracle.interface.parseLog(log)?.name === "EventAsserted",
      );
      const parsedEvent = optimisticOracle.interface.parseLog(event);
      const assertionId = parsedEvent .args[0];

      // Fast forward time past dispute window without any proposal
      await ethers.provider.send("evm_increaseTime", [181]);
      await ethers.provider.send("evm_mine");

      const state = await optimisticOracle.getState(assertionId);
      expect(state).to.equal(State.Expired); // Expired
    });
  });

  describe("Start and End Time Logic", function () {
    it("Should not allow proposal before startTime", async function () {
      const reward = ethers.parseEther("1");
      const now = (await ethers.provider.getBlock("latest")) .timestamp;
      const start = now + 1000;
      const end = start + 1000;
      const tx = await optimisticOracle.connect(asserter).assertEvent("future event", start, end, { value: reward });
      const receipt = await tx.wait();
      const event = receipt .logs.find(
        log => optimisticOracle.interface.parseLog(log)?.name === "EventAsserted",
      );
      const parsedEvent = optimisticOracle.interface.parseLog(event);
      if (!parsedEvent) throw new Error("Event not found");
      const assertionId = parsedEvent.args[0];

      const bond = reward * 2n;
      await expect(
        optimisticOracle.connect(proposer).proposeOutcome(assertionId, true, { value: bond }),
      ).to.be.revertedWithCustomError(optimisticOracle, "InvalidTime");
    });

    it("Should not allow proposal after endTime", async function () {
      const reward = ethers.parseEther("1");
      const now = (await ethers.provider.getBlock("latest")) .timestamp;
      const start = now + 1; // Start time must be in the future
      const end = now + 200; // 200 seconds, which is more than MINIMUM_DISPUTE_WINDOW (180 seconds)
      const tx = await optimisticOracle.connect(asserter).assertEvent("short event", start, end, { value: reward });
      const receipt = await tx.wait();
      const event = receipt .logs.find(
        log => optimisticOracle.interface.parseLog(log)?.name === "EventAsserted",
      );
      const parsedEvent = optimisticOracle.interface.parseLog(event);
      if (!parsedEvent) throw new Error("Event not found");
      const assertionId = parsedEvent.args[0];

      // Wait until after endTime
      await ethers.provider.send("evm_increaseTime", [201]);
      await ethers.provider.send("evm_mine");

      const bond = reward * 2n;
      await expect(
        optimisticOracle.connect(proposer).proposeOutcome(assertionId, true, { value: bond }),
      ).to.be.revertedWithCustomError(optimisticOracle, "InvalidTime");
    });

    it("Should allow proposal only within [startTime, endTime]", async function () {
      const reward = ethers.parseEther("1");
      const now = (await ethers.provider.getBlock("latest")) .timestamp;
      const start = now + 10; // Start time in the future
      const end = start + 200; // Ensure endTime is far enough in the future
      const tx = await optimisticOracle.connect(asserter).assertEvent("window event", start, end, { value: reward });
      const receipt = await tx.wait();
      const event = receipt .logs.find(
        log => optimisticOracle.interface.parseLog(log)?.name === "EventAsserted",
      );
      const parsedEvent = optimisticOracle.interface.parseLog(event);
      if (!parsedEvent) throw new Error("Event not found");
      const assertionId = parsedEvent.args[0];

      const bond = reward * 2n;

      // Before startTime - should fail
      await expect(
        optimisticOracle.connect(proposer).proposeOutcome(assertionId, true, { value: bond }),
      ).to.be.revertedWithCustomError(optimisticOracle, "InvalidTime");

      // Move to startTime
      await ethers.provider.send("evm_increaseTime", [10]);
      await ethers.provider.send("evm_mine");

      // Now it should work
      await optimisticOracle.connect(proposer).proposeOutcome(assertionId, true, { value: bond });
    });
  });
});
```
