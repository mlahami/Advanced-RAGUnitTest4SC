# flash-token--btcdanaindiaoff-arch

- domain: lending-collateral (flash-loan)
- level: complex
- origin: human
- convention: hardhat2-ethers6
- source: https://github.com/btcdanaindiaoff-arch/flash-token @ 4eeb96a09767d06d4cbc9a85bf86ca212b5a1f25
- license: MIT
- targets: FlashToken.sol
- validation: 26 passing tests, 0 failing; statement coverage FlashToken.sol 100.0 %

## Contract: FlashToken.sol (primary target)

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title FlashToken
 * @author thirdweb Smart Contract Developer
 * @notice ERC-20 token with ERC-3156 Flash Loan capability
 * @dev Implements flash minting - allows uncollateralized borrowing
 *      of tokens within a single transaction. Tokens are minted to
 *      the borrower and must be returned + fee by end of transaction.
 *
 *      Key Features:
 *      - Standard ERC-20 with mint/burn
 *      - ERC-3156 Flash Loan (flash mint)
 *      - Configurable flash fee (default 0.1%)
 *      - Max flash loan cap for safety
 *      - Owner-controlled fee and cap settings
 *      - ReentrancyGuard protection
 *      - Events for all state changes
 */

// ============================================
// INTERFACES
// ============================================

interface IERC3156FlashBorrower {
    function onFlashLoan(
        address initiator,
        address token,
        uint256 amount,
        uint256 fee,
        bytes calldata data
    ) external returns (bytes32);
}

interface IERC3156FlashLender {
    function maxFlashLoan(address token) external view returns (uint256);
    function flashFee(address token, uint256 amount) external view returns (uint256);
    function flashLoan(
        IERC3156FlashBorrower receiver,
        address token,
        uint256 amount,
        bytes calldata data
    ) external returns (bool);
}

// ============================================
// FLASH TOKEN CONTRACT
// ============================================

contract FlashToken is IERC3156FlashLender {

    // ---- ERC-20 Storage ----
    string public name;
    string public symbol;
    uint8 public constant decimals = 18;
    uint256 public totalSupply;

    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    // ---- Flash Loan Storage ----
    uint256 public flashFeeBps;
    uint256 public maxFlashLoanAmount;
    address public feeReceiver;
    uint256 public totalFeesCollected;

    // ---- Access Control ----
    address public owner;

    // ---- Reentrancy Guard ----
    uint256 private _locked = 1;

    // ---- Constants ----
    bytes32 public constant CALLBACK_SUCCESS = keccak256("ERC3156FlashBorrower.onFlashLoan");
    uint256 public constant MAX_FEE_BPS = 1000;
    uint256 public constant BPS_DENOMINATOR = 10000;

    // ---- Events ----
    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);
    event FlashLoan(address indexed receiver, address indexed initiator, address indexed token, uint256 amount, uint256 fee);
    event FlashFeeUpdated(uint256 oldFeeBps, uint256 newFeeBps);
    event MaxFlashLoanUpdated(uint256 oldMax, uint256 newMax);
    event FeeReceiverUpdated(address oldReceiver, address newReceiver);
    event FeesWithdrawn(address indexed to, uint256 amount);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);
    event TokensMinted(address indexed to, uint256 amount);
    event TokensBurned(address indexed from, uint256 amount);

    // ---- Custom Errors ----
    error NotOwner();
    error ZeroAddress();
    error InsufficientBalance();
    error InsufficientAllowance();
    error FlashLoanExceedsMax(uint256 amount, uint256 max);
    error UnsupportedToken(address token);
    error FlashLoanCallbackFailed();
    error FlashLoanRepaymentFailed();
    error FeeTooHigh(uint256 feeBps, uint256 maxBps);
    error ReentrancyDetected();
    error ZeroAmount();

    // ---- Modifiers ----
    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    modifier nonReentrant() {
        if (_locked == 2) revert ReentrancyDetected();
        _locked = 2;
        _;
        _locked = 1;
    }

    constructor(
        string memory _name,
        string memory _symbol,
        uint256 _initialSupply,
        uint256 _flashFeeBps,
        uint256 _maxFlashLoan
    ) {
        if (_flashFeeBps > MAX_FEE_BPS) revert FeeTooHigh(_flashFeeBps, MAX_FEE_BPS);

        name = _name;
        symbol = _symbol;
        owner = msg.sender;
        feeReceiver = msg.sender;
        flashFeeBps = _flashFeeBps;

        uint256 supply = _initialSupply * 10 ** decimals;
        maxFlashLoanAmount = _maxFlashLoan == 0 ? type(uint256).max : _maxFlashLoan * 10 ** decimals;

        if (supply > 0) {
            balanceOf[msg.sender] = supply;
            totalSupply = supply;
            emit Transfer(address(0), msg.sender, supply);
        }

        emit OwnershipTransferred(address(0), msg.sender);
    }

    // ============================================
    // ERC-20 FUNCTIONS
    // ============================================

    function transfer(address to, uint256 amount) external returns (bool) {
        if (to == address(0)) revert ZeroAddress();
        if (balanceOf[msg.sender] < amount) revert InsufficientBalance();
        unchecked { balanceOf[msg.sender] -= amount; }
        balanceOf[to] += amount;
        emit Transfer(msg.sender, to, amount);
        return true;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        if (spender == address(0)) revert ZeroAddress();
        allowance[msg.sender][spender] = amount;
        emit Approval(msg.sender, spender, amount);
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        if (to == address(0)) revert ZeroAddress();
        if (balanceOf[from] < amount) revert InsufficientBalance();
        uint256 currentAllowance = allowance[from][msg.sender];
        if (currentAllowance != type(uint256).max) {
            if (currentAllowance < amount) revert InsufficientAllowance();
            unchecked { allowance[from][msg.sender] -= amount; }
        }
        unchecked { balanceOf[from] -= amount; }
        balanceOf[to] += amount;
        emit Transfer(from, to, amount);
        return true;
    }

    // ============================================
    // ERC-3156 FLASH LOAN FUNCTIONS
    // ============================================

    function maxFlashLoan(address token) external view override returns (uint256) {
        if (token != address(this)) return 0;
        return maxFlashLoanAmount;
    }

    function flashFee(address token, uint256 amount) external view override returns (uint256) {
        if (token != address(this)) revert UnsupportedToken(token);
        return _flashFee(amount);
    }

    function flashLoan(
        IERC3156FlashBorrower receiver,
        address token,
        uint256 amount,
        bytes calldata data
    ) external override nonReentrant returns (bool) {
        if (token != address(this)) revert UnsupportedToken(token);
        if (amount == 0) revert ZeroAmount();
        if (amount > maxFlashLoanAmount) revert FlashLoanExceedsMax(amount, maxFlashLoanAmount);

        uint256 fee = _flashFee(amount);

        // Flash mint
        balanceOf[address(receiver)] += amount;
        totalSupply += amount;
        emit Transfer(address(0), address(receiver), amount);

        // Callback
        bytes32 result = receiver.onFlashLoan(msg.sender, token, amount, fee, data);
        if (result != CALLBACK_SUCCESS) revert FlashLoanCallbackFailed();

        // Verify repayment
        uint256 repayment = amount + fee;
        uint256 borrowerBalance = balanceOf[address(receiver)];
        uint256 borrowerAllowance = allowance[address(receiver)][address(this)];
        if (borrowerBalance < repayment) revert FlashLoanRepaymentFailed();
        if (borrowerAllowance < repayment) revert FlashLoanRepaymentFailed();

        unchecked {
            allowance[address(receiver)][address(this)] -= repayment;
            balanceOf[address(receiver)] -= repayment;
        }

        // Burn principal
        totalSupply -= amount;
        emit Transfer(address(receiver), address(0), amount);

        // Send fee to receiver
        if (fee > 0) {
            balanceOf[feeReceiver] += fee;
            totalFeesCollected += fee;
            emit Transfer(address(receiver), feeReceiver, fee);
        }

        emit FlashLoan(address(receiver), msg.sender, token, amount, fee);
        return true;
    }

    // ============================================
    // OWNER FUNCTIONS
    // ============================================

    function mint(address to, uint256 amount) external onlyOwner {
        if (to == address(0)) revert ZeroAddress();
        if (amount == 0) revert ZeroAmount();
        balanceOf[to] += amount;
        totalSupply += amount;
        emit Transfer(address(0), to, amount);
        emit TokensMinted(to, amount);
    }

    function burn(uint256 amount) external {
        if (amount == 0) revert ZeroAmount();
        if (balanceOf[msg.sender] < amount) revert InsufficientBalance();
        unchecked { balanceOf[msg.sender] -= amount; }
        totalSupply -= amount;
        emit Transfer(msg.sender, address(0), amount);
        emit TokensBurned(msg.sender, amount);
    }

    function setFlashFee(uint256 newFeeBps) external onlyOwner {
        if (newFeeBps > MAX_FEE_BPS) revert FeeTooHigh(newFeeBps, MAX_FEE_BPS);
        uint256 oldFee = flashFeeBps;
        flashFeeBps = newFeeBps;
        emit FlashFeeUpdated(oldFee, newFeeBps);
    }

    function setMaxFlashLoan(uint256 newMax) external onlyOwner {
        uint256 oldMax = maxFlashLoanAmount;
        maxFlashLoanAmount = newMax == 0 ? type(uint256).max : newMax * 10 ** decimals;
        emit MaxFlashLoanUpdated(oldMax, maxFlashLoanAmount);
    }

    function setFeeReceiver(address newReceiver) external onlyOwner {
        if (newReceiver == address(0)) revert ZeroAddress();
        address oldReceiver = feeReceiver;
        feeReceiver = newReceiver;
        emit FeeReceiverUpdated(oldReceiver, newReceiver);
    }

    function transferOwnership(address newOwner) external onlyOwner {
        if (newOwner == address(0)) revert ZeroAddress();
        address oldOwner = owner;
        owner = newOwner;
        emit OwnershipTransferred(oldOwner, newOwner);
    }

    // ============================================
    // VIEW FUNCTIONS
    // ============================================

    function flashLoanInfo() external view returns (
        uint256 _maxLoan, uint256 _feeBps, address _feeReceiver, uint256 _totalFees
    ) {
        return (maxFlashLoanAmount, flashFeeBps, feeReceiver, totalFeesCollected);
    }

    function _flashFee(uint256 amount) internal view returns (uint256) {
        return (amount * flashFeeBps) / BPS_DENOMINATOR;
    }
}


// ============================================
// EXAMPLE FLASH BORROWER
// ============================================

contract ExampleFlashBorrower is IERC3156FlashBorrower {
    bytes32 public constant CALLBACK_SUCCESS = keccak256("ERC3156FlashBorrower.onFlashLoan");

    event FlashLoanReceived(address initiator, address token, uint256 amount, uint256 fee);

    function executeFlashLoan(
        IERC3156FlashLender lender,
        address token,
        uint256 amount
    ) external {
        bytes memory data = abi.encode(msg.sender);
        lender.flashLoan(this, token, amount, data);
    }

    function onFlashLoan(
        address initiator,
        address token,
        uint256 amount,
        uint256 fee,
        bytes calldata
    ) external override returns (bytes32) {
        emit FlashLoanReceived(initiator, token, amount, fee);

        // YOUR CUSTOM LOGIC HERE:
        // - Arbitrage between DEXes
        // - Liquidate undercollateralized positions
        // - Swap collateral types

        // Approve repayment
        FlashToken(token).approve(msg.sender, amount + fee);
        return CALLBACK_SUCCESS;
    }
}
```

## Tests: FlashToken.test.js

```javascript
const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("FlashToken", function () {
  let flashToken, borrower, owner, user1, user2;
  const NAME = "Flash Token";
  const SYMBOL = "FLASH";
  const INITIAL_SUPPLY = 1000000n;
  const FLASH_FEE_BPS = 10n;
  const MAX_FLASH_LOAN = 500000n;
  const DECIMALS = 18n;
  const ONE_TOKEN = 10n ** DECIMALS;

  beforeEach(async function () {
    [owner, user1, user2] = await ethers.getSigners();
    const FlashToken = await ethers.getContractFactory("FlashToken");
    flashToken = await FlashToken.deploy(NAME, SYMBOL, INITIAL_SUPPLY, FLASH_FEE_BPS, MAX_FLASH_LOAN);
    await flashToken.waitForDeployment();
    const Borrower = await ethers.getContractFactory("ExampleFlashBorrower");
    borrower = await Borrower.deploy();
    await borrower.waitForDeployment();
  });

  describe("ERC-20 Basics", function () {
    it("should set correct name, symbol, decimals", async function () {
      expect(await flashToken.name()).to.equal(NAME);
      expect(await flashToken.symbol()).to.equal(SYMBOL);
      expect(await flashToken.decimals()).to.equal(18n);
    });

    it("should mint initial supply to owner", async function () {
      const expected = INITIAL_SUPPLY * ONE_TOKEN;
      expect(await flashToken.totalSupply()).to.equal(expected);
      expect(await flashToken.balanceOf(owner.address)).to.equal(expected);
    });

    it("should transfer tokens", async function () {
      const amount = 100n * ONE_TOKEN;
      await flashToken.transfer(user1.address, amount);
      expect(await flashToken.balanceOf(user1.address)).to.equal(amount);
    });

    it("should revert transfer to zero address", async function () {
      await expect(flashToken.transfer(ethers.ZeroAddress, 100n)).to.be.revertedWithCustomError(flashToken, "ZeroAddress");
    });

    it("should revert transfer with insufficient balance", async function () {
      const tooMuch = (INITIAL_SUPPLY + 1n) * ONE_TOKEN;
      await expect(flashToken.transfer(user1.address, tooMuch)).to.be.revertedWithCustomError(flashToken, "InsufficientBalance");
    });

    it("should approve and transferFrom", async function () {
      const amount = 50n * ONE_TOKEN;
      await flashToken.approve(user1.address, amount);
      expect(await flashToken.allowance(owner.address, user1.address)).to.equal(amount);
      await flashToken.connect(user1).transferFrom(owner.address, user2.address, amount);
      expect(await flashToken.balanceOf(user2.address)).to.equal(amount);
    });

    it("should revert transferFrom with insufficient allowance", async function () {
      await flashToken.approve(user1.address, 10n);
      await expect(flashToken.connect(user1).transferFrom(owner.address, user2.address, 100n * ONE_TOKEN)).to.be.revertedWithCustomError(flashToken, "InsufficientAllowance");
    });
  });

  describe("Flash Loan (ERC-3156)", function () {
    it("should return correct maxFlashLoan", async function () {
      const max = await flashToken.maxFlashLoan(await flashToken.getAddress());
      expect(max).to.equal(MAX_FLASH_LOAN * ONE_TOKEN);
    });

    it("should return 0 maxFlashLoan for wrong token", async function () {
      expect(await flashToken.maxFlashLoan(user1.address)).to.equal(0n);
    });

    it("should return correct flashFee", async function () {
      const amount = 1000n * ONE_TOKEN;
      const expectedFee = (amount * FLASH_FEE_BPS) / 10000n;
      const fee = await flashToken.flashFee(await flashToken.getAddress(), amount);
      expect(fee).to.equal(expectedFee);
    });

    it("should revert flashFee for wrong token", async function () {
      await expect(flashToken.flashFee(user1.address, 100n)).to.be.revertedWithCustomError(flashToken, "UnsupportedToken");
    });

    it("should execute flash loan successfully", async function () {
      const loanAmount = 1000n * ONE_TOKEN;
      const fee = (loanAmount * FLASH_FEE_BPS) / 10000n;
      await flashToken.transfer(await borrower.getAddress(), fee);
      const tokenAddr = await flashToken.getAddress();
      await expect(borrower.executeFlashLoan(tokenAddr, tokenAddr, loanAmount)).to.emit(flashToken, "FlashLoan");
      expect(await flashToken.balanceOf(await borrower.getAddress())).to.equal(0n);
    });

    it("should revert flash loan exceeding max", async function () {
      const tooMuch = (MAX_FLASH_LOAN + 1n) * ONE_TOKEN;
      const tokenAddr = await flashToken.getAddress();
      await expect(borrower.executeFlashLoan(tokenAddr, tokenAddr, tooMuch)).to.be.revertedWithCustomError(flashToken, "FlashLoanExceedsMax");
    });

    it("should revert flash loan with zero amount", async function () {
      const tokenAddr = await flashToken.getAddress();
      await expect(borrower.executeFlashLoan(tokenAddr, tokenAddr, 0n)).to.be.revertedWithCustomError(flashToken, "ZeroAmount");
    });

    it("should track total fees collected", async function () {
      const loanAmount = 10000n * ONE_TOKEN;
      const fee = (loanAmount * FLASH_FEE_BPS) / 10000n;
      await flashToken.transfer(await borrower.getAddress(), fee);
      const tokenAddr = await flashToken.getAddress();
      await borrower.executeFlashLoan(tokenAddr, tokenAddr, loanAmount);
      expect(await flashToken.totalFeesCollected()).to.equal(fee);
    });
  });

  describe("Owner Functions", function () {
    it("should mint tokens (owner)", async function () {
      const amount = 500n * ONE_TOKEN;
      await flashToken.mint(user1.address, amount);
      expect(await flashToken.balanceOf(user1.address)).to.equal(amount);
    });

    it("should revert mint from non-owner", async function () {
      await expect(flashToken.connect(user1).mint(user1.address, 100n)).to.be.revertedWithCustomError(flashToken, "NotOwner");
    });

    it("should burn tokens", async function () {
      const burnAmount = 100n * ONE_TOKEN;
      const before = await flashToken.balanceOf(owner.address);
      await flashToken.burn(burnAmount);
      expect(await flashToken.balanceOf(owner.address)).to.equal(before - burnAmount);
    });

    it("should update flash fee", async function () {
      await flashToken.setFlashFee(50n);
      expect(await flashToken.flashFeeBps()).to.equal(50n);
    });

    it("should revert setting fee too high", async function () {
      await expect(flashToken.setFlashFee(1001n)).to.be.revertedWithCustomError(flashToken, "FeeTooHigh");
    });

    it("should update max flash loan", async function () {
      await flashToken.setMaxFlashLoan(1000000n);
      expect(await flashToken.maxFlashLoanAmount()).to.equal(1000000n * ONE_TOKEN);
    });

    it("should set unlimited max flash loan with 0", async function () {
      await flashToken.setMaxFlashLoan(0n);
      expect(await flashToken.maxFlashLoanAmount()).to.equal(ethers.MaxUint256);
    });

    it("should update fee receiver", async function () {
      await flashToken.setFeeReceiver(user2.address);
      expect(await flashToken.feeReceiver()).to.equal(user2.address);
    });

    it("should transfer ownership", async function () {
      await flashToken.transferOwnership(user1.address);
      expect(await flashToken.owner()).to.equal(user1.address);
    });

    it("should revert ownership transfer to zero address", async function () {
      await expect(flashToken.transferOwnership(ethers.ZeroAddress)).to.be.revertedWithCustomError(flashToken, "ZeroAddress");
    });
  });

  describe("Flash Loan Info", function () {
    it("should return correct info", async function () {
      const [maxLoan, feeBps, feeRecv, totalFees] = await flashToken.flashLoanInfo();
      expect(maxLoan).to.equal(MAX_FLASH_LOAN * ONE_TOKEN);
      expect(feeBps).to.equal(FLASH_FEE_BPS);
      expect(feeRecv).to.equal(owner.address);
      expect(totalFees).to.equal(0n);
    });
  });
});
```
