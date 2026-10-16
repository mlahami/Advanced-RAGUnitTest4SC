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
