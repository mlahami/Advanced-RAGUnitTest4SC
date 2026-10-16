// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

/**
 * @dev OpenZeppelin Contracts v4.9.0 (metatx/MinimalForwarder.sol)
 * https://github.com/OpenZeppelin/openzeppelin-contracts/blob/v4.9.0/contracts/metatx/MinimalForwarder.sol
 */
contract MinimalForwarder {
    struct ForwardRequest {
        address from;
        address to;
        uint256 value;
        uint256 gas;
        uint256 nonce;
        bytes data;
    }

    bytes32 private constant _TYPEHASH =
        keccak256(
            "ForwardRequest(address from,address to,uint256 value,uint256 gas,uint256 nonce,bytes data)"
        );

    mapping(address => uint256) private _nonces;

    function getNonce(address from) public view returns (uint256) {
        return _nonces[from];
    }

    function verify(
        ForwardRequest calldata req,
        bytes calldata signature
    ) public view returns (bool) {
        bytes32 hashStruct = keccak256(
            abi.encode(
                _TYPEHASH,
                req.from,
                req.to,
                req.value,
                req.gas,
                req.nonce,
                keccak256(req.data)
            )
        );
        bytes32 digest = _toTypedDataHash(_domainSeparatorV4(), hashStruct);
        address signer = _recoverSigner(digest, signature);
        require(
            _nonces[req.from] == req.nonce,
            "MinimalForwarder: nonce mismatch"
        );
        require(
            signer == req.from,
            "MinimalForwarder: signature does not match request"
        );
        return true;
    }

    function execute(
        ForwardRequest calldata req,
        bytes calldata signature
    ) public payable returns (bool, bytes memory) {
        require(
            verify(req, signature),
            "MinimalForwarder: signature does not match request"
        );
        _nonces[req.from] = req.nonce + 1;
        (bool success, bytes memory returndata) = req.to.call{
            gas: req.gas,
            value: req.value
        }(abi.encodePacked(req.data, req.from));
        assert(gasleft() > req.gas / 63);
        return (success, returndata);
    }

    // --- EIP-712 helpers ---
    function _domainSeparatorV4() internal view returns (bytes32) {
        return
            keccak256(
                abi.encode(
                    keccak256(
                        "EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"
                    ),
                    keccak256(bytes("MinimalForwarder")),
                    keccak256(bytes("0.0.1")),
                    block.chainid,
                    address(this)
                )
            );
    }

    function _toTypedDataHash(
        bytes32 domainSeparator,
        bytes32 structHash
    ) internal pure returns (bytes32) {
        return
            keccak256(
                abi.encodePacked("\x19\x01", domainSeparator, structHash)
            );
    }

    function _recoverSigner(
        bytes32 hash,
        bytes memory signature
    ) internal pure returns (address) {
        if (signature.length != 65) {
            return address(0);
        }
        bytes32 r;
        bytes32 s;
        uint8 v;
        assembly {
            r := mload(add(signature, 0x20))
            s := mload(add(signature, 0x40))
            v := byte(0, mload(add(signature, 0x60)))
        }
        return ecrecover(hash, v, r, s);
    }
}
