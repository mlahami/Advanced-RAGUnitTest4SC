# micro-payment-channel--ypeng1620-beep

- domain: escrow-conditional-payments (payments)
- level: moderate
- origin: human
- convention: hardhat2-ethers6
- source: https://github.com/ypeng1620-beep/EM-A2A @ d342ddeec75bc110dae00e880f28c8d1768f7227
- license: MIT
- targets: MicroPaymentChannel.sol
- validation: 9 passing tests, 0 failing; statement coverage MicroPaymentChannel.sol 100.0 %

## Contract: MicroPaymentChannel.sol (primary target)

```solidity
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
```

## Tests: MicroPaymentChannel.test.js

```javascript
const { expect } = require("chai");
const { ethers } = require("hardhat");

describe('MicroPaymentChannel', () => {
  let channel
  let owner
  let payer
  let payee

  beforeEach(async () => {
    ;[owner, payer, payee] = await ethers.getSigners()
    const factory = await ethers.getContractFactory('MicroPaymentChannel')
    channel = await factory.deploy()
  })

  describe('Channel Opening', () => {
    it('should open a channel with deposit', async () => {
      const channelId = ethers.encodeBytes32String('ch_001')
      const expiresAt = Math.floor(Date.now() / 1000) + 86400
      const deposit = ethers.parseEther('1')

      await expect(
        channel.connect(payer).openChannel(channelId, payee.address, expiresAt, { value: deposit }),
      )
        .to.emit(channel, 'ChannelOpened')
        .withArgs(channelId, payer.address, payee.address, deposit)

      const ch = await channel.getChannel(channelId)
      expect(ch.from).to.equal(payer.address)
      expect(ch.to).to.equal(payee.address)
      expect(ch.deposit).to.equal(deposit)
      expect(ch.open).to.be.true
    })

    it('should reject zero deposit', async () => {
      const channelId = ethers.encodeBytes32String('ch_zero')
      const expiresAt = Math.floor(Date.now() / 1000) + 86400

      await expect(
        channel.connect(payer).openChannel(channelId, payee.address, expiresAt),
      ).to.be.revertedWith('Deposit required')
    })

    it('should reject expired channel', async () => {
      const channelId = ethers.encodeBytes32String('ch_expired')
      const expiresAt = Math.floor(Date.now() / 1000) - 86400

      await expect(
        channel
          .connect(payer)
          .openChannel(channelId, payee.address, expiresAt, { value: ethers.parseEther('1') }),
      ).to.be.revertedWith('Expired')
    })

    it('should reject duplicate channel', async () => {
      const channelId = ethers.encodeBytes32String('ch_dup')
      const expiresAt = Math.floor(Date.now() / 1000) + 86400

      await channel
        .connect(payer)
        .openChannel(channelId, payee.address, expiresAt, { value: ethers.parseEther('1') })
      await expect(
        channel
          .connect(payer)
          .openChannel(channelId, payee.address, expiresAt, { value: ethers.parseEther('1') }),
      ).to.be.revertedWith('Channel exists')
    })
  })

  describe('Channel Closing with Signature', () => {
    it('should close channel with valid signature', async () => {
      const channelId = ethers.encodeBytes32String('ch_sign')
      const expiresAt = Math.floor(Date.now() / 1000) + 86400
      const deposit = ethers.parseEther('1')

      await channel
        .connect(payer)
        .openChannel(channelId, payee.address, expiresAt, { value: deposit })

      const ch = await channel.getChannel(channelId)
      const paid = ethers.parseEther('0.7')

      // Build message matching contract:
      // message = keccak256(abi.encodePacked(channelId, paid, nonce))
      // ethSigned = keccak256("\x19Ethereum Signed Message:\n32" + message)
      const message = ethers.solidityPackedKeccak256(
        ['bytes32', 'uint256', 'uint256'],
        [channelId, paid, ch.nonce],
      )
      // signMessage applies the EIP-191 prefix and keccak256, then signs
      const signature = await payer.signMessage(ethers.getBytes(message))

      await expect(channel.connect(payee).closeChannel(channelId, paid, signature))
        .to.emit(channel, 'ChannelClosed')
        .withArgs(channelId, paid, deposit - paid)

      const finalCh = await channel.getChannel(channelId)
      expect(finalCh.open).to.be.false
    })

    it('should reject invalid signature', async () => {
      const channelId = ethers.encodeBytes32String('ch_badsig')
      const expiresAt = Math.floor(Date.now() / 1000) + 86400

      await channel
        .connect(payer)
        .openChannel(channelId, payee.address, expiresAt, { value: ethers.parseEther('1') })

      const badSignature = '0x' + '00'.repeat(65)
      await expect(
        channel.connect(payer).closeChannel(channelId, ethers.parseEther('0.5'), badSignature),
      ).to.be.reverted
    })

    it('should reject payment exceeding deposit', async () => {
      const channelId = ethers.encodeBytes32String('ch_over')
      const expiresAt = Math.floor(Date.now() / 1000) + 86400

      await channel
        .connect(payer)
        .openChannel(channelId, payee.address, expiresAt, { value: ethers.parseEther('1') })

      const ch2 = await channel.getChannel(channelId)
      const messageOver = ethers.solidityPackedKeccak256(
        ['bytes32', 'uint256', 'uint256'],
        [channelId, ethers.parseEther('2'), ch2.nonce],
      )
      const signature2 = await payer.signMessage(ethers.getBytes(messageOver))

      await expect(
        channel.connect(payee).closeChannel(channelId, ethers.parseEther('2'), signature2),
      ).to.be.revertedWith('Insufficient deposit')
    })
  })

  describe('Disputes', () => {
    it('should allow payer to dispute and refund', async () => {
      const channelId = ethers.encodeBytes32String('ch_dispute')
      const expiresAt = Math.floor(Date.now() / 1000) + 86400
      const deposit = ethers.parseEther('1')

      await channel
        .connect(payer)
        .openChannel(channelId, payee.address, expiresAt, { value: deposit })

      await expect(channel.connect(payer).disputeChannel(channelId))
        .to.emit(channel, 'ChannelDisputed')
        .withArgs(channelId)

      const ch = await channel.getChannel(channelId)
      expect(ch.open).to.be.false
    })

    it('should allow payee to dispute as well', async () => {
      const channelId = ethers.encodeBytes32String('ch_payeedispute')
      const expiresAt = Math.floor(Date.now() / 1000) + 86400

      await channel
        .connect(payer)
        .openChannel(channelId, payee.address, expiresAt, { value: ethers.parseEther('1') })

      await expect(channel.connect(payee).disputeChannel(channelId))
        .to.emit(channel, 'ChannelDisputed')
        .withArgs(channelId)
    })
  })
})
```
