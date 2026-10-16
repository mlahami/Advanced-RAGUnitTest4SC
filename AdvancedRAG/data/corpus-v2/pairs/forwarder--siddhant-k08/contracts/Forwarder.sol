//SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "hardhat/console.sol";

contract Forwarder {
    struct ForwardRequest {
        address from;
        address to;
        uint256 value;
        uint256 gas;
        uint256 nonce;
        bytes data;
    }

    bytes32 private constant TYPEHASH = keccak256(
        "ForwardRequest(address from,address to,uint256 value,uint256 gas,uint256 nonce,bytes data)"
    );

    bytes32 private immutable DOMAIN_SEPARATOR;

    mapping(address => uint256) private _nonces;

    event MetaTransactionExecuted(
        address indexed from,
        address indexed to,
        uint256 nonce,
        bool success,
        bytes returnData
    );

    constructor() {
        DOMAIN_SEPARATOR = keccak256(
            abi.encode(
                keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
                keccak256(bytes("RSKForwarder")),
                keccak256(bytes("0.0.1")),
                block.chainid,
                address(this)
            )
        );
    }

    function getNonce(address from) public view returns (uint256) {
        return _nonces[from];
    }

    function verify(
        ForwardRequest calldata req,
        bytes calldata signature
    ) public view returns (bool) {
        address signer = _recoverSigner(req, signature);
        return _nonces[req.from] == req.nonce && signer == req.from;
    }

    function execute(
        ForwardRequest calldata req,
        bytes calldata signature
    ) public payable returns (bool, bytes memory) {
        require(verify(req, signature), "Forwarder: signature does not match request");

        _nonces[req.from] = req.nonce + 1;

        (bool success, bytes memory returnData) = req.to.call{
            gas: req.gas,
            value: req.value
        }(abi.encodePacked(req.data, req.from));

        if (!success) {
            assembly {
                returndatacopy(0, 0, returndatasize())
                revert(0, returndatasize())
            }
        }

        emit MetaTransactionExecuted(req.from, req.to, req.nonce, success, returnData);

        return (success, returnData);
    }

    function _recoverSigner(
        ForwardRequest calldata req,
        bytes calldata signature
    ) internal view returns (address) {
        bytes32 digest = keccak256(
            abi.encodePacked(
                "\x19\x01",
                DOMAIN_SEPARATOR,
                keccak256(
                    abi.encode(
                        TYPEHASH,
                        req.from,
                        req.to,
                        req.value,
                        req.gas,
                        req.nonce,
                        keccak256(req.data)
                    )
                )
            )
        );

        require(signature.length == 65, "Forwarder: invalid signature length");

        bytes32 r;
        bytes32 s;
        uint8 v;

        assembly {
            r := calldataload(signature.offset)
            s := calldataload(add(signature.offset, 32))
            v := byte(0, calldataload(add(signature.offset, 64)))
        }

        if (v < 27) {
            v += 27;
        }

        require(v == 27 || v == 28, "Forwarder: invalid signature v value");

        return ecrecover(digest, v, r, s);
    }

    function getDomainSeparator() public view returns (bytes32) {
        return DOMAIN_SEPARATOR;
    }
}
