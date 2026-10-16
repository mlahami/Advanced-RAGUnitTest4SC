// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

error UnauthorizedRemote();
error InvalidChainId();
error InvalidPayload();
error MessageAlreadyProcessed();
error MessageDeliveryFailed();

interface ICrossChainBridge {
    event MessageSent(uint16 indexed dstChainId, bytes32 indexed messageId, bytes payload);
    event MessageReceived(uint16 indexed srcChainId, bytes32 indexed messageId, bytes payload);
    event TrustedRemoteSet(uint16 indexed chainId, bytes remoteAddress);

    function sendMessage(uint16 dstChainId, bytes calldata payload, address refundAddress) external payable returns (bytes32 messageId);

    function estimateFees(uint16 dstChainId, bytes calldata payload) external view returns (uint256 nativeFee);

    function setTrustedRemote(uint16 chainId, bytes calldata remoteAddress) external;

    function getTrustedRemote(uint16 chainId) external view returns (bytes memory);

    function lzEndpoint() external view returns (address);
}
