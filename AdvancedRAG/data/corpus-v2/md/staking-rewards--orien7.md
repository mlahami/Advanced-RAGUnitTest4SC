# staking-rewards--orien7

- domain: staking-yield (staking)
- level: moderate
- origin: human
- convention: hardhat2-ethers6
- source: https://github.com/orien7/uday-erc20-staking @ 6fecb4fc0252af708d598b6703f8e6dac53e2e9c
- license: MIT
- targets: StakingRewards.sol, UDAYToken.sol
- validation: 12 passing tests, 0 failing; statement coverage StakingRewards.sol 90.7 %, UDAYToken.sol 100.0 %

## Contract: StakingRewards.sol (primary target)

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/access/Ownable2Step.sol";

/// @title StakingRewards — Non-custodial ERC-20 staking with APY rewards
/// @author Uday Kumar BS
/// @notice Users stake UDAY tokens and earn rewards proportional to time staked
contract StakingRewards is ReentrancyGuard, Ownable2Step {
    using SafeERC20 for IERC20;

    // ── State ──────────────────────────────────────────────────────────────
    IERC20 public immutable stakingToken;

    uint256 public rewardRateBPS;        // basis points per year (1000 = 10% APY)
    uint256 public lockPeriod;           // seconds before penalty-free unstake
    uint256 public emergencyPenaltyBPS;  // penalty BPS on early exit (500 = 5%)
    uint256 public minimumStake;         // minimum tokens to stake

    struct StakeInfo {
        uint256 amount;          // tokens staked
        uint256 stakedAt;        // timestamp of stake
        uint256 rewardDebt;      // rewards already claimed
        uint256 lastUpdate;      // last reward calculation timestamp
    }

    mapping(address => StakeInfo) public stakes;
    uint256 public totalStaked;

    // ── Events ─────────────────────────────────────────────────────────────
    event Staked(address indexed user, uint256 amount);
    event Unstaked(address indexed user, uint256 amount, uint256 penalty);
    event RewardsClaimed(address indexed user, uint256 reward);
    event EmergencyWithdraw(address indexed user, uint256 amount, uint256 penalty);
    event ParametersUpdated(uint256 rewardRateBPS, uint256 lockPeriod);

    // ── Errors ─────────────────────────────────────────────────────────────
    error BelowMinimumStake(uint256 amount, uint256 minimum);
    error NothingStaked();
    error InsufficientContractBalance();
    error ZeroAmount();

    // ── Constructor ────────────────────────────────────────────────────────
    constructor(
        address _stakingToken,
        address initialOwner,
        uint256 _rewardRateBPS,   // e.g. 1000 = 10% APY
        uint256 _lockPeriodDays
    ) Ownable(initialOwner) {
        stakingToken = IERC20(_stakingToken);
        rewardRateBPS = _rewardRateBPS;
        lockPeriod = _lockPeriodDays * 1 days;
        emergencyPenaltyBPS = 500; // 5%
        minimumStake = 100 * 10 ** 18; // 100 tokens
    }

    // ── Core functions ─────────────────────────────────────────────────────

    /// @notice Stake tokens to earn rewards
    function stake(uint256 amount) external nonReentrant {
        if (amount == 0) revert ZeroAmount();
        if (amount < minimumStake) revert BelowMinimumStake(amount, minimumStake);

        StakeInfo storage info = stakes[msg.sender];

        // Claim pending rewards before updating stake
        if (info.amount > 0) {
            _claimRewards(msg.sender);
        }

        stakingToken.safeTransferFrom(msg.sender, address(this), amount);

        info.amount += amount;
        info.stakedAt = block.timestamp;
        info.lastUpdate = block.timestamp;
        totalStaked += amount;

        emit Staked(msg.sender, amount);
    }

    /// @notice Unstake tokens — penalty applies if before lock period
    function unstake(uint256 amount) external nonReentrant {
        StakeInfo storage info = stakes[msg.sender];
        if (info.amount == 0) revert NothingStaked();
        if (amount == 0) revert ZeroAmount();
        if (amount > info.amount) amount = info.amount;

        // Claim pending rewards first
        _claimRewards(msg.sender);

        uint256 penalty = 0;
        if (block.timestamp < info.stakedAt + lockPeriod) {
            penalty = (amount * emergencyPenaltyBPS) / 10_000;
        }

        info.amount -= amount;
        totalStaked -= amount;
        info.lastUpdate = block.timestamp;

        uint256 amountOut = amount - penalty;
        stakingToken.safeTransfer(msg.sender, amountOut);

        emit Unstaked(msg.sender, amountOut, penalty);
    }

    /// @notice Claim accrued rewards without unstaking
    function claimRewards() external nonReentrant {
        StakeInfo storage info = stakes[msg.sender];
        if (info.amount == 0) revert NothingStaked();
        _claimRewards(msg.sender);
    }

    /// @notice Emergency exit — always incurs penalty regardless of lock period
    function emergencyWithdraw() external nonReentrant {
        StakeInfo storage info = stakes[msg.sender];
        if (info.amount == 0) revert NothingStaked();

        uint256 amount = info.amount;
        uint256 penalty = (amount * emergencyPenaltyBPS) / 10_000;
        uint256 amountOut = amount - penalty;

        totalStaked -= amount;
        delete stakes[msg.sender];

        stakingToken.safeTransfer(msg.sender, amountOut);

        emit EmergencyWithdraw(msg.sender, amountOut, penalty);
    }

    // ── View functions ─────────────────────────────────────────────────────

    /// @notice Calculate pending rewards for an address
    function earned(address user) public view returns (uint256) {
        StakeInfo storage info = stakes[user];
        if (info.amount == 0) return 0;

        uint256 timeElapsed = block.timestamp - info.lastUpdate;
        // reward = amount * rate * time / (10000 * 365 days)
        uint256 reward = (info.amount * rewardRateBPS * timeElapsed) / (10_000 * 365 days);
        return reward;
    }

    /// @notice Returns full stake info for a user
    function getStakeInfo(address user) external view returns (
        uint256 amount,
        uint256 stakedAt,
        uint256 pendingReward,
        bool isLocked,
        uint256 unlockTime
    ) {
        StakeInfo storage info = stakes[user];
        amount = info.amount;
        stakedAt = info.stakedAt;
        pendingReward = earned(user);
        unlockTime = info.stakedAt + lockPeriod;
        isLocked = block.timestamp < unlockTime;
    }

    // ── Internal ───────────────────────────────────────────────────────────

    function _claimRewards(address user) internal {
        uint256 reward = earned(user);
        if (reward == 0) return;

        if (stakingToken.balanceOf(address(this)) < totalStaked + reward) {
            revert InsufficientContractBalance();
        }

        stakes[user].rewardDebt += reward;
        stakes[user].lastUpdate = block.timestamp;

        stakingToken.safeTransfer(user, reward);
        emit RewardsClaimed(user, reward);
    }

    // ── Admin ──────────────────────────────────────────────────────────────

    function setRewardRate(uint256 _rewardRateBPS) external onlyOwner {
        rewardRateBPS = _rewardRateBPS;
        emit ParametersUpdated(_rewardRateBPS, lockPeriod);
    }

    function setLockPeriod(uint256 _days) external onlyOwner {
        lockPeriod = _days * 1 days;
        emit ParametersUpdated(rewardRateBPS, lockPeriod);
    }

    function fundRewards(uint256 amount) external onlyOwner {
        stakingToken.safeTransferFrom(msg.sender, address(this), amount);
    }
}
```

## Contract: UDAYToken.sol (dependency)

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Burnable.sol";
import "@openzeppelin/contracts/access/Ownable2Step.sol";

/// @title UDAYToken — ERC-20 with capped supply
/// @author Uday Kumar BS
/// @notice Portfolio demonstration token for staking integration
contract UDAYToken is ERC20, ERC20Burnable, Ownable2Step {
    uint256 public constant MAX_SUPPLY = 1_000_000 * 10 ** 18; // 1M tokens

    event TokensMinted(address indexed to, uint256 amount);

    error ExceedsMaxSupply(uint256 requested, uint256 available);

    constructor(address initialOwner)
        ERC20("UDAY Token", "UDAY")
        Ownable(initialOwner)
    {
        // Mint 500k to deployer; reserve 500k for staking rewards
        _mint(initialOwner, 500_000 * 10 ** 18);
    }

    /// @notice Owner mints additional tokens up to MAX_SUPPLY
    function mint(address to, uint256 amount) external onlyOwner {
        uint256 available = MAX_SUPPLY - totalSupply();
        if (amount > available) revert ExceedsMaxSupply(amount, available);
        _mint(to, amount);
        emit TokensMinted(to, amount);
    }
}
```

## Tests: StakingRewards.test.js

```javascript
// test/StakingRewards.test.js
const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

describe("StakingRewards", function () {
  let token, staking, owner, alice, bob;
  const STAKE_AMOUNT = ethers.parseEther("1000");
  const REWARD_POOL  = ethers.parseEther("500000");

  beforeEach(async () => {
    [owner, alice, bob] = await ethers.getSigners();

    const Token = await ethers.getContractFactory("UDAYToken");
    token = await Token.deploy(owner.address);

    const Staking = await ethers.getContractFactory("StakingRewards");
    staking = await Staking.deploy(await token.getAddress(), owner.address, 1000, 7);

    // Fund staking rewards pool
    await token.mint(owner.address, REWARD_POOL);
    await token.approve(await staking.getAddress(), REWARD_POOL);
    await staking.fundRewards(REWARD_POOL);

    // Give alice & bob tokens
    await token.transfer(alice.address, ethers.parseEther("5000"));
    await token.transfer(bob.address,   ethers.parseEther("5000"));

    // Approve staking contract
    await token.connect(alice).approve(await staking.getAddress(), ethers.parseEther("5000"));
    await token.connect(bob).approve(await staking.getAddress(),   ethers.parseEther("5000"));
  });

  describe("Staking", () => {
    it("should allow staking above minimum", async () => {
      await staking.connect(alice).stake(STAKE_AMOUNT);
      const info = await staking.getStakeInfo(alice.address);
      expect(info.amount).to.equal(STAKE_AMOUNT);
    });

    it("should reject stake below minimum", async () => {
      await expect(staking.connect(alice).stake(ethers.parseEther("50")))
        .to.be.revertedWithCustomError(staking, "BelowMinimumStake");
    });

    it("should reject zero stake", async () => {
      await expect(staking.connect(alice).stake(0))
        .to.be.revertedWithCustomError(staking, "ZeroAmount");
    });

    it("should update totalStaked", async () => {
      await staking.connect(alice).stake(STAKE_AMOUNT);
      await staking.connect(bob).stake(STAKE_AMOUNT);
      expect(await staking.totalStaked()).to.equal(STAKE_AMOUNT * 2n);
    });
  });

  describe("Rewards", () => {
    it("should accrue rewards over time", async () => {
      await staking.connect(alice).stake(STAKE_AMOUNT);
      await time.increase(365 * 24 * 60 * 60); // 1 year
      const earned = await staking.earned(alice.address);
      // 10% APY on 1000 tokens = ~100 tokens
      expect(earned).to.be.closeTo(ethers.parseEther("100"), ethers.parseEther("1"));
    });

    it("should allow claiming rewards without unstaking", async () => {
      await staking.connect(alice).stake(STAKE_AMOUNT);
      await time.increase(30 * 24 * 60 * 60); // 30 days
      const before = await token.balanceOf(alice.address);
      await staking.connect(alice).claimRewards();
      const after = await token.balanceOf(alice.address);
      expect(after).to.be.gt(before);
    });

    it("should reset rewards after claim", async () => {
      await staking.connect(alice).stake(STAKE_AMOUNT);
      await time.increase(60 * 24 * 60 * 60);
      await staking.connect(alice).claimRewards();
      const earnedAfter = await staking.earned(alice.address);
      expect(earnedAfter).to.equal(0);
    });
  });

  describe("Unstaking", () => {
    it("should apply penalty before lock period", async () => {
      await staking.connect(alice).stake(STAKE_AMOUNT);
      const before = await token.balanceOf(alice.address);
      await staking.connect(alice).unstake(STAKE_AMOUNT);
      const after = await token.balanceOf(alice.address);
      const received = after - before;
      // Should receive less than staked (5% penalty)
      expect(received).to.be.lt(STAKE_AMOUNT);
    });

    it("should not apply penalty after lock period", async () => {
      await staking.connect(alice).stake(STAKE_AMOUNT);
      await time.increase(8 * 24 * 60 * 60); // 8 days (past 7-day lock)
      const before = await token.balanceOf(alice.address);
      await staking.connect(alice).unstake(STAKE_AMOUNT);
      const after = await token.balanceOf(alice.address);
      const received = after - before;
      expect(received).to.be.gte(STAKE_AMOUNT); // receives stake + rewards
    });

    it("should revert if nothing staked", async () => {
      await expect(staking.connect(bob).unstake(STAKE_AMOUNT))
        .to.be.revertedWithCustomError(staking, "NothingStaked");
    });
  });

  describe("Emergency Withdraw", () => {
    it("should always apply penalty", async () => {
      await staking.connect(alice).stake(STAKE_AMOUNT);
      await time.increase(30 * 24 * 60 * 60); // past lock
      const before = await token.balanceOf(alice.address);
      await staking.connect(alice).emergencyWithdraw();
      const after = await token.balanceOf(alice.address);
      // Should still take penalty even past lock
      expect(after - before).to.be.lt(STAKE_AMOUNT);
    });

    it("should clear stake info", async () => {
      await staking.connect(alice).stake(STAKE_AMOUNT);
      await staking.connect(alice).emergencyWithdraw();
      const info = await staking.getStakeInfo(alice.address);
      expect(info.amount).to.equal(0);
    });
  });
});
```
