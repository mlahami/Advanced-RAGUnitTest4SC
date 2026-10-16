# loan-manager--kris0721

- domain: lending-collateral (lending)
- level: moderate
- origin: human
- convention: hardhat2-ethers6
- source: https://github.com/Kris0721/CDL @ 77d15efb60692f5d91ee7b54c7cdf7aeda2d5556
- license: MIT
- targets: LoanManager.sol, LendingPool.sol, MockERC20.sol
- validation: 14 passing tests, 0 failing; statement coverage LoanManager.sol 100.0 %, LendingPool.sol 50.0 %, MockERC20.sol 33.33 %

## Contract: LendingPool.sol (dependency)

```solidity
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
```

## Contract: LoanManager.sol (primary target)

```solidity
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
```

## Contract: MockERC20.sol (dependency)

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/**
 * @title MockERC20
 * @dev Mock ERC20 token for testing purposes
 */
contract MockERC20 is ERC20 {
    constructor(
        string memory name,
        string memory symbol,
        uint256 initialSupply
    ) ERC20(name, symbol) {
        _mint(msg.sender, initialSupply);
    }

    /**
     * @dev Mint tokens to an address (for testing)
     */
    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    /**
     * @dev Burn tokens from an address (for testing)
     */
    function burn(address from, uint256 amount) external {
        _burn(from, amount);
    }
}
```

## Tests: LoanManager.test.js

```javascript
const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("LoanManager", function () {
    let loanManager;
    let lendingPool;
    let token;
    let owner;
    let borrower1;
    let borrower2;
    let lender;

    beforeEach(async function () {
        [owner, borrower1, borrower2, lender] = await ethers.getSigners();

        // Deploy mock ERC20 token
        const Token = await ethers.getContractFactory("MockERC20");
        token = await Token.deploy("USD Coin", "USDC", ethers.parseEther("1000000"));
        await token.waitForDeployment();

        // Deploy LendingPool
        const LendingPool = await ethers.getContractFactory("LendingPool");
        lendingPool = await LendingPool.deploy(await token.getAddress());
        await lendingPool.waitForDeployment();

        // Deploy LoanManager
        const LoanManager = await ethers.getContractFactory("LoanManager");
        loanManager = await LoanManager.deploy(
            await token.getAddress(),
            await lendingPool.getAddress()
        );
        await loanManager.waitForDeployment();

        // Transfer ownership of lending pool to loan manager
        await lendingPool.transferOwnership(await loanManager.getAddress());

        // Add liquidity to pool
        await token.transfer(lender.address, ethers.parseEther("100000"));
        await token.connect(lender).approve(await lendingPool.getAddress(), ethers.parseEther("100000"));
        await lendingPool.connect(lender).deposit(ethers.parseEther("100000"), 30 * 24 * 60 * 60);

        // Transfer tokens to loan manager for disbursement
        await token.transfer(await loanManager.getAddress(), ethers.parseEther("100000"));
    });

    describe("Loan Request", function () {
        it("Should allow borrowers to request loans", async function () {
            const loanAmount = ethers.parseEther("1000");
            const duration = 30 * 24 * 60 * 60; // 30 days

            await expect(loanManager.connect(borrower1).requestLoan(loanAmount, duration))
                .to.emit(loanManager, "LoanRequested")
                .withArgs(0, borrower1.address, loanAmount, duration);

            const loan = await loanManager.getLoan(0);
            expect(loan.borrower).to.equal(borrower1.address);
            expect(loan.amount).to.equal(loanAmount);
            expect(loan.active).to.be.false;
            expect(loan.approved).to.be.false;
        });

        it("Should reject loans with invalid duration", async function () {
            const loanAmount = ethers.parseEther("1000");
            const invalidDuration = 20 * 24 * 60 * 60; // 20 days

            await expect(
                loanManager.connect(borrower1).requestLoan(loanAmount, invalidDuration)
            ).to.be.revertedWith("Invalid duration");
        });

        it("Should calculate total repayment correctly", async function () {
            const loanAmount = ethers.parseEther("1000");
            const duration = 30 * 24 * 60 * 60;

            await loanManager.connect(borrower1).requestLoan(loanAmount, duration);

            const loan = await loanManager.getLoan(0);
            expect(loan.totalRepayment).to.be.gt(loanAmount); // Should include interest
        });
    });

    describe("Loan Approval", function () {
        beforeEach(async function () {
            const loanAmount = ethers.parseEther("1000");
            const duration = 30 * 24 * 60 * 60;
            await loanManager.connect(borrower1).requestLoan(loanAmount, duration);
        });

        it("Should allow owner to approve loans", async function () {
            await expect(loanManager.approveLoan(0))
                .to.emit(loanManager, "LoanApproved")
                .withArgs(0);

            const loan = await loanManager.getLoan(0);
            expect(loan.approved).to.be.true;
        });

        it("Should reject approval from non-owner", async function () {
            await expect(
                loanManager.connect(borrower1).approveLoan(0)
            ).to.be.reverted;
        });

        it("Should reject double approval", async function () {
            await loanManager.approveLoan(0);

            await expect(
                loanManager.approveLoan(0)
            ).to.be.revertedWith("Loan already approved");
        });
    });

    describe("Loan Disbursement", function () {
        beforeEach(async function () {
            const loanAmount = ethers.parseEther("1000");
            const duration = 30 * 24 * 60 * 60;
            await loanManager.connect(borrower1).requestLoan(loanAmount, duration);
            await loanManager.approveLoan(0);
        });

        it("Should disburse approved loans", async function () {
            const initialBalance = await token.balanceOf(borrower1.address);

            await expect(loanManager.disburseLoan(0))
                .to.emit(loanManager, "LoanDisbursed")
                .withArgs(0, ethers.parseEther("1000"));

            const finalBalance = await token.balanceOf(borrower1.address);
            expect(finalBalance - initialBalance).to.equal(ethers.parseEther("1000"));

            const loan = await loanManager.getLoan(0);
            expect(loan.active).to.be.true;
            expect(loan.startTime).to.be.gt(0);
        });

        it("Should reject disbursement of unapproved loans", async function () {
            const loanAmount = ethers.parseEther("1000");
            const duration = 30 * 24 * 60 * 60;
            await loanManager.connect(borrower2).requestLoan(loanAmount, duration);

            await expect(
                loanManager.disburseLoan(1)
            ).to.be.revertedWith("Loan not approved");
        });
    });

    describe("Loan Repayment", function () {
        beforeEach(async function () {
            const loanAmount = ethers.parseEther("1000");
            const duration = 30 * 24 * 60 * 60;
            await loanManager.connect(borrower1).requestLoan(loanAmount, duration);
            await loanManager.approveLoan(0);
            await loanManager.disburseLoan(0);

            // Give borrower tokens to repay
            await token.transfer(borrower1.address, ethers.parseEther("2000"));
        });

        it("Should allow partial repayment", async function () {
            const repayAmount = ethers.parseEther("500");

            await token.connect(borrower1).approve(await loanManager.getAddress(), repayAmount);

            await expect(loanManager.connect(borrower1).repayLoan(0, repayAmount))
                .to.emit(loanManager, "LoanRepaid")
                .withArgs(0, repayAmount);

            const loan = await loanManager.getLoan(0);
            expect(loan.amountRepaid).to.equal(repayAmount);
            expect(loan.active).to.be.true; // Still active
        });

        it("Should complete loan on full repayment", async function () {
            const loan = await loanManager.getLoan(0);
            const totalRepayment = loan.totalRepayment;

            await token.connect(borrower1).approve(await loanManager.getAddress(), totalRepayment);

            await expect(loanManager.connect(borrower1).repayLoan(0, totalRepayment))
                .to.emit(loanManager, "LoanCompleted")
                .withArgs(0);

            const updatedLoan = await loanManager.getLoan(0);
            expect(updatedLoan.active).to.be.false;
            expect(updatedLoan.amountRepaid).to.equal(totalRepayment);
        });

        it("Should reject overpayment", async function () {
            const loan = await loanManager.getLoan(0);
            const excessAmount = loan.totalRepayment + ethers.parseEther("100");

            await token.connect(borrower1).approve(await loanManager.getAddress(), excessAmount);

            await expect(
                loanManager.connect(borrower1).repayLoan(0, excessAmount)
            ).to.be.revertedWith("Amount exceeds remaining balance");
        });

        it("Should only allow borrower to repay", async function () {
            const repayAmount = ethers.parseEther("500");

            await token.connect(borrower2).approve(await loanManager.getAddress(), repayAmount);

            await expect(
                loanManager.connect(borrower2).repayLoan(0, repayAmount)
            ).to.be.revertedWith("Not the borrower");
        });
    });

    describe("View Functions", function () {
        beforeEach(async function () {
            const loanAmount = ethers.parseEther("1000");
            const duration = 30 * 24 * 60 * 60;
            await loanManager.connect(borrower1).requestLoan(loanAmount, duration);
            await loanManager.connect(borrower1).requestLoan(loanAmount, duration);
        });

        it("Should return borrower's loans", async function () {
            const loans = await loanManager.getBorrowerLoans(borrower1.address);
            expect(loans.length).to.equal(2);
            expect(loans[0]).to.equal(0);
            expect(loans[1]).to.equal(1);
        });

        it("Should calculate remaining balance correctly", async function () {
            await loanManager.approveLoan(0);
            await loanManager.disburseLoan(0);

            const loan = await loanManager.getLoan(0);
            const remainingBalance = await loanManager.getRemainingBalance(0);

            expect(remainingBalance).to.equal(loan.totalRepayment);
        });
    });
});
```
