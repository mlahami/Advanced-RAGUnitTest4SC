# authenticator--w3hc

- domain: access-control (identity-signature-auth)
- level: simple
- origin: human
- convention: hardhat2-ethers6
- source: https://github.com/w3hc/authenticator @ 2a1d4c5156296d1ced5287ee0776da62c7aa8691
- license: GPL-3.0
- targets: Authenticator.sol
- validation: 6 passing tests, 0 failing; statement coverage Authenticator.sol 100.0 %

## Contract: Authenticator.sol (primary target)

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

contract Authenticator is EIP712 {
    using ECDSA for bytes32;

    bytes32 private constant AUTH_TYPEHASH = keccak256("Authenticate(address user,uint256 nonce)");

    mapping(address => uint256) public nonces;
    mapping(address => bool) public authenticated;

    event Authenticated(address indexed user);

    constructor() EIP712("Authenticator", "1") {}

    function authenticate(address user, bytes memory signature) external {
        bytes32 structHash = keccak256(abi.encode(AUTH_TYPEHASH, user, nonces[user]));

        bytes32 hash = _hashTypedDataV4(structHash);
        address signer = hash.recover(signature);

        require(signer == user, "Invalid signature");

        nonces[user]++;
        authenticated[user] = true;

        emit Authenticated(user);
    }

    function isAuthenticated(address user) external view returns (bool) {
        return authenticated[user];
    }

    function getNonce(address user) external view returns (uint256) {
        return nonces[user];
    }
}
```

## Tests: Authenticator.js

```javascript
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
```
