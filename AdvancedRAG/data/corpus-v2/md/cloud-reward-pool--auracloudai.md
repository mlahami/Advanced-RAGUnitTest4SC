# cloud-reward-pool--auracloudai

- domain: staking-yield (staking)
- level: complex
- origin: human
- convention: hardhat2-ethers6
- source: https://github.com/AuraCloudAI/contracts @ 3311746b47d358ff6f26f19e3297978b3e9a9032
- license: MIT
- targets: CloudRewardPool.sol, CloudStakeVault.sol, CloudToken.sol
- validation: 22 passing tests, 0 failing; statement coverage CloudRewardPool.sol 94.44 %, CloudStakeVault.sol 45.95 %, CloudToken.sol 25.0 %

## Contract: CloudRewardPool.sol (primary target)

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

// Author: CloudAI Dev Team
// Developed by @BullBoss5

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol"; 
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";

interface ICloudStakeVault {
    function getDepositedBalance(address _user)     external view returns (uint256);
    function getLastActivityTime(address _user)      external view returns (uint256);
}

contract CloudRewardPool is Ownable, ReentrancyGuard, Pausable {
    using SafeERC20 for IERC20;

    IERC20 public immutable cloudToken;
    ICloudStakeVault public cloudStakeVault;
    address public cloudStaking;
    uint256 public rugDetectionApr;
    mapping(address => uint256) public lastRewardClaimTimes;

    event StakingContractUpdated    (address newStakingContract);
    event StakeVaultContractUpdated (address newCloudStakeVault);
    event RewardsDistributed        (address indexed recipient, uint256 amount);
    event RewardsDeposited          (address indexed depositor, uint256 amount);
    event rugDetectionAprUpdated    (uint256 newRugDetectionApr);

    constructor(address _cloudToken, address _cloudStaking, address _cloudStakeVault, uint256 _rugDetectionApr) Ownable(msg.sender) {
        require(_cloudToken != address(0),          "Invalid token address");
        require(_cloudStaking != address(0),        "Invalid staking contract address");
        require(_cloudStakeVault != address(0),     "Invalid stake vault address");
        require(_rugDetectionApr <= 50,             "APR limit must be smaller than 50");

        cloudToken      = IERC20(_cloudToken);
        cloudStakeVault = ICloudStakeVault(_cloudStakeVault);
        cloudStaking    = _cloudStaking;
        rugDetectionApr = _rugDetectionApr;
    }


    // ============================================
    // VIEW FUNCTIONS
    // ============================================


    function getRewardBalance()                                                                 external view returns (uint256) {
        return cloudToken.balanceOf(address(this));
    }


    // ============================================
    // INTERNAL FUNCTIONS
    // ============================================


    function _secureRewardThreshold     (address _recipient)                                    internal view returns (uint256) {
        uint256 totalStaked = cloudStakeVault.getDepositedBalance(_recipient);
        require(totalStaked > 0, "No tokens staked");

        uint256 lastActivityTime = cloudStakeVault.getLastActivityTime(_recipient);
        uint256 lastClaimTime   = lastRewardClaimTimes[_recipient];
        uint256 lastActionTime  = lastActivityTime > lastClaimTime ? lastActivityTime : lastClaimTime; // Determine the last action time (either the last deposit or the last reward claim)
        require(lastActionTime > 0, "No action time");

        uint256 elapsedTime = block.timestamp - lastActionTime;
        return (totalStaked * elapsedTime * (rugDetectionApr)) / (365 days * 100) * 1001 / 1000; // add 0.1% margin
    }


    // ============================================
    // PUBLIC FUNCTIONS
    // ============================================


    function setStakingContract         (address _newCloudStaking)                              external onlyOwner {
        require(_newCloudStaking != address(0),     "Invalid staking contract address");

        cloudStaking = _newCloudStaking;
        
        emit StakingContractUpdated(_newCloudStaking);
    }

    function setCloudStakeVault         (address _newCloudStakeVault)                           external onlyOwner {
        require(_newCloudStakeVault != address(0), "Invalid stake vault address");

        cloudStakeVault = ICloudStakeVault(_newCloudStakeVault);

        emit StakeVaultContractUpdated(_newCloudStakeVault);
    }

    function setRugDetectionApr         (uint256 _newRugDetectionApr)                           external onlyOwner {
        require(_newRugDetectionApr <= 50,      "APR must not exceed 50");

        rugDetectionApr = _newRugDetectionApr;

        emit rugDetectionAprUpdated(_newRugDetectionApr);
    }

    function depositRewards             (uint256 _amount)                                       external whenNotPaused {
        require(_amount > 0,           "Amount must be greater than zero");

        cloudToken.safeTransferFrom(msg.sender, address(this), _amount);

        emit RewardsDeposited(msg.sender, _amount);
    }

    function distributeRewards          (address _recipient, uint256 _rewardAmount)             external nonReentrant whenNotPaused{
        require(msg.sender == cloudStaking,                             "Only staking contract can distribute rewards");
        require(_recipient != address(0),                               "Invalid recipient address");
        require(_rewardAmount > 0,                                      "Amount must be greater than zero");
        require(cloudToken.balanceOf(address(this)) >= _rewardAmount,   "Insufficient rewards");

        uint256 entitledRewards = _secureRewardThreshold(_recipient);
        require(_rewardAmount < entitledRewards, "Requested amount exceeds entitled rewards"); // Ensure the requested reward amount does not exceed the rugDetectionApr

        lastRewardClaimTimes[_recipient] = block.timestamp;

        cloudToken.safeTransfer(_recipient, _rewardAmount);

        emit RewardsDistributed(_recipient, _rewardAmount);
    }

    function recoverMistakenTokens      (address _token, address _recipient, uint256 _amount)   external onlyOwner {
        require(_token != address(cloudToken),  "Cannot withdraw staking token");
        require(_recipient != address(0),       "Invalid recipient address");


        IERC20(_token).safeTransfer(_recipient, _amount);
    }

    function pause                      ()                                                      external onlyOwner {
        _pause();
    }

    function unpause                    ()                                                      external onlyOwner {
        _unpause();
    }

    receive()                                                                                   external payable {
        revert("Direct ETH transfers not allowed");
    }

    fallback()                                                                                  external payable {
        revert("ETH deposits not allowed");
    }
}
```

## Contract: CloudStakeVault.sol (dependency)

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

// Author: CloudAI Dev Team
// Developed by @BullBoss5

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";

interface ICloudStaking {
    function handleInactivityOne(address stakerAddr)        external;
}

contract CloudStakeVault is Ownable, ReentrancyGuard, Pausable {
    using SafeERC20 for IERC20;

    IERC20 public immutable cloudToken;
    ICloudStaking    public cloudStaking;
    uint256 public constant EMERGENCY_COOLDOWN = 30 days;

    mapping(address => uint256) private userDeposits;
    mapping(address => uint256) private lastActivityTimes;
    mapping(address => uint256) private emergencyWithdrawRequests;
    mapping(address => uint256) private emergencyWithdrawAmounts;

    event StakingContractAddressUpdated     (address oldCloudStaking, address newCloudStaking);
    event Deposited                         (address indexed user, uint256 amount);
    event Withdrawn                         (address indexed user, uint256 amount);
    event EmergencyWithdrawRequested        (address indexed user, uint256 timestamp);
    event EmergencyWithdrawn                (address indexed user, uint256 amount);

    constructor(address _cloudToken, address _cloudStaking) Ownable(msg.sender) {
        require(_cloudToken   != address(0),    "Invalid token address");
        require(_cloudStaking != address(0),    "Invalid staking address");

        cloudToken             = IERC20(_cloudToken);
        cloudStaking           = ICloudStaking(_cloudStaking);
    }

    modifier onlyStakingContract() {
        require(msg.sender == address(cloudStaking), "Only CloudStaking can call this function");
        _;
    }


    // ============================================
    // VIEW FUNCTIONS
    // ============================================


    function getDepositedBalance(address user)                                          external view returns (uint256) {
        return userDeposits[user];
    }

    function getLastActivityTime(address user)                                           external view returns (uint256) {
        return lastActivityTimes[user];
    }

    function getEmergencyWithdrawalInfo(address user)
        external
        view
        returns (
            bool requested,
            uint256 requestTime,
            uint256 pendingAmount,
            bool claimable
        )
    {
        requestTime   = emergencyWithdrawRequests[user];
        pendingAmount = emergencyWithdrawAmounts[user];
        requested     = requestTime > 0;
        claimable     = requested && (block.timestamp >= requestTime + EMERGENCY_COOLDOWN);
    }


    // ============================================
    // PUBLIC FUNCTIONS
    // ============================================

    function setStakingContract(address _newCloudStaking)                               external onlyOwner {
        require(_newCloudStaking != address(0),               "Invalid address");
        require(_newCloudStaking != address(cloudStaking),    "Same address already set");

        address oldCloudStaking     = address(cloudStaking);
        cloudStaking                = ICloudStaking(_newCloudStaking);

        emit StakingContractAddressUpdated(oldCloudStaking, _newCloudStaking);
    }

    function deposit(address user, uint256 amount)                                      external onlyStakingContract whenNotPaused nonReentrant {
        require(user != address(0),                     "Invalid user address");
        require(emergencyWithdrawRequests[user] == 0,   "Cannot deposit during emergency withdrawal request");
        require(amount > 0,                             "Amount must be greater than zero");

        cloudToken.safeTransferFrom(user, address(this), amount);

        userDeposits[user]        += amount;
        lastActivityTimes[user]     = block.timestamp;

        emit Deposited(user, amount);
    }

    function withdraw(address user, uint256 amount)                                     external onlyStakingContract whenNotPaused nonReentrant {
        require(user != address(0),                     "Invalid user address");
        require(emergencyWithdrawRequests[user] == 0,   "Cannot withdraw during emergency withdrawal request");
        require(amount > 0,                             "Amount must be greater than zero");
        require(userDeposits[user] >= amount,           "Insufficient user balance");

        userDeposits[user]        -= amount;
        lastActivityTimes[user]     = block.timestamp;
        if(userDeposits[user] == 0) {
            delete userDeposits[user];
            delete lastActivityTimes[user];
        }

        cloudToken.safeTransfer(user, amount);

        emit Withdrawn(user, amount);
    }

    function emergencyWithdraw()                                                        external {
        require(emergencyWithdrawRequests[msg.sender] == 0,     "Already requested");
        require(userDeposits[msg.sender] > 0,                   "No funds to withdraw");

        emergencyWithdrawAmounts[msg.sender]  = userDeposits[msg.sender];
        userDeposits[msg.sender]              = 0;
        emergencyWithdrawRequests[msg.sender] = block.timestamp;

        try cloudStaking.handleInactivityOne(msg.sender) { } catch { } // notify CloudStaking

        emit EmergencyWithdrawRequested(msg.sender, block.timestamp);
    }

    function claimEmergencyWithdraw()                                                   external nonReentrant {
        require(emergencyWithdrawRequests[msg.sender] > 0,                                      "No pending emergency withdrawal");
        require(block.timestamp >= emergencyWithdrawRequests[msg.sender] + EMERGENCY_COOLDOWN,  "Emergency cooldown not finished");

        uint256 amount = emergencyWithdrawAmounts[msg.sender];
        require(amount > 0, "No fund to withdraw");

        delete emergencyWithdrawAmounts[msg.sender];
        delete emergencyWithdrawRequests[msg.sender];
        delete userDeposits[msg.sender];
        delete lastActivityTimes[msg.sender];

        cloudToken.safeTransfer(msg.sender, amount);

        emit EmergencyWithdrawn(msg.sender, amount);
    }

    function pause()                                                                    external onlyOwner {
        _pause();
    }

    function unpause()                                                                  external onlyOwner {
        _unpause();
    }

    function recoverMistakenTokens(address _token, address _recipient, uint256 _amount) external onlyOwner {
        require(_token != address(cloudToken),  "Cannot withdraw staking token");
        require(_recipient != address(0),       "Invalid recipient address");

        IERC20(_token).safeTransfer(_recipient, _amount);
    }
    
    receive()                                                                           external payable {
        revert("Direct ETH transfers not allowed");
    }

    fallback()                                                                          external payable {
        revert("ETH deposits not allowed");
    }
}
```

## Contract: CloudToken.sol (dependency)

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

contract CloudToken is ERC20, Ownable {
	uint256 private immutable _cap = 1_000_000_000 * 10 ** 18; // 1 Billion CLOUD (Fixed Supply)

	constructor() ERC20("CloudAI", "CLOUD") Ownable(msg.sender) {
		_mint(msg.sender, _cap);
	}

	// ✅ Public Burn Function (Users can burn their tokens)
	function burn(uint256 amount) public {
		_burn(msg.sender, amount);
	}

	// 🚫 Block ETH from being sent to the contract
	receive() external payable {
		revert("CLOUD does not accept ETH");
	}

	fallback() external payable {
		revert("CLOUD does not accept ETH");
	}

	// 🚀 Final Step: Renounce Ownership (Fully Decentralized)
	function renounceOwnership() public override onlyOwner {
		_transferOwnership(address(0)); // Makes contract ownerless
	}
}
```

## Tests: CloudRewardPool.test.js

```javascript
const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("CloudRewardPool", function () {
  let CloudToken, cloudToken, CloudStakeVault, cloudStakeVault, CloudRewardPool, cloudRewardPool, cloudStaking, OtherToken, otherToken;
  let owner, user1, user2;

  beforeEach(async function () {
    [owner, cloudStaking, user1, user2] = await ethers.getSigners();

    // CloudToken
    CloudToken = await ethers.getContractFactory("CloudToken");
    cloudToken = await CloudToken.deploy();
    await cloudToken.waitForDeployment();

    // CloudStakeVault
    CloudStakeVault = await ethers.getContractFactory("CloudStakeVault");
    cloudStakeVault = await CloudStakeVault.deploy(await cloudToken.getAddress(), await cloudStaking.getAddress());
    await cloudStakeVault.waitForDeployment();
    
    // CloudRewardPool
    CloudRewardPool = await ethers.getContractFactory("CloudRewardPool");
    cloudRewardPool = await CloudRewardPool.deploy(
      await cloudToken.getAddress(),
      await cloudStaking.getAddress(),
      await cloudStakeVault.getAddress(),
      10 // rugDetectionApr
    );

    // otherToken (for mistaken recovery test)
    OtherToken = await ethers.getContractFactory("CloudToken");
    otherToken = await OtherToken.deploy();
    await otherToken.waitForDeployment();
    
  });

  it("Should set correct initial values", async function () {
    expect(await cloudRewardPool.cloudToken()).to.equal(await cloudToken.getAddress());
    expect(await cloudRewardPool.cloudStaking()).to.equal(await cloudStaking.getAddress());
    expect(await cloudRewardPool.cloudStakeVault()).to.equal(await cloudStakeVault.getAddress());
    expect(await cloudRewardPool.rugDetectionApr()).to.equal(10);
  });

  it("Should allow owner to set a new staking contract", async function () {
    await cloudRewardPool.setStakingContract(await user1.getAddress());
    expect(await cloudRewardPool.cloudStaking()).to.equal(await user1.getAddress());
  });

  it("Should NOT allow non-owner to set a new staking contract", async function () {
      await expect(cloudRewardPool.connect(user1).setStakingContract(await user2.getAddress())).to.be.reverted;
  });

  it("Should allow owner to set a new stake vault contract", async function () {
    await cloudRewardPool.setCloudStakeVault(await user1.getAddress());
    expect(await cloudRewardPool.cloudStakeVault()).to.equal(await user1.getAddress());
  });

  it("Should NOT allow non-owner to set a new stake vault contract", async function () {
      await expect(cloudRewardPool.connect(user1).setCloudStakeVault(await user2.getAddress())).to.be.reverted;
  });

  it("Should allow owner to set a new rug detection APR", async function () {
    await cloudRewardPool.setRugDetectionApr(11);
    expect(await cloudRewardPool.rugDetectionApr()).to.equal(11);
  });

  it("Should NOT allow non-owner to set a new rug detection APR", async function () {
    await expect(cloudRewardPool.connect(user1).setRugDetectionApr(11)).to.be.reverted;
  });

  it("Should pause and unpause the contract", async function () {
    await cloudRewardPool.pause();
    await expect(cloudRewardPool.depositRewards(ethers.parseEther("10"))).to.be.reverted;
    
    await cloudRewardPool.unpause();
    await cloudToken.approve(await cloudRewardPool.getAddress(), ethers.parseEther("10"));
    await expect(cloudRewardPool.depositRewards(ethers.parseEther("10"))).to.not.be.reverted;
  });

  it("Should NOT allow non-owner to pause or unpause the contract", async function () {
      await expect(cloudRewardPool.connect(user1).pause()).to.be.reverted;

      await cloudRewardPool.pause();
      await expect(cloudRewardPool.connect(user1).unpause()).to.be.reverted;
  });

  it("Should allow owner to recover mistaken tokens", async function () {
    const depositAmount = ethers.parseEther("150");
    await otherToken.transfer(await cloudRewardPool.getAddress(), depositAmount);
    await expect( cloudRewardPool.connect(owner).recoverMistakenTokens( await otherToken.getAddress(), await user1.getAddress(), depositAmount)).to.not.be.reverted;
    expect(await otherToken.balanceOf(await user1.getAddress())).to.equal(depositAmount);
  });

  it("Should not allow to recover CLOUD token", async function () {
    const depositAmount = ethers.parseEther("150");
    await expect(
      cloudRewardPool.connect(owner).recoverMistakenTokens(await cloudToken.getAddress(), await owner.getAddress(), depositAmount)
    ).to.be.revertedWith("Cannot withdraw staking token");
  });

  it("Should not allow non-owner to recover tokens", async function () {
    const depositAmount = ethers.parseEther("150");
    await otherToken.transfer(await cloudRewardPool.getAddress(), depositAmount);
    await expect(
      cloudRewardPool.connect(user1).recoverMistakenTokens(
        await otherToken.getAddress(),
        await user1.getAddress(),
        depositAmount
      )
    ).to.be.reverted;
  });

  it("Should reject direct ETH transfers", async function () {
    await expect(
        user1.sendTransaction({ to: cloudRewardPool.getAddress(), value: ethers.parseUnits("1", "ether") })
    ).to.be.revertedWith("Direct ETH transfers not allowed");
});

  // ----- core functions

  it("Should allow topping up rewards and update balance", async function () {
    await cloudToken.transfer(await user1.getAddress(), ethers.parseEther("100"));
    await cloudToken.connect(user1).approve(await cloudRewardPool.getAddress(), ethers.parseEther("100"));
    await cloudRewardPool.connect(user1).depositRewards(ethers.parseEther("100"));

    expect(await cloudToken.balanceOf(await cloudRewardPool.getAddress())).to.equal(ethers.parseEther("100"));
  });

  it("Should not allow deposits when paused", async function () {
    await cloudToken.transfer(await user1.getAddress(), ethers.parseEther("100"));
    await cloudToken.connect(user1).approve(await cloudRewardPool.getAddress(), ethers.parseEther("100"));

    await cloudRewardPool.pause();
    await expect(
      cloudRewardPool.connect(user1).depositRewards(ethers.parseEther("10"))
    ).to.be.reverted;
});

  it("Should NOT allow non-staking contract to distribute reward", async function () {
    await expect(
      cloudRewardPool.connect(user1).distributeRewards(await user1.getAddress(), ethers.parseEther("10"))
    ).to.be.revertedWith("Only staking contract can distribute rewards");
  });

  it("Should distribute rewards correctly", async function () {
    await cloudToken.transfer(await cloudRewardPool.getAddress(), ethers.parseEther("33"));
    await cloudToken.transfer(await user1.getAddress(), ethers.parseEther("100"));

    await cloudToken.connect(user1).approve(await cloudStakeVault.getAddress(), ethers.parseEther("100"));
    await cloudStakeVault.connect(cloudStaking).deposit(await user1.getAddress(), ethers.parseEther("50"));

    await ethers.provider.send("evm_increaseTime", [365 * 24 * 60 * 60]);
    await ethers.provider.send("evm_mine");

    await expect(
            cloudRewardPool.connect(cloudStaking).distributeRewards(await user1.getAddress(), ethers.parseEther("5"))
          ).to.emit(cloudRewardPool, "RewardsDistributed").withArgs(user1.getAddress(), ethers.parseEther("5"))
    expect(await cloudToken.balanceOf(await user1.getAddress())).to.equal(ethers.parseEther("55"));
  });

  it("Should not allow exceeding entitled rewards", async function () {
    await cloudToken.transfer(await cloudRewardPool.getAddress(), ethers.parseEther("33"));
    await cloudToken.transfer(await user1.getAddress(), ethers.parseEther("100"));

    await cloudToken.connect(user1).approve(await cloudStakeVault.getAddress(), ethers.parseEther("100"));
    await cloudStakeVault.connect(cloudStaking).deposit(await user1.getAddress(), ethers.parseEther("50"));

    await expect(cloudRewardPool.connect(cloudStaking).distributeRewards(await user1.getAddress(), ethers.parseEther("5"))).to.be.revertedWith("Requested amount exceeds entitled rewards");

    await ethers.provider.send("evm_increaseTime", [(365-1) * 24 * 60 * 60]);
    await ethers.provider.send("evm_mine");

    await expect(cloudRewardPool.connect(cloudStaking).distributeRewards(await user1.getAddress(), ethers.parseEther("5"))).to.be.revertedWith("Requested amount exceeds entitled rewards");
  });

  it("Should not allow non-staker rewards", async function () {
    await cloudToken.transfer(await cloudRewardPool.getAddress(), ethers.parseEther("33"));

    await expect(cloudRewardPool.connect(cloudStaking).distributeRewards(await user2.getAddress(), ethers.parseEther("5"))).to.be.revertedWith("No tokens staked");
  });

  it("Should revert if contract balance is less than requested reward", async function () {
    await cloudToken.transfer(await cloudRewardPool.getAddress(), ethers.parseEther("3"));
    await cloudToken.transfer(await user1.getAddress(), ethers.parseEther("100"));

    await cloudToken.connect(user1).approve(await cloudStakeVault.getAddress(), ethers.parseEther("100"));
    await cloudStakeVault.connect(cloudStaking).deposit(await user1.getAddress(), ethers.parseEther("50"));

    await ethers.provider.send("evm_increaseTime", [365 * 24 * 60 * 60]);
    await ethers.provider.send("evm_mine");

    await expect(
            cloudRewardPool.connect(cloudStaking).distributeRewards(await user1.getAddress(), ethers.parseEther("5"))
          ).to.be.revertedWith("Insufficient rewards");
  });

  it("Should revert if reward amount is zero", async function () {
      await expect(
          cloudRewardPool.connect(cloudStaking).distributeRewards(user1.address, 0)
      ).to.be.revertedWith("Amount must be greater than zero");
  });

  it("Should not allow distributing more than the entitled amount after deposit-withdraw-deposit", async function () {
    await cloudToken.transfer(await cloudRewardPool.getAddress(), ethers.parseEther("33"));
    await cloudToken.transfer(await user1.getAddress(), ethers.parseEther("100"));
    await cloudToken.transfer(await user2.getAddress(), ethers.parseEther("100"));

    await cloudToken.connect(user1).approve(await cloudStakeVault.getAddress(), ethers.parseEther("100"));
    await cloudStakeVault.connect(cloudStaking).deposit(await user1.getAddress(), ethers.parseEther("50"));

    await cloudToken.connect(user2).approve(await cloudStakeVault.getAddress(), ethers.parseEther("100"));
    await cloudStakeVault.connect(cloudStaking).deposit(await user2.getAddress(), ethers.parseEther("50"));

    await ethers.provider.send("evm_increaseTime", [10 * 24 * 60 * 60]);
    await ethers.provider.send("evm_mine");

    await cloudStakeVault.connect(cloudStaking).withdraw(await user1.getAddress(), ethers.parseEther("50"));

    await ethers.provider.send("evm_increaseTime", [30 * 24 * 60 * 60]);
    await ethers.provider.send("evm_mine");

    await cloudStakeVault.connect(cloudStaking).deposit(await user1.getAddress(), ethers.parseEther("50"));

    await ethers.provider.send("evm_increaseTime", [(365-1) * 24 * 60 * 60]);
    await ethers.provider.send("evm_mine");

    await expect(cloudRewardPool.connect(cloudStaking).distributeRewards(await user1.getAddress(), ethers.parseEther("5"))).to.be.revertedWith("Requested amount exceeds entitled rewards");
 
    await ethers.provider.send("evm_increaseTime", [1 * 24 * 60 * 60]);
    await ethers.provider.send("evm_mine");

    await expect(
        cloudRewardPool.connect(cloudStaking).distributeRewards(await user1.getAddress(), ethers.parseEther("5"))
      ).to.emit(cloudRewardPool, "RewardsDistributed").withArgs(user1.getAddress(), ethers.parseEther("5"))
    expect(await cloudToken.balanceOf(await user1.getAddress())).to.equal(ethers.parseEther("55"));

  });

});
```
