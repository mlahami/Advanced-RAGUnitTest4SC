// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

//LendingPool â€” collateral deposit, borrow against it, liquidation threshold
interface IERC20Mintable {
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
}

contract LendingPool {
    uint256 public constant COLLATERAL_FACTOR = 150; // 150% collateralization
    uint256 public constant LIQUIDATION_BONUS = 10;  // 10% bonus for liquidator

    mapping(address => uint256) public collateral; // ETH collateral
    mapping(address => uint256) public borrowed;   // tokens borrowed
    mapping(address => uint256) public debt;

    IERC20Mintable public loanToken;

    event CollateralDeposited(address indexed user, uint256 amount);
    event Borrowed(address indexed user, uint256 amount);
    event Repaid(address indexed user, uint256 amount);
    event Liquidated(address indexed user, address indexed liquidator);

    constructor(address _loanToken) {
        loanToken = IERC20Mintable(_loanToken);
    }

    function depositCollateral() external payable {
        require(msg.value > 0, "Send ETH");
        collateral[msg.sender] += msg.value;
        emit CollateralDeposited(msg.sender, msg.value);
    }

    /// @param _tokenAmount Amount of loan tokens to borrow (18 decimals)
    /// @param _ethPrice    Current ETH/token price (1 ETH = _ethPrice tokens)
    function borrow(uint256 _tokenAmount, uint256 _ethPrice) external {
        uint256 maxBorrow = (collateral[msg.sender] * _ethPrice * 100) / COLLATERAL_FACTOR;
        require(debt[msg.sender] + _tokenAmount <= maxBorrow, "Undercollateralized");
        debt[msg.sender] += _tokenAmount;
        loanToken.transfer(msg.sender, _tokenAmount);
        emit Borrowed(msg.sender, _tokenAmount);
    }

    function repay(uint256 _amount) external {
        require(debt[msg.sender] >= _amount, "Excess repay");
        debt[msg.sender] -= _amount;
        loanToken.transferFrom(msg.sender, address(this), _amount);
        emit Repaid(msg.sender, _amount);
    }

    function liquidate(address _borrower, uint256 _ethPrice) external {
        uint256 maxBorrow = (collateral[_borrower] * _ethPrice * 100) / COLLATERAL_FACTOR;
        require(debt[_borrower] > maxBorrow, "Position healthy");
        uint256 seize = collateral[_borrower];
        collateral[_borrower] = 0;
        debt[_borrower] = 0;
        (bool ok, ) = msg.sender.call{value: seize}("");
        require(ok, "Transfer failed");
        emit Liquidated(_borrower, msg.sender);
    }
}
