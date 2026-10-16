# token-vesting--winsitoruser

- domain: vesting-timelock (vesting)
- level: moderate
- origin: human
- convention: hardhat2-ethers6
- source: https://github.com/winsitoruser/lileinstein @ 30d28563f96f295a3ed8fc591440cfe7c4c43433
- license: MIT
- targets: TokenVesting.sol, BaseToken.sol
- validation: 9 passing tests, 0 failing; statement coverage TokenVesting.sol 97.06 %, BaseToken.sol 12.5 %

## Contract: BaseToken.sol (dependency)

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Burnable.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Permit.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title BaseToken
 * @dev ERC20 Token deployed on Base Chain L2
 * Features:
 * - Burnable tokens
 * - ERC20Permit for gasless approvals
 * - Ownable for controlled minting
 */
contract BaseToken is ERC20, ERC20Burnable, ERC20Permit, Ownable {
    uint8 private _decimals;
    
    /**
     * @dev Constructor that gives msg.sender all of initial supply.
     * @param name Token name
     * @param symbol Token symbol
     * @param initialSupply Initial token supply (will be multiplied by 10^decimals)
     * @param decimals_ Token decimals
     */
    constructor(
        string memory name,
        string memory symbol,
        uint256 initialSupply,
        uint8 decimals_
    ) ERC20(name, symbol) ERC20Permit(name) Ownable(msg.sender) {
        _decimals = decimals_;
        _mint(msg.sender, initialSupply * 10 ** decimals_);
    }

    /**
     * @dev Returns the number of decimals used for token amounts.
     */
    function decimals() public view virtual override returns (uint8) {
        return _decimals;
    }

    /**
     * @dev Mint new tokens (only owner)
     * @param to Address to receive tokens
     * @param amount Amount of tokens to mint
     */
    function mint(address to, uint256 amount) public onlyOwner {
        _mint(to, amount);
    }

    /**
     * @dev Batch transfer tokens to multiple addresses
     * @param recipients Array of recipient addresses
     * @param amounts Array of amounts to send
     */
    function batchTransfer(
        address[] calldata recipients,
        uint256[] calldata amounts
    ) public returns (bool) {
        require(recipients.length == amounts.length, "Arrays length mismatch");
        require(recipients.length > 0, "Empty arrays");
        
        for (uint256 i = 0; i < recipients.length; i++) {
            transfer(recipients[i], amounts[i]);
        }
        
        return true;
    }
}
```

## Contract: TokenVesting.sol (primary target)

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title TokenVesting
 * @dev A token vesting contract that releases tokens gradually over time
 */
contract TokenVesting is Ownable, ReentrancyGuard {
    struct VestingSchedule {
        uint256 totalAmount;
        uint256 releasedAmount;
        uint256 startTime;
        uint256 cliffDuration;
        uint256 duration;
        bool revocable;
        bool revoked;
    }

    IERC20 public token;
    mapping(address => VestingSchedule) public vestingSchedules;

    event VestingScheduleCreated(
        address indexed beneficiary,
        uint256 totalAmount,
        uint256 startTime,
        uint256 cliffDuration,
        uint256 duration
    );
    event TokensReleased(address indexed beneficiary, uint256 amount);
    event VestingRevoked(address indexed beneficiary);

    constructor(address tokenAddress) Ownable(msg.sender) {
        require(tokenAddress != address(0), "Token address cannot be zero");
        token = IERC20(tokenAddress);
    }

    /**
     * @dev Creates a vesting schedule
     * @param beneficiary Address of the beneficiary
     * @param totalAmount Total amount of tokens to vest
     * @param startTime Start time of vesting
     * @param cliffDuration Cliff duration in seconds
     * @param duration Total vesting duration in seconds
     * @param revocable Whether the vesting is revocable
     */
    function createVestingSchedule(
        address beneficiary,
        uint256 totalAmount,
        uint256 startTime,
        uint256 cliffDuration,
        uint256 duration,
        bool revocable
    ) external onlyOwner {
        require(beneficiary != address(0), "Beneficiary cannot be zero address");
        require(totalAmount > 0, "Amount must be greater than 0");
        require(duration > 0, "Duration must be greater than 0");
        require(cliffDuration <= duration, "Cliff must be <= duration");
        require(vestingSchedules[beneficiary].totalAmount == 0, "Schedule already exists");

        vestingSchedules[beneficiary] = VestingSchedule({
            totalAmount: totalAmount,
            releasedAmount: 0,
            startTime: startTime,
            cliffDuration: cliffDuration,
            duration: duration,
            revocable: revocable,
            revoked: false
        });

        require(
            token.transferFrom(msg.sender, address(this), totalAmount),
            "Token transfer failed"
        );

        emit VestingScheduleCreated(beneficiary, totalAmount, startTime, cliffDuration, duration);
    }

    /**
     * @dev Releases vested tokens to beneficiary
     */
    function release() external nonReentrant {
        VestingSchedule storage schedule = vestingSchedules[msg.sender];
        require(schedule.totalAmount > 0, "No vesting schedule");
        require(!schedule.revoked, "Vesting revoked");

        uint256 releasable = _releasableAmount(schedule);
        require(releasable > 0, "No tokens to release");

        schedule.releasedAmount += releasable;
        require(token.transfer(msg.sender, releasable), "Token transfer failed");

        emit TokensReleased(msg.sender, releasable);
    }

    /**
     * @dev Revokes a vesting schedule (only if revocable)
     * @param beneficiary Address of the beneficiary
     */
    function revoke(address beneficiary) external onlyOwner {
        VestingSchedule storage schedule = vestingSchedules[beneficiary];
        require(schedule.totalAmount > 0, "No vesting schedule");
        require(schedule.revocable, "Vesting not revocable");
        require(!schedule.revoked, "Already revoked");

        uint256 releasable = _releasableAmount(schedule);
        uint256 refund = schedule.totalAmount - schedule.releasedAmount - releasable;

        schedule.revoked = true;

        if (releasable > 0) {
            schedule.releasedAmount += releasable;
            require(token.transfer(beneficiary, releasable), "Token transfer failed");
        }

        if (refund > 0) {
            require(token.transfer(owner(), refund), "Refund transfer failed");
        }

        emit VestingRevoked(beneficiary);
    }

    /**
     * @dev Calculates the releasable amount of tokens
     */
    function _releasableAmount(VestingSchedule memory schedule) private view returns (uint256) {
        return _vestedAmount(schedule) - schedule.releasedAmount;
    }

    /**
     * @dev Calculates the vested amount of tokens
     */
    function _vestedAmount(VestingSchedule memory schedule) private view returns (uint256) {
        if (block.timestamp < schedule.startTime + schedule.cliffDuration) {
            return 0;
        } else if (
            block.timestamp >= schedule.startTime + schedule.duration ||
            schedule.revoked
        ) {
            return schedule.totalAmount;
        } else {
            return (schedule.totalAmount * (block.timestamp - schedule.startTime)) / schedule.duration;
        }
    }

    /**
     * @dev Returns the releasable amount for a beneficiary
     */
    function getReleasableAmount(address beneficiary) external view returns (uint256) {
        return _releasableAmount(vestingSchedules[beneficiary]);
    }

    /**
     * @dev Returns the vested amount for a beneficiary
     */
    function getVestedAmount(address beneficiary) external view returns (uint256) {
        return _vestedAmount(vestingSchedules[beneficiary]);
    }
}
```

## Tests: TokenVesting.test.js

```javascript
const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

describe("TokenVesting", function () {
  let token;
  let vesting;
  let owner;
  let beneficiary;
  
  const TOKEN_NAME = "Test Token";
  const TOKEN_SYMBOL = "TEST";
  const INITIAL_SUPPLY = 1000000;
  const DECIMALS = 18;

  beforeEach(async function () {
    [owner, beneficiary] = await ethers.getSigners();
    
    // Deploy token
    const BaseToken = await ethers.getContractFactory("BaseToken");
    token = await BaseToken.deploy(TOKEN_NAME, TOKEN_SYMBOL, INITIAL_SUPPLY, DECIMALS);
    await token.waitForDeployment();

    // Deploy vesting
    const TokenVesting = await ethers.getContractFactory("TokenVesting");
    vesting = await TokenVesting.deploy(await token.getAddress());
    await vesting.waitForDeployment();
  });

  describe("Vesting Schedule Creation", function () {
    it("Should create a vesting schedule", async function () {
      const amount = ethers.parseUnits("1000", DECIMALS);
      const startTime = await time.latest();
      const cliffDuration = 30 * 24 * 60 * 60; // 30 days
      const duration = 365 * 24 * 60 * 60; // 1 year

      // Approve tokens
      await token.approve(await vesting.getAddress(), amount);

      // Create vesting schedule
      await vesting.createVestingSchedule(
        beneficiary.address,
        amount,
        startTime,
        cliffDuration,
        duration,
        false
      );

      const schedule = await vesting.vestingSchedules(beneficiary.address);
      expect(schedule.totalAmount).to.equal(amount);
      expect(schedule.startTime).to.equal(startTime);
    });

    it("Should fail if beneficiary is zero address", async function () {
      const amount = ethers.parseUnits("1000", DECIMALS);
      const startTime = await time.latest();

      await token.approve(await vesting.getAddress(), amount);

      await expect(
        vesting.createVestingSchedule(
          ethers.ZeroAddress,
          amount,
          startTime,
          0,
          365 * 24 * 60 * 60,
          false
        )
      ).to.be.revertedWith("Beneficiary cannot be zero address");
    });

    it("Should fail if amount is zero", async function () {
      const startTime = await time.latest();

      await expect(
        vesting.createVestingSchedule(
          beneficiary.address,
          0,
          startTime,
          0,
          365 * 24 * 60 * 60,
          false
        )
      ).to.be.revertedWith("Amount must be greater than 0");
    });
  });

  describe("Token Release", function () {
    it("Should release vested tokens after cliff", async function () {
      const amount = ethers.parseUnits("1000", DECIMALS);
      const startTime = await time.latest();
      const cliffDuration = 30 * 24 * 60 * 60; // 30 days
      const duration = 365 * 24 * 60 * 60; // 1 year

      await token.approve(await vesting.getAddress(), amount);
      await vesting.createVestingSchedule(
        beneficiary.address,
        amount,
        startTime,
        cliffDuration,
        duration,
        false
      );

      // Move time past cliff
      await time.increase(cliffDuration + 1);

      // Release tokens
      await vesting.connect(beneficiary).release();

      const balance = await token.balanceOf(beneficiary.address);
      expect(balance).to.be.gt(0);
    });

    it("Should not release tokens before cliff", async function () {
      const amount = ethers.parseUnits("1000", DECIMALS);
      const startTime = await time.latest();
      const cliffDuration = 30 * 24 * 60 * 60;
      const duration = 365 * 24 * 60 * 60;

      await token.approve(await vesting.getAddress(), amount);
      await vesting.createVestingSchedule(
        beneficiary.address,
        amount,
        startTime,
        cliffDuration,
        duration,
        false
      );

      // Try to release before cliff
      await expect(
        vesting.connect(beneficiary).release()
      ).to.be.revertedWith("No tokens to release");
    });

    it("Should release all tokens after vesting period", async function () {
      const amount = ethers.parseUnits("1000", DECIMALS);
      const startTime = await time.latest();
      const duration = 365 * 24 * 60 * 60;

      await token.approve(await vesting.getAddress(), amount);
      await vesting.createVestingSchedule(
        beneficiary.address,
        amount,
        startTime,
        0,
        duration,
        false
      );

      // Move time past vesting period
      await time.increase(duration + 1);

      // Release tokens
      await vesting.connect(beneficiary).release();

      const balance = await token.balanceOf(beneficiary.address);
      expect(balance).to.equal(amount);
    });
  });

  describe("Vesting Revocation", function () {
    it("Should allow owner to revoke revocable vesting", async function () {
      const amount = ethers.parseUnits("1000", DECIMALS);
      const startTime = await time.latest();
      const duration = 365 * 24 * 60 * 60;

      await token.approve(await vesting.getAddress(), amount);
      await vesting.createVestingSchedule(
        beneficiary.address,
        amount,
        startTime,
        0,
        duration,
        true // revocable
      );

      // Revoke vesting
      await vesting.revoke(beneficiary.address);

      const schedule = await vesting.vestingSchedules(beneficiary.address);
      expect(schedule.revoked).to.be.true;
    });

    it("Should fail to revoke non-revocable vesting", async function () {
      const amount = ethers.parseUnits("1000", DECIMALS);
      const startTime = await time.latest();
      const duration = 365 * 24 * 60 * 60;

      await token.approve(await vesting.getAddress(), amount);
      await vesting.createVestingSchedule(
        beneficiary.address,
        amount,
        startTime,
        0,
        duration,
        false // not revocable
      );

      await expect(
        vesting.revoke(beneficiary.address)
      ).to.be.revertedWith("Vesting not revocable");
    });
  });

  describe("View Functions", function () {
    it("Should return correct releasable amount", async function () {
      const amount = ethers.parseUnits("1000", DECIMALS);
      const startTime = await time.latest();
      const duration = 100; // 100 seconds for easy testing

      await token.approve(await vesting.getAddress(), amount);
      await vesting.createVestingSchedule(
        beneficiary.address,
        amount,
        startTime,
        0,
        duration,
        false
      );

      // Move time to 50% of vesting period
      await time.increase(50);

      const releasable = await vesting.getReleasableAmount(beneficiary.address);
      // Allow larger tolerance due to block timestamp precision
      expect(releasable).to.be.closeTo(amount / 2n, ethers.parseUnits("100", DECIMALS));
    });
  });
});
```
