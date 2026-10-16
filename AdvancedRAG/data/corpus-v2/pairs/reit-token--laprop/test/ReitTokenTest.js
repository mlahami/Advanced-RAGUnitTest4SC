const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("ReitToken", function () {
    let reitToken;
    let whiteList;
    let owner;
    let manager;
    let master;
    let user1;
    let user2;
    let forwarder;

    const MANAGER_ROLE = ethers.keccak256(ethers.toUtf8Bytes("MANAGER"));
    const MASTER_ROLE = ethers.keccak256(ethers.toUtf8Bytes("MASTER_ROLE"));
    const WRITER_ROLE = ethers.keccak256(ethers.toUtf8Bytes("WRITER_ROLE"));
    const READER_ROLE = ethers.keccak256(ethers.toUtf8Bytes("READER_ROLE"));
    const DEFAULT_ADMIN_ROLE = ethers.ZeroHash;
    const ZERO_ADDRESS = ethers.ZeroAddress;

    beforeEach(async function () {
        [owner, manager, master, user1, user2, forwarder] = await ethers.getSigners();

        // Deploy WhiteList
        const WhiteListFactory = await ethers.getContractFactory("WhiteList");
        whiteList = await WhiteListFactory.deploy();

        // Deploy ReitToken
        const ReitTokenFactory = await ethers.getContractFactory("ReitToken");
        reitToken = await ReitTokenFactory.deploy(
            "Real Estate Token",
            "REIT",
            await whiteList.getAddress(),
            await forwarder.getAddress(),
            true // activatedTransferWhitelisting
        );

        // Setup roles for ReitToken
        await reitToken.grantRole(MANAGER_ROLE, await manager.getAddress());
        await reitToken.grantRole(MASTER_ROLE, await master.getAddress());

        // Setup roles for WhiteList
        // Grant READER_ROLE to the ReitToken contract itself
        await whiteList.grantRole(READER_ROLE, await reitToken.getAddress());
        // Grant WRITER_ROLE to owner for adding addresses
        await whiteList.grantRole(WRITER_ROLE, await owner.getAddress());

        // Add addresses to whitelist
        await whiteList.addAddress(await owner.getAddress());
        await whiteList.addAddress(await user1.getAddress());
        await whiteList.addAddress(await user2.getAddress());
    });

    describe("Initialization", function () {
        it("Should initialize with correct values", async function () {
            expect(await reitToken.name()).to.equal("Real Estate Token");
            expect(await reitToken.symbol()).to.equal("REIT");
            expect(await reitToken.whiteList()).to.equal(await whiteList.getAddress());
            expect(await reitToken.activatedTransferWhitelisting()).to.be.true;
        });

        it("Should set up roles correctly", async function () {
            expect(await reitToken.hasRole(MANAGER_ROLE, await manager.getAddress())).to.be.true;
            expect(await reitToken.hasRole(MASTER_ROLE, await master.getAddress())).to.be.true;
        });
    });

    describe("Minting and Burning", function () {
        it("Should allow manager to mint tokens", async function () {
            await reitToken.connect(manager).mint(await user1.getAddress(), 1000);
            expect(await reitToken.balanceOf(await user1.getAddress())).to.equal(1000);
        });

        it("Should allow manager to burn tokens", async function () {
            await reitToken.connect(manager).mint(await user1.getAddress(), 1000);
            await reitToken.connect(manager).burn(await user1.getAddress(), 500);
            expect(await reitToken.balanceOf(await user1.getAddress())).to.equal(500);
        });

        it("Should not allow non-manager to mint tokens", async function () {
            await expect(
                reitToken.connect(user1).mint(await user1.getAddress(), 1000)
            ).to.be.revertedWithCustomError(reitToken, "AccessControlUnauthorizedAccount")
             .withArgs(await user1.getAddress(), MANAGER_ROLE);
        });

        it("Should not allow non-manager to burn tokens", async function () {
            await expect(
                reitToken.connect(user1).burn(await user1.getAddress(), 1000)
            ).to.be.revertedWithCustomError(reitToken, "AccessControlUnauthorizedAccount")
             .withArgs(await user1.getAddress(), MANAGER_ROLE);
        });
    });

    describe("Transfer Whitelisting", function () {
        beforeEach(async function () {
            await reitToken.connect(manager).mint(await user1.getAddress(), 1000);
        });

        it("Should allow transfer between whitelisted addresses", async function () {
            await reitToken.connect(user1).transfer(await user2.getAddress(), 500);
            expect(await reitToken.balanceOf(await user2.getAddress())).to.equal(500);
        });

        it("Should not allow transfer to non-whitelisted address", async function () {
            const nonWhitelisted = forwarder;
            await expect(
                reitToken.connect(user1).transfer(await nonWhitelisted.getAddress(), 500)
            ).to.be.revertedWith("The 'to' address should be white listed");
        });

        it("Should not allow transfer from non-whitelisted address", async function () {
            const nonWhitelisted = forwarder;
            // Temporarily add to whitelist for minting
            await whiteList.addAddress(await nonWhitelisted.getAddress());
            await reitToken.connect(manager).mint(await nonWhitelisted.getAddress(), 1000);
            // Remove from whitelist to test transfer restriction
            await whiteList.deleteAddress(await nonWhitelisted.getAddress());
            await expect(
                reitToken.connect(nonWhitelisted).transfer(await user1.getAddress(), 500)
            ).to.be.revertedWith("The 'from' address should be white listed");
        });

        it("Should respect whitelist activation toggle", async function () {
            await reitToken.connect(master).setActivationOfWhitelist(false);
            const nonWhitelisted = forwarder;
            await reitToken.connect(user1).transfer(await nonWhitelisted.getAddress(), 500);
            expect(await reitToken.balanceOf(await nonWhitelisted.getAddress())).to.equal(500);
        });
    });

    describe("Pause Functionality", function () {
        beforeEach(async function () {
            await reitToken.connect(manager).mint(await user1.getAddress(), 1000);
        });

        it("Should allow master to pause and unpause", async function () {
            await reitToken.connect(master).pause();
            expect(await reitToken.paused()).to.be.true;

            await reitToken.connect(master).unpause();
            expect(await reitToken.paused()).to.be.false;
        });

        it("Should not allow non-master to pause", async function () {
            await expect(
                reitToken.connect(user1).pause()
            ).to.be.revertedWithCustomError(reitToken, "AccessControlUnauthorizedAccount")
             .withArgs(await user1.getAddress(), MASTER_ROLE);
        });

        it("Should prevent transfers when paused", async function () {
            await reitToken.connect(master).pause();
            await expect(
                reitToken.connect(user1).transfer(await user2.getAddress(), 500)
            ).to.be.revertedWithCustomError(reitToken, "EnforcedPause");
        });
    });

    describe("Authorization Functions", function () {
        let validAfter;
        let validBefore;
        let nonce;
        let value;

        beforeEach(async function () {
            await reitToken.connect(manager).mint(await user1.getAddress(), 1000);
            validAfter = Math.floor(Date.now() / 1000) - 1000; // 1000 seconds ago
            validBefore = Math.floor(Date.now() / 1000) + 1000; // 1000 seconds from now
            nonce = ethers.randomBytes(32);
            value = 500;
        });

        it("Should execute transferWithAuthorization", async function () {
            const domain = {
                name: "Real Estate Token",
                version: "1",
                chainId: (await ethers.provider.getNetwork()).chainId,
                verifyingContract: await reitToken.getAddress()
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

            const message = {
                from: await user1.getAddress(),
                to: await user2.getAddress(),
                value: value,
                validAfter: validAfter,
                validBefore: validBefore,
                nonce: ethers.hexlify(nonce)
            };

            const signature = await user1.signTypedData(domain, types, message);
            const sig = ethers.Signature.from(signature);

            await reitToken.transferWithAuthorization(
                await user1.getAddress(),
                await user2.getAddress(),
                value,
                validAfter,
                validBefore,
                ethers.hexlify(nonce),
                sig.v,
                sig.r,
                sig.s
            );

            expect(await reitToken.balanceOf(await user2.getAddress())).to.equal(value);
        });

        it("Should not allow expired authorizations", async function () {
            const expiredValidBefore = Math.floor(Date.now() / 1000) - 1000; // 1000 seconds ago
            const signature = await generateAuthorizationSignature(
                user1,
                await user2.getAddress(),
                value,
                validAfter,
                expiredValidBefore,
                nonce
            );

            await expect(
                reitToken.transferWithAuthorization(
                    await user1.getAddress(),
                    await user2.getAddress(),
                    value,
                    validAfter,
                    expiredValidBefore,
                    ethers.hexlify(nonce),
                    signature.v,
                    signature.r,
                    signature.s
                )
            ).to.be.revertedWithCustomError(reitToken, "AuthorizationExpired")
             .withArgs(expiredValidBefore);
        });

        it("Should not allow reuse of nonce", async function () {
            const signature = await generateAuthorizationSignature(
                user1,
                await user2.getAddress(),
                value,
                validAfter,
                validBefore,
                nonce
            );

            await reitToken.transferWithAuthorization(
                await user1.getAddress(),
                await user2.getAddress(),
                value,
                validAfter,
                validBefore,
                ethers.hexlify(nonce),
                signature.v,
                signature.r,
                signature.s
            );

            await expect(
                reitToken.transferWithAuthorization(
                    await user1.getAddress(),
                    await user2.getAddress(),
                    value,
                    validAfter,
                    validBefore,
                    ethers.hexlify(nonce),
                    signature.v,
                    signature.r,
                    signature.s
                )
            ).to.be.revertedWithCustomError(reitToken, "AuthorizationAlreadyUsed")
             .withArgs(await user1.getAddress(), ethers.hexlify(nonce));
        });
    });

    // Helper function to generate authorization signatures
    async function generateAuthorizationSignature(
        signer,
        to,
        value,
        validAfter,
        validBefore,
        nonce
    ) {
        const domain = {
            name: "Real Estate Token",
            version: "1",
            chainId: (await ethers.provider.getNetwork()).chainId,
            verifyingContract: await reitToken.getAddress()
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

        const message = {
            from: await signer.getAddress(),
            to: to,
            value: value,
            validAfter: validAfter,
            validBefore: validBefore,
            nonce: ethers.hexlify(nonce)
        };

        const signature = await signer.signTypedData(domain, types, message);
        return ethers.Signature.from(signature);
    }
});