# my-token--profadam

- domain: fungible-tokens (erc20-token)
- level: moderate
- origin: human
- convention: hardhat2-ethers6
- source: https://github.com/PROFADAM/defi-token @ 40cb9bd9c3c893ae178af63afae0ca1b9289337f
- license: MIT
- targets: MyToken.sol
- validation: 25 passing tests, 0 failing; statement coverage MyToken.sol 94.59 %

## Contract: MyToken.sol (primary target)

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Burnable.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title MyToken
 * @dev ERC20 Token with burn capability, ownership and staking functionality
 * @notice This is a DeFi token with staking rewards
 */
contract MyToken is ERC20, ERC20Burnable, Ownable, ReentrancyGuard {
    // Maximum supply cap
    uint256 public constant MAX_SUPPLY = 1000000 * 10**18; // 1 million tokens
    
    // Staking variables
    uint256 public rewardRate = 10; // 10% annual reward rate
    uint256 public constant REWARD_INTERVAL = 365 days; // Annual rewards
    
    // Staking data structure
    struct StakeInfo {
        uint256 amount;
        uint256 since;
        uint256 claimedRewards;
    }
    
    // Mapping of staker address to their staking info
    mapping(address => StakeInfo) public stakes;
    
    // Total staked amount
    uint256 public totalStaked;
    
    // Events
    event Staked(address indexed user, uint256 amount);
    event Unstaked(address indexed user, uint256 amount);
    event RewardPaid(address indexed user, uint256 reward);
    
    /**
     * @dev Constructor mints initial supply to deployer
     * @param initialSupply Initial amount of tokens to mint
     */
    constructor(uint256 initialSupply) ERC20("MyToken", "MTK") Ownable(msg.sender) {
        require(initialSupply <= MAX_SUPPLY, "Initial supply exceeds maximum");
        _mint(msg.sender, initialSupply);
    }
    
    /**
     * @dev Mint new tokens (only owner)
     * @param to Address to receive tokens
     * @param amount Amount of tokens to mint
     */
    function mint(address to, uint256 amount) public onlyOwner {
        require(totalSupply() + amount <= MAX_SUPPLY, "Would exceed max supply");
        _mint(to, amount);
    }
    
    /**
     * @dev Get remaining mintable supply
     * @return Amount of tokens that can still be minted
     */
    function remainingSupply() public view returns (uint256) {
        return MAX_SUPPLY - totalSupply();
    }
    
    /**
     * @notice Stake tokens to earn rewards
     * @param amount Amount of tokens to stake
     */
    function stake(uint256 amount) external nonReentrant {
        require(amount > 0, "Cannot stake 0 tokens");
        require(balanceOf(msg.sender) >= amount, "Insufficient balance");
        
        // Calculate rewards if already staking
        uint256 reward = 0;
        if (stakes[msg.sender].amount > 0) {
            reward = calculateReward(msg.sender);
        } else {
            // Initialize stake record if first time staking
            stakes[msg.sender].since = block.timestamp;
        }
        
        // Update state variables (CEI pattern)
        if (reward > 0) {
            stakes[msg.sender].claimedRewards += reward;
        }
        
        // Update stake amount
        stakes[msg.sender].amount += amount;
        totalStaked += amount;
        
        // External interactions after state changes
        if (reward > 0) {
            _mint(msg.sender, reward);
        }
        
        // Transfer tokens to contract
        _transfer(msg.sender, address(this), amount);
        
        emit Staked(msg.sender, amount);
    }
    
    /**
     * @notice Unstake tokens and claim rewards
     * @param amount Amount of tokens to unstake
     */
    function unstake(uint256 amount) external nonReentrant {
        require(amount > 0, "Cannot unstake 0 tokens");
        require(stakes[msg.sender].amount >= amount, "Insufficient staked amount");
        
        // Calculate rewards
        uint256 reward = calculateReward(msg.sender);
        
        // Update staking data - CEI (Checks-Effects-Interactions) pattern
        stakes[msg.sender].amount -= amount;
        totalStaked -= amount;
        
        // Reset staking timestamp if fully unstaked
        if (stakes[msg.sender].amount == 0) {
            stakes[msg.sender].since = 0;
        } else {
            stakes[msg.sender].since = block.timestamp;
        }
        
        // Update claimed rewards
        if (reward > 0) {
            stakes[msg.sender].claimedRewards += reward;
        }
        
        // External interactions after state changes (CEI pattern)
        if (reward > 0) {
            _mint(msg.sender, reward);
            emit RewardPaid(msg.sender, reward);
        }
        
        // Return staked tokens
        _transfer(address(this), msg.sender, amount);
        
        emit Unstaked(msg.sender, amount);
    }
    
    /**
     * @notice Claim staking rewards without unstaking
     */
    function claimRewards() external nonReentrant {
        StakeInfo storage stakeInfo = stakes[msg.sender];
        require(stakeInfo.amount > 0, "No staked tokens");
        
        uint256 reward = calculateReward(msg.sender);
        require(reward > 0, "No rewards to claim");
        
        // Update state variables first (CEI pattern)
        stakeInfo.since = block.timestamp;
        stakeInfo.claimedRewards += reward;
        
        // External interaction after state changes
        _mint(msg.sender, reward);
        
        emit RewardPaid(msg.sender, reward);
    }
    
    /**
     * @notice Calculate pending rewards for a staker
     * @param staker Address of the staker
     * @return Pending reward amount
     */
    function calculateReward(address staker) public view returns (uint256) {
        StakeInfo storage stakeInfo = stakes[staker];
        
        // Early return to save gas
        if (stakeInfo.amount == 0) {
            return 0;
        }
        
        uint256 stakingDuration = block.timestamp - stakeInfo.since;
        
        // Optimize calculation to reduce gas usage
        return (stakeInfo.amount * rewardRate * stakingDuration) / (REWARD_INTERVAL * 100);
    }
    
    /**
     * @notice Get staking information for an address
     * @param staker Address to query
     * @return Staked amount, staking timestamp, and claimed rewards
     */
    function getStakeInfo(address staker) external view returns (uint256, uint256, uint256) {
        return (
            stakes[staker].amount,
            stakes[staker].since,
            stakes[staker].claimedRewards
        );
    }
    
    /**
     * @notice Update reward rate (only owner)
     * @param newRate New annual reward rate percentage
     */
    function setRewardRate(uint256 newRate) external onlyOwner {
        require(newRate <= 100, "Rate cannot exceed 100%");
        rewardRate = newRate;
    }
}
```

## Tests: MyToken.test.js

```javascript
/**
 * Test suite for MyToken ERC20 contract with staking functionality
 */

const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

describe("MyToken Contract", function () {
  let myToken;
  let owner;
  let addr1;
  let addr2;
  const INITIAL_SUPPLY = ethers.parseEther("100000");
  const MAX_SUPPLY = ethers.parseEther("1000000");
  const ONE_YEAR = 365 * 24 * 60 * 60; // 365 days in seconds

  beforeEach(async function () {
    [owner, addr1, addr2] = await ethers.getSigners();
    const MyToken = await ethers.getContractFactory("MyToken");
    myToken = await MyToken.deploy(INITIAL_SUPPLY);
    await myToken.waitForDeployment();
  });

  describe("Deployment", function () {
    it("Should set the right owner", async function () {
      expect(await myToken.owner()).to.equal(owner.address);
    });

    it("Should assign the initial supply to the owner", async function () {
      const ownerBalance = await myToken.balanceOf(owner.address);
      expect(ownerBalance).to.equal(INITIAL_SUPPLY);
    });

    it("Should have correct name and symbol", async function () {
      expect(await myToken.name()).to.equal("MyToken");
      expect(await myToken.symbol()).to.equal("MTK");
    });

    it("Should have correct max supply", async function () {
      expect(await myToken.MAX_SUPPLY()).to.equal(MAX_SUPPLY);
    });
  });

  describe("Transfers", function () {
    it("Should transfer tokens between accounts", async function () {
      const amount = ethers.parseEther("100");
      await myToken.transfer(addr1.address, amount);
      expect(await myToken.balanceOf(addr1.address)).to.equal(amount);
    });

    it("Should fail if sender doesn't have enough tokens", async function () {
      const initialOwnerBalance = await myToken.balanceOf(owner.address);
      await expect(
        myToken.connect(addr1).transfer(owner.address, ethers.parseEther("1"))
      ).to.be.reverted;
      expect(await myToken.balanceOf(owner.address)).to.equal(initialOwnerBalance);
    });

    it("Should update balances after transfers", async function () {
      const amount = ethers.parseEther("100");
      await myToken.transfer(addr1.address, amount);
      await myToken.transfer(addr2.address, ethers.parseEther("50"));
      
      expect(await myToken.balanceOf(addr1.address)).to.equal(amount);
      expect(await myToken.balanceOf(addr2.address)).to.equal(ethers.parseEther("50"));
    });
  });

  describe("Minting", function () {
    it("Should allow owner to mint tokens", async function () {
      const mintAmount = ethers.parseEther("1000");
      await myToken.mint(addr1.address, mintAmount);
      expect(await myToken.balanceOf(addr1.address)).to.equal(mintAmount);
    });

    it("Should fail if non-owner tries to mint", async function () {
      await expect(
        myToken.connect(addr1).mint(addr1.address, ethers.parseEther("1000"))
      ).to.be.reverted;
    });

    it("Should not allow minting beyond max supply", async function () {
      const overMaxAmount = MAX_SUPPLY;
      await expect(myToken.mint(addr1.address, overMaxAmount)).to.be.revertedWith(
        "Would exceed max supply"
      );
    });

    it("Should correctly calculate remaining supply", async function () {
      const remaining = await myToken.remainingSupply();
      expect(remaining).to.equal(MAX_SUPPLY - INITIAL_SUPPLY);
    });
  });

  describe("Burning", function () {
    it("Should allow token holders to burn their tokens", async function () {
      const burnAmount = ethers.parseEther("100");
      await myToken.burn(burnAmount);
      expect(await myToken.balanceOf(owner.address)).to.equal(
        INITIAL_SUPPLY - burnAmount
      );
    });

    it("Should reduce total supply when burning", async function () {
      const burnAmount = ethers.parseEther("100");
      await myToken.burn(burnAmount);
      expect(await myToken.totalSupply()).to.equal(INITIAL_SUPPLY - burnAmount);
    });

    it("Should fail when burning more than balance", async function () {
      await expect(myToken.burn(INITIAL_SUPPLY + ethers.parseEther("1"))).to.be
        .reverted;
    });
  });

  describe("Ownership", function () {
    it("Should transfer ownership", async function () {
      await myToken.transferOwnership(addr1.address);
      expect(await myToken.owner()).to.equal(addr1.address);
    });

    it("Should prevent non-owners from transferring ownership", async function () {
      await expect(
        myToken.connect(addr1).transferOwnership(addr2.address)
      ).to.be.reverted;
    });
  });

  describe("Staking", function () {
    const stakeAmount = ethers.parseEther("1000");
    
    beforeEach(async function () {
      // Transfer tokens to addr1 for staking tests
      await myToken.transfer(addr1.address, ethers.parseEther("10000"));
    });

    it("Should allow users to stake tokens", async function () {
      await myToken.connect(addr1).stake(stakeAmount);
      
      const stakeInfo = await myToken.getStakeInfo(addr1.address);
      expect(stakeInfo[0]).to.equal(stakeAmount);
      expect(await myToken.totalStaked()).to.equal(stakeAmount);
    });

    it("Should not allow staking zero tokens", async function () {
      await expect(myToken.connect(addr1).stake(0)).to.be.revertedWith("Cannot stake 0 tokens");
    });

    it("Should not allow staking more than balance", async function () {
      const excessAmount = ethers.parseEther("20000");
      await expect(myToken.connect(addr1).stake(excessAmount)).to.be.revertedWith("Insufficient balance");
    });

    it("Should allow users to unstake tokens", async function () {
      await myToken.connect(addr1).stake(stakeAmount);
      await myToken.connect(addr1).unstake(stakeAmount);
      
      const stakeInfo = await myToken.getStakeInfo(addr1.address);
      expect(stakeInfo[0]).to.equal(0);
      expect(await myToken.totalStaked()).to.equal(0);
    });

    it("Should not allow unstaking more than staked", async function () {
      await myToken.connect(addr1).stake(stakeAmount);
      await expect(myToken.connect(addr1).unstake(stakeAmount * 2n)).to.be.reverted;
    });

    it("Should generate rewards after staking period", async function () {
      await myToken.connect(addr1).stake(stakeAmount);
      
      // Fast forward time by 6 months
      await time.increase(ONE_YEAR / 2);
      
      // Calculate expected reward (5% for half a year)
      const expectedReward = (stakeAmount * 5n) / 100n;
      
      // Check calculated reward
      const pendingReward = await myToken.calculateReward(addr1.address);
      expect(pendingReward).to.be.closeTo(expectedReward, ethers.parseEther("1"));
      
      // Claim rewards
      await myToken.connect(addr1).claimRewards();
      
      // Check claimed rewards
      const stakeInfo = await myToken.getStakeInfo(addr1.address);
      expect(stakeInfo[2]).to.be.closeTo(expectedReward, ethers.parseEther("1"));
    });

    it("Should allow owner to update reward rate", async function () {
      await myToken.setRewardRate(20);
      expect(await myToken.rewardRate()).to.equal(20);
    });

    it("Should not allow non-owner to update reward rate", async function () {
      await expect(myToken.connect(addr1).setRewardRate(20)).to.be.reverted;
    });

    it("Should not allow setting reward rate above 100%", async function () {
      await expect(myToken.setRewardRate(101)).to.be.revertedWith("Rate cannot exceed 100%");
    });
  });
});
```
