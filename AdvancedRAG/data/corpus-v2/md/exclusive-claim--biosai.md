# exclusive-claim--biosai

- domain: escrow-conditional-payments (escrow)
- level: complex
- origin: human
- convention: hardhat2-ethers6
- source: https://github.com/Biosai/lockd @ d2b022f15709a1e511911b7e0c9d2753ba06b7d0
- license: MIT
- targets: ExclusiveClaim.sol, MockERC20.sol
- validation: 49 passing tests, 0 failing; statement coverage ExclusiveClaim.sol 100.0 %, MockERC20.sol 50.0 %

## Contract: ExclusiveClaim.sol (primary target)

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title ExclusiveClaim
 * @notice A contract that allows users to deposit ETH or ERC20 tokens for a specific claimant.
 *         The claimant can claim at any time. After the deadline, the depositor can also refund.
 */
contract ExclusiveClaim is ReentrancyGuard {
    using SafeERC20 for IERC20;

    /// @notice Represents a deposit with its associated data
    struct Deposit {
        address depositor;      // The address that made the deposit
        address claimant;       // The address that can claim the deposit
        address token;          // Token address (address(0) for ETH)
        uint256 amount;         // Amount deposited
        uint256 startTime;      // Timestamp from which claimant can claim (0 = immediate)
        uint256 deadline;       // Timestamp after which depositor can also withdraw
        bool claimed;           // Whether the deposit has been claimed/refunded
        string title;           // Optional title/label for the deposit
    }

    /// @notice Mapping from deposit ID to Deposit struct
    mapping(uint256 => Deposit) public deposits;

    /// @notice Total number of deposits created
    uint256 public depositCount;

    /// @notice Emitted when a new deposit is created
    event DepositCreated(
        uint256 indexed depositId,
        address indexed depositor,
        address indexed claimant,
        address token,
        uint256 amount,
        uint256 startTime,
        uint256 deadline,
        string title
    );

    /// @notice Emitted when a deposit is claimed by the claimant
    event Claimed(uint256 indexed depositId, address indexed claimant);

    /// @notice Emitted when a deposit is refunded to the depositor (after deadline)
    event Refunded(uint256 indexed depositId, address indexed depositor);

    /// @notice Error thrown when deposit amount is zero
    error ZeroAmount();

    /// @notice Error thrown when claimant address is zero
    error ZeroClaimant();

    /// @notice Error thrown when deadline is not in the future
    error DeadlineNotInFuture();

    /// @notice Error thrown when deposit has already been claimed
    error AlreadyClaimed();

    /// @notice Error thrown when caller is not the claimant
    error NotClaimant();

    /// @notice Error thrown when caller is not the depositor
    error NotDepositor();

    /// @notice Error thrown when trying to refund before deadline
    error DeadlineNotReached();

    /// @notice Error thrown when ETH amount doesn't match for ERC20 deposit
    error InvalidETHAmount();

    /// @notice Error thrown when deposit doesn't exist
    error DepositNotFound();

    /// @notice Error thrown when title exceeds maximum length
    error TitleTooLong();

    /// @notice Error thrown when startTime is after deadline
    error StartTimeAfterDeadline();

    /// @notice Error thrown when trying to claim before startTime
    error ClaimNotYetAllowed();

    /// @notice Maximum allowed length for deposit title (in bytes)
    uint256 public constant MAX_TITLE_LENGTH = 128;

    /**
     * @notice Create a new deposit for ETH
     * @param claimant The address that can claim this deposit
     * @param startTime Timestamp from which claimant can claim (0 for immediate)
     * @param deadline The timestamp after which the depositor can also withdraw
     * @param title Optional title/label for the deposit
     * @return depositId The ID of the newly created deposit
     */
    function depositETH(
        address claimant,
        uint256 startTime,
        uint256 deadline,
        string calldata title
    ) external payable nonReentrant returns (uint256 depositId) {
        if (msg.value == 0) revert ZeroAmount();
        if (claimant == address(0)) revert ZeroClaimant();
        if (deadline <= block.timestamp) revert DeadlineNotInFuture();
        if (startTime > deadline) revert StartTimeAfterDeadline();
        if (bytes(title).length > MAX_TITLE_LENGTH) revert TitleTooLong();

        depositId = depositCount++;
        
        deposits[depositId] = Deposit({
            depositor: msg.sender,
            claimant: claimant,
            token: address(0),
            amount: msg.value,
            startTime: startTime,
            deadline: deadline,
            claimed: false,
            title: title
        });

        emit DepositCreated(depositId, msg.sender, claimant, address(0), msg.value, startTime, deadline, title);
    }

    /**
     * @notice Create a new deposit for an ERC20 token
     * @dev Supports fee-on-transfer tokens by recording actual balance change
     * @param claimant The address that can claim this deposit
     * @param token The ERC20 token address
     * @param amount The amount of tokens to deposit (may differ from actual if fee-on-transfer)
     * @param startTime Timestamp from which claimant can claim (0 for immediate)
     * @param deadline The timestamp after which the depositor can also withdraw
     * @param title Optional title/label for the deposit
     * @return depositId The ID of the newly created deposit
     */
    function depositToken(
        address claimant,
        address token,
        uint256 amount,
        uint256 startTime,
        uint256 deadline,
        string calldata title
    ) external nonReentrant returns (uint256 depositId) {
        if (amount == 0) revert ZeroAmount();
        if (claimant == address(0)) revert ZeroClaimant();
        if (token == address(0)) revert InvalidETHAmount();
        if (deadline <= block.timestamp) revert DeadlineNotInFuture();
        if (startTime > deadline) revert StartTimeAfterDeadline();
        if (bytes(title).length > MAX_TITLE_LENGTH) revert TitleTooLong();

        // Record balance before transfer to handle fee-on-transfer tokens
        uint256 balanceBefore = IERC20(token).balanceOf(address(this));
        
        // Transfer tokens from sender to this contract
        IERC20(token).safeTransferFrom(msg.sender, address(this), amount);
        
        // Calculate actual amount received (handles fee-on-transfer tokens)
        uint256 actualAmount = IERC20(token).balanceOf(address(this)) - balanceBefore;
        
        // Ensure we actually received tokens
        if (actualAmount == 0) revert ZeroAmount();

        depositId = depositCount++;

        deposits[depositId] = Deposit({
            depositor: msg.sender,
            claimant: claimant,
            token: token,
            amount: actualAmount, // Store actual amount received, not requested amount
            startTime: startTime,
            deadline: deadline,
            claimed: false,
            title: title
        });

        emit DepositCreated(depositId, msg.sender, claimant, token, actualAmount, startTime, deadline, title);
    }

    /**
     * @notice Claim a deposit (only callable by the designated claimant)
     * @param depositId The ID of the deposit to claim
     */
    function claim(uint256 depositId) external nonReentrant {
        if (depositId >= depositCount) revert DepositNotFound();
        
        Deposit storage d = deposits[depositId];
        
        if (d.claimed) revert AlreadyClaimed();
        if (msg.sender != d.claimant) revert NotClaimant();
        if (d.startTime > 0 && block.timestamp < d.startTime) revert ClaimNotYetAllowed();

        d.claimed = true;

        _transfer(d.token, d.claimant, d.amount);

        emit Claimed(depositId, d.claimant);
    }

    /**
     * @notice Refund a deposit to the depositor (only after deadline has passed)
     * @param depositId The ID of the deposit to refund
     */
    function refund(uint256 depositId) external nonReentrant {
        if (depositId >= depositCount) revert DepositNotFound();
        
        Deposit storage d = deposits[depositId];
        
        if (d.claimed) revert AlreadyClaimed();
        if (msg.sender != d.depositor) revert NotDepositor();
        if (block.timestamp <= d.deadline) revert DeadlineNotReached();

        d.claimed = true;

        _transfer(d.token, d.depositor, d.amount);

        emit Refunded(depositId, d.depositor);
    }

    /**
     * @notice Get deposit details
     * @param depositId The ID of the deposit
     * @return depositor The address that made the deposit
     * @return claimant The address that can claim
     * @return token The token address (address(0) for ETH)
     * @return amount The deposit amount
     * @return startTime The timestamp from which claiming is allowed
     * @return deadline The claim deadline
     * @return claimed Whether already claimed/refunded
     * @return title The deposit title/label
     */
    function getDeposit(uint256 depositId) external view returns (
        address depositor,
        address claimant,
        address token,
        uint256 amount,
        uint256 startTime,
        uint256 deadline,
        bool claimed,
        string memory title
    ) {
        if (depositId >= depositCount) revert DepositNotFound();
        Deposit storage d = deposits[depositId];
        return (d.depositor, d.claimant, d.token, d.amount, d.startTime, d.deadline, d.claimed, d.title);
    }

    /**
     * @notice Internal function to transfer ETH or ERC20 tokens
     * @param token The token address (address(0) for ETH)
     * @param to The recipient address
     * @param amount The amount to transfer
     */
    function _transfer(address token, address to, uint256 amount) internal {
        if (token == address(0)) {
            (bool success, ) = to.call{value: amount}("");
            require(success, "ETH transfer failed");
        } else {
            IERC20(token).safeTransfer(to, amount);
        }
    }
}
```

## Contract: MockERC20.sol (dependency)

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/**
 * @title MockERC20
 * @notice A simple ERC20 token for testing purposes
 */
contract MockERC20 is ERC20 {
    uint8 private _decimals;

    constructor(
        string memory name,
        string memory symbol,
        uint8 decimals_
    ) ERC20(name, symbol) {
        _decimals = decimals_;
    }

    function decimals() public view override returns (uint8) {
        return _decimals;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}
```

## Tests: ExclusiveClaim.test.js

```javascript
const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

describe("ExclusiveClaim", function () {
  let exclusiveClaim;
  let mockToken;
  let depositor;
  let claimant;
  let other;

  const ONE_HOUR = 60 * 60;
  const ONE_DAY = 24 * ONE_HOUR;
  const ETH_AMOUNT = ethers.parseEther("1");
  const TOKEN_AMOUNT = ethers.parseUnits("1000", 6); // USDC-like (6 decimals)
  const DEFAULT_TITLE = "Test Deposit";
  const IMMEDIATE = 0; // startTime = 0 means immediate claiming

  beforeEach(async function () {
    [depositor, claimant, other] = await ethers.getSigners();

    // Deploy ExclusiveClaim contract
    const ExclusiveClaimFactory = await ethers.getContractFactory("ExclusiveClaim");
    exclusiveClaim = await ExclusiveClaimFactory.deploy();

    // Deploy mock ERC20 token (USDC-like with 6 decimals)
    const MockERC20Factory = await ethers.getContractFactory("MockERC20");
    mockToken = await MockERC20Factory.deploy("Mock USDC", "MUSDC", 6);

    // Mint tokens to depositor
    await mockToken.mint(depositor.address, TOKEN_AMOUNT * 10n);
  });

  describe("ETH Deposits", function () {
    describe("depositETH", function () {
      it("should create an ETH deposit successfully", async function () {
        const deadline = (await time.latest()) + ONE_DAY;

        await expect(
          exclusiveClaim.connect(depositor).depositETH(claimant.address, IMMEDIATE, deadline, DEFAULT_TITLE, {
            value: ETH_AMOUNT,
          })
        )
          .to.emit(exclusiveClaim, "DepositCreated")
          .withArgs(0, depositor.address, claimant.address, ethers.ZeroAddress, ETH_AMOUNT, IMMEDIATE, deadline, DEFAULT_TITLE);

        const deposit = await exclusiveClaim.getDeposit(0);
        expect(deposit.depositor).to.equal(depositor.address);
        expect(deposit.claimant).to.equal(claimant.address);
        expect(deposit.token).to.equal(ethers.ZeroAddress);
        expect(deposit.amount).to.equal(ETH_AMOUNT);
        expect(deposit.startTime).to.equal(IMMEDIATE);
        expect(deposit.deadline).to.equal(deadline);
        expect(deposit.claimed).to.equal(false);
        expect(deposit.title).to.equal(DEFAULT_TITLE);
      });

      it("should create deposit with startTime", async function () {
        const startTime = (await time.latest()) + ONE_HOUR;
        const deadline = (await time.latest()) + ONE_DAY;

        await exclusiveClaim.connect(depositor).depositETH(claimant.address, startTime, deadline, DEFAULT_TITLE, {
          value: ETH_AMOUNT,
        });

        const deposit = await exclusiveClaim.getDeposit(0);
        expect(deposit.startTime).to.equal(startTime);
      });

      it("should increment deposit count", async function () {
        const deadline = (await time.latest()) + ONE_DAY;

        expect(await exclusiveClaim.depositCount()).to.equal(0);

        await exclusiveClaim.connect(depositor).depositETH(claimant.address, IMMEDIATE, deadline, DEFAULT_TITLE, {
          value: ETH_AMOUNT,
        });
        expect(await exclusiveClaim.depositCount()).to.equal(1);

        await exclusiveClaim.connect(depositor).depositETH(claimant.address, IMMEDIATE, deadline, DEFAULT_TITLE, {
          value: ETH_AMOUNT,
        });
        expect(await exclusiveClaim.depositCount()).to.equal(2);
      });

      it("should revert if amount is zero", async function () {
        const deadline = (await time.latest()) + ONE_DAY;

        await expect(
          exclusiveClaim.connect(depositor).depositETH(claimant.address, IMMEDIATE, deadline, DEFAULT_TITLE, {
            value: 0,
          })
        ).to.be.revertedWithCustomError(exclusiveClaim, "ZeroAmount");
      });

      it("should revert if claimant is zero address", async function () {
        const deadline = (await time.latest()) + ONE_DAY;

        await expect(
          exclusiveClaim.connect(depositor).depositETH(ethers.ZeroAddress, IMMEDIATE, deadline, DEFAULT_TITLE, {
            value: ETH_AMOUNT,
          })
        ).to.be.revertedWithCustomError(exclusiveClaim, "ZeroClaimant");
      });

      it("should revert if deadline is in the past", async function () {
        const pastDeadline = (await time.latest()) - 1;

        await expect(
          exclusiveClaim.connect(depositor).depositETH(claimant.address, IMMEDIATE, pastDeadline, DEFAULT_TITLE, {
            value: ETH_AMOUNT,
          })
        ).to.be.revertedWithCustomError(exclusiveClaim, "DeadlineNotInFuture");
      });

      it("should revert if deadline is current timestamp", async function () {
        const currentTime = await time.latest();

        await expect(
          exclusiveClaim.connect(depositor).depositETH(claimant.address, IMMEDIATE, currentTime, DEFAULT_TITLE, {
            value: ETH_AMOUNT,
          })
        ).to.be.revertedWithCustomError(exclusiveClaim, "DeadlineNotInFuture");
      });

      it("should revert if startTime is after deadline", async function () {
        const deadline = (await time.latest()) + ONE_DAY;
        const startTime = deadline + ONE_HOUR; // startTime after deadline

        await expect(
          exclusiveClaim.connect(depositor).depositETH(claimant.address, startTime, deadline, DEFAULT_TITLE, {
            value: ETH_AMOUNT,
          })
        ).to.be.revertedWithCustomError(exclusiveClaim, "StartTimeAfterDeadline");
      });

      it("should allow startTime equal to deadline", async function () {
        const deadline = (await time.latest()) + ONE_DAY;
        const startTime = deadline; // startTime equals deadline

        await exclusiveClaim.connect(depositor).depositETH(claimant.address, startTime, deadline, DEFAULT_TITLE, {
          value: ETH_AMOUNT,
        });

        const deposit = await exclusiveClaim.getDeposit(0);
        expect(deposit.startTime).to.equal(startTime);
      });

      it("should revert if title is too long", async function () {
        const deadline = (await time.latest()) + ONE_DAY;
        const longTitle = "a".repeat(129); // 129 chars, exceeds MAX_TITLE_LENGTH of 128

        await expect(
          exclusiveClaim.connect(depositor).depositETH(claimant.address, IMMEDIATE, deadline, longTitle, {
            value: ETH_AMOUNT,
          })
        ).to.be.revertedWithCustomError(exclusiveClaim, "TitleTooLong");
      });
    });

    describe("claim (ETH)", function () {
      let deadline;
      let depositId;

      beforeEach(async function () {
        deadline = (await time.latest()) + ONE_DAY;
        const tx = await exclusiveClaim.connect(depositor).depositETH(claimant.address, IMMEDIATE, deadline, DEFAULT_TITLE, {
          value: ETH_AMOUNT,
        });
        const receipt = await tx.wait();
        depositId = 0n;
      });

      it("should allow claimant to claim before deadline", async function () {
        const balanceBefore = await ethers.provider.getBalance(claimant.address);

        await expect(exclusiveClaim.connect(claimant).claim(depositId))
          .to.emit(exclusiveClaim, "Claimed")
          .withArgs(depositId, claimant.address);

        const balanceAfter = await ethers.provider.getBalance(claimant.address);
        // Account for gas, balance should increase by approximately ETH_AMOUNT
        expect(balanceAfter - balanceBefore).to.be.closeTo(ETH_AMOUNT, ethers.parseEther("0.01"));

        const deposit = await exclusiveClaim.getDeposit(depositId);
        expect(deposit.claimed).to.equal(true);
      });

      it("should allow claimant to claim after deadline", async function () {
        await time.increase(ONE_DAY + 1);

        await expect(exclusiveClaim.connect(claimant).claim(depositId))
          .to.emit(exclusiveClaim, "Claimed")
          .withArgs(depositId, claimant.address);
      });

      it("should revert if not claimant", async function () {
        await expect(
          exclusiveClaim.connect(other).claim(depositId)
        ).to.be.revertedWithCustomError(exclusiveClaim, "NotClaimant");
      });

      it("should revert if already claimed", async function () {
        await exclusiveClaim.connect(claimant).claim(depositId);

        await expect(
          exclusiveClaim.connect(claimant).claim(depositId)
        ).to.be.revertedWithCustomError(exclusiveClaim, "AlreadyClaimed");
      });

      it("should revert if deposit doesn't exist", async function () {
        await expect(
          exclusiveClaim.connect(claimant).claim(999)
        ).to.be.revertedWithCustomError(exclusiveClaim, "DepositNotFound");
      });
    });

    describe("claim with startTime", function () {
      it("should revert if claiming before startTime", async function () {
        const startTime = (await time.latest()) + ONE_HOUR;
        const deadline = (await time.latest()) + ONE_DAY;

        await exclusiveClaim.connect(depositor).depositETH(claimant.address, startTime, deadline, DEFAULT_TITLE, {
          value: ETH_AMOUNT,
        });

        await expect(
          exclusiveClaim.connect(claimant).claim(0)
        ).to.be.revertedWithCustomError(exclusiveClaim, "ClaimNotYetAllowed");
      });

      it("should allow claiming exactly at startTime", async function () {
        const startTime = (await time.latest()) + ONE_HOUR;
        const deadline = (await time.latest()) + ONE_DAY;

        await exclusiveClaim.connect(depositor).depositETH(claimant.address, startTime, deadline, DEFAULT_TITLE, {
          value: ETH_AMOUNT,
        });

        await time.increaseTo(startTime);

        await expect(exclusiveClaim.connect(claimant).claim(0))
          .to.emit(exclusiveClaim, "Claimed");
      });

      it("should allow claiming after startTime", async function () {
        const startTime = (await time.latest()) + ONE_HOUR;
        const deadline = (await time.latest()) + ONE_DAY;

        await exclusiveClaim.connect(depositor).depositETH(claimant.address, startTime, deadline, DEFAULT_TITLE, {
          value: ETH_AMOUNT,
        });

        await time.increaseTo(startTime + 1);

        await expect(exclusiveClaim.connect(claimant).claim(0))
          .to.emit(exclusiveClaim, "Claimed");
      });

      it("should allow immediate claiming when startTime is 0", async function () {
        const deadline = (await time.latest()) + ONE_DAY;

        await exclusiveClaim.connect(depositor).depositETH(claimant.address, IMMEDIATE, deadline, DEFAULT_TITLE, {
          value: ETH_AMOUNT,
        });

        await expect(exclusiveClaim.connect(claimant).claim(0))
          .to.emit(exclusiveClaim, "Claimed");
      });
    });

    describe("refund (ETH)", function () {
      let deadline;
      let depositId;

      beforeEach(async function () {
        deadline = (await time.latest()) + ONE_DAY;
        await exclusiveClaim.connect(depositor).depositETH(claimant.address, IMMEDIATE, deadline, DEFAULT_TITLE, {
          value: ETH_AMOUNT,
        });
        depositId = 0n;
      });

      it("should allow depositor to refund after deadline", async function () {
        await time.increase(ONE_DAY + 1);

        const balanceBefore = await ethers.provider.getBalance(depositor.address);

        await expect(exclusiveClaim.connect(depositor).refund(depositId))
          .to.emit(exclusiveClaim, "Refunded")
          .withArgs(depositId, depositor.address);

        const balanceAfter = await ethers.provider.getBalance(depositor.address);
        expect(balanceAfter - balanceBefore).to.be.closeTo(ETH_AMOUNT, ethers.parseEther("0.01"));

        const deposit = await exclusiveClaim.getDeposit(depositId);
        expect(deposit.claimed).to.equal(true);
      });

      it("should revert if deadline not reached", async function () {
        await expect(
          exclusiveClaim.connect(depositor).refund(depositId)
        ).to.be.revertedWithCustomError(exclusiveClaim, "DeadlineNotReached");
      });

      it("should revert if not depositor", async function () {
        await time.increase(ONE_DAY + 1);

        await expect(
          exclusiveClaim.connect(other).refund(depositId)
        ).to.be.revertedWithCustomError(exclusiveClaim, "NotDepositor");
      });

      it("should revert if already claimed", async function () {
        await exclusiveClaim.connect(claimant).claim(depositId);
        await time.increase(ONE_DAY + 1);

        await expect(
          exclusiveClaim.connect(depositor).refund(depositId)
        ).to.be.revertedWithCustomError(exclusiveClaim, "AlreadyClaimed");
      });

      it("should revert if already refunded", async function () {
        await time.increase(ONE_DAY + 1);
        await exclusiveClaim.connect(depositor).refund(depositId);

        await expect(
          exclusiveClaim.connect(depositor).refund(depositId)
        ).to.be.revertedWithCustomError(exclusiveClaim, "AlreadyClaimed");
      });
    });
  });

  describe("ERC20 Token Deposits", function () {
    describe("depositToken", function () {
      it("should create a token deposit successfully", async function () {
        const deadline = (await time.latest()) + ONE_DAY;

        // Approve tokens first
        await mockToken.connect(depositor).approve(await exclusiveClaim.getAddress(), TOKEN_AMOUNT);

        await expect(
          exclusiveClaim.connect(depositor).depositToken(
            claimant.address,
            await mockToken.getAddress(),
            TOKEN_AMOUNT,
            IMMEDIATE,
            deadline,
            DEFAULT_TITLE
          )
        )
          .to.emit(exclusiveClaim, "DepositCreated")
          .withArgs(
            0,
            depositor.address,
            claimant.address,
            await mockToken.getAddress(),
            TOKEN_AMOUNT,
            IMMEDIATE,
            deadline,
            DEFAULT_TITLE
          );

        const deposit = await exclusiveClaim.getDeposit(0);
        expect(deposit.depositor).to.equal(depositor.address);
        expect(deposit.claimant).to.equal(claimant.address);
        expect(deposit.token).to.equal(await mockToken.getAddress());
        expect(deposit.amount).to.equal(TOKEN_AMOUNT);
        expect(deposit.startTime).to.equal(IMMEDIATE);
        expect(deposit.title).to.equal(DEFAULT_TITLE);

        // Contract should hold the tokens
        expect(await mockToken.balanceOf(await exclusiveClaim.getAddress())).to.equal(TOKEN_AMOUNT);
      });

      it("should create token deposit with startTime", async function () {
        const startTime = (await time.latest()) + ONE_HOUR;
        const deadline = (await time.latest()) + ONE_DAY;

        await mockToken.connect(depositor).approve(await exclusiveClaim.getAddress(), TOKEN_AMOUNT);
        await exclusiveClaim.connect(depositor).depositToken(
          claimant.address,
          await mockToken.getAddress(),
          TOKEN_AMOUNT,
          startTime,
          deadline,
          DEFAULT_TITLE
        );

        const deposit = await exclusiveClaim.getDeposit(0);
        expect(deposit.startTime).to.equal(startTime);
      });

      it("should revert if amount is zero", async function () {
        const deadline = (await time.latest()) + ONE_DAY;

        await expect(
          exclusiveClaim.connect(depositor).depositToken(
            claimant.address,
            await mockToken.getAddress(),
            0,
            IMMEDIATE,
            deadline,
            DEFAULT_TITLE
          )
        ).to.be.revertedWithCustomError(exclusiveClaim, "ZeroAmount");
      });

      it("should revert if claimant is zero address", async function () {
        const deadline = (await time.latest()) + ONE_DAY;

        await expect(
          exclusiveClaim.connect(depositor).depositToken(
            ethers.ZeroAddress,
            await mockToken.getAddress(),
            TOKEN_AMOUNT,
            IMMEDIATE,
            deadline,
            DEFAULT_TITLE
          )
        ).to.be.revertedWithCustomError(exclusiveClaim, "ZeroClaimant");
      });

      it("should revert if token is zero address", async function () {
        const deadline = (await time.latest()) + ONE_DAY;

        await expect(
          exclusiveClaim.connect(depositor).depositToken(
            claimant.address,
            ethers.ZeroAddress,
            TOKEN_AMOUNT,
            IMMEDIATE,
            deadline,
            DEFAULT_TITLE
          )
        ).to.be.revertedWithCustomError(exclusiveClaim, "InvalidETHAmount");
      });

      it("should revert if deadline is in the past", async function () {
        const pastDeadline = (await time.latest()) - 1;

        await expect(
          exclusiveClaim.connect(depositor).depositToken(
            claimant.address,
            await mockToken.getAddress(),
            TOKEN_AMOUNT,
            IMMEDIATE,
            pastDeadline,
            DEFAULT_TITLE
          )
        ).to.be.revertedWithCustomError(exclusiveClaim, "DeadlineNotInFuture");
      });

      it("should revert if startTime is after deadline", async function () {
        const deadline = (await time.latest()) + ONE_DAY;
        const startTime = deadline + ONE_HOUR;

        await mockToken.connect(depositor).approve(await exclusiveClaim.getAddress(), TOKEN_AMOUNT);

        await expect(
          exclusiveClaim.connect(depositor).depositToken(
            claimant.address,
            await mockToken.getAddress(),
            TOKEN_AMOUNT,
            startTime,
            deadline,
            DEFAULT_TITLE
          )
        ).to.be.revertedWithCustomError(exclusiveClaim, "StartTimeAfterDeadline");
      });

      it("should revert if not approved", async function () {
        const deadline = (await time.latest()) + ONE_DAY;

        await expect(
          exclusiveClaim.connect(depositor).depositToken(
            claimant.address,
            await mockToken.getAddress(),
            TOKEN_AMOUNT,
            IMMEDIATE,
            deadline,
            DEFAULT_TITLE
          )
        ).to.be.reverted;
      });

      it("should revert if title is too long", async function () {
        const deadline = (await time.latest()) + ONE_DAY;
        const longTitle = "a".repeat(129); // 129 chars, exceeds MAX_TITLE_LENGTH of 128

        await mockToken.connect(depositor).approve(await exclusiveClaim.getAddress(), TOKEN_AMOUNT);

        await expect(
          exclusiveClaim.connect(depositor).depositToken(
            claimant.address,
            await mockToken.getAddress(),
            TOKEN_AMOUNT,
            IMMEDIATE,
            deadline,
            longTitle
          )
        ).to.be.revertedWithCustomError(exclusiveClaim, "TitleTooLong");
      });
    });

    describe("claim (ERC20)", function () {
      let deadline;
      let depositId;

      beforeEach(async function () {
        deadline = (await time.latest()) + ONE_DAY;
        await mockToken.connect(depositor).approve(await exclusiveClaim.getAddress(), TOKEN_AMOUNT);
        await exclusiveClaim.connect(depositor).depositToken(
          claimant.address,
          await mockToken.getAddress(),
          TOKEN_AMOUNT,
          IMMEDIATE,
          deadline,
          DEFAULT_TITLE
        );
        depositId = 0n;
      });

      it("should allow claimant to claim tokens before deadline", async function () {
        const balanceBefore = await mockToken.balanceOf(claimant.address);

        await expect(exclusiveClaim.connect(claimant).claim(depositId))
          .to.emit(exclusiveClaim, "Claimed")
          .withArgs(depositId, claimant.address);

        const balanceAfter = await mockToken.balanceOf(claimant.address);
        expect(balanceAfter - balanceBefore).to.equal(TOKEN_AMOUNT);

        const deposit = await exclusiveClaim.getDeposit(depositId);
        expect(deposit.claimed).to.equal(true);
      });

      it("should allow claimant to claim tokens after deadline", async function () {
        await time.increase(ONE_DAY + 1);

        await expect(exclusiveClaim.connect(claimant).claim(depositId))
          .to.emit(exclusiveClaim, "Claimed")
          .withArgs(depositId, claimant.address);

        expect(await mockToken.balanceOf(claimant.address)).to.equal(TOKEN_AMOUNT);
      });

      it("should revert if not claimant", async function () {
        await expect(
          exclusiveClaim.connect(other).claim(depositId)
        ).to.be.revertedWithCustomError(exclusiveClaim, "NotClaimant");
      });
    });

    describe("claim (ERC20) with startTime", function () {
      it("should revert if claiming before startTime", async function () {
        const startTime = (await time.latest()) + ONE_HOUR;
        const deadline = (await time.latest()) + ONE_DAY;

        await mockToken.connect(depositor).approve(await exclusiveClaim.getAddress(), TOKEN_AMOUNT);
        await exclusiveClaim.connect(depositor).depositToken(
          claimant.address,
          await mockToken.getAddress(),
          TOKEN_AMOUNT,
          startTime,
          deadline,
          DEFAULT_TITLE
        );

        await expect(
          exclusiveClaim.connect(claimant).claim(0)
        ).to.be.revertedWithCustomError(exclusiveClaim, "ClaimNotYetAllowed");
      });

      it("should allow claiming after startTime", async function () {
        const startTime = (await time.latest()) + ONE_HOUR;
        const deadline = (await time.latest()) + ONE_DAY;

        await mockToken.connect(depositor).approve(await exclusiveClaim.getAddress(), TOKEN_AMOUNT);
        await exclusiveClaim.connect(depositor).depositToken(
          claimant.address,
          await mockToken.getAddress(),
          TOKEN_AMOUNT,
          startTime,
          deadline,
          DEFAULT_TITLE
        );

        await time.increaseTo(startTime + 1);

        await expect(exclusiveClaim.connect(claimant).claim(0))
          .to.emit(exclusiveClaim, "Claimed");
      });
    });

    describe("refund (ERC20)", function () {
      let deadline;
      let depositId;
      let depositorInitialBalance;

      beforeEach(async function () {
        deadline = (await time.latest()) + ONE_DAY;
        depositorInitialBalance = await mockToken.balanceOf(depositor.address);

        await mockToken.connect(depositor).approve(await exclusiveClaim.getAddress(), TOKEN_AMOUNT);
        await exclusiveClaim.connect(depositor).depositToken(
          claimant.address,
          await mockToken.getAddress(),
          TOKEN_AMOUNT,
          IMMEDIATE,
          deadline,
          DEFAULT_TITLE
        );
        depositId = 0n;
      });

      it("should allow depositor to refund tokens after deadline", async function () {
        await time.increase(ONE_DAY + 1);

        const balanceBefore = await mockToken.balanceOf(depositor.address);

        await expect(exclusiveClaim.connect(depositor).refund(depositId))
          .to.emit(exclusiveClaim, "Refunded")
          .withArgs(depositId, depositor.address);

        const balanceAfter = await mockToken.balanceOf(depositor.address);
        expect(balanceAfter - balanceBefore).to.equal(TOKEN_AMOUNT);
      });

      it("should revert if deadline not reached", async function () {
        await expect(
          exclusiveClaim.connect(depositor).refund(depositId)
        ).to.be.revertedWithCustomError(exclusiveClaim, "DeadlineNotReached");
      });

      it("should revert if not depositor", async function () {
        await time.increase(ONE_DAY + 1);

        await expect(
          exclusiveClaim.connect(other).refund(depositId)
        ).to.be.revertedWithCustomError(exclusiveClaim, "NotDepositor");
      });
    });
  });

  describe("Multiple Deposits", function () {
    it("should handle multiple deposits from different users", async function () {
      const deadline = (await time.latest()) + ONE_DAY;

      // First deposit: ETH from depositor to claimant
      await exclusiveClaim.connect(depositor).depositETH(claimant.address, IMMEDIATE, deadline, "ETH Deposit", {
        value: ETH_AMOUNT,
      });

      // Second deposit: Tokens from depositor to other
      await mockToken.connect(depositor).approve(await exclusiveClaim.getAddress(), TOKEN_AMOUNT);
      await exclusiveClaim.connect(depositor).depositToken(
        other.address,
        await mockToken.getAddress(),
        TOKEN_AMOUNT,
        IMMEDIATE,
        deadline,
        "Token Deposit"
      );

      expect(await exclusiveClaim.depositCount()).to.equal(2);

      // Claim first deposit
      await exclusiveClaim.connect(claimant).claim(0);

      // Claim second deposit
      await exclusiveClaim.connect(other).claim(1);

      const deposit0 = await exclusiveClaim.getDeposit(0);
      const deposit1 = await exclusiveClaim.getDeposit(1);

      expect(deposit0.claimed).to.equal(true);
      expect(deposit1.claimed).to.equal(true);
    });

    it("should handle race condition: claimant claims just before depositor refunds", async function () {
      const deadline = (await time.latest()) + ONE_DAY;
      await exclusiveClaim.connect(depositor).depositETH(claimant.address, IMMEDIATE, deadline, DEFAULT_TITLE, {
        value: ETH_AMOUNT,
      });

      // Move time to just after deadline
      await time.increase(ONE_DAY + 1);

      // Claimant claims successfully
      await exclusiveClaim.connect(claimant).claim(0);

      // Depositor tries to refund but fails because already claimed
      await expect(
        exclusiveClaim.connect(depositor).refund(0)
      ).to.be.revertedWithCustomError(exclusiveClaim, "AlreadyClaimed");
    });
  });

  describe("Edge Cases", function () {
    it("should handle very small amounts", async function () {
      const deadline = (await time.latest()) + ONE_DAY;
      const smallAmount = 1n; // 1 wei

      await exclusiveClaim.connect(depositor).depositETH(claimant.address, IMMEDIATE, deadline, DEFAULT_TITLE, {
        value: smallAmount,
      });

      await exclusiveClaim.connect(claimant).claim(0);

      const deposit = await exclusiveClaim.getDeposit(0);
      expect(deposit.claimed).to.equal(true);
    });

    it("should handle very large amounts", async function () {
      const deadline = (await time.latest()) + ONE_DAY;
      const largeAmount = ethers.parseEther("1000"); // 1000 ETH (reasonable for test accounts)

      await exclusiveClaim.connect(depositor).depositETH(claimant.address, IMMEDIATE, deadline, DEFAULT_TITLE, {
        value: largeAmount,
      });

      const deposit = await exclusiveClaim.getDeposit(0);
      expect(deposit.amount).to.equal(largeAmount);
    });

    it("should handle minimum deadline (1 second in future)", async function () {
      const deadline = (await time.latest()) + 2; // +2 to account for block time

      await exclusiveClaim.connect(depositor).depositETH(claimant.address, IMMEDIATE, deadline, DEFAULT_TITLE, {
        value: ETH_AMOUNT,
      });

      const deposit = await exclusiveClaim.getDeposit(0);
      expect(deposit.deadline).to.equal(deadline);
    });

    it("should allow depositor to be their own claimant", async function () {
      const deadline = (await time.latest()) + ONE_DAY;

      await exclusiveClaim.connect(depositor).depositETH(depositor.address, IMMEDIATE, deadline, DEFAULT_TITLE, {
        value: ETH_AMOUNT,
      });

      await exclusiveClaim.connect(depositor).claim(0);

      const deposit = await exclusiveClaim.getDeposit(0);
      expect(deposit.claimed).to.equal(true);
    });

    it("should handle empty title", async function () {
      const deadline = (await time.latest()) + ONE_DAY;

      await exclusiveClaim.connect(depositor).depositETH(claimant.address, IMMEDIATE, deadline, "", {
        value: ETH_AMOUNT,
      });

      const deposit = await exclusiveClaim.getDeposit(0);
      expect(deposit.title).to.equal("");
    });

    it("should handle max length title", async function () {
      const deadline = (await time.latest()) + ONE_DAY;
      const maxTitle = "a".repeat(128); // Exactly MAX_TITLE_LENGTH

      await exclusiveClaim.connect(depositor).depositETH(claimant.address, IMMEDIATE, deadline, maxTitle, {
        value: ETH_AMOUNT,
      });

      const deposit = await exclusiveClaim.getDeposit(0);
      expect(deposit.title).to.equal(maxTitle);
    });
  });
});
```
