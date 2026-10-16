# liminal-staking-pool--mdantis-dev

- domain: staking-yield (staking)
- level: moderate
- origin: human
- convention: hardhat2-ethers6
- source: https://github.com/mdantis-dev/SOLIDITY-Liminal-Games @ 09a7484ac7f92e054eedc087b2d03431968e435b
- license: MIT
- targets: LiminalStakingPool.sol, LiminalToken.sol
- validation: 9 passing tests, 0 failing; statement coverage LiminalStakingPool.sol 86.79 %, LiminalToken.sol 44.44 %

## Contract: LiminalStakingPool.sol (primary target)

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";

/// @title Liminal Staking Pool (Shared Emissions, No Fees)
/// @notice Emission starts at 380,000 LIM/day, decaying linearly to 100,000 over 30 days
contract LiminalStakingPool is Ownable, AccessControl, ReentrancyGuard {
    bytes32 public constant POOL_LOADER_ROLE = keccak256("POOL_LOADER_ROLE");
    IERC20 public immutable limToken;

    // Emission parameters
    uint256 public constant EMISSION_START = 4398148148148148148; // 380k/day
    uint256 public constant EMISSION_END = 1157407407407407407;   // 100k/day
    uint256 public constant EMISSION_DURATION = 30 days;

    uint256 public immutable startTimestamp;
    uint256 public lastRewardTime;     // last timestamp the pool was updated
    uint256 public accRewardPerShare;  // accumulated reward-per-share, scaled by 1e12

    // Pool state
    uint256 public totalStaked;        // total tokens staked
    uint256 public rewardPool;         // funded rewards available

    struct StakeInfo {
        uint256 amount;       // how many tokens the user has staked
        uint256 rewardDebt;   // user.amount * accRewardPerShare
    }

    mapping(address => StakeInfo) public stakes;

    event RewardLoaded(uint256 amount);
    event Staked(address indexed user, uint256 amount);
    event Unstaked(address indexed user, uint256 amount);
    event Claimed(address indexed user, uint256 reward);

    /// @param _limToken Address of the LIM token
    constructor(address _limToken) Ownable(msg.sender) {
        require(_limToken != address(0), "Invalid token");
        limToken = IERC20(_limToken);
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);

        startTimestamp = block.timestamp;
        lastRewardTime  = block.timestamp;
    }

    /// @notice Loader deposits reward tokens into the pool
    function receiveRewardTokens(uint256 amount) external onlyRole(POOL_LOADER_ROLE) {
        require(amount > 0, "Zero amount");
        limToken.transferFrom(msg.sender, address(this), amount);
        rewardPool += amount;
        emit RewardLoaded(amount);
    }

    /// @notice Stake tokens to start earning
    function stake(uint256 amount) external nonReentrant {
        require(amount > 0, "Invalid amount");
        _updatePool();

        StakeInfo storage s = stakes[msg.sender];
        if (s.amount > 0) {
            uint256 pending = (s.amount * accRewardPerShare) / 1e12 - s.rewardDebt;
            if (pending > 0) {
                limToken.transfer(msg.sender, pending);
                emit Claimed(msg.sender, pending);
            }
        }

        limToken.transferFrom(msg.sender, address(this), amount);
        s.amount += amount;
        totalStaked += amount;
        s.rewardDebt = (s.amount * accRewardPerShare) / 1e12;
        emit Staked(msg.sender, amount);
    }

    /// @notice Unstake tokens and claim rewards
    function unstake(uint256 amount) external nonReentrant {
        require(amount > 0, "Amount must be greater than 0");
        StakeInfo storage s = stakes[msg.sender];
        require(amount > 0 && s.amount >= amount, "Invalid unstake");

        _updatePool();
        uint256 pending = (s.amount * accRewardPerShare) / 1e12 - s.rewardDebt;
        if (pending > 0) {
            limToken.transfer(msg.sender, pending);
            emit Claimed(msg.sender, pending);
        }

        s.amount       -= amount;
        totalStaked    -= amount;
        s.rewardDebt    = (s.amount * accRewardPerShare) / 1e12;

        limToken.transfer(msg.sender, amount);
        emit Unstaked(msg.sender, amount);
    }

    /// @notice Claim only rewards without unstaking
    function claim() external nonReentrant {
        _updatePool();
        StakeInfo storage s = stakes[msg.sender];
        uint256 pending = (s.amount * accRewardPerShare) / 1e12 - s.rewardDebt;
        require(pending > 0, "No reward");

        s.rewardDebt = (s.amount * accRewardPerShare) / 1e12;
        limToken.transfer(msg.sender, pending);
        emit Claimed(msg.sender, pending);
    }

    /// @dev Update pool accounting and distribute rewards
    function _updatePool() internal {
        if (block.timestamp <= lastRewardTime) return;
        uint256 elapsed = block.timestamp - lastRewardTime;
        if (totalStaked > 0) {
            uint256 reward = elapsed * currentRewardPerSecond();
            if (reward > rewardPool) {
                reward = rewardPool;
            }
            rewardPool -= reward;
            accRewardPerShare += (reward * 1e12) / totalStaked;
        }
        lastRewardTime = block.timestamp;
    }

    /// @notice View pending rewards for a user
    function pendingReward(address user) external view returns (uint256) {
        StakeInfo storage s = stakes[user];
        uint256 _acc = accRewardPerShare;
        if (block.timestamp > lastRewardTime && totalStaked > 0) {
            uint256 elapsed = block.timestamp - lastRewardTime;
            uint256 reward = elapsed * currentRewardPerSecond();
            if (reward > rewardPool) reward = rewardPool;
            _acc += (reward * 1e12) / totalStaked;
        }
        return (s.amount * _acc) / 1e12 - s.rewardDebt;
    }

    /// @notice Returns the staked amount for a given user
    function getStakedAmount(address user) external view returns (uint256 amount) {
        return stakes[user].amount;
    }

    /// @notice Computes the current emission rate per second, based on elapsed time since staking started.
    function currentRewardPerSecond() public view returns (uint256) {
        uint256 elapsed = block.timestamp - startTimestamp;
        if (elapsed >= EMISSION_DURATION) return EMISSION_END;

        uint256 diff = EMISSION_START - EMISSION_END;
        uint256 decayed = (diff * elapsed) / EMISSION_DURATION;
        return EMISSION_START - decayed;
    }

    /// @notice Manage loader role
    function grantLoaderRole(address account) external onlyOwner {
        grantRole(POOL_LOADER_ROLE, account);
    }

    function revokeLoaderRole(address account) external onlyOwner {
        revokeRole(POOL_LOADER_ROLE, account);
    }
}
```

## Contract: LiminalToken.sol (dependency)

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Votes.sol";
import "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/// @title Liminal Token (LIM)
/// @notice ERC20 token with on-chain governance voting, pausing, and burn functionality for the Liminal Games ecosystem.
contract LiminalToken is ERC20Votes, Pausable, Ownable {
    
    /// @notice Deploys the LIM token, mints 400M tokens to the deployer, and enables governance voting support.
    constructor() ERC20("Liminal Token", "LIM") EIP712("Liminal Token", "1") Ownable(msg.sender) {
        _mint(msg.sender, 400_000_000 * 10 ** decimals());
    }

    /// @notice Pauses all token transfers. Only callable by the owner.
    function pause() public onlyOwner {
        _pause();
    }

    /// @notice Unpauses token transfers. Only callable by the owner.
    function unpause() public onlyOwner {
        _unpause();
    }

    /// @notice Transfers tokens to another address when not paused.
    function transfer(address to, uint256 amount) public override whenNotPaused returns (bool) {
        return super.transfer(to, amount);
    }

    /// @notice Transfers tokens from a sender to a recipient when not paused.
    function transferFrom(address from, address to, uint256 amount) public override whenNotPaused returns (bool) {
        return super.transferFrom(from, to, amount);
    }

    /// @notice Burns tokens from the caller's wallet.
    function burn(uint256 amount) public {
        _burn(msg.sender, amount);
    }

    /// @notice Burns tokens from another address using allowance.
    function burnFrom(address from, uint256 amount) public {
        _spendAllowance(from, msg.sender, amount);
        _burn(from, amount);
    }

    /// @notice Internal function to update vote tracking on transfers.
    function _update(address from, address to, uint256 value) internal override(ERC20Votes) {
        super._update(from, to, value);
    }
}
```

## Tests: LiminalStakingPool.js

```javascript
const { loadFixture, time } = require("@nomicfoundation/hardhat-network-helpers");
const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("LiminalStakingPool – Emission Decay", function () {
  async function deployFixture() {
    const [owner, user1, user2, stranger] = await ethers.getSigners();

    // Deploy token
    const Token = await ethers.getContractFactory("LiminalToken");
    const lim = await Token.deploy();
    await lim.waitForDeployment();

    // Deploy staking pool
    const Pool = await ethers.getContractFactory("LiminalStakingPool");
    const pool = await Pool.deploy(await lim.getAddress());
    await pool.waitForDeployment();

    // Grant loader role and fund rewards
    const preload = ethers.parseUnits("40000000", 18);
    await pool.connect(owner).grantLoaderRole(owner.address);
    await lim.connect(owner).approve(pool.getAddress(), preload);
    await pool.connect(owner).receiveRewardTokens(preload);

    // Distribute LIM to users
    const stake1 = ethers.parseUnits("1000", 18);
    const stake2 = ethers.parseUnits("2000000", 18);
    await lim.transfer(user1.address, stake1);
    await lim.transfer(user2.address, stake2);

    return { owner, user1, user2, stranger, lim, pool, stake1, stake2 };
  }

  it("should only allow POOL_LOADER_ROLE to load rewards", async () => {
    const { stranger, lim, pool } = await loadFixture(deployFixture);
    const amt = ethers.parseUnits("100", 18);
    await lim.approve(await pool.getAddress(), amt);
    await expect(pool.connect(stranger).receiveRewardTokens(amt)).to.be.reverted;
  });

  it("should emit decaying rewards (12h stake)", async () => {
    const { user1, lim, pool, stake1 } = await loadFixture(deployFixture);
    await lim.connect(user1).approve(pool.getAddress(), stake1);
    await pool.connect(user1).stake(stake1);

    const seconds = 43200; // 12 hours
    await time.increase(seconds);
    await ethers.provider.send("evm_mine");

    const rps = await pool.currentRewardPerSecond();
    const expected = rps * BigInt(seconds);
    const pending = await pool.pendingReward(user1.address);
    const tolerance = ethers.parseUnits("20", 18);

    console.log("⏱ Elapsed:", seconds);
    console.log("📈 RPS:", rps.toString());
    console.log("💰 Expected:", expected.toString());
    console.log("🧾 Pending:", pending.toString());

    expect(pending).to.be.closeTo(expected, tolerance);
  });

  it("should split rewards between multiple users proportionally", async () => {
    const { user1, user2, lim, pool, stake1, stake2 } = await loadFixture(deployFixture);

    await lim.connect(user1).approve(pool.getAddress(), stake1);
    await pool.connect(user1).stake(stake1);

    await lim.connect(user2).approve(pool.getAddress(), stake2);
    await pool.connect(user2).stake(stake2);

    await time.increase(86400); // 1 day
    await ethers.provider.send("evm_mine");

    const p1 = await pool.pendingReward(user1.address);
    const p2 = await pool.pendingReward(user2.address);

    const totalPending = p1 + p2;
    const expectedRatio1 = (stake1 * 10000n) / (stake1 + stake2); // basis points (10000 = 100%)
    const actualRatio1 = (p1 * 10000n) / totalPending;

    console.log("🧑‍🌾 User1 pending:", p1.toString());
    console.log("🧑‍🌾 User2 pending:", p2.toString());
    console.log("📊 Expected User1 ratio (bps):", expectedRatio1.toString());
    console.log("📐 Actual User1 ratio (bps):", actualRatio1.toString());

    expect(actualRatio1).to.be.closeTo(expectedRatio1, 50); // 0.5% tolerance
  });

  it("should reward early stakers more under decaying emissions", async () => {
    const { user1, user2, lim, pool } = await loadFixture(deployFixture);
    const amt = ethers.parseUnits("100", 18);

    await lim.connect(user1).approve(pool.getAddress(), amt);
    await pool.connect(user1).stake(amt);

    await time.increase(12 * 3600); // 12h
    await lim.connect(user2).approve(pool.getAddress(), amt);
    await pool.connect(user2).stake(amt);

    await time.increase(12 * 3600); // another 12h
    await ethers.provider.send("evm_mine");

    const pending1 = await pool.pendingReward(user1.address);
    const pending2 = await pool.pendingReward(user2.address);
    const total = pending1 + pending2;

    const percent1 = (pending1 * 10000n) / total;
    const percent2 = (pending2 * 10000n) / total;

    console.log("User1 Share:", Number(percent1) / 100, "%");
    console.log("User2 Share:", Number(percent2) / 100, "%");

    expect(percent1).to.be.greaterThan(percent2); // User1 should earn more
  });

  it("should decay emission rate over time (day 1 vs day 30)", async () => {
    const { pool } = await loadFixture(deployFixture);

    const rpsDay0 = await pool.currentRewardPerSecond();
    await time.increase(30 * 86400); // 30 days
    await ethers.provider.send("evm_mine");

    const rpsDay30 = await pool.currentRewardPerSecond();

    const expectedEnd = BigInt("1157407407407407407");
    const tolerance = BigInt("10000000000000000"); // 0.01 LIM

    console.log("📊 RPS Day 0:", rpsDay0.toString());
    console.log("📉 RPS Day 30:", rpsDay30.toString());

    expect(rpsDay30).to.be.closeTo(expectedEnd, tolerance);
  });

  it("should not go below EMISSION_END after 30 days", async () => {
    const { pool } = await loadFixture(deployFixture);
    await time.increase(45 * 86400); // advance 45 days
    const rps = await pool.currentRewardPerSecond();

    const expectedEnd = BigInt("1157407407407407407");
    expect(rps).to.equal(expectedEnd);
  });

  it("should fully drain the reward pool over time without reverts", async () => {
    const { user1, lim, pool } = await loadFixture(deployFixture);

    const stakeAmt = ethers.parseUnits("1000", 18);
    await lim.connect(user1).approve(pool.getAddress(), stakeAmt);
    await pool.connect(user1).stake(stakeAmt);

    let lastPending = 0n;
    let totalClaimed = 0n;

    for (let i = 0; i < 400; i++) {
      await time.increase(86400); // 1 day
      await ethers.provider.send("evm_mine");

      const pending = await pool.pendingReward(user1.address);
      const poolBal = await lim.balanceOf(pool.getAddress());

      console.log(`📅 Day ${i + 1}: Pending = ${pending}, Pool = ${poolBal}`);

      if (pending > 0n) {
        await pool.connect(user1).claim();
        totalClaimed += pending;
      }

      if (poolBal < ethers.parseUnits("0.0001", 18)) {
        console.log("🎯 Pool drained.");
        break;
      }

      lastPending = pending;
    }

    const finalPool = await lim.balanceOf(pool.getAddress());
    expect(finalPool).to.be.lte(ethers.parseUnits("1001", 18));

    console.log("✅ Final Pool:", finalPool.toString());
    console.log("✅ Total Claimed:", totalClaimed.toString());
  });

  it("should emit Claimed and Unstaked events on full unstake", async () => {
    const { user1, lim, pool, stake1 } = await loadFixture(deployFixture);

    await lim.connect(user1).approve(pool.getAddress(), stake1);
    await pool.connect(user1).stake(stake1);

    await time.increase(86400);

    await expect(pool.connect(user1).unstake(stake1))
      .to.emit(pool, "Claimed")
      .and.to.emit(pool, "Unstaked");
  });

  it("should correctly split rewards when User2 stakes later with more weight", async () => {
    const { user1, user2, lim, pool } = await loadFixture(deployFixture);

    const stake1 = ethers.parseUnits("1000", 18);
    const stake2 = ethers.parseUnits("2000", 18);

    // User1 stakes on Day 0
    await lim.connect(user1).approve(pool.getAddress(), stake1);
    await pool.connect(user1).stake(stake1);

    // ⏩ Advance 1 day
    await time.increase(86400);
    await ethers.provider.send("evm_mine");

    // User2 stakes on Day 1
    await lim.connect(user2).approve(pool.getAddress(), stake2);
    await pool.connect(user2).stake(stake2);

    // ⏩ Advance another day
    await time.increase(86400);
    await ethers.provider.send("evm_mine");

    // Collect pending rewards
    const p1 = await pool.pendingReward(user1.address);
    const p2 = await pool.pendingReward(user2.address);

    const total = p1 + p2;
    const actualUser1Bps = (p1 * 10000n) / total; // basis points (1/100 of %)

    // Expected:
    // - Day 1: User1 gets 100%
    // - Day 2: User1 gets 1/3, User2 gets 2/3
    // => User1 total = 1 + 1/3 = 4/3
    // => Total = 2
    // => Ratio = (4/3) / 2 = 2/3 = 6666.66 bps
    const expectedUser1Bps = 6667n;

    console.log("🧑‍🌾 User1 pending:", p1.toString());
    console.log("🧑‍🌾 User2 pending:", p2.toString());
    console.log("📊 Expected User1 ratio (bps):", expectedUser1Bps.toString());
    console.log("📐 Actual User1 ratio (bps):", actualUser1Bps.toString());

    expect(actualUser1Bps).to.be.closeTo(expectedUser1Bps, 50); // now ±0.5%
  });
});
```
