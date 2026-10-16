// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "./ICrossChainBridge.sol";

contract LayerZeroBridge is ICrossChainBridge, Ownable, ReentrancyGuard {
    address public immutable override lzEndpoint;
    uint16 public immutable localChainId;

    mapping(uint16 => bytes) public trustedRemotes;
    mapping(bytes32 => bool) public processedMessages;
    uint256 private _nonce;

    uint256 public minGasLimit = 200000;

    event GasLimitUpdated(uint256 newGasLimit);

    constructor(address _lzEndpoint, uint16 _localChainId) Ownable(msg.sender) {
        require(_lzEndpoint != address(0), "Invalid endpoint");
        require(_localChainId != 0, "Invalid chain ID");
        lzEndpoint = _lzEndpoint;
        localChainId = _localChainId;
    }

    function sendMessage(uint16 dstChainId, bytes calldata payload, address refundAddress)
        external
        payable
        override
        nonReentrant
        returns (bytes32 messageId)
    {
        if (dstChainId == 0) revert InvalidChainId();
        if (trustedRemotes[dstChainId].length == 0) revert UnauthorizedRemote();
        require(refundAddress != address(0), "Invalid refund address");

        messageId = keccak256(abi.encodePacked(localChainId, dstChainId, _nonce++, payload));

        bytes memory lzPacket = abi.encodePacked(
            trustedRemotes[dstChainId],
            uint64(_nonce),
            uint8(1),
            uint16(payload.length),
            payload
        );

        (bool success, ) = lzEndpoint.call{value: msg.value}(
            abi.encodeWithSignature(
                "send(uint16,bytes,uint256,address,bytes,uint256)",
                dstChainId,
                trustedRemotes[dstChainId],
                minGasLimit,
                refundAddress,
                lzPacket,
                msg.value
            )
        );
        if (!success) revert MessageDeliveryFailed();

        emit MessageSent(dstChainId, messageId, payload);
        return messageId;
    }

    function lzReceive(uint16 srcChainId, bytes calldata srcAddress, uint64, bytes calldata payload) external {
        if (msg.sender != lzEndpoint) revert UnauthorizedRemote();

        bytes memory expectedAddress = trustedRemotes[srcChainId];
        if (expectedAddress.length == 0 || keccak256(expectedAddress) != keccak256(srcAddress)) {
            revert UnauthorizedRemote();
        }

        bytes32 messageId = keccak256(abi.encodePacked(srcChainId, localChainId, payload));
        if (processedMessages[messageId]) revert MessageAlreadyProcessed();
        processedMessages[messageId] = true;

        emit MessageReceived(srcChainId, messageId, payload);
    }

    function estimateFees(uint16 /* dstChainId */, bytes calldata payload) external view override returns (uint256) {
        uint256 baseGas = 21000;
        uint256 payloadGas = payload.length * 16;
        uint256 totalGas = baseGas + payloadGas + minGasLimit;
        return totalGas * tx.gasprice;
    }

    function setTrustedRemote(uint16 chainId, bytes calldata remoteAddress) external override onlyOwner {
        trustedRemotes[chainId] = remoteAddress;
        emit TrustedRemoteSet(chainId, remoteAddress);
    }

    function getTrustedRemote(uint16 chainId) external view override returns (bytes memory) {
        return trustedRemotes[chainId];
    }

    function setMinGasLimit(uint256 _minGasLimit) external onlyOwner {
        minGasLimit = _minGasLimit;
        emit GasLimitUpdated(_minGasLimit);
    }

    function withdrawNative(address to, uint256 amount) external onlyOwner nonReentrant {
        require(to != address(0), "Invalid recipient");
        (bool success, ) = to.call{value: amount}("");
        if (!success) revert MessageDeliveryFailed();
    }
}
