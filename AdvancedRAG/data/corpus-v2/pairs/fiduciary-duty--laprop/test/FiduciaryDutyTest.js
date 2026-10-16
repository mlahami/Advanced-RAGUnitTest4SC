const { ethers } = require("hardhat");
const { loadFixture } = require("@nomicfoundation/hardhat-network-helpers");
const { expect } = require("chai");

describe("FiduciaryDuty", () => {
    // Helper function to create authorization data
    const createAuthorization = async (
        from,
        to,
        value,
        validAfter,
        validBefore,
        nonceStr,
        signer,
        mockUSDC
    ) => {
        const nonce = ethers.id(nonceStr);

        // Create typed data for EIP-712 signing
        const domain = {
            name: "Mock USDC", // Must match the name in MockERC3009 constructor
            version: "1",
            chainId: (await ethers.provider.getNetwork()).chainId,
            verifyingContract: await mockUSDC.getAddress()
        };

        const types = {
            TransferWithAuthorization: [
                { name: "from", type: "address" },
                { name: "to", type: "address" },
                { name: "value", type: "uint256" },
                { name: "validAfter", type: "uint256" },
                { name: "validBefore", type: "uint256" },
                { name: "nonce", type: "bytes32" }
            ]
        };

        const value712 = {
            from,
            to,
            value,
            validAfter,
            validBefore,
            nonce
        };

        // Sign using EIP-712
        const signature = await signer.signTypedData(domain, types, value712);
        const { v, r, s } = ethers.Signature.from(signature);

        return {
            from,
            to,
            value,
            validAfter,
            validBefore,
            nonce,
            v,
            r,
            s
        };
    };

    const deployFixture = async () => {
        const [owner, user1, manager] = await ethers.getSigners();

        // Deploy WhiteList
        const WhiteList = await ethers.getContractFactory("WhiteList");
        const whitelist = await WhiteList.deploy();

        // Deploy Mock USDC with ERC3009 functionality
        const MockToken = await ethers.getContractFactory("MockERC3009");
        const mockUSDC = await MockToken.deploy("Mock USDC", "mUSDC", 6);

        // Deploy Mock Forwarder
        const MockForwarder = await ethers.getContractFactory("MockForwarder");
        const forwarder = await MockForwarder.deploy();

        // Deploy FiduciaryDuty
        const FiduciaryDuty = await ethers.getContractFactory("FiduciaryDuty");
        const fiduciaryDuty = await FiduciaryDuty.deploy(
            await mockUSDC.getAddress(),
            "Fiduciary Token",
            "FDT",
            1000n, // totalSupply
            manager.address,
            await whitelist.getAddress(),
            await forwarder.getAddress(),
            80n, // minimalPoint
            10n // unit price
        );

        // Setup whitelist
        await whitelist.addAddress(owner.address);
        await whitelist.grantRole(await whitelist.READER_ROLE(), await fiduciaryDuty.getAddress());

        return {
            fiduciaryDuty,
            whitelist,
            mockUSDC,
            forwarder,
            owner,
            user1,
            manager
        };
    };

    describe("Initialization", () => {
        it("Should initialize with correct values", async () => {
            const { fiduciaryDuty, mockUSDC, manager, whitelist, forwarder } = await loadFixture(deployFixture);

            expect(await fiduciaryDuty.tokenStorage()).to.equal(await mockUSDC.getAddress());
            expect(await fiduciaryDuty.managerAddress()).to.equal(manager.address);
            expect(await fiduciaryDuty.whiteListContract()).to.equal(await whitelist.getAddress());
            expect(await fiduciaryDuty.viablePoint()).to.equal(false);
            expect(await fiduciaryDuty.canceledRaise()).to.equal(false);
            expect(await fiduciaryDuty.sold()).to.equal(0n);
            expect(await fiduciaryDuty.decimals()).to.equal(0);
        });

        it("Should have correct initial token distribution", async () => {
            const { fiduciaryDuty } = await loadFixture(deployFixture);

            const totalSupply = await fiduciaryDuty.totalSupply();
            const contractBalance = await fiduciaryDuty.balanceOf(await fiduciaryDuty.getAddress());

            expect(totalSupply).to.equal(1000n);
            expect(contractBalance).to.equal(totalSupply);
        });
    });

    describe("Additional Initialization Tests", () => {
        it("Should initialize with correct raised amount", async () => {
            const { fiduciaryDuty } = await loadFixture(deployFixture);
            expect(await fiduciaryDuty.raised()).to.equal(0n);
        });

        it("Should initialize with correct decimal value", async () => {
            const { fiduciaryDuty } = await loadFixture(deployFixture);
            expect(await fiduciaryDuty.decimals()).to.equal(0n);
        });
    });

    describe("Payment Functions", () => {
        it("Should not allow payment without whitelist", async () => {
            const { fiduciaryDuty, user1, mockUSDC } = await loadFixture(deployFixture);

            const auth = await createAuthorization(
                user1.address,
                await fiduciaryDuty.getAddress(),
                10000000n,
                0n,
                2n ** 48n - 1n,
                "nonce1",
                user1,
                mockUSDC
            );

            await expect(
                fiduciaryDuty.connect(user1).addForPayment(auth, user1.address)
            ).to.be.revertedWithCustomError(fiduciaryDuty, "SenderNotWhitelisted");
        });

        it("Should not allow payment with invalid timing", async () => {
            const { fiduciaryDuty, user1, whitelist, mockUSDC } = await loadFixture(deployFixture);
            await whitelist.addAddress(user1.address);

            // Mint tokens to user1 first
            await mockUSDC.mint(user1.address, 1000000000n);

            // Test validAfter > current time
            const futureAuth = await createAuthorization(
                user1.address,
                await fiduciaryDuty.getAddress(),
                10000000n,
                BigInt(Math.floor(Date.now() / 1000) + 3600), // 1 hour in future
                BigInt(Math.floor(Date.now() / 1000) + 7200), // 2 hours in future
                "nonce1",
                user1,
                mockUSDC
            );

            await expect(
                fiduciaryDuty.connect(user1).addForPayment(futureAuth, user1.address)
            ).to.be.revertedWithCustomError(fiduciaryDuty, "TransferAuthorizationNotYetValid");

            // Test validBefore < current time
            const pastAuth = await createAuthorization(
                user1.address,
                await fiduciaryDuty.getAddress(),
                10000000n,
                0n,
                1n, // Past time
                "nonce2",
                user1,
                mockUSDC
            );

            await expect(
                fiduciaryDuty.connect(user1).addForPayment(pastAuth, user1.address)
            ).to.be.revertedWithCustomError(fiduciaryDuty, "TransferAuthorizationExpired");
        });

        it("Should not allow payment with invalid unit amounts", async () => {
            const { fiduciaryDuty, user1, whitelist, mockUSDC } = await loadFixture(deployFixture);
            await whitelist.addAddress(user1.address);
            await mockUSDC.mint(user1.address, 1000000000n);

            // Test non-divisible by token decimals
            const invalidDecimalAuth = await createAuthorization(
                user1.address,
                await fiduciaryDuty.getAddress(),
                10000123n, // Not divisible by 10^6 (USDC decimals)
                0n,
                2n ** 48n - 1n,
                "nonce3",
                user1,
                mockUSDC
            );

            await expect(
                fiduciaryDuty.connect(user1).addForPayment(invalidDecimalAuth, user1.address)
            ).to.be.revertedWithCustomError(fiduciaryDuty, "InvalidUnitAmount");

            // Test non-divisible by unit price
            const invalidUnitAuth = await createAuthorization(
                user1.address,
                await fiduciaryDuty.getAddress(),
                15000000n, // 15 USDC (not divisible by 10 USDC unit price)
                0n,
                2n ** 48n - 1n,
                "nonce4",
                user1,
                mockUSDC
            );

            await expect(
                fiduciaryDuty.connect(user1).addForPayment(invalidUnitAuth, user1.address)
            ).to.be.revertedWithCustomError(fiduciaryDuty, "InvalidUnitAmount");
        });

        it("Should handle multiple payments correctly", async () => {
            const { fiduciaryDuty, user1, whitelist, mockUSDC } = await loadFixture(deployFixture);
            await whitelist.addAddress(user1.address);
            await mockUSDC.mint(user1.address, 1000000000n);

            // Make multiple valid payments
            for(let i = 0; i < 3; i++) {
                const auth = await createAuthorization(
                    user1.address,
                    await fiduciaryDuty.getAddress(),
                    10000000n,
                    0n,
                    2n ** 48n - 1n,
                    `nonce${i+5}`,
                    user1,
                    mockUSDC
                );

                await fiduciaryDuty.connect(user1).addForPayment(auth, user1.address);

                expect(await fiduciaryDuty.balanceOf(user1.address)).to.equal(BigInt(i + 1));
                expect(await fiduciaryDuty.sold()).to.equal(BigInt(i + 1));
            }
        });

        it("Should reach viable point correctly", async () => {
            const { fiduciaryDuty, user1, whitelist, mockUSDC } = await loadFixture(deployFixture);
            await whitelist.addAddress(user1.address);
            await mockUSDC.mint(user1.address, 10000000000n);

            // Buy 79% of supply (below minimal point)
            const auth1 = await createAuthorization(
                user1.address,
                await fiduciaryDuty.getAddress(),
                7900000000n, // 790 tokens worth
                0n,
                2n ** 48n - 1n,
                "nonce_large1",
                user1,
                mockUSDC
            );

            await fiduciaryDuty.connect(user1).addForPayment(auth1, user1.address);
            expect(await fiduciaryDuty.viablePoint()).to.equal(false);

            // Buy 2% more to reach viable point
            const auth2 = await createAuthorization(
                user1.address,
                await fiduciaryDuty.getAddress(),
                200000000n, // 20 tokens worth
                0n,
                2n ** 48n - 1n,
                "nonce_large2",
                user1,
                mockUSDC
            );

            await fiduciaryDuty.connect(user1).addForPayment(auth2, user1.address);
            expect(await fiduciaryDuty.viablePoint()).to.equal(true);
        });

        it("Should emit PaymentReceived event on successful payment", async () => {
            const { fiduciaryDuty, user1, whitelist, mockUSDC } = await loadFixture(deployFixture);
            await whitelist.addAddress(user1.address);
            await mockUSDC.mint(user1.address, 100000000n);

            const auth = await createAuthorization(
                user1.address,
                await fiduciaryDuty.getAddress(),
                10000000n, // 1 token worth
                0n,
                2n ** 48n - 1n,
                "nonce_event_test",
                user1,
                mockUSDC
            );

            await expect(fiduciaryDuty.connect(user1).addForPayment(auth, user1.address))
                .to.emit(fiduciaryDuty, "PaymentReceived")
                .withArgs(user1.address, 10000000n, 1n);
        });

        it("Should emit PaymentReturned event on successful withdrawal", async () => {
            const { fiduciaryDuty, user1, whitelist, mockUSDC } = await loadFixture(deployFixture);
            await whitelist.addAddress(user1.address);
            await mockUSDC.mint(user1.address, 100000000n);

            // Make initial payment
            const auth = await createAuthorization(
                user1.address,
                await fiduciaryDuty.getAddress(),
                10000000n,
                0n,
                2n ** 48n - 1n,
                "nonce_withdraw_event",
                user1,
                mockUSDC
            );

            await fiduciaryDuty.connect(user1).addForPayment(auth, user1.address);

            await expect(fiduciaryDuty.connect(user1).withdrawPayment())
                .to.emit(fiduciaryDuty, "PaymentReturned")
                .withArgs(user1.address, 10000000n); // Amount in USDC units
        });

        // ... continue with more test cases
    });

    describe("Withdrawal Functions", () => {
        it("Should not allow withdrawal without balance", async () => {
            const { fiduciaryDuty, owner } = await loadFixture(deployFixture);

            await expect(
                fiduciaryDuty.connect(owner).withdrawPayment()
            ).to.be.revertedWithCustomError(fiduciaryDuty, "NoRefundAvailable");
        });

    });

    describe("Withdrawal Scenarios", () => {
        it("Should handle multiple withdrawals correctly", async () => {
            const { fiduciaryDuty, user1, whitelist, mockUSDC } = await loadFixture(deployFixture);
            await whitelist.addAddress(user1.address);
            await mockUSDC.mint(user1.address, 1000000000n);

            // Make payment
            const auth = await createAuthorization(
                user1.address,
                await fiduciaryDuty.getAddress(),
                10000000n,
                0n,
                2n ** 48n - 1n,
                "nonce_withdraw",
                user1,
                mockUSDC
            );

            await fiduciaryDuty.connect(user1).addForPayment(auth, user1.address);

            // Cancel raise
            await fiduciaryDuty.cancelRaise();

            // Withdraw
            await fiduciaryDuty.connect(user1).withdrawPayment();

            // Verify state after withdrawal
            expect(await fiduciaryDuty.balanceOf(user1.address)).to.equal(0n);
            expect(await fiduciaryDuty.sold()).to.equal(0n);
            expect(await mockUSDC.balanceOf(user1.address)).to.equal(1000000000n);
        });

        it("Should emit PaymentWithdrawn event on successful withdrawal", async () => {
            const { fiduciaryDuty, user1, whitelist, mockUSDC } = await loadFixture(deployFixture);
            await whitelist.addAddress(user1.address);
            await mockUSDC.mint(user1.address, 100000000n);

            // Make initial payment
            const auth = await createAuthorization(
                user1.address,
                await fiduciaryDuty.getAddress(),
                10000000n,
                0n,
                2n ** 48n - 1n,
                "nonce_withdraw_event",
                user1,
                mockUSDC
            );

            await fiduciaryDuty.connect(user1).addForPayment(auth, user1.address);

            await expect(fiduciaryDuty.connect(user1).withdrawPayment())
                .to.emit(fiduciaryDuty, "PaymentReturned")
                .withArgs(user1.address, 10000000n);
        });

        // ... continue with more withdrawal scenarios
    });

    describe("Complex Multi-User Scenarios", () => {
        it("Should handle multiple users buying and withdrawing simultaneously", async () => {
            const { fiduciaryDuty, whitelist, mockUSDC } = await loadFixture(deployFixture);
            const [_, user1, user2, user3, user4] = await ethers.getSigners();

            // Setup users
            for (const user of [user1, user2, user3, user4]) {
                await whitelist.addAddress(user.address);
                await mockUSDC.mint(user.address, 100000000n * 100n); // 100 units each
            }

            // Multiple users buy tokens
            const buyAmount = 10000000n; // 10 USDC
            for (const user of [user1, user2, user3]) {
                const auth = await createAuthorization(
                    user.address,
                    await fiduciaryDuty.getAddress(),
                    buyAmount,
                    0n,
                    2n ** 48n - 1n,
                    `nonce_${user.address}`,
                    user,
                    mockUSDC
                );
                await fiduciaryDuty.connect(user).addForPayment(auth, user.address);
            }

            // Verify individual balances
            for (const user of [user1, user2, user3]) {
                expect(await fiduciaryDuty.balanceOf(user.address)).to.equal(1n);
            }
            expect(await fiduciaryDuty.sold()).to.equal(3n);

            // Cancel raise and test multiple withdrawals
            await fiduciaryDuty.cancelRaise();

            // All users try to withdraw simultaneously
            await Promise.all([user1, user2, user3].map(user =>
                fiduciaryDuty.connect(user).withdrawPayment()
            ));

            // Verify all balances are 0 and tokens returned
            for (const user of [user1, user2, user3]) {
                expect(await fiduciaryDuty.balanceOf(user.address)).to.equal(0n);
                expect(await mockUSDC.balanceOf(user.address)).to.equal(100000000n * 100n);
            }
            expect(await fiduciaryDuty.sold()).to.equal(0n);
        });

        it("Should handle race to viable point correctly", async () => {
            const { fiduciaryDuty, whitelist, mockUSDC } = await loadFixture(deployFixture);
            const [_, user1, user2] = await ethers.getSigners();

            // Setup users
            for (const user of [user1, user2]) {
                await whitelist.addAddress(user.address);
                await mockUSDC.mint(user.address, 1000000000n * 1000n);
            }

            // User1 buys 79% of supply
            const auth1 = await createAuthorization(
                user1.address,
                await fiduciaryDuty.getAddress(),
                7900000000n,
                0n,
                2n ** 48n - 1n,
                "nonce_large_user1",
                user1,
                mockUSDC
            );
            await fiduciaryDuty.connect(user1).addForPayment(auth1, user1.address);
            expect(await fiduciaryDuty.viablePoint()).to.equal(false);

            // User2 tries to buy remaining supply
            const auth2 = await createAuthorization(
                user2.address,
                await fiduciaryDuty.getAddress(),
                2100000000n,
                0n,
                2n ** 48n - 1n,
                "nonce_large_user2",
                user2,
                mockUSDC
            );
            await fiduciaryDuty.connect(user2).addForPayment(auth2, user2.address);

            expect(await fiduciaryDuty.viablePoint()).to.equal(true);
            expect(await fiduciaryDuty.sold()).to.equal(1000n);
        });

        it("Should handle edge cases with multiple users", async () => {
            const { fiduciaryDuty, whitelist, mockUSDC } = await loadFixture(deployFixture);
            const [_, user1, user2, user3] = await ethers.getSigners();

            // Setup users with enough tokens
            for (const user of [user1, user2, user3]) {
                await whitelist.addAddress(user.address);
                await mockUSDC.mint(user.address, 10000000000n); // 1000 USDC each
            }

            // Test case 1: Multiple users try to buy more than available
            // First user buys 500 tokens
            const auth1 = await createAuthorization(
                user1.address,
                await fiduciaryDuty.getAddress(),
                5000000000n, // 500 tokens
                0n,
                2n ** 48n - 1n,
                `nonce_large_${user1.address}`,
                user1,
                mockUSDC
            );
            await fiduciaryDuty.connect(user1).addForPayment(auth1, user1.address);

            // Second user buys 400 tokens
            const auth2 = await createAuthorization(
                user2.address,
                await fiduciaryDuty.getAddress(),
                4000000000n, // 400 tokens
                0n,
                2n ** 48n - 1n,
                `nonce_large_${user2.address}`,
                user2,
                mockUSDC
            );
            await fiduciaryDuty.connect(user2).addForPayment(auth2, user2.address);

            // Third user tries to buy 200 tokens when only 100 are left
            const auth3 = await createAuthorization(
                user3.address,
                await fiduciaryDuty.getAddress(),
                2000000000n, // Try to buy 200 tokens when only 100 left
                0n,
                2n ** 48n - 1n,
                "nonce_large_user3",
                user3,
                mockUSDC
            );

            // This should fail as there are not enough tokens left
            await expect(
                fiduciaryDuty.connect(user3).addForPayment(auth3, user3.address)
            ).to.be.revertedWithCustomError(fiduciaryDuty, "ExceedsAvailableSupply");
        });

        it("Should handle whitelist revocation during active raise", async () => {
            const { fiduciaryDuty, whitelist, mockUSDC } = await loadFixture(deployFixture);
            const [_, user1] = await ethers.getSigners();

            // Setup initial state
            await whitelist.addAddress(user1.address);
            await mockUSDC.mint(user1.address, 100000000n);

            // First payment succeeds
            const auth1 = await createAuthorization(
                user1.address,
                await fiduciaryDuty.getAddress(),
                10000000n,
                0n,
                2n ** 48n - 1n,
                "nonce_first",
                user1,
                mockUSDC
            );
            await fiduciaryDuty.connect(user1).addForPayment(auth1, user1.address);

            // Remove from whitelist using the correct method name
            await whitelist.deleteAddress(user1.address);

            // Second payment should fail
            const auth2 = await createAuthorization(
                user1.address,
                await fiduciaryDuty.getAddress(),
                10000000n,
                0n,
                2n ** 48n - 1n,
                "nonce_second",
                user1,
                mockUSDC
            );

            await expect(
                fiduciaryDuty.connect(user1).addForPayment(auth2, user1.address)
            ).to.be.revertedWithCustomError(fiduciaryDuty, "SenderNotWhitelisted");
        });

        it("Should handle multiple users with different payment sizes", async () => {
            const { fiduciaryDuty, whitelist, mockUSDC } = await loadFixture(deployFixture);
            const [_, user1, user2, user3] = await ethers.getSigners();

            // Setup users with different amounts
            const userAmounts = [
                { user: user1, amount: 100000000n }, // 100 USDC
                { user: user2, amount: 200000000n }, // 200 USDC
                { user: user3, amount: 300000000n } // 300 USDC
            ];

            for (const { user, amount } of userAmounts) {
                await whitelist.addAddress(user.address);
                await mockUSDC.mint(user.address, amount);

                const auth = await createAuthorization(
                    user.address,
                    await fiduciaryDuty.getAddress(),
                    amount,
                    0n,
                    2n ** 48n - 1n,
                    `nonce_${user.address}`,
                    user,
                    mockUSDC
                );
                await fiduciaryDuty.connect(user).addForPayment(auth, user.address);
            }

            // Verify proportional token distribution
            expect(await fiduciaryDuty.balanceOf(user1.address)).to.equal(10n);
            expect(await fiduciaryDuty.balanceOf(user2.address)).to.equal(20n);
            expect(await fiduciaryDuty.balanceOf(user3.address)).to.equal(30n);
        });
    });

    describe("Withdrawal before viable point", () => {
        it("Should allow withdrawal before viable point is reached", async () => {
            const { fiduciaryDuty, user1, whitelist, mockUSDC } = await loadFixture(deployFixture);

            // Setup user
            await whitelist.addAddress(user1.address);
            await mockUSDC.mint(user1.address, 100000000n); // 10 USDC

            // Make initial payment
            const auth = await createAuthorization(
                user1.address,
                await fiduciaryDuty.getAddress(),
                10000000n, // 1 token worth
                0n,
                2n ** 48n - 1n,
                "nonce_withdraw_test",
                user1,
                mockUSDC
            );

            // Add payment
            await fiduciaryDuty.connect(user1).addForPayment(auth, user1.address);

            // Verify initial state
            expect(await fiduciaryDuty.balanceOf(user1.address)).to.equal(1n);
            expect(await fiduciaryDuty.sold()).to.equal(1n);
            expect(await fiduciaryDuty.viablePoint()).to.equal(false);

            // Get initial USDC balance
            const initialUSDCBalance = await mockUSDC.balanceOf(user1.address);

            // Withdraw before viable point
            await fiduciaryDuty.connect(user1).withdrawPayment();

            // Verify final state
            expect(await fiduciaryDuty.balanceOf(user1.address)).to.equal(0n);
            expect(await fiduciaryDuty.sold()).to.equal(0n);
            expect(await mockUSDC.balanceOf(user1.address)).to.equal(initialUSDCBalance + 10000000n);
            expect(await fiduciaryDuty.balanceOf(await fiduciaryDuty.getAddress())).to.equal(1000n);
        });

        it("Should handle multiple users withdrawing before viable point", async () => {
            const { fiduciaryDuty, whitelist, mockUSDC } = await loadFixture(deployFixture);
            const [_, user1, user2, user3] = await ethers.getSigners();

            // Setup users
            for (const user of [user1, user2, user3]) {
                await whitelist.addAddress(user.address);
                await mockUSDC.mint(user.address, 100000000n); // 10 USDC each
            }

            // All users make payments
            for (let i = 0; i < 3; i++) {
                const user = [user1, user2, user3][i];
                const auth = await createAuthorization(
                    user.address,
                    await fiduciaryDuty.getAddress(),
                    10000000n, // 1 token worth
                    0n,
                    2n ** 48n - 1n,
                    `nonce_multi_${i}`,
                    user,
                    mockUSDC
                );
                await fiduciaryDuty.connect(user).addForPayment(auth, user.address);
            }

            // Verify state after payments
            expect(await fiduciaryDuty.sold()).to.equal(3n);
            expect(await fiduciaryDuty.viablePoint()).to.equal(false);

            // Store initial USDC balances
            const initialBalances = await Promise.all(
                [user1, user2, user3].map(user => mockUSDC.balanceOf(user.address))
            );

            // All users withdraw
            for (const user of [user1, user2, user3]) {
                await fiduciaryDuty.connect(user).withdrawPayment();
            }

            // Verify final state
            expect(await fiduciaryDuty.sold()).to.equal(0n);

            // Verify each user got their USDC back
            for (let i = 0; i < 3; i++) {
                const user = [user1, user2, user3][i];
                expect(await fiduciaryDuty.balanceOf(user.address)).to.equal(0n);
                expect(await mockUSDC.balanceOf(user.address)).to.equal(initialBalances[i] + 10000000n);
            }

            // Verify contract balance is back to initial supply
            expect(await fiduciaryDuty.balanceOf(await fiduciaryDuty.getAddress())).to.equal(1000n);
        });

        it("Should not allow withdrawal after viable point unless canceled", async () => {
            const { fiduciaryDuty, user1, whitelist, mockUSDC } = await loadFixture(deployFixture);

            // Setup user
            await whitelist.addAddress(user1.address);
            await mockUSDC.mint(user1.address, 10000000000n); // 1000 USDC

            // Buy enough tokens to reach viable point (80%)
            const auth = await createAuthorization(
                user1.address,
                await fiduciaryDuty.getAddress(),
                8000000000n, // 800 tokens worth
                0n,
                2n ** 48n - 1n,
                "nonce_viable_point",
                user1,
                mockUSDC
            );

            await fiduciaryDuty.connect(user1).addForPayment(auth, user1.address);

            // Verify viable point is reached
            expect(await fiduciaryDuty.viablePoint()).to.equal(true);

            // Try to withdraw - should fail
            await expect(
                fiduciaryDuty.connect(user1).withdrawPayment()
            ).to.be.revertedWithCustomError(fiduciaryDuty, "ViablePointAlreadyReached");

            // Cancel raise
            await fiduciaryDuty.cancelRaise();

            // Now withdrawal should succeed
            await fiduciaryDuty.connect(user1).withdrawPayment();

            // Verify final state
            expect(await fiduciaryDuty.balanceOf(user1.address)).to.equal(0n);
            expect(await fiduciaryDuty.sold()).to.equal(0n);
        });
    });

    describe("Additional Test Scenarios", () => {
        it("should test payment with invalid signature", async () => {
            const { fiduciaryDuty, user1, whitelist, mockUSDC } = await loadFixture(deployFixture);
            await whitelist.addAddress(user1.address);
            await mockUSDC.mint(user1.address, 100000000n);

            const auth = {
                from: user1.address,
                to: user1.address, // Invalid destination - should be fiduciaryDuty address
                value: 10000000n,
                validAfter: 0n,
                validBefore: 2n ** 48n - 1n,
                nonce: ethers.id("invalid_sig"),
                v: 27,
                r: ethers.ZeroHash,
                s: ethers.ZeroHash
            };

            await expect(
                fiduciaryDuty.connect(user1).addForPayment(auth, user1.address)
            ).to.be.revertedWithCustomError(fiduciaryDuty, "InvalidTransferDestination");
        });

        it("should test authorization validation", async () => {
            const { fiduciaryDuty, user1, whitelist, mockUSDC } = await loadFixture(deployFixture);
            await whitelist.addAddress(user1.address);
            await mockUSDC.mint(user1.address, 200000000n);

            // Test with invalid destination
            const invalidDestAuth = await createAuthorization(
                user1.address,
                user1.address, // Invalid destination (should be fiduciaryDuty address)
                10000000n,
                0n,
                2n ** 48n - 1n,
                "nonce_invalid_dest",
                user1,
                mockUSDC
            );

            await expect(
                fiduciaryDuty.connect(user1).addForPayment(invalidDestAuth, user1.address)
            ).to.be.revertedWithCustomError(fiduciaryDuty, "InvalidTransferDestination");

            // Test with expired authorization
            const expiredAuth = await createAuthorization(
                user1.address,
                await fiduciaryDuty.getAddress(),
                10000000n,
                0n,
                1n, // Set to past timestamp
                "nonce_expired",
                user1,
                mockUSDC
            );

            await expect(
                fiduciaryDuty.connect(user1).addForPayment(expiredAuth, user1.address)
            ).to.be.revertedWithCustomError(fiduciaryDuty, "TransferAuthorizationExpired");

            // Test with future authorization
            const futureAuth = await createAuthorization(
                user1.address,
                await fiduciaryDuty.getAddress(),
                10000000n,
                BigInt(Math.floor(Date.now() / 1000) + 3600), // 1 hour in future
                BigInt(Math.floor(Date.now() / 1000) + 7200), // 2 hours in future
                "nonce_future",
                user1,
                mockUSDC
            );

            await expect(
                fiduciaryDuty.connect(user1).addForPayment(futureAuth, user1.address)
            ).to.be.revertedWithCustomError(fiduciaryDuty, "TransferAuthorizationNotYetValid");
        });

        describe("Manager withdrawal scenarios", () => {
            it("should allow manager to withdraw only after viable point", async () => {
                const { fiduciaryDuty, user1, whitelist, mockUSDC, manager } = await loadFixture(deployFixture);
                await whitelist.addAddress(user1.address);
                await mockUSDC.mint(user1.address, 10000000000n);

                // Buy 79% of supply (below viable point)
                const auth = await createAuthorization(
                    user1.address,
                    await fiduciaryDuty.getAddress(),
                    7900000000n,
                    0n,
                    2n ** 48n - 1n,
                    "nonce_manager_test",
                    user1,
                    mockUSDC
                );

                await fiduciaryDuty.connect(user1).addForPayment(auth, user1.address);

                // Try to withdraw before viable point
                await expect(
                    fiduciaryDuty.withdrawForDuty()
                ).to.be.revertedWithCustomError(fiduciaryDuty, "ViablePointNotReached");

                // Buy remaining to reach viable point
                const auth2 = await createAuthorization(
                    user1.address,
                    await fiduciaryDuty.getAddress(),
                    100000000n,
                    0n,
                    2n ** 48n - 1n,
                    "nonce_manager_test2",
                    user1,
                    mockUSDC
                );

                await fiduciaryDuty.connect(user1).addForPayment(auth2, user1.address);

                // Now withdrawal should succeed
                await fiduciaryDuty.withdrawForDuty();

                // Verify USDC was transferred to manager
                expect(await mockUSDC.balanceOf(manager.address)).to.equal(8000000000n);
            });

            it("should not allow manager withdrawal after raise is canceled", async () => {
                const { fiduciaryDuty, user1, whitelist, mockUSDC } = await loadFixture(deployFixture);
                await whitelist.addAddress(user1.address);
                await mockUSDC.mint(user1.address, 10000000000n);

                // Buy enough to reach viable point
                const auth = await createAuthorization(
                    user1.address,
                    await fiduciaryDuty.getAddress(),
                    8000000000n,
                    0n,
                    2n ** 48n - 1n,
                    "nonce_cancel_test",
                    user1,
                    mockUSDC
                );

                await fiduciaryDuty.connect(user1).addForPayment(auth, user1.address);

                // Cancel the raise
                await fiduciaryDuty.cancelRaise();

                // Try to withdraw after cancellation
                await expect(
                    fiduciaryDuty.withdrawForDuty()
                ).to.be.revertedWithCustomError(fiduciaryDuty, "RaiseCanceled");
            });
        });

        describe("Edge cases for payment validation", () => {
            it("should validate payment amount matches token decimals", async () => {
                const { fiduciaryDuty, user1, whitelist, mockUSDC } = await loadFixture(deployFixture);
                await whitelist.addAddress(user1.address);
                await mockUSDC.mint(user1.address, 10000000000n);

                // Create authorization with invalid decimal amount
                const auth = await createAuthorization(
                    user1.address,
                    await fiduciaryDuty.getAddress(),
                    10000123n, // Not divisible by 10^6 (USDC decimals)
                    0n,
                    2n ** 48n - 1n,
                    "nonce_decimal_test",
                    user1,
                    mockUSDC
                );

                await expect(
                    fiduciaryDuty.connect(user1).addForPayment(auth, user1.address)
                ).to.be.revertedWithCustomError(fiduciaryDuty, "InvalidUnitAmount");
            });
        });

        it("Should emit RaiseEnded event when raise is canceled", async () => {
            const { fiduciaryDuty } = await loadFixture(deployFixture);

            await expect(fiduciaryDuty.cancelRaise())
                .to.emit(fiduciaryDuty, "RaiseEnded")
                .withArgs(true);
        });
    });

    describe("Forwarder Tests", () => {
        it("Should initialize with correct forwarder", async () => {
            const { fiduciaryDuty, forwarder } = await loadFixture(deployFixture);
            expect(await fiduciaryDuty.trustedForwarder()).to.equal(await forwarder.getAddress());
        });

        it("Should correctly identify trusted forwarder", async () => {
            const { fiduciaryDuty, forwarder } = await loadFixture(deployFixture);
            expect(await fiduciaryDuty.isTrustedForwarder(await forwarder.getAddress())).to.be.true;
        });
    });

    describe("Event Tests", () => {
        it("Should emit PaymentAdded event", async () => {
            const { fiduciaryDuty, user1, whitelist, mockUSDC } = await loadFixture(deployFixture);
            await whitelist.addAddress(user1.address);
            await mockUSDC.mint(user1.address, 100000000n);

            const auth = await createAuthorization(
                user1.address,
                await fiduciaryDuty.getAddress(),
                10000000n,
                0n,
                2n ** 48n - 1n,
                "nonce_event",
                user1,
                mockUSDC
            );

            await expect(fiduciaryDuty.connect(user1).addForPayment(auth, user1.address))
                .to.emit(fiduciaryDuty, "PaymentReceived")
                .withArgs(user1.address, 10000000n, 1n);
        });
    });
});