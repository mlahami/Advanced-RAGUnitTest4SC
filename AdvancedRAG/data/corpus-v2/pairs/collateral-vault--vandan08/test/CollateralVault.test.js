const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("CollateralVault", function () {
    let usdc, creditRegistry, collateralVault;
    let owner, oracle, user1, lendingPoolMock;
    const USDC_DECIMALS = 6;
    const toUSDC = (amount) => ethers.parseUnits(amount.toString(), USDC_DECIMALS);

    beforeEach(async function () {
        [owner, oracle, user1, lendingPoolMock] = await ethers.getSigners();

        // Deploy MockUSDC
        const MockUSDC = await ethers.getContractFactory("MockUSDC");
        usdc = await MockUSDC.deploy();
        await usdc.waitForDeployment();

        // Deploy CreditRegistry
        const CreditRegistry = await ethers.getContractFactory("CreditRegistry");
        creditRegistry = await CreditRegistry.deploy(oracle.address);
        await creditRegistry.waitForDeployment();

        // Deploy CollateralVault
        const CollateralVault = await ethers.getContractFactory("CollateralVault");
        collateralVault = await CollateralVault.deploy(
            await creditRegistry.getAddress(),
            await usdc.getAddress()
        );
        await collateralVault.waitForDeployment();

        // Set lending pool
        await collateralVault.setLendingPool(lendingPoolMock.address);

        // Register and score user
        await creditRegistry.connect(oracle).registerBorrower(user1.address);

        // Give user some USDC
        await usdc.mint(user1.address, toUSDC(100000));
    });

    describe("Deposit & Withdraw Collateral", function () {
        it("Should deposit collateral", async function () {
            await usdc.connect(user1).approve(await collateralVault.getAddress(), toUSDC(1000));
            await collateralVault.connect(user1).depositCollateral(toUSDC(1000));

            expect(await collateralVault.collateralBalance(user1.address)).to.equal(toUSDC(1000));
        });

        it("Should emit CollateralDeposited event", async function () {
            await usdc.connect(user1).approve(await collateralVault.getAddress(), toUSDC(1000));
            await expect(collateralVault.connect(user1).depositCollateral(toUSDC(1000)))
                .to.emit(collateralVault, "CollateralDeposited")
                .withArgs(user1.address, toUSDC(1000));
        });

        it("Should withdraw collateral", async function () {
            await usdc.connect(user1).approve(await collateralVault.getAddress(), toUSDC(1000));
            await collateralVault.connect(user1).depositCollateral(toUSDC(1000));
            await collateralVault.connect(user1).withdrawCollateral(toUSDC(500));

            expect(await collateralVault.collateralBalance(user1.address)).to.equal(toUSDC(500));
        });

        it("Should revert withdraw if insufficient balance", async function () {
            await expect(
                collateralVault.connect(user1).withdrawCollateral(toUSDC(1000))
            ).to.be.revertedWith("CollateralVault: insufficient balance");
        });
    });

    describe("Required Collateral Calculation", function () {
        it("Should require 110% for C-band (default 500 score)", async function () {
            // Default score is 500 (C-band) → 110% collateral
            const required = await collateralVault.getRequiredCollateral(user1.address, toUSDC(1000));
            expect(required).to.equal(toUSDC(1100)); // 110%
        });

        it("Should require 40% for A-band borrower", async function () {
            await creditRegistry.connect(oracle).updateCreditScore(user1.address, 850);
            const required = await collateralVault.getRequiredCollateral(user1.address, toUSDC(1000));
            expect(required).to.equal(toUSDC(400)); // 40%
        });

        it("Should require 70% for B-band borrower", async function () {
            await creditRegistry.connect(oracle).updateCreditScore(user1.address, 700);
            const required = await collateralVault.getRequiredCollateral(user1.address, toUSDC(1000));
            expect(required).to.equal(toUSDC(700)); // 70%
        });
    });

    describe("Lock & Unlock (LendingPool Only)", function () {
        beforeEach(async function () {
            await usdc.connect(user1).approve(await collateralVault.getAddress(), toUSDC(5000));
            await collateralVault.connect(user1).depositCollateral(toUSDC(5000));
        });

        it("Should lock collateral (lending pool only)", async function () {
            await collateralVault.connect(lendingPoolMock).lockCollateral(user1.address, toUSDC(1000));
            expect(await collateralVault.lockedCollateral(user1.address)).to.equal(toUSDC(1000));
            expect(await collateralVault.collateralBalance(user1.address)).to.equal(toUSDC(4000));
        });

        it("Should unlock collateral", async function () {
            await collateralVault.connect(lendingPoolMock).lockCollateral(user1.address, toUSDC(1000));
            await collateralVault.connect(lendingPoolMock).unlockCollateral(user1.address, toUSDC(1000));

            expect(await collateralVault.lockedCollateral(user1.address)).to.equal(0);
            expect(await collateralVault.collateralBalance(user1.address)).to.equal(toUSDC(5000));
        });

        it("Should revert if non-lending-pool tries to lock", async function () {
            await expect(
                collateralVault.connect(user1).lockCollateral(user1.address, toUSDC(1000))
            ).to.be.revertedWith("CollateralVault: caller is not lending pool");
        });
    });

    describe("Liquidation", function () {
        beforeEach(async function () {
            await usdc.connect(user1).approve(await collateralVault.getAddress(), toUSDC(5000));
            await collateralVault.connect(user1).depositCollateral(toUSDC(5000));
            await collateralVault.connect(lendingPoolMock).lockCollateral(user1.address, toUSDC(2000));
        });

        it("Should liquidate collateral to recipient", async function () {
            const balBefore = await usdc.balanceOf(owner.address);
            await collateralVault
                .connect(lendingPoolMock)
                .liquidateCollateral(user1.address, toUSDC(2000), owner.address);

            expect(await collateralVault.lockedCollateral(user1.address)).to.equal(0);
            const balAfter = await usdc.balanceOf(owner.address);
            expect(balAfter - balBefore).to.equal(toUSDC(2000));
        });
    });
});
