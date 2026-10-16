// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

contract LendingPool is Ownable, ReentrancyGuard {
    IERC20 public token;
    
    struct Deposit {
        uint256 amount;
        uint256 timestamp;
        uint256 lockDuration;
        uint256 interestRate;
    }
    
    mapping(address => Deposit[]) public deposits;
    mapping(address => uint256) public totalDeposited;
    
    uint256 public totalPoolSize;
    uint256 public availableLiquidity;
    
    event Deposited(address indexed lender, uint256 amount, uint256 lockDuration, uint256 interestRate);
    event Withdrawn(address indexed lender, uint256 amount, uint256 interest);
    
    constructor(address _token) Ownable(msg.sender) {
        token = IERC20(_token);
    }
    
    function deposit(uint256 amount, uint256 lockDuration) external nonReentrant {
        require(amount > 0, "Amount must be greater than 0");
        require(lockDuration >= 30 days && lockDuration <= 180 days, "Invalid lock duration");
        
        uint256 interestRate = calculateInterestRate(lockDuration);
        
        require(token.transferFrom(msg.sender, address(this), amount), "Transfer failed");
        
        deposits[msg.sender].push(Deposit({
            amount: amount,
            timestamp: block.timestamp,
            lockDuration: lockDuration,
            interestRate: interestRate
        }));
        
        totalDeposited[msg.sender] += amount;
        totalPoolSize += amount;
        availableLiquidity += amount;
        
        emit Deposited(msg.sender, amount, lockDuration, interestRate);
    }
    
    function withdraw(uint256 depositIndex) external nonReentrant {
        require(depositIndex < deposits[msg.sender].length, "Invalid deposit index");
        
        Deposit memory userDeposit = deposits[msg.sender][depositIndex];
        require(block.timestamp >= userDeposit.timestamp + userDeposit.lockDuration, "Lock period not over");
        
        uint256 interest = calculateInterest(userDeposit.amount, userDeposit.interestRate, userDeposit.lockDuration);
        uint256 totalAmount = userDeposit.amount + interest;
        
        // Remove deposit
        deposits[msg.sender][depositIndex] = deposits[msg.sender][deposits[msg.sender].length - 1];
        deposits[msg.sender].pop();
        
        totalDeposited[msg.sender] -= userDeposit.amount;
        totalPoolSize -= userDeposit.amount;
        
        require(token.transfer(msg.sender, totalAmount), "Transfer failed");
        
        emit Withdrawn(msg.sender, userDeposit.amount, interest);
    }
    
    function calculateInterestRate(uint256 lockDuration) public pure returns (uint256) {
        if (lockDuration >= 180 days) return 1000; // 10%
        if (lockDuration >= 90 days) return 850;   // 8.5%
        if (lockDuration >= 60 days) return 750;   // 7.5%
        return 600; // 6%
    }
    
    function calculateInterest(uint256 amount, uint256 rate, uint256 duration) public pure returns (uint256) {
        return (amount * rate * duration) / (10000 * 365 days);
    }
    
    function getUserDeposits(address user) external view returns (Deposit[] memory) {
        return deposits[user];
    }
    
    function allocateLoan(uint256 amount) external onlyOwner {
        require(amount <= availableLiquidity, "Insufficient liquidity");
        availableLiquidity -= amount;
    }
    
    function repayLoan(uint256 amount) external onlyOwner {
        availableLiquidity += amount;
    }
}
