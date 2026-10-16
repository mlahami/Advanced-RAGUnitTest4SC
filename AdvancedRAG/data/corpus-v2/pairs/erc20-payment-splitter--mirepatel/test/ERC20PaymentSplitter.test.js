const { expect } = require("chai")
const { ethers } = require("hardhat")

describe("ERC20PaymentSplitter", () => {
  let owner, addr1, addr2, addr3
  let mockToken
  let splitter
  const initialSupply = ethers.parseEther("1000")

  beforeEach(async () => {
    // Get signers
    ;[owner, addr1, addr2, addr3] = await ethers.getSigners()

    // Deploy MockERC20
    const MockERC20 = await ethers.getContractFactory("MockERC20")
    mockToken = await MockERC20.deploy("Mock Token", "MTK", owner.address)

    // Mint tokens to owner
    await mockToken.mint(owner.address, initialSupply)

    // Deploy ERC20PaymentSplitter
    const ERC20PaymentSplitter = await ethers.getContractFactory("ERC20PaymentSplitter")
    splitter = await ERC20PaymentSplitter.deploy(owner.address)
  })

  describe("Deployment", () => {
    it("Should set the right owner", async () => {
      expect(await splitter.owner()).to.equal(owner.address)
    })

    it("Should have zero total shares initially", async () => {
      expect(await splitter.totalShares()).to.equal(0)
    })
  })

  describe("Adding payees", () => {
    it("Should allow owner to add payees", async () => {
      await splitter.addPayee(addr1.address, 50)
      await splitter.addPayee(addr2.address, 30)
      await splitter.addPayee(addr3.address, 20)

      expect(await splitter.totalShares()).to.equal(100)
      expect(await splitter.shares(addr1.address)).to.equal(50)
      expect(await splitter.shares(addr2.address)).to.equal(30)
      expect(await splitter.shares(addr3.address)).to.equal(20)
    })

    it("Should emit PayeeAdded event", async () => {
      await expect(splitter.addPayee(addr1.address, 50)).to.emit(splitter, "PayeeAdded").withArgs(addr1.address, 50)
    })

    it("Should revert if non-owner tries to add payee", async () => {
      await expect(splitter.connect(addr1).addPayee(addr2.address, 50)).to.be.revertedWithCustomError(
        splitter,
        "OwnableUnauthorizedAccount",
      )
    })

    it("Should revert if adding zero address", async () => {
      await expect(splitter.addPayee(ethers.ZeroAddress, 50)).to.be.revertedWith(
        "PaymentSplitter: account is the zero address",
      )
    })

    it("Should revert if adding zero shares", async () => {
      await expect(splitter.addPayee(addr1.address, 0)).to.be.revertedWith("PaymentSplitter: shares are 0")
    })

    it("Should revert if adding duplicate payee", async () => {
      await splitter.addPayee(addr1.address, 50)
      await expect(splitter.addPayee(addr1.address, 30)).to.be.revertedWith(
        "PaymentSplitter: account already has shares",
      )
    })
  })

  describe("Resetting payees", () => {
    beforeEach(async () => {
      await splitter.addPayee(addr1.address, 50)
      await splitter.addPayee(addr2.address, 30)
    })

    it("Should allow owner to reset payees", async () => {
      await splitter.resetPayees()
      expect(await splitter.totalShares()).to.equal(0)
      expect(await splitter.shares(addr1.address)).to.equal(0)
      expect(await splitter.shares(addr2.address)).to.equal(0)
    })

    it("Should emit PayeesReset event", async () => {
      await expect(splitter.resetPayees()).to.emit(splitter, "PayeesReset")
    })

    it("Should revert if non-owner tries to reset payees", async () => {
      await expect(splitter.connect(addr1).resetPayees()).to.be.revertedWithCustomError(
        splitter,
        "OwnableUnauthorizedAccount",
      )
    })
  })

  describe("Distribution", () => {
    beforeEach(async () => {
      // Add payees with shares
      await splitter.addPayee(addr1.address, 50) // 50%
      await splitter.addPayee(addr2.address, 30) // 30%
      await splitter.addPayee(addr3.address, 20) // 20%

      // Approve splitter to spend owner's tokens
      const splitterAddress = await splitter.getAddress()
      await mockToken.approve(splitterAddress, initialSupply)
    })

    it("Should distribute tokens according to shares", async () => {
      const amount = ethers.parseEther("100")
      const splitterAddress = await splitter.getAddress()
      const tokenAddress = await mockToken.getAddress()

      // Transfer tokens to splitter
      await mockToken.transfer(splitterAddress, amount)

      // Distribute tokens
      await splitter.distribute(tokenAddress)

      // Check balances
      expect(await mockToken.balanceOf(addr1.address)).to.equal(ethers.parseEther("50"))
      expect(await mockToken.balanceOf(addr2.address)).to.equal(ethers.parseEther("30"))
      expect(await mockToken.balanceOf(addr3.address)).to.equal(ethers.parseEther("20"))
    })

    it("Should deposit and distribute in one transaction", async () => {
      const amount = ethers.parseEther("100")
      const tokenAddress = await mockToken.getAddress()

      // Deposit and distribute
      await splitter.depositAndDistribute(tokenAddress, amount)

      // Check balances
      expect(await mockToken.balanceOf(addr1.address)).to.equal(ethers.parseEther("50"))
      expect(await mockToken.balanceOf(addr2.address)).to.equal(ethers.parseEther("30"))
      expect(await mockToken.balanceOf(addr3.address)).to.equal(ethers.parseEther("20"))
    })

    it("Should emit PaymentReceived and PaymentReleased events", async () => {
      const amount = ethers.parseEther("100")
      const tokenAddress = await mockToken.getAddress()

      // Deposit and distribute
      const tx = await splitter.depositAndDistribute(tokenAddress, amount)

      // Check events
      await expect(tx).to.emit(splitter, "PaymentReceived").withArgs(tokenAddress, owner.address, amount)

      await expect(tx)
        .to.emit(splitter, "PaymentReleased")
        .withArgs(tokenAddress, addr1.address, ethers.parseEther("50"))

      await expect(tx)
        .to.emit(splitter, "PaymentReleased")
        .withArgs(tokenAddress, addr2.address, ethers.parseEther("30"))

      await expect(tx)
        .to.emit(splitter, "PaymentReleased")
        .withArgs(tokenAddress, addr3.address, ethers.parseEther("20"))
    })

    it("Should revert distribute if no tokens to distribute", async () => {
      const tokenAddress = await mockToken.getAddress()
      await expect(splitter.distribute(tokenAddress)).to.be.revertedWith("PaymentSplitter: no tokens to distribute")
    })

    it("Should revert depositAndDistribute if amount is zero", async () => {
      const tokenAddress = await mockToken.getAddress()
      await expect(splitter.depositAndDistribute(tokenAddress, 0)).to.be.revertedWith(
        "PaymentSplitter: amount must be greater than 0",
      )
    })

    it("Should revert depositAndDistribute if no payees", async () => {
      // Reset payees
      await splitter.resetPayees()
      const tokenAddress = await mockToken.getAddress()

      await expect(splitter.depositAndDistribute(tokenAddress, ethers.parseEther("100"))).to.be.revertedWith(
        "PaymentSplitter: no payees",
      )
    })
  })

  describe("Getters", () => {
    beforeEach(async () => {
      await splitter.addPayee(addr1.address, 50)
      await splitter.addPayee(addr2.address, 30)
    })

    it("Should return correct payee at index", async () => {
      expect(await splitter.payee(0)).to.equal(addr1.address)
      expect(await splitter.payee(1)).to.equal(addr2.address)
    })

    it("Should return all payees", async () => {
      const payees = await splitter.getPayees()
      expect(payees.length).to.equal(2)
      expect(payees[0]).to.equal(addr1.address)
      expect(payees[1]).to.equal(addr2.address)
    })
  })
})