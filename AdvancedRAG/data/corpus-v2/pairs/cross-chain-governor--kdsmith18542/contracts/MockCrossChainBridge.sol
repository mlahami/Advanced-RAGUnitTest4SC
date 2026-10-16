// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "./ICrossChainBridge.sol";

contract MockCrossChainBridge is ICrossChainBridge, AccessControl {
    bytes32 public constant ADMIN_ROLE = keccak256("ADMIN_ROLE");

    mapping(uint16 => bytes) public trustedRemotes;
    mapping(bytes32 => bool) public processedMessages;
    uint256 private _messageCounter;

    uint16 public immutable localChainId;
    address public immutable override lzEndpoint;
    address public immutable admin;

    receive() external payable {}

    constructor(uint16 _localChainId) {
        localChainId = _localChainId;
        lzEndpoint = address(this);
        admin = msg.sender;
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(ADMIN_ROLE, msg.sender);
    }

    function sendMessage(uint16 dstChainId, bytes calldata payload, address) external payable override returns (bytes32 messageId) {
        if (dstChainId == 0) revert InvalidChainId();
        messageId = keccak256(abi.encodePacked(block.chainid, _messageCounter++, payload));
        emit MessageSent(dstChainId, messageId, payload);
        return messageId;
    }

    function deliverMessage(address target, uint16 srcChainId, bytes32 messageId, bytes calldata payload) external {
        require(target != address(0), "Invalid target");
        if (processedMessages[messageId]) revert MessageAlreadyProcessed();
        processedMessages[messageId] = true;
        emit MessageReceived(srcChainId, messageId, payload);
        (bool success, ) = target.call(abi.encodeWithSignature("lzReceive(uint16,bytes,uint64,bytes)", srcChainId, abi.encodePacked(address(this)), 0, payload));
        if (!success) revert MessageDeliveryFailed();
    }

    function estimateFees(uint16, bytes calldata) external pure override returns (uint256) {
        return 0;
    }

    function setTrustedRemote(uint16 chainId, bytes calldata remoteAddress) external override onlyRole(ADMIN_ROLE) {
        trustedRemotes[chainId] = remoteAddress;
        emit TrustedRemoteSet(chainId, remoteAddress);
    }

    function getTrustedRemote(uint16 chainId) external view override returns (bytes memory) {
        return trustedRemotes[chainId];
    }

    function withdrawNative(uint256 amount) external onlyRole(ADMIN_ROLE) {
        (bool success, ) = payable(admin).call{value: amount}("");
        if (!success) revert MessageDeliveryFailed();
    }
}
