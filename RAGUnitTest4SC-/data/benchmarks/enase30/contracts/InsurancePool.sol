// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title InsurancePool
 * @notice Parametric insurance pool.
 *         - Liquidity providers stake ETH to earn premiums.
 *         - Policyholders pay a premium for coverage up to a cap.
 *         - A trusted oracle (owner) triggers payouts on-chain.
 *         - LP shares are tracked proportionally.
 * Complexity: Complex
 */
contract InsurancePool {
    struct Policy {
        address holder;
        uint256 coverage;   // max payout
        uint256 premium;    // paid upfront
        uint256 expiry;     // timestamp
        bool    active;
        bool    claimed;
    }

    struct LPPosition {
        uint256 deposited;
        uint256 rewardDebt; // snapshot of rewardPerShare at deposit
    }

    address public owner;
    uint256 public totalLiquidity;
    uint256 public totalCoverage;    // sum of active policy coverage
    uint256 public rewardPerShare;   // scaled by 1e18
    uint256 public constant SCALE = 1e18;

    Policy[] public policies;
    mapping(address => LPPosition) public lpPositions;
    mapping(address => uint256)    public pendingRewards;

    event Deposited(address indexed lp, uint256 amount);
    event Withdrawn(address indexed lp, uint256 amount);
    event PolicyPurchased(uint256 indexed policyId, address indexed holder, uint256 coverage, uint256 premium, uint256 expiry);
    event Claimed(uint256 indexed policyId, address indexed holder, uint256 payout);
    event PolicyExpired(uint256 indexed policyId);

    modifier onlyOwner() { require(msg.sender == owner, "Not owner"); _; }

    constructor() { owner = msg.sender; }

    // â”€â”€â”€ LP actions â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

    function deposit() external payable {
        require(msg.value > 0, "Zero deposit");
        _updateRewards(msg.sender);
        lpPositions[msg.sender].deposited += msg.value;
        totalLiquidity += msg.value;
        emit Deposited(msg.sender, msg.value);
    }

    function withdraw(uint256 amount) external {
        LPPosition storage pos = lpPositions[msg.sender];
        require(pos.deposited >= amount, "Insufficient deposit");
        require(totalLiquidity - amount >= totalCoverage, "Undercollateralized");
        _updateRewards(msg.sender);
        pos.deposited  -= amount;
        totalLiquidity -= amount;
        (bool ok,) = msg.sender.call{value: amount}("");
        require(ok, "Transfer failed");
        emit Withdrawn(msg.sender, amount);
    }

    function claimRewards() external {
        _updateRewards(msg.sender);
        uint256 reward = pendingRewards[msg.sender];
        require(reward > 0, "No rewards");
        pendingRewards[msg.sender] = 0;
        (bool ok,) = msg.sender.call{value: reward}("");
        require(ok, "Transfer failed");
    }

    // â”€â”€â”€ Policy actions â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

    function buyPolicy(uint256 coverage, uint256 durationSeconds) external payable returns (uint256 policyId) {
        require(coverage > 0, "Zero coverage");
        require(totalLiquidity >= totalCoverage + coverage, "Insufficient pool");
        uint256 premium = msg.value;
        require(premium > 0, "No premium");

        uint256 expiry = block.timestamp + durationSeconds;
        policyId = policies.length;
        policies.push(Policy({
            holder:  msg.sender,
            coverage: coverage,
            premium:  premium,
            expiry:   expiry,
            active:   true,
            claimed:  false
        }));
        totalCoverage += coverage;

        // Distribute premium to LPs
        if (totalLiquidity > 0) {
            rewardPerShare += (premium * SCALE) / totalLiquidity;
        }

        emit PolicyPurchased(policyId, msg.sender, coverage, premium, expiry);
    }

    // â”€â”€â”€ Oracle-triggered payout â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

    function triggerClaim(uint256 policyId) external onlyOwner {
        Policy storage p = policies[policyId];
        require(p.active && !p.claimed, "Not claimable");
        require(block.timestamp <= p.expiry, "Policy expired");

        p.claimed = true;
        p.active  = false;
        totalCoverage  -= p.coverage;
        totalLiquidity -= p.coverage;

        (bool ok,) = p.holder.call{value: p.coverage}("");
        require(ok, "Payout failed");
        emit Claimed(policyId, p.holder, p.coverage);
    }

    function expirePolicy(uint256 policyId) external {
        Policy storage p = policies[policyId];
        require(p.active && !p.claimed, "Not active");
        require(block.timestamp > p.expiry, "Not expired");
        p.active = false;
        totalCoverage -= p.coverage;
        emit PolicyExpired(policyId);
    }

    // â”€â”€â”€ Internal â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

    function _updateRewards(address lp) internal {
        LPPosition storage pos = lpPositions[lp];
        uint256 accrued = (pos.deposited * (rewardPerShare - pos.rewardDebt)) / SCALE;
        pendingRewards[lp]  += accrued;
        pos.rewardDebt       = rewardPerShare;
    }

    function policyCount() external view returns (uint256) { return policies.length; }
}

