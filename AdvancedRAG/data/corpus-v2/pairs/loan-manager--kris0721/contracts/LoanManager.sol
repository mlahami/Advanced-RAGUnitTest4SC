// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "./LendingPool.sol";

contract LoanManager is Ownable, ReentrancyGuard {
    IERC20 public token;
    LendingPool public lendingPool;
    
    struct Loan {
        address borrower;
        uint256 amount;
        uint256 interestRate;
        uint256 duration;
        uint256 startTime;
        uint256 totalRepayment;
        uint256 amountRepaid;
        bool active;
        bool approved;
    }
    
    mapping(uint256 => Loan) public loans;
    mapping(address => uint256[]) public borrowerLoans;
    uint256 public loanCounter;
    
    event LoanRequested(uint256 indexed loanId, address indexed borrower, uint256 amount, uint256 duration);
    event LoanApproved(uint256 indexed loanId);
    event LoanDisbursed(uint256 indexed loanId, uint256 amount);
    event LoanRepaid(uint256 indexed loanId, uint256 amount);
    event LoanCompleted(uint256 indexed loanId);
    
    constructor(address _token, address _lendingPool) Ownable(msg.sender) {
        token = IERC20(_token);
        lendingPool = LendingPool(_lendingPool);
    }
    
    function requestLoan(uint256 amount, uint256 duration) external returns (uint256) {
        require(amount > 0, "Amount must be greater than 0");
        require(duration >= 30 days && duration <= 180 days, "Invalid duration");
        
        uint256 interestRate = lendingPool.calculateInterestRate(duration);
        uint256 interest = lendingPool.calculateInterest(amount, interestRate, duration);
        uint256 totalRepayment = amount + interest;
        
        uint256 loanId = loanCounter++;
        
        loans[loanId] = Loan({
            borrower: msg.sender,
            amount: amount,
            interestRate: interestRate,
            duration: duration,
            startTime: 0,
            totalRepayment: totalRepayment,
            amountRepaid: 0,
            active: false,
            approved: false
        });
        
        borrowerLoans[msg.sender].push(loanId);
        
        emit LoanRequested(loanId, msg.sender, amount, duration);
        
        return loanId;
    }
    
    function approveLoan(uint256 loanId) external onlyOwner {
        Loan storage loan = loans[loanId];
        require(!loan.approved, "Loan already approved");
        require(!loan.active, "Loan already active");
        
        loan.approved = true;
        
        emit LoanApproved(loanId);
    }
    
    function disburseLoan(uint256 loanId) external onlyOwner nonReentrant {
        Loan storage loan = loans[loanId];
        require(loan.approved, "Loan not approved");
        require(!loan.active, "Loan already disbursed");
        
        lendingPool.allocateLoan(loan.amount);
        
        loan.active = true;
        loan.startTime = block.timestamp;
        
        require(token.transfer(loan.borrower, loan.amount), "Transfer failed");
        
        emit LoanDisbursed(loanId, loan.amount);
    }
    
    function repayLoan(uint256 loanId, uint256 amount) external nonReentrant {
        Loan storage loan = loans[loanId];
        require(loan.active, "Loan not active");
        require(msg.sender == loan.borrower, "Not the borrower");
        require(amount > 0, "Amount must be greater than 0");
        
        uint256 remainingAmount = loan.totalRepayment - loan.amountRepaid;
        require(amount <= remainingAmount, "Amount exceeds remaining balance");
        
        require(token.transferFrom(msg.sender, address(this), amount), "Transfer failed");
        
        loan.amountRepaid += amount;
        lendingPool.repayLoan(amount);
        
        emit LoanRepaid(loanId, amount);
        
        if (loan.amountRepaid >= loan.totalRepayment) {
            loan.active = false;
            emit LoanCompleted(loanId);
        }
    }
    
    function getLoan(uint256 loanId) external view returns (Loan memory) {
        return loans[loanId];
    }
    
    function getBorrowerLoans(address borrower) external view returns (uint256[] memory) {
        return borrowerLoans[borrower];
    }
    
    function getRemainingBalance(uint256 loanId) external view returns (uint256) {
        Loan memory loan = loans[loanId];
        return loan.totalRepayment - loan.amountRepaid;
    }
}
