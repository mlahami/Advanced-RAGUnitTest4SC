# totem-trusted-forwarder--totembound

- domain: relayer-meta-transactions (meta-transactions)
- level: moderate
- origin: human
- convention: hardhat2-ethers6
- source: https://github.com/totembound/totem-contracts @ a80daaf499dc81cab764ad5398c6a277d5fc67e6
- license: MIT
- targets: TotemTrustedForwarder.sol, MockTarget.sol
- validation: 19 passing tests, 0 failing; statement coverage TotemTrustedForwarder.sol 94.44 %, MockTarget.sol 71.43 %

## Contract: MockTarget.sol (dependency)

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

/**
 * @title MockTarget
 * @dev A mock contract for testing the TotemTrustedForwarder.
 * This contract implements ERC-2771 style trusted forwarder functionality
 * to extract the original sender from the calldata appended by the forwarder.
 */
contract MockTarget {
    address public lastCaller;
    string public lastMessage;
    
    event FunctionExecuted(address caller, string message);
    
    /**
     * @dev Extracts the original sender from the calldata if it exists.
     * This implements ERC-2771 style message handling.
     * @return sender The original sender of the transaction
     */
    function _msgSender() internal view returns (address sender) {
        // Check if calldata is long enough to contain an address at the end
        if (msg.data.length >= 20) {
            // Extract the original sender address from the end of the calldata
            assembly {
                // Find the appended address (last 20 bytes)
                sender := shr(96, calldataload(sub(calldatasize(), 20)))
            }
            
            // Ensure sender is not zero address as an additional safety check
            if (sender == address(0)) {
                return msg.sender;
            }
        } else {
            return msg.sender;
        }
    }
    
    /**
     * @dev A test function that records who called it and a message.
     * @param message A test message to record
     */
    function executeFunction(string memory message) external {
        // Use _msgSender() to get the original sender
        address originalSender = _msgSender();
        lastCaller = originalSender;
        lastMessage = message;
        
        emit FunctionExecuted(originalSender, message);
    }
    
    /**
     * @dev A test function that always reverts, used for testing error handling.
     */
    function revertingFunction() external pure {
        revert("This function always reverts");
    }
}
```

## Contract: TotemTrustedForwarder.sol (primary target)

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import { Ownable } from "@openzeppelin/contracts/access/Ownable.sol";
import { ReentrancyGuard } from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import { ECDSA } from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import { MessageHashUtils } from "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";

contract TotemTrustedForwarder is Ownable, ReentrancyGuard {
    using ECDSA for bytes32;

    struct ForwardRequest {
        address from;
        address to; // Specific contract to call
        uint256 value;
        uint256 gas;
        uint256 nonce;
        bytes data;
    }

    bytes32 private immutable _DOMAIN_SEPARATOR;
    bytes32 public constant DOMAIN_TYPE_HASH = 
        keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)");
    bytes32 public constant REQUEST_TYPE_HASH = 
        keccak256("ForwardRequest(address from,address to,uint256 value,uint256 gas,uint256 nonce,bytes data)");

    
    mapping(address => uint256) private _nonces;
    uint256 public maxGasPrice;
    mapping(address => bool) public allowedContracts; // The allowed target contracts

    event MetaTransactionExecuted(
        address indexed from, 
        address indexed to, 
        bytes data, 
        uint256 gasUsed,
        uint256 gasPrice,
        uint256 polSpent
    );
    event ContractWhitelisted(address indexed contractAddress, bool status);
    event GasFundingFailed(address indexed from, address indexed to, uint256 gasCost);
    event RelayExecutionFailed(
        address indexed from, 
        address indexed to, 
        string reason
    );

    // Custom errors
    error UnauthorizedContract();
    error InvalidSignature();
    error InvalidContractAddress();
    error MismatchedArrayLengths();
    error InvalidFromAddress();
    error InvalidToAddress();
    error ContractNotWhitelisted();
    error InvalidNonce();
    error TransactionFailed(string reason);

    constructor(uint256 _maxGasPrice) Ownable(msg.sender) {
        maxGasPrice = _maxGasPrice;
        _DOMAIN_SEPARATOR = _buildDomainSeparator();
    }
    
    receive() external payable {}

    function relay(ForwardRequest calldata req, bytes calldata signature) 
        external 
        nonReentrant
        returns (bool, bytes memory) 
    {
        if (!allowedContracts[req.to]) revert UnauthorizedContract();
        if (!verify(req, signature)) revert InvalidSignature();

        uint256 startGas = gasleft();
        _nonces[req.from] = req.nonce + 1;

        // Execute the transaction from the forwarder contract itself
        (bool success, bytes memory returndata) = req.to.call{gas: req.gas, value: 0}(
            abi.encodePacked(req.data, req.from)
        );

        // Handle return data and potential revert reasons
        if (!success) {
            // If the call failed, revert with the original error message
            string memory revertReason = _getRevertMsg(returndata);
            emit RelayExecutionFailed(req.from, req.to, revertReason);
            // Re-throw with the actual error
            revert TransactionFailed(revertReason);
        }

        // Calculate actual gas used
        uint256 gasUsed = startGas - gasleft() + 21000;
        uint256 actualCost = gasUsed * tx.gasprice;

        emit MetaTransactionExecuted(
            req.from,
            req.to,
            req.data,
            gasUsed,
            tx.gasprice,
            actualCost
        );

        return (success, returndata);
    }

    // Update to whitelist/delist contracts
    function setContractStatus(address _contract, bool _status) external onlyOwner {
        if (_contract == address(0)) revert InvalidContractAddress();

        allowedContracts[_contract] = _status;
        emit ContractWhitelisted(_contract, _status);
    }

    // Batch whitelist contracts
    function batchSetContractStatus(address[] calldata _contracts, bool[] calldata _statuses) external onlyOwner {
        if (_contracts.length != _statuses.length) revert MismatchedArrayLengths();
        
        for (uint256 i = 0; i < _contracts.length; i++) {
            if (_contracts[i] == address(0)) revert InvalidContractAddress();

            allowedContracts[_contracts[i]] = _statuses[i];
            emit ContractWhitelisted(_contracts[i], _statuses[i]);
        }
    }

    function setMaxGasPrice(uint256 _maxGasPrice) external onlyOwner {
        maxGasPrice = _maxGasPrice;
    }

    function verify(ForwardRequest calldata req, bytes calldata signature) public view returns (bool) {
        // Validate request parameters
        if (req.from == address(0)) revert InvalidFromAddress();
        if (req.to == address(0)) revert InvalidToAddress();
        if (!allowedContracts[req.to]) revert ContractNotWhitelisted();

        // Normalize addresses for comparison
        address normalizedFrom = address(uint160(uint256(uint160(req.from))));
        address normalizedRecovered = address(uint160(uint256(uint160(_recoverSigner(req, signature)))));
        
        // Verify signature with normalized addresses
        bool isValidSigner = normalizedRecovered == normalizedFrom;
        bool isNonZeroSigner = normalizedRecovered != address(0);

        if (_nonces[normalizedFrom] != req.nonce) revert InvalidNonce();

        return isValidSigner && isNonZeroSigner;
    }

    function getNonce(address from) public view returns (uint256) {
        return _nonces[from];
    }

    function domainSeparator() public view returns (bytes32) {
        return _DOMAIN_SEPARATOR;
    }

    function _recoverSigner(
        ForwardRequest calldata req, 
        bytes calldata signature
    ) internal view returns (address) {
        // Construct the digest using EIP-712 typed data hashing
        bytes32 digest = _hashTypedDataV4(keccak256(abi.encode(
            keccak256("ForwardRequest(address from,address to,uint256 value,uint256 gas,uint256 nonce,bytes data)"),
            req.from,
            req.to,
            req.value,
            req.gas,
            req.nonce,
            keccak256(req.data)
        )));

        // Recover the signer
        return ECDSA.recover(digest, signature);
    }

    function _getRevertMsg(bytes memory returnData) internal pure returns (string memory) {
        // If the returnData length is less than 68, then the transaction reverted silently (without a reason string)
        if (returnData.length < 68) return "Transaction reverted silently";
        // solhint-disable-next-line
        assembly {
            // Slice the sighash.
            returnData := add(returnData, 0x04)
        }
        
        return abi.decode(returnData, (string));
    }

    function _buildDomainSeparator() private view returns (bytes32) {
        return keccak256(abi.encode(
            DOMAIN_TYPE_HASH,
            keccak256(bytes("TotemTrustedForwarder")),
            keccak256(bytes("1")),
            block.chainid,
            address(this)
        ));
    }

    function _hashTypedDataV4(bytes32 structHash) private view returns (bytes32) {
        return MessageHashUtils.toTypedDataHash(_DOMAIN_SEPARATOR, structHash);
    }

    function _hashForwardRequest(ForwardRequest calldata req) private pure returns (bytes32) {
        return keccak256(abi.encode(
            REQUEST_TYPE_HASH,
            req.from,
            req.to,
            req.value,
            req.gas,
            req.nonce,
            keccak256(req.data)
        ));
    }

}
```

## Tests: TotemTrustedForwarder.test.js

```javascript
const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("TotemTrustedForwarder", function () {
    let TotemTrustedForwarder;
    let forwarder;
    let MockTarget;
    let mockTarget;
    let owner, user1, user2;
    let maxGasPrice = ethers.parseUnits("50", "gwei");

    beforeEach(async function () {
        // Get signers
        [owner, user1, user2] = await ethers.getSigners();

        // Deploy TotemTrustedForwarder
        TotemTrustedForwarder = await ethers.getContractFactory("TotemTrustedForwarder");
        forwarder = await TotemTrustedForwarder.connect(owner).deploy(maxGasPrice);

        // Deploy a mock target contract for testing
        MockTarget = await ethers.getContractFactory("MockTarget");
        mockTarget = await MockTarget.connect(owner).deploy();

        // Whitelist the target contract in the forwarder
        await forwarder.connect(owner).setContractStatus(await mockTarget.getAddress(), true);
    });

    describe("Initialization", function () {
        it("Should set the max gas price correctly", async function () {
            expect(await forwarder.maxGasPrice()).to.equal(maxGasPrice);
        });

        it("Should set the deployer as the owner", async function () {
            expect(await forwarder.owner()).to.equal(owner.address);
        });
    });

    describe("Contract Whitelisting", function () {
        it("Should allow the owner to whitelist a contract", async function () {
            const targetAddress = ethers.Wallet.createRandom().address;
            await forwarder.connect(owner).setContractStatus(targetAddress, true);
            expect(await forwarder.allowedContracts(targetAddress)).to.be.true;
        });

        it("Should allow the owner to remove a contract from the whitelist", async function () {
            const mockAddress = await mockTarget.getAddress();
            expect(await forwarder.allowedContracts(mockAddress)).to.be.true;

            await forwarder.connect(owner).setContractStatus(mockAddress, false);
            expect(await forwarder.allowedContracts(mockAddress)).to.be.false;
        });

        it("Should revert when setting zero address as contract", async function () {
            await expect(forwarder.connect(owner).setContractStatus(ethers.ZeroAddress, true))
                .to.be.revertedWithCustomError(forwarder, "InvalidContractAddress");
        });

        it("Should revert when non-owner tries to whitelist a contract", async function () {
            const targetAddress = ethers.Wallet.createRandom().address;
            await expect(forwarder.connect(user1).setContractStatus(targetAddress, true))
                .to.be.revertedWithCustomError(forwarder, "OwnableUnauthorizedAccount")
                .withArgs(user1.address);
        });

        it("Should allow batch whitelisting of contracts", async function () {
            const addresses = [
                ethers.Wallet.createRandom().address,
                ethers.Wallet.createRandom().address,
                ethers.Wallet.createRandom().address
            ];
            const statuses = [true, false, true];

            await forwarder.connect(owner).batchSetContractStatus(addresses, statuses);

            expect(await forwarder.allowedContracts(addresses[0])).to.equal(statuses[0]);
            expect(await forwarder.allowedContracts(addresses[1])).to.equal(statuses[1]);
            expect(await forwarder.allowedContracts(addresses[2])).to.equal(statuses[2]);
        });

        it("Should revert batch whitelisting when arrays have different lengths", async function () {
            const addresses = [
                ethers.Wallet.createRandom().address,
                ethers.Wallet.createRandom().address
            ];
            const statuses = [true];

            await expect(forwarder.connect(owner).batchSetContractStatus(addresses, statuses))
                .to.be.revertedWithCustomError(forwarder, "MismatchedArrayLengths");
        });

        it("Should revert batch whitelisting with zero address", async function () {
            const addresses = [
                ethers.Wallet.createRandom().address,
                ethers.ZeroAddress
            ];
            const statuses = [true, true];

            await expect(forwarder.connect(owner).batchSetContractStatus(addresses, statuses))
                .to.be.revertedWithCustomError(forwarder, "InvalidContractAddress");
        });
    });

    describe("Max Gas Price Management", function () {
        it("Should allow the owner to update max gas price", async function () {
            const newMaxGasPrice = ethers.parseUnits("100", "gwei");
            await forwarder.connect(owner).setMaxGasPrice(newMaxGasPrice);
            expect(await forwarder.maxGasPrice()).to.equal(newMaxGasPrice);
        });

        it("Should revert when non-owner tries to update max gas price", async function () {
            const newMaxGasPrice = ethers.parseUnits("100", "gwei");
            await expect(forwarder.connect(user1).setMaxGasPrice(newMaxGasPrice))
                .to.be.revertedWithCustomError(forwarder, "OwnableUnauthorizedAccount")
                .withArgs(user1.address);
        });
    });

    describe("Nonce Management", function () {
        it("Should return the correct nonce for an address", async function () {
            const nonce = await forwarder.getNonce(user1.address);
            expect(nonce).to.equal(0n);
        });

        it("Should increment nonce after successful relay", async function () {
            // Will be implemented in the Relay section
        });
    });

    describe("EIP-712 Signature Verification", function () {
        it("Should correctly generate domain separator", async function () {
            const domain = await forwarder.domainSeparator();
            expect(domain).to.not.equal(ethers.ZeroHash);
        });

        // More tests for signature verification will be added in the relay tests
    });

    describe("Meta-transaction Relay", function () {
        let mockFunctionData;
        let mockRequest;
        let domain;

        beforeEach(async function () {
            // Get the contract domain
            const name = "TotemTrustedForwarder";
            const version = "1";
            const chainId = (await ethers.provider.getNetwork()).chainId;
            const verifyingContract = await forwarder.getAddress();

            domain = {
                name,
                version,
                chainId,
                verifyingContract
            };

            // Create mock function call data for target contract
            mockFunctionData = mockTarget.interface.encodeFunctionData("executeFunction", ["Hello World"]);

            // Create a request to be signed and forwarded
            mockRequest = {
                from: user1.address,
                to: await mockTarget.getAddress(),
                value: 0,
                gas: 1000000,
                nonce: await forwarder.getNonce(user1.address),
                data: mockFunctionData
            };
        });

        it("Should relay a valid transaction correctly", async function () {
            // Create EIP-712 signature
            const types = {
                ForwardRequest: [
                    { name: "from", type: "address" },
                    { name: "to", type: "address" },
                    { name: "value", type: "uint256" },
                    { name: "gas", type: "uint256" },
                    { name: "nonce", type: "uint256" },
                    { name: "data", type: "bytes" }
                ]
            };

            const signature = await user1.signTypedData(domain, types, mockRequest);

            // Execute relay
            const relayTx = await forwarder.connect(user2).relay(mockRequest, signature);
            const receipt = await relayTx.wait();

            // Verify the relay was successful
            const metaExecutedEvents = receipt.logs.filter(
                log => log.fragment && log.fragment.name === 'MetaTransactionExecuted'
            );
            expect(metaExecutedEvents.length).to.equal(1);

            // Check target contract state was updated
            expect(await mockTarget.lastCaller()).to.equal(user1.address);
            expect(await mockTarget.lastMessage()).to.equal("Hello World");

            // Check nonce was incremented
            expect(await forwarder.getNonce(user1.address)).to.equal(1n);
        });

        it("Should revert when relaying to non-whitelisted contract", async function () {
            // Deploy a new contract that isn't whitelisted
            const newMockTarget = await MockTarget.connect(owner).deploy();

            // Update request with non-whitelisted contract
            const invalidRequest = { ...mockRequest, to: await newMockTarget.getAddress() };

            // Create signature
            const types = {
                ForwardRequest: [
                    { name: "from", type: "address" },
                    { name: "to", type: "address" },
                    { name: "value", type: "uint256" },
                    { name: "gas", type: "uint256" },
                    { name: "nonce", type: "uint256" },
                    { name: "data", type: "bytes" }
                ]
            };

            const signature = await user1.signTypedData(domain, types, invalidRequest);

            // Try to relay
            await expect(forwarder.connect(user2).relay(invalidRequest, signature))
                .to.be.revertedWithCustomError(forwarder, "UnauthorizedContract");
        });

        it("Should revert when signature is invalid", async function () {
            // Create a valid request
            const validRequest = mockRequest;

            // But sign it with the wrong signer
            const types = {
                ForwardRequest: [
                    { name: "from", type: "address" },
                    { name: "to", type: "address" },
                    { name: "value", type: "uint256" },
                    { name: "gas", type: "uint256" },
                    { name: "nonce", type: "uint256" },
                    { name: "data", type: "bytes" }
                ]
            };

            // User2 signs a transaction claiming to be from user1
            const invalidSignature = await user2.signTypedData(domain, types, validRequest);

            // Try to relay
            await expect(forwarder.connect(user2).relay(validRequest, invalidSignature))
                .to.be.revertedWithCustomError(forwarder, "InvalidSignature");
        });

        it("Should revert when nonce is invalid", async function () {
            // Create request with incorrect nonce
            const invalidRequest = { ...mockRequest, nonce: 42 };

            // Create signature
            const types = {
                ForwardRequest: [
                    { name: "from", type: "address" },
                    { name: "to", type: "address" },
                    { name: "value", type: "uint256" },
                    { name: "gas", type: "uint256" },
                    { name: "nonce", type: "uint256" },
                    { name: "data", type: "bytes" }
                ]
            };

            const signature = await user1.signTypedData(domain, types, invalidRequest);

            // Try to relay
            await expect(forwarder.connect(user2).relay(invalidRequest, signature))
                .to.be.revertedWithCustomError(forwarder, "InvalidNonce");
        });

        it("Should revert when relay target function reverts", async function () {
            // Create request that will trigger a revert in the target
            const revertFunctionData = mockTarget.interface.encodeFunctionData("revertingFunction");
            const revertRequest = { ...mockRequest, data: revertFunctionData };

            // Create signature
            const types = {
                ForwardRequest: [
                    { name: "from", type: "address" },
                    { name: "to", type: "address" },
                    { name: "value", type: "uint256" },
                    { name: "gas", type: "uint256" },
                    { name: "nonce", type: "uint256" },
                    { name: "data", type: "bytes" }
                ]
            };

            const signature = await user1.signTypedData(domain, types, revertRequest);

            // Try to relay
            await expect(forwarder.connect(user2).relay(revertRequest, signature))
                .to.be.revertedWithCustomError(forwarder, "TransactionFailed");
        });
    });
});
```
