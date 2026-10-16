# grow-vault--deboraholaboye

- domain: staking-yield (yield-vault)
- level: moderate
- origin: human
- convention: hardhat2-ethers6
- source: https://github.com/DeborahOlaboye/grow-vault @ 47b97f83bd00d11beb72f2e1158b42d4185ec502
- license: MIT
- targets: GrowVault.sol, MockERC20.sol
- validation: 23 passing tests, 0 failing; statement coverage GrowVault.sol 88.37 %, MockERC20.sol 50.0 %

## Contract: GrowVault.sol (primary target)

```solidity
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
```

## Contract: MockERC20.sol (dependency)

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

// Test-only mock — not deployed to mainnet
contract MockERC20 is ERC20 {
    uint8 private _dec;

    constructor(string memory name, string memory symbol, uint8 dec) ERC20(name, symbol) {
        _dec = dec;
    }

    function decimals() public view override returns (uint8) {
        return _dec;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}
```

## Tests: GrowVault.js

```javascript
const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

const SOFT = 0;
const HARD = 1;
const ONE_CUSD = ethers.parseUnits("1", 18);
const TEN_CUSD = ethers.parseUnits("10", 18);
const HUNDRED_CUSD = ethers.parseUnits("100", 18);

async function deployFixture() {
  const [owner, alice, bob] = await ethers.getSigners();
  const MockERC20 = await ethers.getContractFactory("MockERC20");
  const mockCUSD = await MockERC20.deploy("Celo Dollar", "cUSD", 18);
  const GrowVault = await ethers.getContractFactory("GrowVault");
  const vault = await GrowVault.deploy(await mockCUSD.getAddress());
  await mockCUSD.mint(alice.address, HUNDRED_CUSD * 10n);
  await mockCUSD.mint(bob.address, HUNDRED_CUSD * 10n);
  await mockCUSD.connect(alice).approve(await vault.getAddress(), ethers.MaxUint256);
  await mockCUSD.connect(bob).approve(await vault.getAddress(), ethers.MaxUint256);
  const oneMonthFromNow = (await time.latest()) + 30 * 24 * 3600;
  return { vault, mockCUSD, owner, alice, bob, oneMonthFromNow };
}

describe("GrowVault", () => {
  describe("createGoal", () => {
    it("creates a goal and records it", async () => {
      const { vault, alice, oneMonthFromNow } = await deployFixture();
      await vault.connect(alice).createGoal("School fees", "🎓", TEN_CUSD, oneMonthFromNow, SOFT);
      const goal = await vault.goals(0n);
      expect(goal.owner).to.equal(alice.address);
      expect(goal.name).to.equal("School fees");
      expect(goal.emoji).to.equal("🎓");
      expect(goal.targetAmount).to.equal(TEN_CUSD);
      expect(goal.lockMode).to.equal(SOFT);
      expect(goal.completed).to.be.false;
      expect(goal.withdrawn).to.be.false;
    });

    it("increments goalId counter", async () => {
      const { vault, alice, oneMonthFromNow } = await deployFixture();
      await vault.connect(alice).createGoal("Goal A", "🏠", TEN_CUSD, oneMonthFromNow, SOFT);
      await vault.connect(alice).createGoal("Goal B", "📱", TEN_CUSD, oneMonthFromNow, HARD);
      const ids = await vault.getUserGoals(alice.address);
      expect(ids).to.deep.equal([0n, 1n]);
    });

    it("reverts if name is empty", async () => {
      const { vault, alice, oneMonthFromNow } = await deployFixture();
      await expect(
        vault.connect(alice).createGoal("", "🎓", TEN_CUSD, oneMonthFromNow, SOFT)
      ).to.be.revertedWith("Name required");
    });

    it("reverts if targetAmount is zero", async () => {
      const { vault, alice, oneMonthFromNow } = await deployFixture();
      await expect(
        vault.connect(alice).createGoal("Test", "🎓", 0, oneMonthFromNow, SOFT)
      ).to.be.revertedWith("Target required");
    });

    it("reverts if deadline is in the past", async () => {
      const { vault, alice } = await deployFixture();
      const pastDeadline = (await time.latest()) - 1;
      await expect(
        vault.connect(alice).createGoal("Test", "🎓", TEN_CUSD, pastDeadline, SOFT)
      ).to.be.revertedWith("Invalid deadline");
    });
  });

  describe("deposit", () => {
    it("records contribution and updates savedAmount", async () => {
      const { vault, alice, bob, oneMonthFromNow } = await deployFixture();
      await vault.connect(alice).createGoal("Laptop", "💻", TEN_CUSD, oneMonthFromNow, SOFT);
      await vault.connect(bob).deposit(0n, ONE_CUSD);
      const goal = await vault.goals(0n);
      expect(goal.savedAmount).to.equal(ONE_CUSD);
      expect(await vault.contributions(0n, bob.address)).to.equal(ONE_CUSD);
    });

    it("marks goal completed when savedAmount reaches target", async () => {
      const { vault, alice, oneMonthFromNow } = await deployFixture();
      await vault.connect(alice).createGoal("Phone", "📱", ONE_CUSD, oneMonthFromNow, SOFT);
      await vault.connect(alice).deposit(0n, ONE_CUSD);
      const goal = await vault.goals(0n);
      expect(goal.completed).to.be.true;
    });

    it("social contribution — non-owner can deposit and appears in contributors", async () => {
      const { vault, alice, bob, oneMonthFromNow } = await deployFixture();
      await vault.connect(alice).createGoal("Business", "💼", TEN_CUSD, oneMonthFromNow, SOFT);
      await vault.connect(bob).deposit(0n, ONE_CUSD);
      const contributors = await vault.getContributors(0n);
      expect(contributors).to.include(bob.address);
    });

    it("accumulates multiple deposits from the same contributor", async () => {
      const { vault, alice, oneMonthFromNow } = await deployFixture();
      await vault.connect(alice).createGoal("Trip", "✈️", TEN_CUSD, oneMonthFromNow, SOFT);
      await vault.connect(alice).deposit(0n, ONE_CUSD);
      await vault.connect(alice).deposit(0n, ONE_CUSD);
      const goal = await vault.goals(0n);
      expect(goal.savedAmount).to.equal(ONE_CUSD * 2n);
      expect(await vault.contributions(0n, alice.address)).to.equal(ONE_CUSD * 2n);
    });

    it("reverts on a withdrawn goal", async () => {
      const { vault, alice, oneMonthFromNow } = await deployFixture();
      await vault.connect(alice).createGoal("Done", "✅", ONE_CUSD, oneMonthFromNow, SOFT);
      await vault.connect(alice).deposit(0n, ONE_CUSD);
      await vault.connect(alice).withdraw(0n);
      await expect(vault.connect(alice).deposit(0n, ONE_CUSD)).to.be.revertedWith("Goal closed");
    });
  });

  describe("withdraw (soft lock)", () => {
    it("applies 5% penalty on early withdrawal", async () => {
      const { vault, mockCUSD, alice, oneMonthFromNow } = await deployFixture();
      await vault.connect(alice).createGoal("Partial", "🎯", HUNDRED_CUSD, oneMonthFromNow, SOFT);
      await vault.connect(alice).deposit(0n, TEN_CUSD);
      const balBefore = await mockCUSD.balanceOf(alice.address);
      await vault.connect(alice).withdraw(0n);
      const balAfter = await mockCUSD.balanceOf(alice.address);
      const received = balAfter - balBefore;
      const expected = (TEN_CUSD * 9500n) / 10000n;
      expect(received).to.equal(expected);
      expect(await vault.penaltyPool()).to.equal(TEN_CUSD - expected);
    });

    it("no penalty if soft lock goal is completed", async () => {
      const { vault, mockCUSD, alice, oneMonthFromNow } = await deployFixture();
      await vault.connect(alice).createGoal("Full", "🎯", ONE_CUSD, oneMonthFromNow, SOFT);
      await vault.connect(alice).deposit(0n, ONE_CUSD);
      const balBefore = await mockCUSD.balanceOf(alice.address);
      await vault.connect(alice).withdraw(0n);
      const balAfter = await mockCUSD.balanceOf(alice.address);
      expect(balAfter - balBefore).to.equal(ONE_CUSD);
    });

    it("no penalty if withdrawn after deadline", async () => {
      const { vault, mockCUSD, alice } = await deployFixture();
      const deadline = (await time.latest()) + 100;
      await vault.connect(alice).createGoal("After deadline", "🎯", TEN_CUSD, deadline, SOFT);
      await vault.connect(alice).deposit(0n, ONE_CUSD);
      await time.increase(200);
      const balBefore = await mockCUSD.balanceOf(alice.address);
      await vault.connect(alice).withdraw(0n);
      const balAfter = await mockCUSD.balanceOf(alice.address);
      expect(balAfter - balBefore).to.equal(ONE_CUSD);
    });

    it("reverts if non-owner tries to withdraw", async () => {
      const { vault, alice, bob, oneMonthFromNow } = await deployFixture();
      await vault.connect(alice).createGoal("Mine", "🎯", TEN_CUSD, oneMonthFromNow, SOFT);
      await vault.connect(alice).deposit(0n, ONE_CUSD);
      await expect(vault.connect(bob).withdraw(0n)).to.be.revertedWith("Not owner");
    });
  });

  describe("withdraw (hard lock)", () => {
    it("reverts if hard lock before deadline", async () => {
      const { vault, alice, oneMonthFromNow } = await deployFixture();
      await vault.connect(alice).createGoal("Hard", "🔒", TEN_CUSD, oneMonthFromNow, HARD);
      await vault.connect(alice).deposit(0n, ONE_CUSD);
      await expect(vault.connect(alice).withdraw(0n)).to.be.revertedWith("Hard locked until deadline");
    });

    it("succeeds after deadline", async () => {
      const { vault, mockCUSD, alice } = await deployFixture();
      const deadline = (await time.latest()) + 100;
      await vault.connect(alice).createGoal("Hard future", "🔒", TEN_CUSD, deadline, HARD);
      await vault.connect(alice).deposit(0n, ONE_CUSD);
      await time.increase(200);
      const balBefore = await mockCUSD.balanceOf(alice.address);
      await vault.connect(alice).withdraw(0n);
      const balAfter = await mockCUSD.balanceOf(alice.address);
      expect(balAfter - balBefore).to.equal(ONE_CUSD);
    });

    it("succeeds before deadline if goal is completed", async () => {
      const { vault, mockCUSD, alice, oneMonthFromNow } = await deployFixture();
      await vault.connect(alice).createGoal("Hard complete", "🔒", ONE_CUSD, oneMonthFromNow, HARD);
      await vault.connect(alice).deposit(0n, ONE_CUSD);
      const balBefore = await mockCUSD.balanceOf(alice.address);
      await vault.connect(alice).withdraw(0n);
      const balAfter = await mockCUSD.balanceOf(alice.address);
      expect(balAfter - balBefore).to.equal(ONE_CUSD);
    });
  });

  describe("claimMilestone", () => {
    it("claims milestone at 25%", async () => {
      const { vault, alice, oneMonthFromNow } = await deployFixture();
      await vault.connect(alice).createGoal("Save", "🎯", HUNDRED_CUSD, oneMonthFromNow, SOFT);
      await vault.connect(alice).deposit(0n, ethers.parseUnits("25", 18));
      await vault.connect(alice).claimMilestone(0n);
      expect((await vault.goals(0n)).milestonesClaimed).to.equal(1);
    });

    it("claims all four milestones in sequence", async () => {
      const { vault, alice, oneMonthFromNow } = await deployFixture();
      await vault.connect(alice).createGoal("Full run", "🎯", HUNDRED_CUSD, oneMonthFromNow, SOFT);
      for (const [deposit, expectedMilestone] of [[25, 1], [25, 2], [25, 3], [25, 4]]) {
        await vault.connect(alice).deposit(0n, ethers.parseUnits(deposit.toString(), 18));
        await vault.connect(alice).claimMilestone(0n);
        expect((await vault.goals(0n)).milestonesClaimed).to.equal(expectedMilestone);
      }
    });

    it("reverts if milestone threshold not reached", async () => {
      const { vault, alice, oneMonthFromNow } = await deployFixture();
      await vault.connect(alice).createGoal("Low", "🎯", HUNDRED_CUSD, oneMonthFromNow, SOFT);
      await vault.connect(alice).deposit(0n, ethers.parseUnits("10", 18));
      await expect(vault.connect(alice).claimMilestone(0n)).to.be.revertedWith("Milestone not reached");
    });

    it("reverts if non-owner tries to claim", async () => {
      const { vault, alice, bob, oneMonthFromNow } = await deployFixture();
      await vault.connect(alice).createGoal("Mine", "🎯", HUNDRED_CUSD, oneMonthFromNow, SOFT);
      await vault.connect(alice).deposit(0n, ethers.parseUnits("25", 18));
      await expect(vault.connect(bob).claimMilestone(0n)).to.be.revertedWith("Not owner");
    });
  });

  describe("withdrawPenalties", () => {
    it("allows owner to collect the penalty pool", async () => {
      const { vault, mockCUSD, owner, alice, oneMonthFromNow } = await deployFixture();
      await vault.connect(alice).createGoal("Early exit", "💸", TEN_CUSD, oneMonthFromNow, SOFT);
      await vault.connect(alice).deposit(0n, ONE_CUSD);
      await vault.connect(alice).withdraw(0n);
      const pool = await vault.penaltyPool();
      expect(pool).to.be.gt(0n);
      const balBefore = await mockCUSD.balanceOf(owner.address);
      await vault.connect(owner).withdrawPenalties();
      const balAfter = await mockCUSD.balanceOf(owner.address);
      expect(balAfter - balBefore).to.equal(pool);
      expect(await vault.penaltyPool()).to.equal(0n);
    });

    it("reverts if non-owner tries to collect penalties", async () => {
      const { vault, alice } = await deployFixture();
      await expect(vault.connect(alice).withdrawPenalties()).to.be.revertedWithCustomError(vault, "OwnableUnauthorizedAccount");
    });
  });
});
```
