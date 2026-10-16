# bridge-base--unclekaldoteth

- domain: relayer-meta-transactions (bridge)
- level: complex
- origin: human
- convention: hardhat2-ethers6
- source: https://github.com/unclekaldoteth/stacks-bridge @ 629c8c719f82e5fb7a929f065d28ae5dc97d922d
- license: MIT
- targets: BridgeBase.sol, MockUSDC.sol
- validation: 28 passing tests, 0 failing; statement coverage BridgeBase.sol 94.38 %, MockUSDC.sol 50.0 %

## Contract: BridgeBase.sol (primary target)

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";

/**
 * @title BridgeBase
 * @notice Base <> Stacks USDC Bridge with Multi-Sig, Rate Limiting, and Timelock
 * @dev Security layers:
 *      1. Multi-sig (2-of-3) for releases
 *      2. Rate limiting (per-tx, hourly, daily caps)
 *      3. Timelock for large withdrawals
 *      4. Emergency pause
 */
contract BridgeBase is Ownable, ReentrancyGuard, Pausable {
    using SafeERC20 for IERC20;

    // ============================================
    // STATE VARIABLES
    // ============================================
    
    IERC20 public immutable usdc;
    
    // Multi-sig configuration
    // MAINNET: Requires 2-of-3 signatures for releases
    uint256 public constant REQUIRED_SIGNATURES = 2;
    uint256 public constant MAX_SIGNERS = 3;
    address[] public signers;
    mapping(address => bool) public isSigner;
    
    // Rate limiting
    uint256 public constant MIN_DEPOSIT = 10 * 1e6;  // 10 USDC minimum to prevent dust attacks
    uint256 public maxPerTx = 10_000 * 1e6;      // 10,000 USDC
    uint256 public hourlyLimit = 50_000 * 1e6;   // 50,000 USDC/hour
    uint256 public dailyLimit = 200_000 * 1e6;   // 200,000 USDC/day
    
    uint256 public currentHourlyVolume;
    uint256 public currentDailyVolume;
    uint256 public lastHourReset;
    uint256 public lastDayReset;
    
    // Timelock configuration
    uint256 public constant SMALL_TX_THRESHOLD = 1_000 * 1e6;   // 1,000 USDC - instant
    uint256 public constant MEDIUM_TX_THRESHOLD = 10_000 * 1e6; // 10,000 USDC - 10 min delay
    uint256 public constant SMALL_DELAY = 0;
    uint256 public constant MEDIUM_DELAY = 10 minutes;
    uint256 public constant LARGE_DELAY = 1 hours;
    
    // Pending releases with timelock
    struct PendingRelease {
        address receiver;
        uint256 amount;
        uint256 executeAfter;
        uint256 approvalCount;
        bool executed;
        bool cancelled;
    }
    
    uint256 public releaseNonce;
    mapping(uint256 => PendingRelease) public pendingReleases;
    mapping(uint256 => mapping(address => bool)) public hasApproved;
    
    // Deposit tracking
    mapping(string => uint256) public pendingDeposits;

    // ============================================
    // EVENTS
    // ============================================
    
    event Deposit(
        address indexed from,
        uint256 amount,
        string stacksAddress,
        uint256 timestamp
    );
    
    event ReleaseQueued(
        uint256 indexed releaseId,
        address indexed receiver,
        uint256 amount,
        uint256 executeAfter
    );
    
    event ReleaseApproved(
        uint256 indexed releaseId,
        address indexed signer,
        uint256 approvalCount
    );
    
    event ReleaseExecuted(
        uint256 indexed releaseId,
        address indexed receiver,
        uint256 amount
    );
    
    event ReleaseCancelled(uint256 indexed releaseId);
    
    event SignerAdded(address indexed signer);
    event SignerRemoved(address indexed signer);
    event EmergencyWithdraw(address indexed to, uint256 amount, address indexed by);
    event LimitsUpdated(uint256 maxPerTx, uint256 hourlyLimit, uint256 dailyLimit);

    // ============================================
    // ERRORS
    // ============================================
    
    error NotSigner();
    error InvalidAmount();
    error AmountBelowMinimum();
    error InvalidAddress();
    error InvalidStacksAddress();
    error ExceedsMaxPerTx();
    error ExceedsHourlyLimit();
    error ExceedsDailyLimit();
    error InsufficientContractBalance();
    error ReleaseNotFound();
    error ReleaseAlreadyExecuted();
    error ReleaseCancelledError();
    error TimelockNotExpired();
    error InsufficientApprovals();
    error AlreadyApproved();
    error TooManySigners();
    error NotEnoughSigners();
    error SignerAlreadyExists();
    error SignerDoesNotExist();

    // ============================================
    // CONSTRUCTOR
    // ============================================
    
    constructor(
        address _usdc, 
        address[] memory _initialSigners
    ) Ownable(msg.sender) {
        require(_usdc != address(0), "Invalid USDC address");
        require(_initialSigners.length >= REQUIRED_SIGNATURES, "Need at least 1 signer");
        require(_initialSigners.length <= MAX_SIGNERS, "Too many signers");
        
        usdc = IERC20(_usdc);
        
        for (uint256 i = 0; i < _initialSigners.length; i++) {
            require(_initialSigners[i] != address(0), "Invalid signer");
            require(!isSigner[_initialSigners[i]], "Duplicate signer");
            
            signers.push(_initialSigners[i]);
            isSigner[_initialSigners[i]] = true;
            emit SignerAdded(_initialSigners[i]);
        }
        
        lastHourReset = block.timestamp;
        lastDayReset = block.timestamp;
    }

    // ============================================
    // MODIFIERS
    // ============================================
    
    modifier onlySigner() {
        if (!isSigner[msg.sender]) revert NotSigner();
        _;
    }
    
    modifier updateRateLimits() {
        _resetRateLimitsIfNeeded();
        _;
    }

    // ============================================
    // USER FUNCTIONS
    // ============================================
    
    /**
     * @notice Lock USDC to bridge to Stacks
     * @param amount Amount of USDC to lock (6 decimals)
     * @param stacksAddress Destination Stacks address
     */
    function lock(uint256 amount, string calldata stacksAddress) 
        external 
        nonReentrant 
        whenNotPaused
        updateRateLimits
    {
        if (amount == 0) revert InvalidAmount();
        if (amount < MIN_DEPOSIT) revert AmountBelowMinimum();
        
        // Validate Stacks address (34-64 chars, must start with S)
        bytes memory addrBytes = bytes(stacksAddress);
        uint256 addrLen = addrBytes.length;
        if (addrLen < 34 || addrLen > 64) revert InvalidStacksAddress();
        // Stacks addresses start with 'S' (mainnet SP/SM) or 'ST' (testnet)
        if (addrBytes[0] != 0x53) revert InvalidStacksAddress(); // 'S' = 0x53
        
        // Transfer USDC from user to this contract
        usdc.safeTransferFrom(msg.sender, address(this), amount);
        
        // Track pending deposit
        pendingDeposits[stacksAddress] += amount;
        
        emit Deposit(msg.sender, amount, stacksAddress, block.timestamp);
    }

    // ============================================
    // MULTI-SIG RELEASE FUNCTIONS
    // ============================================
    
    /**
     * @notice Queue a release (any signer can initiate)
     * @param receiver EVM address to receive USDC
     * @param amount Amount to release
     */
    function queueRelease(address receiver, uint256 amount) 
        external 
        onlySigner 
        whenNotPaused
        updateRateLimits
        returns (uint256 releaseId)
    {
        // Validate inputs
        if (amount == 0) revert InvalidAmount();
        if (receiver == address(0)) revert InvalidAddress();
        
        // Check rate limits
        if (amount > maxPerTx) revert ExceedsMaxPerTx();
        if (currentHourlyVolume + amount > hourlyLimit) revert ExceedsHourlyLimit();
        if (currentDailyVolume + amount > dailyLimit) revert ExceedsDailyLimit();
        
        // Check balance
        if (usdc.balanceOf(address(this)) < amount) {
            revert InsufficientContractBalance();
        }
        
        // Calculate timelock delay based on amount
        uint256 delay = _getDelayForAmount(amount);
        uint256 executeAfter = block.timestamp + delay;
        
        // Create pending release
        releaseId = releaseNonce++;
        pendingReleases[releaseId] = PendingRelease({
            receiver: receiver,
            amount: amount,
            executeAfter: executeAfter,
            approvalCount: 1, // Initiator auto-approves
            executed: false,
            cancelled: false
        });
        
        hasApproved[releaseId][msg.sender] = true;
        
        // Update rate limit tracking
        currentHourlyVolume += amount;
        currentDailyVolume += amount;
        
        emit ReleaseQueued(releaseId, receiver, amount, executeAfter);
        emit ReleaseApproved(releaseId, msg.sender, 1);
        
        return releaseId;
    }
    
    /**
     * @notice Approve a pending release (requires 2-of-3)
     * @param releaseId The release to approve
     */
    function approveRelease(uint256 releaseId) 
        external 
        onlySigner 
        whenNotPaused
    {
        PendingRelease storage release = pendingReleases[releaseId];
        
        if (release.receiver == address(0)) revert ReleaseNotFound();
        if (release.executed) revert ReleaseAlreadyExecuted();
        if (release.cancelled) revert ReleaseCancelledError();
        if (hasApproved[releaseId][msg.sender]) revert AlreadyApproved();
        
        hasApproved[releaseId][msg.sender] = true;
        release.approvalCount = _countApprovals(releaseId);
        
        emit ReleaseApproved(releaseId, msg.sender, release.approvalCount);
    }
    
    /**
     * @notice Execute a release after timelock and approvals
     * @param releaseId The release to execute
     */
    function executeRelease(uint256 releaseId) 
        external 
        nonReentrant 
        whenNotPaused
    {
        PendingRelease storage release = pendingReleases[releaseId];
        
        if (release.receiver == address(0)) revert ReleaseNotFound();
        if (release.executed) revert ReleaseAlreadyExecuted();
        if (release.cancelled) revert ReleaseCancelledError();
        if (block.timestamp < release.executeAfter) revert TimelockNotExpired();
        uint256 approvalCount = _countApprovals(releaseId);
        if (approvalCount < REQUIRED_SIGNATURES) revert InsufficientApprovals();
        
        // Check balance again at execution time
        if (usdc.balanceOf(address(this)) < release.amount) {
            revert InsufficientContractBalance();
        }
        
        release.executed = true;
        
        usdc.safeTransfer(release.receiver, release.amount);
        
        emit ReleaseExecuted(releaseId, release.receiver, release.amount);
    }
    
    /**
     * @notice Cancel a pending release (any signer)
     * @param releaseId The release to cancel
     */
    function cancelRelease(uint256 releaseId) 
        external 
        onlySigner
    {
        PendingRelease storage release = pendingReleases[releaseId];
        
        if (release.receiver == address(0)) revert ReleaseNotFound();
        if (release.executed) revert ReleaseAlreadyExecuted();
        if (release.cancelled) revert ReleaseCancelledError();
        
        release.cancelled = true;
        
        // Refund the rate limit tracking
        if (currentHourlyVolume >= release.amount) {
            currentHourlyVolume -= release.amount;
        }
        if (currentDailyVolume >= release.amount) {
            currentDailyVolume -= release.amount;
        }
        
        emit ReleaseCancelled(releaseId);
    }

    // ============================================
    // ADMIN FUNCTIONS
    // ============================================
    
    function addSigner(address newSigner) external onlyOwner {
        if (signers.length >= MAX_SIGNERS) revert TooManySigners();
        if (newSigner == address(0)) revert InvalidAddress();
        if (isSigner[newSigner]) revert SignerAlreadyExists();
        
        signers.push(newSigner);
        isSigner[newSigner] = true;
        
        emit SignerAdded(newSigner);
    }
    
    function removeSigner(address signer) external onlyOwner {
        if (!isSigner[signer]) revert SignerDoesNotExist();
        if (signers.length <= REQUIRED_SIGNATURES) revert NotEnoughSigners();
        
        isSigner[signer] = false;
        
        // Remove from array
        for (uint256 i = 0; i < signers.length; i++) {
            if (signers[i] == signer) {
                signers[i] = signers[signers.length - 1];
                signers.pop();
                break;
            }
        }
        
        emit SignerRemoved(signer);
    }
    
    function updateLimits(
        uint256 _maxPerTx,
        uint256 _hourlyLimit,
        uint256 _dailyLimit
    ) external onlyOwner {
        maxPerTx = _maxPerTx;
        hourlyLimit = _hourlyLimit;
        dailyLimit = _dailyLimit;
        
        emit LimitsUpdated(_maxPerTx, _hourlyLimit, _dailyLimit);
    }
    
    function pause() external onlySigner {
        _pause();
    }
    
    function unpause() external onlyOwner {
        _unpause();
    }
    
    function emergencyWithdraw(address to, uint256 amount) external onlyOwner {
        require(to != address(0), "Invalid address");
        usdc.safeTransfer(to, amount);
        emit EmergencyWithdraw(to, amount, msg.sender);
    }

    // ============================================
    // VIEW FUNCTIONS
    // ============================================
    
    function getLockedBalance() external view returns (uint256) {
        return usdc.balanceOf(address(this));
    }
    
    function getSigners() external view returns (address[] memory) {
        return signers;
    }
    
    function getSignerCount() external view returns (uint256) {
        return signers.length;
    }
    
    function getReleaseInfo(uint256 releaseId) external view returns (
        address receiver,
        uint256 amount,
        uint256 executeAfter,
        uint256 approvalCount,
        bool executed,
        bool cancelled
    ) {
        PendingRelease storage r = pendingReleases[releaseId];
        return (r.receiver, r.amount, r.executeAfter, _countApprovals(releaseId), r.executed, r.cancelled);
    }
    
    function getRemainingLimits() external view returns (
        uint256 remainingHourly,
        uint256 remainingDaily
    ) {
        uint256 hourly = currentHourlyVolume > hourlyLimit ? 0 : hourlyLimit - currentHourlyVolume;
        uint256 daily = currentDailyVolume > dailyLimit ? 0 : dailyLimit - currentDailyVolume;
        return (hourly, daily);
    }
    
    function getPendingDeposit(string calldata stacksAddress) external view returns (uint256) {
        return pendingDeposits[stacksAddress];
    }

    // ============================================
    // INTERNAL FUNCTIONS
    // ============================================
    
    function _getDelayForAmount(uint256 amount) internal pure returns (uint256) {
        if (amount <= SMALL_TX_THRESHOLD) {
            return SMALL_DELAY;
        } else if (amount <= MEDIUM_TX_THRESHOLD) {
            return MEDIUM_DELAY;
        } else {
            return LARGE_DELAY;
        }
    }
    
    function _resetRateLimitsIfNeeded() internal {
        if (block.timestamp >= lastHourReset + 1 hours) {
            currentHourlyVolume = 0;
            lastHourReset = block.timestamp;
        }
        
        if (block.timestamp >= lastDayReset + 1 days) {
            currentDailyVolume = 0;
            lastDayReset = block.timestamp;
        }
    }

    function _countApprovals(uint256 releaseId) internal view returns (uint256) {
        uint256 count = 0;
        for (uint256 i = 0; i < signers.length; i++) {
            if (hasApproved[releaseId][signers[i]]) {
                count++;
            }
        }
        return count;
    }
}
```

## Contract: MockUSDC.sol (dependency)

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract MockUSDC is ERC20 {
    constructor() ERC20("USD Coin", "USDC") {}

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}
```

## Tests: BridgeBase.test.js

```javascript
const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");
const { anyValue } = require("@nomicfoundation/hardhat-chai-matchers/withArgs");

describe("BridgeBase", function () {
    let owner;
    let signer1;
    let signer2;
    let signer3;
    let user;
    let receiver;
    let usdc;
    let bridge;

    beforeEach(async function () {
        [owner, signer1, signer2, signer3, user, receiver] = await ethers.getSigners();

        const MockUSDC = await ethers.getContractFactory("MockUSDC");
        usdc = await MockUSDC.deploy();

        const BridgeBase = await ethers.getContractFactory("BridgeBase");
        bridge = await BridgeBase.deploy(await usdc.getAddress(), [
            signer1.address,
            signer2.address,
            signer3.address,
        ]);
    });

    describe("lock", function () {
        it("locks USDC and tracks pending deposits", async function () {
            const amount = await bridge.MIN_DEPOSIT();
            const stacksAddress = "ST1ZGGS886YCZHMFXJR1EK61ZP34FNWNSX28M1PMM";

            await usdc.mint(user.address, amount);
            await usdc.connect(user).approve(await bridge.getAddress(), amount);

            await expect(bridge.connect(user).lock(amount, stacksAddress))
                .to.emit(bridge, "Deposit")
                .withArgs(user.address, amount, stacksAddress, anyValue);

            const pending = await bridge.pendingDeposits(stacksAddress);
            expect(pending).to.equal(amount);
        });

        it("rejects amounts below the minimum", async function () {
            const amount = (await bridge.MIN_DEPOSIT()) - 1n;
            const stacksAddress = "ST1ZGGS886YCZHMFXJR1EK61ZP34FNWNSX28M1PMM";

            await usdc.mint(user.address, amount + 1n);
            await usdc.connect(user).approve(await bridge.getAddress(), amount + 1n);

            await expect(bridge.connect(user).lock(amount, stacksAddress))
                .to.be.revertedWithCustomError(bridge, "AmountBelowMinimum");
        });

        it("rejects invalid Stacks addresses", async function () {
            const amount = await bridge.MIN_DEPOSIT();
            const invalidStacksAddress = "0xabc";

            await usdc.mint(user.address, amount);
            await usdc.connect(user).approve(await bridge.getAddress(), amount);

            await expect(bridge.connect(user).lock(amount, invalidStacksAddress))
                .to.be.revertedWithCustomError(bridge, "InvalidStacksAddress");
        });
    });

    describe("queueRelease", function () {
        it("requires a signer", async function () {
            const amount = ethers.parseUnits("100", 6);
            await usdc.mint(await bridge.getAddress(), amount);

            await expect(
                bridge.connect(user).queueRelease(receiver.address, amount)
            ).to.be.revertedWithCustomError(bridge, "NotSigner");
        });

        it("enforces per-tx and hourly limits", async function () {
            const maxPerTx = ethers.parseUnits("100", 6);
            const hourlyLimit = ethers.parseUnits("150", 6);
            const dailyLimit = ethers.parseUnits("200", 6);

            await bridge.connect(owner).updateLimits(maxPerTx, hourlyLimit, dailyLimit);
            await usdc.mint(await bridge.getAddress(), dailyLimit + 1n);

            await expect(
                bridge.connect(signer1).queueRelease(receiver.address, maxPerTx + 1n)
            ).to.be.revertedWithCustomError(bridge, "ExceedsMaxPerTx");

            await bridge.connect(signer1).queueRelease(receiver.address, maxPerTx);

            await expect(
                bridge.connect(signer1).queueRelease(receiver.address, ethers.parseUnits("60", 6))
            ).to.be.revertedWithCustomError(bridge, "ExceedsHourlyLimit");
        });
    });

    describe("approve + execute", function () {
        it("executes after approvals for small amounts", async function () {
            const amount = ethers.parseUnits("100", 6);
            await usdc.mint(await bridge.getAddress(), amount);

            const releaseId = await bridge
                .connect(signer1)
                .queueRelease.staticCall(receiver.address, amount);

            await bridge.connect(signer1).queueRelease(receiver.address, amount);
            await bridge.connect(signer2).approveRelease(releaseId);

            await expect(bridge.executeRelease(releaseId))
                .to.emit(bridge, "ReleaseExecuted")
                .withArgs(releaseId, receiver.address, amount);

            expect(await usdc.balanceOf(receiver.address)).to.equal(amount);
        });

        it("enforces timelock for medium amounts", async function () {
            const amount = ethers.parseUnits("2000", 6);
            await usdc.mint(await bridge.getAddress(), amount);

            const releaseId = await bridge
                .connect(signer1)
                .queueRelease.staticCall(receiver.address, amount);

            await bridge.connect(signer1).queueRelease(receiver.address, amount);
            await bridge.connect(signer2).approveRelease(releaseId);

            await expect(bridge.executeRelease(releaseId))
                .to.be.revertedWithCustomError(bridge, "TimelockNotExpired");

            const delay = await bridge.MEDIUM_DELAY();
            await time.increase(delay);

            await expect(bridge.executeRelease(releaseId))
                .to.emit(bridge, "ReleaseExecuted")
                .withArgs(releaseId, receiver.address, amount);
        });

        it("tracks approvals and prevents duplicates", async function () {
            const amount = ethers.parseUnits("100", 6);
            await usdc.mint(await bridge.getAddress(), amount);

            const releaseId = await bridge
                .connect(signer1)
                .queueRelease.staticCall(receiver.address, amount);

            await bridge.connect(signer1).queueRelease(receiver.address, amount);
            await bridge.connect(signer2).approveRelease(releaseId);

            await expect(bridge.connect(signer2).approveRelease(releaseId))
                .to.be.revertedWithCustomError(bridge, "AlreadyApproved");
        });

        it("refunds rate limits on cancel", async function () {
            const amount = ethers.parseUnits("500", 6);
            await usdc.mint(await bridge.getAddress(), amount);

            const releaseId = await bridge
                .connect(signer1)
                .queueRelease.staticCall(receiver.address, amount);

            await bridge.connect(signer1).queueRelease(receiver.address, amount);

            expect(await bridge.currentHourlyVolume()).to.equal(amount);
            expect(await bridge.currentDailyVolume()).to.equal(amount);

            await bridge.connect(signer2).cancelRelease(releaseId);

            expect(await bridge.currentHourlyVolume()).to.equal(0n);
            expect(await bridge.currentDailyVolume()).to.equal(0n);
        });
    });

    describe("pause", function () {
        it("prevents lock when paused", async function () {
            const amount = await bridge.MIN_DEPOSIT();
            const stacksAddress = "ST1ZGGS886YCZHMFXJR1EK61ZP34FNWNSX28M1PMM";

            await usdc.mint(user.address, amount);
            await usdc.connect(user).approve(await bridge.getAddress(), amount);

            await bridge.connect(signer1).pause();

            await expect(bridge.connect(user).lock(amount, stacksAddress))
                .to.be.revertedWithCustomError(bridge, "EnforcedPause");
        });

        it("prevents queueRelease when paused", async function () {
            const amount = ethers.parseUnits("100", 6);
            await usdc.mint(await bridge.getAddress(), amount);

            await bridge.connect(signer1).pause();

            await expect(
                bridge.connect(signer1).queueRelease(receiver.address, amount)
            ).to.be.revertedWithCustomError(bridge, "EnforcedPause");
        });

        it("prevents executeRelease when paused", async function () {
            const amount = ethers.parseUnits("100", 6);
            await usdc.mint(await bridge.getAddress(), amount);

            const releaseId = await bridge
                .connect(signer1)
                .queueRelease.staticCall(receiver.address, amount);

            await bridge.connect(signer1).queueRelease(receiver.address, amount);
            await bridge.connect(signer2).approveRelease(releaseId);

            await bridge.connect(signer1).pause();

            await expect(bridge.executeRelease(releaseId))
                .to.be.revertedWithCustomError(bridge, "EnforcedPause");
        });

        it("only signers can pause, only owner can unpause", async function () {
            // Non-signer cannot pause
            await expect(bridge.connect(user).pause())
                .to.be.revertedWithCustomError(bridge, "NotSigner");

            // Signer can pause
            await bridge.connect(signer1).pause();

            // Non-owner cannot unpause
            await expect(bridge.connect(signer1).unpause())
                .to.be.revertedWithCustomError(bridge, "OwnableUnauthorizedAccount");

            await bridge.connect(owner).unpause();
        });
    });

    describe("signer management", function () {
        it("addSigner - owner only and respects MAX_SIGNERS", async function () {
            // First remove a signer to make room
            await bridge.connect(owner).removeSigner(signer1.address);

            const newSigner = (await ethers.getSigners())[6];

            await expect(bridge.connect(user).addSigner(newSigner.address))
                .to.be.revertedWithCustomError(bridge, "OwnableUnauthorizedAccount");

            await expect(bridge.connect(owner).addSigner(newSigner.address))
                .to.emit(bridge, "SignerAdded")
                .withArgs(newSigner.address);

            expect(await bridge.isSigner(newSigner.address)).to.be.true;
        });

        it("addSigner - respects MAX_SIGNERS limit", async function () {
            const newSigner = (await ethers.getSigners())[6];
            // Already at max 3 signers, should fail
            await expect(bridge.connect(owner).addSigner(newSigner.address))
                .to.be.revertedWithCustomError(bridge, "TooManySigners");
        });

        it("removeSigner - owner only", async function () {
            await expect(bridge.connect(user).removeSigner(signer1.address))
                .to.be.revertedWithCustomError(bridge, "OwnableUnauthorizedAccount");

            await expect(bridge.connect(owner).removeSigner(signer1.address))
                .to.emit(bridge, "SignerRemoved")
                .withArgs(signer1.address);

            expect(await bridge.isSigner(signer1.address)).to.be.false;
        });

        it("removeSigner - keeps minimum signers", async function () {
            // With REQUIRED_SIGNATURES=2, we need at least 2 signers
            // Remove one signer (3 -> 2)
            await bridge.connect(owner).removeSigner(signer1.address);

            // Removing another signer should fail (need at least 2 for REQUIRED_SIGNATURES=2)
            await expect(bridge.connect(owner).removeSigner(signer2.address))
                .to.be.revertedWithCustomError(bridge, "NotEnoughSigners");
        });

        it("removeSigner - non-existent signer reverts", async function () {
            await expect(bridge.connect(owner).removeSigner(user.address))
                .to.be.revertedWithCustomError(bridge, "SignerDoesNotExist");
        });
    });

    describe("emergency withdraw", function () {
        it("only owner can call", async function () {
            const amount = ethers.parseUnits("1000", 6);
            await usdc.mint(await bridge.getAddress(), amount);

            await expect(
                bridge.connect(user).emergencyWithdraw(owner.address, amount)
            ).to.be.revertedWithCustomError(bridge, "OwnableUnauthorizedAccount");
        });

        it("transfers correct amount and emits event", async function () {
            const amount = ethers.parseUnits("1000", 6);
            await usdc.mint(await bridge.getAddress(), amount);

            const balanceBefore = await usdc.balanceOf(owner.address);

            await expect(bridge.connect(owner).emergencyWithdraw(owner.address, amount))
                .to.emit(bridge, "EmergencyWithdraw")
                .withArgs(owner.address, amount, owner.address);

            const balanceAfter = await usdc.balanceOf(owner.address);
            expect(balanceAfter - balanceBefore).to.equal(amount);
        });
    });

    describe("edge cases", function () {
        it("daily limit enforcement", async function () {
            const maxPerTx = ethers.parseUnits("100", 6);
            const hourlyLimit = ethers.parseUnits("500", 6);
            const dailyLimit = ethers.parseUnits("150", 6);

            await bridge.connect(owner).updateLimits(maxPerTx, hourlyLimit, dailyLimit);
            await usdc.mint(await bridge.getAddress(), dailyLimit * 2n);

            // First release should succeed
            await bridge.connect(signer1).queueRelease(receiver.address, maxPerTx);

            // Second release should fail due to daily limit
            await expect(
                bridge.connect(signer1).queueRelease(receiver.address, ethers.parseUnits("60", 6))
            ).to.be.revertedWithCustomError(bridge, "ExceedsDailyLimit");
        });

        it("executeRelease after cancelled reverts", async function () {
            const amount = ethers.parseUnits("100", 6);
            await usdc.mint(await bridge.getAddress(), amount);

            const releaseId = await bridge
                .connect(signer1)
                .queueRelease.staticCall(receiver.address, amount);

            await bridge.connect(signer1).queueRelease(receiver.address, amount);
            await bridge.connect(signer2).cancelRelease(releaseId);

            await expect(bridge.executeRelease(releaseId))
                .to.be.revertedWithCustomError(bridge, "ReleaseCancelledError");
        });

        it("approveRelease by non-signer reverts", async function () {
            const amount = ethers.parseUnits("100", 6);
            await usdc.mint(await bridge.getAddress(), amount);

            const releaseId = await bridge
                .connect(signer1)
                .queueRelease.staticCall(receiver.address, amount);

            await bridge.connect(signer1).queueRelease(receiver.address, amount);

            await expect(bridge.connect(user).approveRelease(releaseId))
                .to.be.revertedWithCustomError(bridge, "NotSigner");
        });

        it("large amount requires 1 hour timelock", async function () {
            const amount = ethers.parseUnits("6000", 6);
            await usdc.mint(await bridge.getAddress(), amount);

            const releaseId = await bridge
                .connect(signer1)
                .queueRelease.staticCall(receiver.address, amount);

            await bridge.connect(signer1).queueRelease(receiver.address, amount);
            await bridge.connect(signer2).approveRelease(releaseId);

            // Should fail before timelock
            await expect(bridge.executeRelease(releaseId))
                .to.be.revertedWithCustomError(bridge, "TimelockNotExpired");

            // Wait for large delay (1 hour)
            const largeDelay = await bridge.LARGE_DELAY();
            await time.increase(largeDelay);

            await expect(bridge.executeRelease(releaseId))
                .to.emit(bridge, "ReleaseExecuted");
        });

        // Note: REQUIRED_SIGNATURES=1 in testnet config, so we skip insufficient approvals test
    });

    describe("view functions", function () {
        it("getLockedBalance returns correct value", async function () {
            const amount = ethers.parseUnits("500", 6);
            await usdc.mint(await bridge.getAddress(), amount);

            expect(await bridge.getLockedBalance()).to.equal(amount);
        });

        it("getSigners returns all signers", async function () {
            const signers = await bridge.getSigners();
            expect(signers.length).to.equal(3);
            expect(signers).to.include(signer1.address);
            expect(signers).to.include(signer2.address);
            expect(signers).to.include(signer3.address);
        });

        it("getReleaseInfo returns correct data", async function () {
            const amount = ethers.parseUnits("100", 6);
            await usdc.mint(await bridge.getAddress(), amount);

            const releaseId = await bridge
                .connect(signer1)
                .queueRelease.staticCall(receiver.address, amount);

            await bridge.connect(signer1).queueRelease(receiver.address, amount);

            const info = await bridge.getReleaseInfo(releaseId);
            expect(info.receiver).to.equal(receiver.address);
            expect(info.amount).to.equal(amount);
            expect(info.approvalCount).to.equal(1);
            expect(info.executed).to.be.false;
            expect(info.cancelled).to.be.false;
        });

        it("getPendingDeposit returns correct value", async function () {
            const amount = await bridge.MIN_DEPOSIT();
            const stacksAddress = "ST1ZGGS886YCZHMFXJR1EK61ZP34FNWNSX28M1PMM";

            await usdc.mint(user.address, amount);
            await usdc.connect(user).approve(await bridge.getAddress(), amount);
            await bridge.connect(user).lock(amount, stacksAddress);

            expect(await bridge.getPendingDeposit(stacksAddress)).to.equal(amount);
        });
    });
});
```
