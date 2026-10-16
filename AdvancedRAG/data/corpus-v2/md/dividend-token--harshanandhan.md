# dividend-token--harshanandhan

- domain: fungible-tokens (erc20-dividend)
- level: moderate
- origin: human
- convention: hardhat2-ethers6
- source: https://github.com/Harshanandhan/dividend-token @ 80add620c4516ddda19f253cad7c22eeb4124dfe
- license: MIT
- targets: DividendToken.sol
- validation: 33 passing tests, 0 failing; statement coverage DividendToken.sol 88.68 %

## Contract: DividendToken.sol (primary target)

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title DividendToken
 * @dev A mintable ERC-20 token with ETH dividend distribution and staking
 * 
 * Features:
 * - Mint tokens by depositing ETH (1 ETH = 1000 DTK)
 * - Burn tokens to redeem proportional ETH
 * - Stake tokens to earn ETH dividends
 * - Gas-optimized dividend distribution using a pull mechanism
 * 
 * @author Harsha Nandhan Reddy Gajulapalli (@Harshanandhan)
 */
contract DividendToken is ERC20, Ownable, ReentrancyGuard {
    // ============ Constants ============
    uint256 public constant TOKENS_PER_ETH = 1000;
    uint256 public constant MAGNITUDE = 2 ** 128;
    
    // ============ State Variables ============
    
    // Dividend tracking (gas-optimized using magnified dividends per share)
    uint256 public magnifiedDividendPerShare;
    mapping(address => int256) public magnifiedDividendCorrections;
    mapping(address => uint256) public withdrawnDividends;
    
    // Staking
    mapping(address => uint256) public stakedBalance;
    mapping(address => uint256) public stakeTimestamp;
    uint256 public totalStaked;
    uint256 public stakingRewardPool;
    
    // Tracking
    uint256 public totalDividendsDistributed;
    uint256 public reserveBalance; // ETH backing the minted tokens
    
    // ============ Events ============
    event TokensMinted(address indexed user, uint256 ethAmount, uint256 tokenAmount);
    event TokensBurned(address indexed user, uint256 tokenAmount, uint256 ethAmount);
    event DividendsDistributed(address indexed from, uint256 amount);
    event DividendWithdrawn(address indexed user, uint256 amount);
    event Staked(address indexed user, uint256 amount);
    event Unstaked(address indexed user, uint256 amount);
    event StakingRewardsClaimed(address indexed user, uint256 amount);
    
    // ============ Constructor ============
    constructor() ERC20("DividendToken", "DTK") Ownable(msg.sender) {}
    
    // ============ Minting & Burning ============
    
    /**
     * @dev Mint tokens by sending ETH. Rate: 1 ETH = 1000 DTK
     */
    function mint() external payable nonReentrant {
        require(msg.value > 0, "Must send ETH to mint");
        
        uint256 tokensToMint = msg.value * TOKENS_PER_ETH;
        reserveBalance += msg.value;
        
        _mint(msg.sender, tokensToMint);
        
        // Correct dividend tracking for new tokens
        magnifiedDividendCorrections[msg.sender] -= int256(magnifiedDividendPerShare * tokensToMint);
        
        emit TokensMinted(msg.sender, msg.value, tokensToMint);
    }
    
    /**
     * @dev Burn tokens to redeem proportional ETH from reserves
     * @param amount Number of tokens to burn
     */
    function burn(uint256 amount) external nonReentrant {
        require(amount > 0, "Amount must be greater than 0");
        require(balanceOf(msg.sender) >= amount, "Insufficient balance");
        
        // Calculate ETH to return (proportional to reserve)
        uint256 ethToReturn = (amount * reserveBalance) / totalSupply();
        require(ethToReturn > 0, "ETH amount too small");
        require(address(this).balance >= ethToReturn, "Insufficient contract balance");
        
        reserveBalance -= ethToReturn;
        
        // Correct dividend tracking before burning
        magnifiedDividendCorrections[msg.sender] += int256(magnifiedDividendPerShare * amount);
        
        _burn(msg.sender, amount);
        
        // Transfer ETH back to user
        (bool success, ) = payable(msg.sender).call{value: ethToReturn}("");
        require(success, "ETH transfer failed");
        
        emit TokensBurned(msg.sender, amount, ethToReturn);
    }
    
    // ============ Dividend Distribution ============
    
    /**
     * @dev Distribute ETH dividends to all token holders
     * Uses a gas-optimized pull mechanism - no loops required
     */
    function distributeDividends() external payable onlyOwner {
        require(msg.value > 0, "Must send ETH to distribute");
        require(totalSupply() > 0, "No tokens minted yet");
        
        magnifiedDividendPerShare += (msg.value * MAGNITUDE) / totalSupply();
        totalDividendsDistributed += msg.value;
        
        emit DividendsDistributed(msg.sender, msg.value);
    }
    
    /**
     * @dev Withdraw accumulated dividends
     */
    function withdrawDividends() external nonReentrant {
        uint256 withdrawable = withdrawableDividendOf(msg.sender);
        require(withdrawable > 0, "No dividends to withdraw");
        
        withdrawnDividends[msg.sender] += withdrawable;
        
        (bool success, ) = payable(msg.sender).call{value: withdrawable}("");
        require(success, "ETH transfer failed");
        
        emit DividendWithdrawn(msg.sender, withdrawable);
    }
    
    /**
     * @dev Calculate withdrawable dividends for an address
     */
    function withdrawableDividendOf(address account) public view returns (uint256) {
        return accumulativeDividendOf(account) - withdrawnDividends[account];
    }
    
    /**
     * @dev Calculate total accumulated dividends for an address
     */
    function accumulativeDividendOf(address account) public view returns (uint256) {
        int256 magnifiedDividends = int256(magnifiedDividendPerShare * balanceOf(account));
        int256 correctedDividends = magnifiedDividends + magnifiedDividendCorrections[account];
        
        // Ensure non-negative (can happen due to rounding)
        if (correctedDividends < 0) {
            return 0;
        }
        
        return uint256(correctedDividends) / MAGNITUDE;
    }
    
    // ============ Staking ============
    
    /**
     * @dev Stake tokens to earn additional rewards
     * @param amount Number of tokens to stake
     */
    function stake(uint256 amount) external nonReentrant {
        require(amount > 0, "Amount must be greater than 0");
        require(balanceOf(msg.sender) >= amount, "Insufficient balance");
        
        // Transfer tokens to contract (user must approve first)
        _transfer(msg.sender, address(this), amount);
        
        stakedBalance[msg.sender] += amount;
        stakeTimestamp[msg.sender] = block.timestamp;
        totalStaked += amount;
        
        emit Staked(msg.sender, amount);
    }
    
    /**
     * @dev Unstake tokens and claim any pending rewards
     */
    function unstake() external nonReentrant {
        uint256 staked = stakedBalance[msg.sender];
        require(staked > 0, "No tokens staked");
        
        // Calculate and distribute rewards first
        uint256 rewards = calculateStakingRewards(msg.sender);
        
        stakedBalance[msg.sender] = 0;
        stakeTimestamp[msg.sender] = 0;
        totalStaked -= staked;
        
        // Return staked tokens
        _transfer(address(this), msg.sender, staked);
        
        // Send rewards if available
        if (rewards > 0 && stakingRewardPool >= rewards) {
            stakingRewardPool -= rewards;
            (bool success, ) = payable(msg.sender).call{value: rewards}("");
            require(success, "Reward transfer failed");
            emit StakingRewardsClaimed(msg.sender, rewards);
        }
        
        emit Unstaked(msg.sender, staked);
    }
    
    /**
     * @dev Add ETH to the staking reward pool
     */
    function fundStakingRewards() external payable onlyOwner {
        require(msg.value > 0, "Must send ETH");
        stakingRewardPool += msg.value;
    }
    
    /**
     * @dev Calculate staking rewards based on time staked and amount
     * Simplified model: 0.01% per day of staked amount (capped by pool)
     */
    function calculateStakingRewards(address account) public view returns (uint256) {
        uint256 staked = stakedBalance[account];
        if (staked == 0) return 0;
        
        uint256 stakingDuration = block.timestamp - stakeTimestamp[account];
        uint256 daysStaked = stakingDuration / 1 days;
        
        // 0.01% per day = 1 basis point = staked * days / 10000
        uint256 rewards = (staked * daysStaked) / 10000;
        
        // Cap rewards to available pool
        return rewards > stakingRewardPool ? stakingRewardPool : rewards;
    }
    
    // ============ Override Transfer for Dividend Tracking ============
    
    function _update(address from, address to, uint256 value) internal override {
        super._update(from, to, value);
        
        // Update dividend corrections on transfer
        if (from != address(0) && to != address(0)) {
            int256 correction = int256(magnifiedDividendPerShare * value);
            magnifiedDividendCorrections[from] += correction;
            magnifiedDividendCorrections[to] -= correction;
        }
    }
    
    // ============ View Functions ============
    
    /**
     * @dev Get complete account info
     */
    function getAccountInfo(address account) external view returns (
        uint256 tokenBalance,
        uint256 staked,
        uint256 withdrawableDividends,
        uint256 totalDividendsEarned,
        uint256 pendingStakingRewards
    ) {
        return (
            balanceOf(account),
            stakedBalance[account],
            withdrawableDividendOf(account),
            accumulativeDividendOf(account),
            calculateStakingRewards(account)
        );
    }
    
    /**
     * @dev Get contract stats
     */
    function getContractStats() external view returns (
        uint256 _totalSupply,
        uint256 _totalStaked,
        uint256 _reserveBalance,
        uint256 _stakingRewardPool,
        uint256 _totalDividendsDistributed
    ) {
        return (
            totalSupply(),
            totalStaked,
            reserveBalance,
            stakingRewardPool,
            totalDividendsDistributed
        );
    }
    
    // ============ Receive ETH ============
    receive() external payable {
        // Accept ETH for dividends or rewards
    }
}
```

## Tests: DividendToken.test.js

```javascript
const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture } = require("@nomicfoundation/hardhat-network-helpers");

describe("DividendToken", function () {
  // Fixture to deploy the contract fresh for each test
  async function deployDividendTokenFixture() {
    const [owner, user1, user2, user3] = await ethers.getSigners();

    const DividendToken = await ethers.getContractFactory("DividendToken");
    const token = await DividendToken.deploy();

    return { token, owner, user1, user2, user3 };
  }

  // Helper: Allow small rounding errors in dividend calculations (up to 1000 wei)
  const ROUNDING_TOLERANCE = 1000n;

  function expectCloseTo(actual, expected, tolerance = ROUNDING_TOLERANCE) {
    const diff = actual > expected ? actual - expected : expected - actual;
    expect(diff).to.be.lessThanOrEqual(tolerance);
  }

  describe("Deployment", function () {
    it("Should set the right owner", async function () {
      const { token, owner } = await loadFixture(deployDividendTokenFixture);
      expect(await token.owner()).to.equal(owner.address);
    });

    it("Should have correct name and symbol", async function () {
      const { token } = await loadFixture(deployDividendTokenFixture);
      expect(await token.name()).to.equal("DividendToken");
      expect(await token.symbol()).to.equal("DTK");
    });

    it("Should start with zero supply", async function () {
      const { token } = await loadFixture(deployDividendTokenFixture);
      expect(await token.totalSupply()).to.equal(0);
    });
  });

  describe("Minting", function () {
    it("Should mint tokens when sending ETH", async function () {
      const { token, user1 } = await loadFixture(deployDividendTokenFixture);
      const ethAmount = ethers.parseEther("1");

      await token.connect(user1).mint({ value: ethAmount });

      // 1 ETH = 1000 tokens
      expect(await token.balanceOf(user1.address)).to.equal(
        ethers.parseEther("1000")
      );
    });

    it("Should update reserve balance on mint", async function () {
      const { token, user1 } = await loadFixture(deployDividendTokenFixture);
      const ethAmount = ethers.parseEther("2");

      await token.connect(user1).mint({ value: ethAmount });

      expect(await token.reserveBalance()).to.equal(ethAmount);
    });

    it("Should emit TokensMinted event", async function () {
      const { token, user1 } = await loadFixture(deployDividendTokenFixture);
      const ethAmount = ethers.parseEther("1");
      const expectedTokens = ethers.parseEther("1000");

      await expect(token.connect(user1).mint({ value: ethAmount }))
        .to.emit(token, "TokensMinted")
        .withArgs(user1.address, ethAmount, expectedTokens);
    });

    it("Should revert when sending zero ETH", async function () {
      const { token, user1 } = await loadFixture(deployDividendTokenFixture);

      await expect(token.connect(user1).mint({ value: 0 })).to.be.revertedWith(
        "Must send ETH to mint"
      );
    });

    it("Should allow multiple users to mint", async function () {
      const { token, user1, user2 } = await loadFixture(
        deployDividendTokenFixture
      );

      await token.connect(user1).mint({ value: ethers.parseEther("1") });
      await token.connect(user2).mint({ value: ethers.parseEther("2") });

      expect(await token.balanceOf(user1.address)).to.equal(
        ethers.parseEther("1000")
      );
      expect(await token.balanceOf(user2.address)).to.equal(
        ethers.parseEther("2000")
      );
      expect(await token.totalSupply()).to.equal(ethers.parseEther("3000"));
    });
  });

  describe("Burning", function () {
    it("Should burn tokens and return ETH", async function () {
      const { token, user1 } = await loadFixture(deployDividendTokenFixture);

      // Mint first
      await token.connect(user1).mint({ value: ethers.parseEther("1") });

      const balanceBefore = await ethers.provider.getBalance(user1.address);

      // Burn half
      const burnAmount = ethers.parseEther("500");
      const tx = await token.connect(user1).burn(burnAmount);
      const receipt = await tx.wait();
      const gasUsed = receipt.gasUsed * receipt.gasPrice;

      const balanceAfter = await ethers.provider.getBalance(user1.address);

      // Should receive 0.5 ETH back (minus gas)
      expect(balanceAfter + gasUsed - balanceBefore).to.be.closeTo(
        ethers.parseEther("0.5"),
        ethers.parseEther("0.001") // Allow small rounding
      );
    });

    it("Should emit TokensBurned event", async function () {
      const { token, user1 } = await loadFixture(deployDividendTokenFixture);

      await token.connect(user1).mint({ value: ethers.parseEther("1") });

      const burnAmount = ethers.parseEther("500");
      const expectedEth = ethers.parseEther("0.5");

      await expect(token.connect(user1).burn(burnAmount))
        .to.emit(token, "TokensBurned")
        .withArgs(user1.address, burnAmount, expectedEth);
    });

    it("Should revert when burning more than balance", async function () {
      const { token, user1 } = await loadFixture(deployDividendTokenFixture);

      await token.connect(user1).mint({ value: ethers.parseEther("1") });

      await expect(
        token.connect(user1).burn(ethers.parseEther("2000"))
      ).to.be.revertedWith("Insufficient balance");
    });

    it("Should revert when burning zero", async function () {
      const { token, user1 } = await loadFixture(deployDividendTokenFixture);

      await token.connect(user1).mint({ value: ethers.parseEther("1") });

      await expect(token.connect(user1).burn(0)).to.be.revertedWith(
        "Amount must be greater than 0"
      );
    });
  });

  describe("Dividend Distribution", function () {
    it("Should allow owner to distribute dividends", async function () {
      const { token, owner, user1 } = await loadFixture(
        deployDividendTokenFixture
      );

      await token.connect(user1).mint({ value: ethers.parseEther("1") });

      await expect(
        token.connect(owner).distributeDividends({ value: ethers.parseEther("1") })
      )
        .to.emit(token, "DividendsDistributed")
        .withArgs(owner.address, ethers.parseEther("1"));
    });

    it("Should track total dividends distributed", async function () {
      const { token, owner, user1 } = await loadFixture(
        deployDividendTokenFixture
      );

      await token.connect(user1).mint({ value: ethers.parseEther("1") });
      await token
        .connect(owner)
        .distributeDividends({ value: ethers.parseEther("1") });

      expect(await token.totalDividendsDistributed()).to.equal(
        ethers.parseEther("1")
      );
    });

    it("Should calculate withdrawable dividends correctly", async function () {
      const { token, owner, user1 } = await loadFixture(
        deployDividendTokenFixture
      );

      await token.connect(user1).mint({ value: ethers.parseEther("1") });
      await token
        .connect(owner)
        .distributeDividends({ value: ethers.parseEther("1") });

      const withdrawable = await token.withdrawableDividendOf(user1.address);
      // Allow for tiny rounding error due to MAGNITUDE division
      expectCloseTo(withdrawable, ethers.parseEther("1"));
    });

    it("Should split dividends proportionally", async function () {
      const { token, owner, user1, user2 } = await loadFixture(
        deployDividendTokenFixture
      );

      // User1 mints 1000 tokens, User2 mints 3000 tokens
      await token.connect(user1).mint({ value: ethers.parseEther("1") });
      await token.connect(user2).mint({ value: ethers.parseEther("3") });

      // Distribute 4 ETH
      await token
        .connect(owner)
        .distributeDividends({ value: ethers.parseEther("4") });

      // User1 should get 25%, User2 should get 75%
      const user1Dividends = await token.withdrawableDividendOf(user1.address);
      const user2Dividends = await token.withdrawableDividendOf(user2.address);
      
      expectCloseTo(user1Dividends, ethers.parseEther("1"));
      expectCloseTo(user2Dividends, ethers.parseEther("3"));
    });

    it("Should allow users to withdraw dividends", async function () {
      const { token, owner, user1 } = await loadFixture(
        deployDividendTokenFixture
      );

      await token.connect(user1).mint({ value: ethers.parseEther("1") });
      await token
        .connect(owner)
        .distributeDividends({ value: ethers.parseEther("1") });

      const balanceBefore = await ethers.provider.getBalance(user1.address);
      const tx = await token.connect(user1).withdrawDividends();
      const receipt = await tx.wait();
      const gasUsed = receipt.gasUsed * receipt.gasPrice;
      const balanceAfter = await ethers.provider.getBalance(user1.address);

      expect(balanceAfter + gasUsed - balanceBefore).to.be.closeTo(
        ethers.parseEther("1"),
        ethers.parseEther("0.001")
      );
    });

    it("Should revert when no dividends to withdraw", async function () {
      const { token, user1 } = await loadFixture(deployDividendTokenFixture);

      await token.connect(user1).mint({ value: ethers.parseEther("1") });

      await expect(token.connect(user1).withdrawDividends()).to.be.revertedWith(
        "No dividends to withdraw"
      );
    });

    it("Should not give dividends to new minters for past distributions", async function () {
      const { token, owner, user1, user2 } = await loadFixture(
        deployDividendTokenFixture
      );

      // User1 mints
      await token.connect(user1).mint({ value: ethers.parseEther("1") });

      // Dividends distributed
      await token
        .connect(owner)
        .distributeDividends({ value: ethers.parseEther("1") });

      // User2 mints AFTER distribution
      await token.connect(user2).mint({ value: ethers.parseEther("1") });

      // User1 should get all dividends
      const user1Dividends = await token.withdrawableDividendOf(user1.address);
      expectCloseTo(user1Dividends, ethers.parseEther("1"));
      
      // User2 should get none (or near zero due to rounding)
      const user2Dividends = await token.withdrawableDividendOf(user2.address);
      expect(user2Dividends).to.be.lessThanOrEqual(ROUNDING_TOLERANCE);
    });

    it("Should revert if non-owner tries to distribute", async function () {
      const { token, user1 } = await loadFixture(deployDividendTokenFixture);

      await token.connect(user1).mint({ value: ethers.parseEther("1") });

      await expect(
        token.connect(user1).distributeDividends({ value: ethers.parseEther("1") })
      ).to.be.revertedWithCustomError(token, "OwnableUnauthorizedAccount");
    });
  });

  describe("Transfers and Dividend Tracking", function () {
    it("Should transfer dividend rights with tokens", async function () {
      const { token, owner, user1, user2 } = await loadFixture(
        deployDividendTokenFixture
      );

      // User1 mints
      await token.connect(user1).mint({ value: ethers.parseEther("1") });

      // User1 transfers half to User2
      await token
        .connect(user1)
        .transfer(user2.address, ethers.parseEther("500"));

      // Distribute dividends
      await token
        .connect(owner)
        .distributeDividends({ value: ethers.parseEther("1") });

      // Both should get 50%
      const user1Dividends = await token.withdrawableDividendOf(user1.address);
      const user2Dividends = await token.withdrawableDividendOf(user2.address);
      
      expectCloseTo(user1Dividends, ethers.parseEther("0.5"));
      expectCloseTo(user2Dividends, ethers.parseEther("0.5"));
    });
  });

  describe("Staking", function () {
    it("Should allow staking tokens", async function () {
      const { token, user1 } = await loadFixture(deployDividendTokenFixture);

      await token.connect(user1).mint({ value: ethers.parseEther("1") });
      await token.connect(user1).stake(ethers.parseEther("500"));

      expect(await token.stakedBalance(user1.address)).to.equal(
        ethers.parseEther("500")
      );
      expect(await token.totalStaked()).to.equal(ethers.parseEther("500"));
    });

    it("Should emit Staked event", async function () {
      const { token, user1 } = await loadFixture(deployDividendTokenFixture);

      await token.connect(user1).mint({ value: ethers.parseEther("1") });

      await expect(token.connect(user1).stake(ethers.parseEther("500")))
        .to.emit(token, "Staked")
        .withArgs(user1.address, ethers.parseEther("500"));
    });

    it("Should allow unstaking", async function () {
      const { token, user1 } = await loadFixture(deployDividendTokenFixture);

      await token.connect(user1).mint({ value: ethers.parseEther("1") });
      await token.connect(user1).stake(ethers.parseEther("500"));
      await token.connect(user1).unstake();

      expect(await token.stakedBalance(user1.address)).to.equal(0);
      expect(await token.balanceOf(user1.address)).to.equal(
        ethers.parseEther("1000")
      );
    });

    it("Should revert staking with insufficient balance", async function () {
      const { token, user1 } = await loadFixture(deployDividendTokenFixture);

      await token.connect(user1).mint({ value: ethers.parseEther("1") });

      await expect(
        token.connect(user1).stake(ethers.parseEther("2000"))
      ).to.be.revertedWith("Insufficient balance");
    });

    it("Should revert unstaking with nothing staked", async function () {
      const { token, user1 } = await loadFixture(deployDividendTokenFixture);

      await expect(token.connect(user1).unstake()).to.be.revertedWith(
        "No tokens staked"
      );
    });
  });

  describe("View Functions", function () {
    it("Should return correct account info", async function () {
      const { token, owner, user1 } = await loadFixture(
        deployDividendTokenFixture
      );

      await token.connect(user1).mint({ value: ethers.parseEther("1") });
      await token.connect(user1).stake(ethers.parseEther("300"));
      await token
        .connect(owner)
        .distributeDividends({ value: ethers.parseEther("0.7") });

      const info = await token.getAccountInfo(user1.address);

      expect(info.tokenBalance).to.equal(ethers.parseEther("700"));
      expect(info.staked).to.equal(ethers.parseEther("300"));
      // stake() transfers tokens to the contract, so later dividends follow
      // the remaining balance (700/1000 of 0.7 ETH), not the original 1000.
      expectCloseTo(info.withdrawableDividends, ethers.parseEther("0.49"));
    });

    it("Should return correct contract stats", async function () {
      const { token, owner, user1, user2 } = await loadFixture(
        deployDividendTokenFixture
      );

      await token.connect(user1).mint({ value: ethers.parseEther("1") });
      await token.connect(user2).mint({ value: ethers.parseEther("2") });
      await token.connect(user1).stake(ethers.parseEther("500"));
      await token
        .connect(owner)
        .distributeDividends({ value: ethers.parseEther("1") });

      const stats = await token.getContractStats();

      expect(stats._totalSupply).to.equal(ethers.parseEther("3000"));
      expect(stats._totalStaked).to.equal(ethers.parseEther("500"));
      expect(stats._reserveBalance).to.equal(ethers.parseEther("3"));
      expect(stats._totalDividendsDistributed).to.equal(ethers.parseEther("1"));
    });
  });

  describe("Edge Cases", function () {
    it("Should handle very small mint amounts", async function () {
      const { token, user1 } = await loadFixture(deployDividendTokenFixture);

      const smallAmount = ethers.parseEther("0.001");
      await token.connect(user1).mint({ value: smallAmount });

      expect(await token.balanceOf(user1.address)).to.equal(
        ethers.parseEther("1") // 0.001 * 1000
      );
    });

    it("Should handle multiple dividend distributions", async function () {
      const { token, owner, user1 } = await loadFixture(
        deployDividendTokenFixture
      );

      await token.connect(user1).mint({ value: ethers.parseEther("1") });

      // Multiple distributions
      await token
        .connect(owner)
        .distributeDividends({ value: ethers.parseEther("0.5") });
      await token
        .connect(owner)
        .distributeDividends({ value: ethers.parseEther("0.3") });
      await token
        .connect(owner)
        .distributeDividends({ value: ethers.parseEther("0.2") });

      const withdrawable = await token.withdrawableDividendOf(user1.address);
      expectCloseTo(withdrawable, ethers.parseEther("1"));
    });

    it("Should allow partial dividend withdrawals", async function () {
      const { token, owner, user1 } = await loadFixture(
        deployDividendTokenFixture
      );

      await token.connect(user1).mint({ value: ethers.parseEther("1") });
      await token
        .connect(owner)
        .distributeDividends({ value: ethers.parseEther("1") });

      // Withdraw
      await token.connect(user1).withdrawDividends();

      // Try to withdraw again
      await expect(token.connect(user1).withdrawDividends()).to.be.revertedWith(
        "No dividends to withdraw"
      );

      // But new dividends should work
      await token
        .connect(owner)
        .distributeDividends({ value: ethers.parseEther("0.5") });
      
      const withdrawable = await token.withdrawableDividendOf(user1.address);
      expectCloseTo(withdrawable, ethers.parseEther("0.5"));
    });
  });

  describe("Security", function () {
    it("Should be protected against reentrancy on burn", async function () {
      // Note: Full reentrancy testing would require a malicious contract
      // This test verifies the function completes normally
      const { token, user1 } = await loadFixture(deployDividendTokenFixture);

      await token.connect(user1).mint({ value: ethers.parseEther("1") });
      await token.connect(user1).burn(ethers.parseEther("500"));

      expect(await token.balanceOf(user1.address)).to.equal(
        ethers.parseEther("500")
      );
    });

    it("Should be protected against reentrancy on dividend withdrawal", async function () {
      const { token, owner, user1 } = await loadFixture(
        deployDividendTokenFixture
      );

      await token.connect(user1).mint({ value: ethers.parseEther("1") });
      await token
        .connect(owner)
        .distributeDividends({ value: ethers.parseEther("1") });

      await token.connect(user1).withdrawDividends();

      const remaining = await token.withdrawableDividendOf(user1.address);
      expect(remaining).to.be.lessThanOrEqual(ROUNDING_TOLERANCE);
    });
  });
});
```
