# reit-token--laprop

- domain: relayer-meta-transactions (meta-transactions)
- level: complex
- origin: human
- convention: hardhat2-ethers6
- source: https://github.com/LaProp/contracts @ 0aaf375151ace3569b42994142cad8de692ad324
- license: MIT
- targets: ReitToken.sol, EIP3009.sol, EIP712Domain.sol, IWhiteList.sol, ECRecover.sol, EIP712.sol, WhiteList.sol
- validation: 16 passing tests, 0 failing; statement coverage ReitToken.sol 86.96 %, EIP3009.sol 47.62 %, EIP712Domain.sol 100.0 %, IWhiteList.sol 100.0 %, ECRecover.sol 71.43 %, EIP712.sol 100.0 %, WhiteList.sol 59.09 %

## Contract: ECRecover.sol (dependency)

```solidity
/**
 * SPDX-License-Identifier: MIT
 *
 * Copyright (c) 2016-2019 zOS Global Limited
 * Copyright (c) 2018-2020 CENTRE SECZ
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in
 * copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */

pragma solidity ^0.8.20;

/**
 * @title ECRecover
 * @notice A library that provides a safe ECDSA recovery function
 */
library ECRecover {
    /**
     * @notice Recover signer's address from a signed message
     * @dev Adapted from: https://github.com/OpenZeppelin/openzeppelin-contracts/blob/65e4ffde586ec89af3b7e9140bdc9235d1254853/contracts/cryptography/ECDSA.sol
     * Modifications: Accept v, r, and s as separate arguments
     * @param digest    Keccak-256 hash digest of the signed message
     * @param v         v of the signature
     * @param r         r of the signature
     * @param s         s of the signature
     * @return Signer address
     */
    function recover(bytes32 digest, uint8 v, bytes32 r, bytes32 s) internal pure returns (address) {
        // EIP-2 still allows signature malleability for ecrecover(). Remove this possibility and make the signature
        // unique. Appendix F in the Ethereum Yellow paper (https://ethereum.github.io/yellowpaper/paper.pdf), defines
        // the valid range for s in (281): 0 < s < secp256k1n ÷ 2 + 1, and for v in (282): v ∈ {27, 28}. Most
        // signatures from current libraries generate a unique signature with an s-value in the lower half order.
        //
        // If your library generates malleable signatures, such as s-values in the upper range, calculate a new s-value
        // with 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141 - s1 and flip v from 27 to 28 or
        // vice versa. If your library also generates signatures with 0/1 for v instead 27/28, add 27 to v to accept
        // these malleable signatures as well.
        if (uint256(s) > 0x7FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF5D576E7357A4501DDFE92F46681B20A0) {
            revert("ECRecover: invalid signature 's' value");
        }

        if (v != 27 && v != 28) {
            revert("ECRecover: invalid signature 'v' value");
        }

        // If the signature is valid (and not malleable), return the signer address
        address signer = ecrecover(digest, v, r, s);
        require(signer != address(0), "ECRecover: invalid signature");

        return signer;
    }
}
```

## Contract: EIP3009.sol (dependency)

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./EIP712Domain.sol";
import "./EIP712.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/**
 * @title EIP-3009
 * @notice Provide internal implementation for gas-abstracted transfers
 * @dev Contracts that inherit from this must wrap these with publicly
 * accessible functions, optionally adding modifiers where necessary
 */
abstract contract EIP3009 is ERC20, EIP712Domain {
    // keccak256("TransferWithAuthorization(address from,address to,uint256 value,uint256 validAfter,uint256 validBefore,bytes32 nonce)")
    bytes32 public constant TRANSFER_WITH_AUTHORIZATION_TYPEHASH =
        0x7c7c6cdb67a18743f49ec6fa9b35f50d52ed05cbed4cc592e13b44501c1a2267;

    // keccak256("ReceiveWithAuthorization(address from,address to,uint256 value,uint256 validAfter,uint256 validBefore,bytes32 nonce)")
    bytes32 public constant RECEIVE_WITH_AUTHORIZATION_TYPEHASH =
        0xd099cc98ef71107a616c4f0f941f04c322d8e254fe26b3c6668db87aae413de8;

    // keccak256("CancelAuthorization(address authorizer,bytes32 nonce)")
    bytes32 public constant CANCEL_AUTHORIZATION_TYPEHASH =
        0x158b0a9edf7a828aad02f63cd515c68ef2f50ba807396f6d12842833a1597429;

    /**
     * @dev authorizer address => nonce => bool (true if nonce is used)
     */
    mapping(address => mapping(bytes32 => bool)) private _authorizationStates;

    event AuthorizationUsed(address indexed authorizer, bytes32 indexed nonce);
    event AuthorizationCanceled(address indexed authorizer, bytes32 indexed nonce);

    error AuthorizationAlreadyUsed(address authorizer, bytes32 nonce);
    error AuthorizationNotYetValid(uint256 validAfter);
    error AuthorizationExpired(uint256 validBefore);
    error InvalidSignature();
    error CallerMustBePayee(address caller, address payee);

    /**
     * @notice Returns the state of an authorization
     * @param authorizer    Authorizer's address
     * @param nonce         Nonce of the authorization
     * @return True if the nonce is used
     */
    function authorizationState(address authorizer, bytes32 nonce) external view returns (bool) {
        return _authorizationStates[authorizer][nonce];
    }

    /**
     * @notice Execute a transfer with a signed authorization
     * @param from          Payer's address (Authorizer)
     * @param to            Payee's address
     * @param value         Amount to be transferred
     * @param validAfter    The time after which this is valid (unix time)
     * @param validBefore   The time before which this is valid (unix time)
     * @param nonce         Unique nonce
     * @param v             v of the signature
     * @param r             r of the signature
     * @param s             s of the signature
     */
    function _transferWithAuthorization(
        address from,
        address to,
        uint256 value,
        uint256 validAfter,
        uint256 validBefore,
        bytes32 nonce,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) internal virtual {
        _requireValidAuthorization(from, nonce, validAfter, validBefore);

        bytes memory data = abi.encode(
            TRANSFER_WITH_AUTHORIZATION_TYPEHASH,
            from,
            to,
            value,
            validAfter,
            validBefore,
            nonce
        );
        if (EIP712.recover(DOMAIN_SEPARATOR, v, r, s, data) != from) {
            revert InvalidSignature();
        }

        _markAuthorizationAsUsed(from, nonce);
        _transfer(from, to, value);
    }

    /**
     * @notice Receive a transfer with a signed authorization from the payer
     * @param from          Payer's address (Authorizer)
     * @param to            Payee's address
     * @param value         Amount to be transferred
     * @param validAfter    The time after which this is valid (unix time)
     * @param validBefore   The time before which this is valid (unix time)
     * @param nonce         Unique nonce
     * @param v             v of the signature
     * @param r             r of the signature
     * @param s             s of the signature
     */
    function _receiveWithAuthorization(
        address from,
        address to,
        uint256 value,
        uint256 validAfter,
        uint256 validBefore,
        bytes32 nonce,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) internal virtual {
        if (to != msg.sender) {
            revert CallerMustBePayee(msg.sender, to);
        }
        
        _requireValidAuthorization(from, nonce, validAfter, validBefore);

        bytes memory data = abi.encode(
            RECEIVE_WITH_AUTHORIZATION_TYPEHASH,
            from,
            to,
            value,
            validAfter,
            validBefore,
            nonce
        );
        if (EIP712.recover(DOMAIN_SEPARATOR, v, r, s, data) != from) {
            revert InvalidSignature();
        }

        _markAuthorizationAsUsed(from, nonce);
        _transfer(from, to, value);
    }

    /**
     * @notice Attempt to cancel an authorization
     * @param authorizer    Authorizer's address
     * @param nonce         Nonce of the authorization
     * @param v             v of the signature
     * @param r             r of the signature
     * @param s             s of the signature
     */
    function _cancelAuthorization(
        address authorizer, 
        bytes32 nonce, 
        uint8 v, 
        bytes32 r, 
        bytes32 s
    ) internal virtual {
        _requireUnusedAuthorization(authorizer, nonce);

        bytes memory data = abi.encode(CANCEL_AUTHORIZATION_TYPEHASH, authorizer, nonce);
        if (EIP712.recover(DOMAIN_SEPARATOR, v, r, s, data) != authorizer) {
            revert InvalidSignature();
        }

        _authorizationStates[authorizer][nonce] = true;
        emit AuthorizationCanceled(authorizer, nonce);
    }

    /**
     * @notice Check that an authorization is unused
     * @param authorizer    Authorizer's address
     * @param nonce         Nonce of the authorization
     */
    function _requireUnusedAuthorization(address authorizer, bytes32 nonce) private view {
        if (_authorizationStates[authorizer][nonce]) {
            revert AuthorizationAlreadyUsed(authorizer, nonce);
        }
    }

    /**
     * @notice Check that authorization is valid
     * @param authorizer    Authorizer's address
     * @param nonce         Nonce of the authorization
     * @param validAfter    The time after which this is valid (unix time)
     * @param validBefore   The time before which this is valid (unix time)
     */
    function _requireValidAuthorization(
        address authorizer,
        bytes32 nonce,
        uint256 validAfter,
        uint256 validBefore
    ) private view {
        if (block.timestamp <= validAfter) {
            revert AuthorizationNotYetValid(validAfter);
        }
        if (block.timestamp >= validBefore) {
            revert AuthorizationExpired(validBefore);
        }
        _requireUnusedAuthorization(authorizer, nonce);
    }

    /**
     * @notice Mark an authorization as used
     * @param authorizer    Authorizer's address
     * @param nonce         Nonce of the authorization
     */
    function _markAuthorizationAsUsed(address authorizer, bytes32 nonce) private {
        _authorizationStates[authorizer][nonce] = true;
        emit AuthorizationUsed(authorizer, nonce);
    }
}
```

## Contract: EIP712.sol (dependency)

```solidity
/**
 * SPDX-License-Identifier: MIT
 *
 * Copyright (c) 2018-2020 CENTRE SECZ
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in
 * copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */

pragma solidity ^0.8.20;

import { ECRecover } from "./ECRecover.sol";

/**
 * @title EIP712
 * @notice A library that provides EIP712 helper functions
 */
library EIP712 {
    /**
     * @notice Make EIP712 domain separator
     * @param name      Contract name
     * @param version   Contract version
     * @return Domain separator
     */
    function makeDomainSeparator(string memory name, string memory version) internal view returns (bytes32) {
        uint256 chainId;
        assembly {
            chainId := chainid()
        }
        return
            keccak256(
                abi.encode(
                    // keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)")
                    0x8b73c3c69bb8fe3d512ecc4cf759cc79239f7b179b0ffacaa9a75d522b39400f,
                    keccak256(bytes(name)),
                    keccak256(bytes(version)),
                    chainId,
                    address(this)
                )
            );
    }

    /**
     * @notice Recover signer's address from a EIP712 signature
     * @param domainSeparator   Domain separator
     * @param v                 v of the signature
     * @param r                 r of the signature
     * @param s                 s of the signature
     * @param typeHashAndData   Type hash concatenated with data
     * @return Signer's address
     */
    function recover(
        bytes32 domainSeparator,
        uint8 v,
        bytes32 r,
        bytes32 s,
        bytes memory typeHashAndData
    ) internal pure returns (address) {
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", domainSeparator, keccak256(typeHashAndData)));
        return ECRecover.recover(digest, v, r, s);
    }
}
```

## Contract: EIP712Domain.sol (dependency)

```solidity
/**
 * SPDX-License-Identifier: MIT
 *
 * Copyright (c) 2018-2020 CENTRE SECZ
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in
 * copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */

pragma solidity ^0.8.20;

/**
 * @title EIP712 Domain
 */
contract EIP712Domain {
    /**
     * @dev EIP712 Domain Separator
     */
    bytes32 public DOMAIN_SEPARATOR;
}
```

## Contract: IWhiteList.sol (dependency)

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IWhiteList {
    function addAddress(address whiteListAddress) external returns (bool);

    function deleteAddress(address addressToDelete) external returns (bool);

    function getAddressesInWhiteList() external view returns (address[] memory);

    function getAddressesInWhiteListPaginated(
        uint256 offset,
        uint256 itemsAmount
    ) external view returns (address[] memory);

    function isAddressWhiteListed(address addressToFind)
        external
        view
        returns (bool);

    function getWhiteListSize() external view returns (uint256);
}
```

## Contract: ReitToken.sol (primary target)

```solidity
// SPDX-License-Identifier: MIT
import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Pausable.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/metatx/ERC2771Context.sol";
import "./IWhiteList.sol";
import "./EIP3009.sol";

pragma solidity ^0.8.20;

contract ReitToken is ERC2771Context, ERC20Pausable, EIP3009, AccessControl {

    IWhiteList private _whiteList;
    bool private _activatedTransferWhitelisting;

    //--------------------------ROLES-----------------------------------
    bytes32 public constant MANAGER = keccak256("MANAGER");
    bytes32 public constant MASTER_ROLE = keccak256("MASTER_ROLE");
    //-------------------------------------------------------------------

    constructor(
        string memory reitName_,
        string memory reitSymbol_,
        IWhiteList whiteList_,
        address trustedForwarder_,
        bool activatedTransferWhitelisting_
    ) ERC2771Context(trustedForwarder_) ERC20(reitName_, reitSymbol_) {
        _grantRole(DEFAULT_ADMIN_ROLE, _msgSender());
        _grantRole(MANAGER, _msgSender());
        _grantRole(MASTER_ROLE, _msgSender());
        _whiteList = whiteList_;
        DOMAIN_SEPARATOR = EIP712.makeDomainSeparator(reitName_, "1");
        _activatedTransferWhitelisting = activatedTransferWhitelisting_;
    }

    function activatedTransferWhitelisting() external view returns (bool) {
        return _activatedTransferWhitelisting;
    }

    function setActivationOfWhitelist(bool value) external onlyRole(MASTER_ROLE) {
        _activatedTransferWhitelisting = value;
    }

    function pause() external virtual onlyRole(MASTER_ROLE) {
        super._pause();
    }

    function whiteList() external view returns (IWhiteList) {
        return _whiteList;
    }

    function unpause() external virtual onlyRole(MASTER_ROLE) {
        super._unpause();
    }

    function mint(address account, uint256 value) external onlyRole(MANAGER) {
        _mint(account, value);
    }

    function burn(address account, uint256 value) external onlyRole(MANAGER) {
        _burn(account, value);
    }

    function _update(
        address from,
        address to,
        uint256 amount
    )
    internal
    virtual
    override(ERC20, ERC20Pausable)
    whenNotPaused
    {
        if (_activatedTransferWhitelisting) {
            if (from == address(0)) {
                require(
                    _whiteList.isAddressWhiteListed(to),
                    "The 'to' address should be white listed"
                );
            } else if (to == address(0)) {
                require(
                    _whiteList.isAddressWhiteListed(from),
                    "The 'from' address should be white listed"
                );
            } else {
                require(
                    _whiteList.isAddressWhiteListed(from),
                    "The 'from' address should be white listed"
                );
                require(
                    _whiteList.isAddressWhiteListed(to),
                    "The 'to' address should be white listed"
                );
            }
        }
        super._update(from, to, amount);
    }


    function _msgSender() internal view virtual override(Context, ERC2771Context)
        returns (address) {
        return ERC2771Context._msgSender();
    }

    function _msgData() internal view virtual override(Context, ERC2771Context)
        returns (bytes calldata) {
        return ERC2771Context._msgData();
    }

    function _contextSuffixLength() internal view virtual override(Context, ERC2771Context) 
        returns (uint256) {
        return ERC2771Context._contextSuffixLength();
    }

    function transferWithAuthorization(
        address from,
        address to,
        uint256 value,
        uint256 validAfter,
        uint256 validBefore,
        bytes32 nonce,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external whenNotPaused {
        _transferWithAuthorization(
            from,
            to,
            value,
            validAfter,
            validBefore,
            nonce,
            v,
            r,
            s
        );
    }

    function receiveWithAuthorization(
        address from,
        address to,
        uint256 value,
        uint256 validAfter,
        uint256 validBefore,
        bytes32 nonce,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external whenNotPaused {
        _receiveWithAuthorization(
            from,
            to,
            value,
            validAfter,
            validBefore,
            nonce,
            v,
            r,
            s
        );
    }

    function cancelAuthorization(
        address authorizer,
        bytes32 nonce,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external whenNotPaused {
        _cancelAuthorization(authorizer, nonce, v, r, s);
    }


}
```

## Contract: WhiteList.sol (dependency)

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./IWhiteList.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";

contract WhiteList is AccessControl, IWhiteList {
    bytes32 public constant MASTER_ROLE = keccak256("MASTER_ROLE");
    bytes32 public constant READER_ROLE = keccak256("READER_ROLE");
    bytes32 public constant WRITER_ROLE = keccak256("WRITER_ROLE");

    using EnumerableSet for EnumerableSet.AddressSet;

    EnumerableSet.AddressSet private mySet;

    event AddressAdded(address indexed whiteListAddress);
    event AddressDeleted(address indexed addressDeleted);

    constructor() {
        _grantRole(DEFAULT_ADMIN_ROLE, _msgSender());
        _grantRole(READER_ROLE, _msgSender());
        _grantRole(WRITER_ROLE, _msgSender());
        _grantRole(MASTER_ROLE, _msgSender());
    }

    function addAddress(address whiteListAddress)
        public
        override
        onlyRole(WRITER_ROLE)
        returns (bool)
    {
        bool added = mySet.add(whiteListAddress);
        if (added) {
            emit AddressAdded(whiteListAddress);
        }
        return added;
    }

    function deleteAddress(address addressToDelete)
        public
        override
        onlyRole(WRITER_ROLE)
        returns (bool)
    {
        bool removed = mySet.remove(addressToDelete);
        if (removed) {
            emit AddressDeleted(addressToDelete);
        }
        return removed;
    }

    function isAddressWhiteListed(address addressToFind)
        public
        view
        override
        onlyRole(READER_ROLE)
        returns (bool)
    {
        return mySet.contains(addressToFind);
    }

    function getAddressesInWhiteList()
        public
        view
        override
        onlyRole(READER_ROLE)
        returns (address[] memory)
    {
        return mySet.values();
    }

    function getAddressesInWhiteListPaginated(
        uint256 offset,
        uint256 itemsAmount
    ) public view override onlyRole(READER_ROLE) returns (address[] memory) {
        uint256 lengthArray = mySet.length();
        require(
            (int256(lengthArray) - int256(offset + itemsAmount)) >= 0,
            "Offset + itemsAmount bigger than the array"
        );
        address[] memory result = new address[](itemsAmount);
        uint256 counter = 1;
        uint256 index = 0;
        for (uint256 x = offset; counter <= itemsAmount; x++) {
            result[index] = mySet.at(x);
            index++;
            counter++;
        }
        return result;
    }

    function getWhiteListSize()
        external
        view
        override
        onlyRole(READER_ROLE)
        returns (uint256)
    {
        return mySet.length();
    }
}
```

## Tests: ReitTokenTest.js

```javascript
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
```
