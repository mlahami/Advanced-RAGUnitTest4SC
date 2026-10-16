// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "./IERC3009Partial.sol";
import "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

contract MockERC3009 is ERC20, IERC3009Partial, EIP712 {
    using ECDSA for bytes32;
    
    uint8 private _decimalsValue;
    mapping(bytes32 => bool) public usedNonces;

    bytes32 public constant TRANSFER_WITH_AUTHORIZATION_TYPEHASH =
        keccak256("TransferWithAuthorization(address from,address to,uint256 value,uint256 validAfter,uint256 validBefore,bytes32 nonce)");

    constructor(
        string memory name,
        string memory symbol,
        uint8 decimalsValue_
    ) ERC20(name, symbol) EIP712(name, "1") {
        _decimalsValue = decimalsValue_;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function decimals() public view override(ERC20, IERC20Metadata) returns (uint8) {
        return _decimalsValue;
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
    ) external override {
        require(block.timestamp > validAfter, "Not yet valid");
        require(block.timestamp < validBefore, "Expired");
        require(!usedNonces[nonce], "Nonce already used");

        bytes32 structHash = keccak256(
            abi.encode(
                TRANSFER_WITH_AUTHORIZATION_TYPEHASH,
                from,
                to,
                value,
                validAfter,
                validBefore,
                nonce
            )
        );

        bytes32 digest = _hashTypedDataV4(structHash);
        
        // Verify signature using ECDSA
        address recoveredAddress = ECDSA.recover(digest, v, r, s);
        require(recoveredAddress != address(0), "Invalid signature format");
        require(recoveredAddress == from, "Invalid signature");

        usedNonces[nonce] = true;
        _transfer(from, to, value);
    }

    // Helper function for tests to get the digest that needs to be signed
    function getDigestToSign(
        address from,
        address to,
        uint256 value,
        uint256 validAfter,
        uint256 validBefore,
        bytes32 nonce
    ) public view returns (bytes32) {
        bytes32 structHash = keccak256(
            abi.encode(
                TRANSFER_WITH_AUTHORIZATION_TYPEHASH,
                from,
                to,
                value,
                validAfter,
                validBefore,
                nonce
            )
        );
        return _hashTypedDataV4(structHash);
    }
} 