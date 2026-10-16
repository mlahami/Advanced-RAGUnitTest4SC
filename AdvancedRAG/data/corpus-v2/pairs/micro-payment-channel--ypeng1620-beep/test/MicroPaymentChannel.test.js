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
