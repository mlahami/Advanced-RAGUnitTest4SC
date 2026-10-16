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
