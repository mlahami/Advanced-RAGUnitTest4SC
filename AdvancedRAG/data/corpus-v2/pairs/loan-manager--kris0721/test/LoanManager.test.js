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
