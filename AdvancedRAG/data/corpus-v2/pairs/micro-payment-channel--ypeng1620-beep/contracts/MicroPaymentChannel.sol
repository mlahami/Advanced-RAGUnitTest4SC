// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title MicroPaymentChannel
 * @notice 微支付批量通道 — ZZZ累积 → 一次性链上结算，节省 Gas
 */
contract MicroPaymentChannel is Ownable, ReentrancyGuard {
    constructor() Ownable(msg.sender) {}

    // =========================================================================
    // 类型
    // =========================================================================
    struct Channel {
        bytes32 channelId;
        address from;
        address to;
        uint256 deposit;
        uint256 balance;
        uint256 nonce;
        uint256 openedAt;
        uint256 expiresAt;
        bool open;
    }

    // =========================================================================
    // 事件
    // =========================================================================
    event ChannelOpened(bytes32 indexed channelId, address from, address to, uint256 deposit);
    event ChannelClosed(bytes32 indexed channelId, uint256 paid, uint256 refunded);
    event ChannelDisputed(bytes32 indexed channelId);

    // =========================================================================
    // 存储
    // =========================================================================
    mapping(bytes32 => Channel) public channels;

    // =========================================================================
    // 通道管理
    // =========================================================================

    function openChannel(
        bytes32 channelId,
        address to,
        uint256 expiresAt
    ) external payable {
        require(msg.value > 0, "Deposit required");
        require(expiresAt > block.timestamp, "Expired");
        require(!channels[channelId].open, "Channel exists");

        channels[channelId] = Channel({
            channelId: channelId,
            from: msg.sender,
            to: to,
            deposit: msg.value,
            balance: 0,
            nonce: 0,
            openedAt: block.timestamp,
            expiresAt: expiresAt,
            open: true
        });

        emit ChannelOpened(channelId, msg.sender, to, msg.value);
    }

    function closeChannel(
        bytes32 channelId,
        uint256 paid,
        bytes calldata signature
    ) external nonReentrant {
        Channel storage channel = channels[channelId];
        require(channel.open, "Not open");
        require(paid <= channel.deposit, "Insufficient deposit");

        // 验证签名：from 或 to 都可以关闭
        bytes32 message = keccak256(abi.encodePacked(channelId, paid, channel.nonce));
        bytes32 ethSigned = keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", message));
        address signer = _recoverSigner(ethSigned, signature);
        require(signer == channel.from || signer == channel.to, "Invalid signature");

        channel.open = false;

        // 释放资金
        if (paid > 0) {
            (bool sent,) = channel.to.call{value: paid}("");
            require(sent, "Payment failed");
        }

        uint256 refund = channel.deposit - paid;
        if (refund > 0) {
            (bool sent,) = channel.from.call{value: refund}("");
            require(sent, "Refund failed");
        }

        channel.balance = paid;
        emit ChannelClosed(channelId, paid, refund);
    }

    function disputeChannel(bytes32 channelId) external {
        Channel storage channel = channels[channelId];
        require(msg.sender == channel.from || msg.sender == channel.to, "Not participant");

        channel.open = false;
        // 退款给发起方
        (bool sent,) = channel.from.call{value: channel.deposit}("");
        require(sent, "Refund failed");

        emit ChannelDisputed(channelId);
    }

    // =========================================================================
    // 查询
    // =========================================================================

    function getChannel(bytes32 channelId) external view returns (Channel memory) {
        return channels[channelId];
    }

    // =========================================================================
    // 工具
    // =========================================================================

    function _recoverSigner(bytes32 message, bytes memory signature) internal pure returns (address) {
        require(signature.length == 65, "Invalid signature length");
        bytes32 r;
        bytes32 s;
        uint8 v;
        assembly {
            r := mload(add(signature, 32))
            s := mload(add(signature, 64))
            v := byte(0, mload(add(signature, 96)))
        }
        if (v < 27) v += 27;
        return ecrecover(message, v, r, s);
    }
}
