// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

contract GrowVault is Ownable, ReentrancyGuard {
    IERC20 public immutable cUSD;

    enum LockMode { SOFT, HARD }

    struct Goal {
        address owner;
        string name;
        string emoji;
        uint256 targetAmount;
        uint256 savedAmount;
        uint256 deadline;
        LockMode lockMode;
        bool completed;
        bool withdrawn;
        uint256 createdAt;
        uint8 milestonesClaimed; // 0-4 (25%, 50%, 75%, 100%)
    }

    // 5% early withdrawal penalty on soft-lock goals
    uint256 public constant SOFT_LOCK_PENALTY_BPS = 500;
    uint256 public constant BPS_DENOMINATOR = 10000;

    uint256 private _goalCounter;

    mapping(uint256 => Goal) public goals;
    mapping(address => uint256[]) public userGoals;

    // goalId => contributor => amount
    mapping(uint256 => mapping(address => uint256)) public contributions;
    mapping(uint256 => address[]) public contributors;

    uint256 public penaltyPool; // accumulated penalties

    event GoalCreated(uint256 indexed goalId, address indexed owner, string name, uint256 target, uint256 deadline);
    event Deposited(uint256 indexed goalId, address indexed contributor, uint256 amount);
    event Withdrawn(uint256 indexed goalId, address indexed owner, uint256 amount, uint256 penalty);
    event GoalCompleted(uint256 indexed goalId);
    event MilestoneClaimed(uint256 indexed goalId, uint8 milestone);

    constructor(address _cUSD) Ownable(msg.sender) {
        cUSD = IERC20(_cUSD);
    }

    function createGoal(
        string calldata name,
        string calldata emoji,
        uint256 targetAmount,
        uint256 deadline,
        LockMode lockMode
    ) external returns (uint256 goalId) {
        require(bytes(name).length > 0, "Name required");
        require(targetAmount > 0, "Target required");
        require(deadline > block.timestamp, "Invalid deadline");

        goalId = _goalCounter++;
        goals[goalId] = Goal({
            owner: msg.sender,
            name: name,
            emoji: emoji,
            targetAmount: targetAmount,
            savedAmount: 0,
            deadline: deadline,
            lockMode: lockMode,
            completed: false,
            withdrawn: false,
            createdAt: block.timestamp,
            milestonesClaimed: 0
        });

        userGoals[msg.sender].push(goalId);
        emit GoalCreated(goalId, msg.sender, name, targetAmount, deadline);
    }

    function deposit(uint256 goalId, uint256 amount) external nonReentrant {
        Goal storage goal = goals[goalId];
        require(!goal.withdrawn, "Goal closed");
        require(!goal.completed, "Goal already completed");
        require(amount > 0, "Amount required");

        require(cUSD.transferFrom(msg.sender, address(this), amount), "Transfer failed");

        if (contributions[goalId][msg.sender] == 0) {
            contributors[goalId].push(msg.sender);
        }
        contributions[goalId][msg.sender] += amount;
        goal.savedAmount += amount;

        if (goal.savedAmount >= goal.targetAmount) {
            goal.completed = true;
            emit GoalCompleted(goalId);
        }

        emit Deposited(goalId, msg.sender, amount);
    }

    function withdraw(uint256 goalId) external nonReentrant {
        Goal storage goal = goals[goalId];
        require(goal.owner == msg.sender, "Not owner");
        require(!goal.withdrawn, "Already withdrawn");
        require(goal.savedAmount > 0, "Nothing saved");

        // Hard lock: can only withdraw after deadline or if goal is completed
        if (goal.lockMode == LockMode.HARD) {
            require(
                block.timestamp >= goal.deadline || goal.completed,
                "Hard locked until deadline"
            );
        }

        goal.withdrawn = true;
        uint256 amount = goal.savedAmount;
        uint256 penalty = 0;

        // Apply penalty if soft-lock early withdrawal
        if (
            goal.lockMode == LockMode.SOFT &&
            !goal.completed &&
            block.timestamp < goal.deadline
        ) {
            penalty = (amount * SOFT_LOCK_PENALTY_BPS) / BPS_DENOMINATOR;
            penaltyPool += penalty;
            amount -= penalty;
        }

        require(cUSD.transfer(msg.sender, amount), "Transfer failed");
        emit Withdrawn(goalId, msg.sender, amount, penalty);
    }

    function claimMilestone(uint256 goalId) external {
        Goal storage goal = goals[goalId];
        require(goal.owner == msg.sender, "Not owner");

        uint256 pct = (goal.savedAmount * 100) / goal.targetAmount;
        uint8 nextMilestone = goal.milestonesClaimed + 1;

        // milestones: 1=25%, 2=50%, 3=75%, 4=100%
        uint8 threshold = nextMilestone * 25;
        require(pct >= threshold, "Milestone not reached");
        require(nextMilestone <= 4, "All milestones claimed");

        goal.milestonesClaimed = nextMilestone;
        emit MilestoneClaimed(goalId, nextMilestone);
    }

    function getUserGoals(address user) external view returns (uint256[] memory) {
        return userGoals[user];
    }

    function getContributors(uint256 goalId) external view returns (address[] memory) {
        return contributors[goalId];
    }

    function getProgress(uint256 goalId) external view returns (uint256 pct) {
        Goal storage goal = goals[goalId];
        if (goal.targetAmount == 0) return 0;
        pct = (goal.savedAmount * 100) / goal.targetAmount;
        if (pct > 100) pct = 100;
    }

    function totalGoals() external view returns (uint256) {
        return _goalCounter;
    }

    function withdrawPenalties() external onlyOwner {
        uint256 amount = penaltyPool;
        penaltyPool = 0;
        require(cUSD.transfer(owner(), amount), "Transfer failed");
    }
}
