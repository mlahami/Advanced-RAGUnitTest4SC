// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title GaslessRelayer
 * @notice EIP-712 meta-transaction forwarder.
 *         Users sign a ForwardRequest off-chain; a relayer submits it and
 *         pays gas. The target contract reads msg.sender via _msgSender()
 *         convention (ERC2771).
 * Complexity: Complex
 */
contract GaslessRelayer {
    struct ForwardRequest {
        address from;
        address to;
        uint256 value;
        uint256 gas;
        uint256 nonce;
        uint256 deadline;
        bytes   data;
    }

    bytes32 public constant DOMAIN_TYPEHASH = keccak256(
        "EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"
    );

    bytes32 public constant REQUEST_TYPEHASH = keccak256(
        "ForwardRequest(address from,address to,uint256 value,uint256 gas,uint256 nonce,uint256 deadline,bytes data)"
    );

    bytes32 public immutable DOMAIN_SEPARATOR;

    mapping(address => uint256) public nonces;

    event MetaTxExecuted(address indexed from, address indexed to, bool success);

    constructor() {
        DOMAIN_SEPARATOR = keccak256(abi.encode(
            DOMAIN_TYPEHASH,
            keccak256("GaslessRelayer"),
            keccak256("1"),
            block.chainid,
            address(this)
        ));
    }

    // â”€â”€â”€ Execute â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

    function execute(ForwardRequest calldata req, bytes calldata signature)
        external
        payable
        returns (bool success, bytes memory returnData)
    {
        require(block.timestamp <= req.deadline, "Request expired");
        require(nonces[req.from] == req.nonce, "Bad nonce");
        require(verify(req, signature), "Bad signature");

        nonces[req.from]++;

        // Append original sender for ERC2771 targets
        bytes memory callData = abi.encodePacked(req.data, req.from);

        (success, returnData) = req.to.call{gas: req.gas, value: req.value}(callData);
        emit MetaTxExecuted(req.from, req.to, success);
    }

    // â”€â”€â”€ Verify â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

    function verify(ForwardRequest calldata req, bytes calldata sig) public view returns (bool) {
        bytes32 digest = _hashTypedData(req);
        address signer = _recoverSigner(digest, sig);
        return signer == req.from;
    }

    // â”€â”€â”€ Internal â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

    function _hashTypedData(ForwardRequest calldata req) internal view returns (bytes32) {
        return keccak256(abi.encodePacked(
            "\x19\x01",
            DOMAIN_SEPARATOR,
            keccak256(abi.encode(
                REQUEST_TYPEHASH,
                req.from,
                req.to,
                req.value,
                req.gas,
                req.nonce,
                req.deadline,
                keccak256(req.data)
            ))
        ));
    }

    function _recoverSigner(bytes32 digest, bytes calldata sig) internal pure returns (address) {
        require(sig.length == 65, "Invalid sig length");
        bytes32 r; bytes32 s; uint8 v;
        assembly {
            r := calldataload(sig.offset)
            s := calldataload(add(sig.offset, 32))
            v := byte(0, calldataload(add(sig.offset, 64)))
        }
        return ecrecover(digest, v, r, s);
    }
}

