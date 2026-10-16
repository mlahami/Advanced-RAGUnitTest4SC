const { loadFixture } = require("@nomicfoundation/hardhat-network-helpers");
const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("Authenticator", function () {
    async function deployContracts() {
        const [relayer, user] = await ethers.getSigners()
        const Authenticator = await ethers.getContractFactory("Authenticator")
        const authenticator = await Authenticator.deploy()
        return { authenticator, relayer, user }
    }

    describe("Deployment", function () {
        it("Should verify that the contract is deployed", async function () {
            const { authenticator } = await loadFixture(deployContracts)
            expect(await authenticator.getAddress()).to.be.properAddress
        })
    })

    describe("Interactions", function () {
        it("Should relay user signature", async function () {
            const { authenticator, relayer, user } = await loadFixture(
                deployContracts
            )

            const domain = {
                name: "Authenticator",
                version: "1",
                chainId: (await ethers.provider.getNetwork()).chainId,
                verifyingContract: await authenticator.getAddress()
            }

            const types = {
                Authenticate: [
                    { name: "user", type: "address" },
                    { name: "nonce", type: "uint256" }
                ]
            }

            const value = {
                user: user.address,
                nonce: 0 // Initial nonce is 0
            }

            const signature = await user.signTypedData(domain, types, value)

            await expect(
                authenticator
                    .connect(relayer)
                    .authenticate(user.address, signature)
            )
                .to.emit(authenticator, "Authenticated")
                .withArgs(user.address)

            expect(await authenticator.authenticated(user.address)).to.be.true
        })

        it("Should fail with invalid signature", async function () {
            const { authenticator, relayer, user } = await loadFixture(
                deployContracts
            )

            const domain = {
                name: "Authenticator",
                version: "1",
                chainId: (await ethers.provider.getNetwork()).chainId,
                verifyingContract: await authenticator.getAddress()
            }

            const types = {
                Authenticate: [
                    { name: "user", type: "address" },
                    { name: "nonce", type: "uint256" }
                ]
            }

            const value = {
                user: user.address,
                nonce: 0
            }

            const signature = await relayer.signTypedData(domain, types, value)

            await expect(
                authenticator
                    .connect(relayer)
                    .authenticate(user.address, signature)
            ).to.be.revertedWith("Invalid signature")
        })

        it("Should check if a user is authenticated", async function () {
            const { authenticator, relayer, user } = await loadFixture(
                deployContracts
            )

            expect(await authenticator.isAuthenticated(user.address)).to.be
                .false
            expect(await authenticator.isAuthenticated(relayer.address)).to.be
                .false

            const domain = {
                name: "Authenticator",
                version: "1",
                chainId: (await ethers.provider.getNetwork()).chainId,
                verifyingContract: await authenticator.getAddress()
            }

            const types = {
                Authenticate: [
                    { name: "user", type: "address" },
                    { name: "nonce", type: "uint256" }
                ]
            }

            const value = {
                user: user.address,
                nonce: 0
            }

            const signature = await user.signTypedData(domain, types, value)

            await authenticator
                .connect(relayer)
                .authenticate(user.address, signature)

            expect(await authenticator.isAuthenticated(user.address)).to.be.true
            expect(await authenticator.isAuthenticated(relayer.address)).to.be
                .false
        })

        it("Should get the nonce for a given user", async function () {
            const { authenticator, relayer, user } = await loadFixture(
                deployContracts
            )

            expect(await authenticator.getNonce(user.address)).to.equal(0)
            expect(await authenticator.getNonce(relayer.address)).to.equal(0)

            const domain = {
                name: "Authenticator",
                version: "1",
                chainId: (await ethers.provider.getNetwork()).chainId,
                verifyingContract: await authenticator.getAddress()
            }

            const types = {
                Authenticate: [
                    { name: "user", type: "address" },
                    { name: "nonce", type: "uint256" }
                ]
            }

            const value = {
                user: user.address,
                nonce: 0
            }

            const signature = await user.signTypedData(domain, types, value)

            await authenticator
                .connect(relayer)
                .authenticate(user.address, signature)

            expect(await authenticator.getNonce(user.address)).to.equal(1)
            expect(await authenticator.getNonce(relayer.address)).to.equal(0)
        })

        it("Should fail when trying to authenticate with an outdated nonce", async function () {
            const { authenticator, relayer, user } = await loadFixture(
                deployContracts
            )

            const domain = {
                name: "Authenticator",
                version: "1",
                chainId: (await ethers.provider.getNetwork()).chainId,
                verifyingContract: await authenticator.getAddress()
            }

            const types = {
                Authenticate: [
                    { name: "user", type: "address" },
                    { name: "nonce", type: "uint256" }
                ]
            }

            // First authentication
            let value = {
                user: user.address,
                nonce: 0
            }

            let signature = await user.signTypedData(domain, types, value)
            await authenticator
                .connect(relayer)
                .authenticate(user.address, signature)

            // Try to authenticate again with the same nonce
            signature = await user.signTypedData(domain, types, value)
            await expect(
                authenticator
                    .connect(relayer)
                    .authenticate(user.address, signature)
            ).to.be.revertedWith("Invalid signature")

            // Correct authentication with updated nonce
            value.nonce = 1
            signature = await user.signTypedData(domain, types, value)
            await expect(
                authenticator
                    .connect(relayer)
                    .authenticate(user.address, signature)
            )
                .to.emit(authenticator, "Authenticated")
                .withArgs(user.address)
        })
    })
})
