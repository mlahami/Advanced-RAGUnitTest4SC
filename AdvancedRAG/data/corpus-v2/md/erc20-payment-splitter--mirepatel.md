# erc20-payment-splitter--mirepatel

- domain: escrow-conditional-payments (revenue-sharing)
- level: moderate
- origin: human
- convention: hardhat2-ethers6
- source: https://github.com/mirepatel/erc20-payment-splitter @ 3d93e45d387499f8694519182d06889503ade45b
- license: MIT
- targets: ERC20PaymentSplitter.sol
- validation: 19 passing tests, 0 failing; statement coverage ERC20PaymentSplitter.sol 93.75 %

## Contract: ERC20PaymentSplitter.sol (primary target)

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title ERC20PaymentSplitter
 * @dev This contract allows to split ERC20 token payments among a group of accounts.
 * The sender does not need to be aware that the tokens will be split in this way, since
 * it is handled transparently by the contract.
 */
contract ERC20PaymentSplitter is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    event PayeeAdded(address account, uint256 shares);
    event PaymentReleased(address token, address to, uint256 amount);
    event PaymentReceived(address token, address from, uint256 amount);
    event PayeesReset();

    uint256 private _totalShares;
    uint256 private _totalReleased;

    mapping(address => uint256) private _shares;
    mapping(address => mapping(address => uint256)) private _released;
    address[] private _payees;

    /**
     * @dev Creates an instance of `ERC20PaymentSplitter` where each account in `payees` is assigned the number of shares at
     * the matching position in the `shares` array.
     *
     * All addresses in `payees` must be non-zero. Both arrays must have the same non-zero length, and there must be no
     * duplicates in `payees`.
     */
    constructor(address initialOwner) Ownable(initialOwner) {}

    /**
     * @dev Add a new payee to the contract.
     * @param account The address of the payee to add.
     * @param shares_ The number of shares owned by the payee.
     */
    function addPayee(address account, uint256 shares_) external onlyOwner {
        require(account != address(0), "PaymentSplitter: account is the zero address");
        require(shares_ > 0, "PaymentSplitter: shares are 0");
        require(_shares[account] == 0, "PaymentSplitter: account already has shares");

        _payees.push(account);
        _shares[account] = shares_;
        _totalShares += shares_;
        emit PayeeAdded(account, shares_);
    }

    /**
     * @dev Reset all payees. This will remove all current payees.
     */
    function resetPayees() external onlyOwner {
        for (uint256 i = 0; i < _payees.length; i++) {
            _shares[_payees[i]] = 0;
        }
        delete _payees;
        _totalShares = 0;
        emit PayeesReset();
    }

    /**
     * @dev The Ether received will be logged with {PaymentReceived} events. Note that these events are not fully
     * reliable: it's possible for a contract to receive Ether without triggering this function. This only affects the
     * reliability of the events, and not the actual splitting of Ether.
     */
    receive() external payable {
        revert("PaymentSplitter: ETH payments not supported");
    }

    /**
     * @dev Distributes an ERC20 token to all payees according to their shares.
     * @param token The ERC20 token to distribute.
     */
    function distribute(IERC20 token) external nonReentrant {
        uint256 balance = token.balanceOf(address(this));
        require(balance > 0, "PaymentSplitter: no tokens to distribute");

        for (uint256 i = 0; i < _payees.length; i++) {
            address payeeAddress = _payees[i];
            uint256 payment = (balance * _shares[payeeAddress]) / _totalShares;

            if (payment > 0) {
                _released[address(token)][payeeAddress] += payment;
                emit PaymentReleased(address(token), payeeAddress, payment);
                token.safeTransfer(payeeAddress, payment);
            }
        }

        emit PaymentReceived(address(token), msg.sender, balance);
    }

    /**
     * @dev Deposit ERC20 tokens to the contract and distribute them immediately.
     * @param token The ERC20 token to deposit and distribute.
     * @param amount The amount of tokens to deposit.
     */
    function depositAndDistribute(IERC20 token, uint256 amount) external nonReentrant {
        require(amount > 0, "PaymentSplitter: amount must be greater than 0");
        require(_payees.length > 0, "PaymentSplitter: no payees");

        // Transfer tokens from sender to this contract
        token.safeTransferFrom(msg.sender, address(this), amount);
        emit PaymentReceived(address(token), msg.sender, amount);

        // Distribute tokens to payees
        for (uint256 i = 0; i < _payees.length; i++) {
            address payeeAddress = _payees[i];
            uint256 payment = (amount * _shares[payeeAddress]) / _totalShares;

            if (payment > 0) {
                _released[address(token)][payeeAddress] += payment;
                emit PaymentReleased(address(token), payeeAddress, payment);
                token.safeTransfer(payeeAddress, payment);
            }
        }
    }

    /**
     * @dev Getter for the total shares held by payees.
     */
    function totalShares() external view returns (uint256) {
        return _totalShares;
    }

    /**
     * @dev Getter for the total amount of `token` already released.
     */
    function totalReleased(IERC20 token) external view returns (uint256) {
        return _released[address(token)][address(0)];
    }

    /**
     * @dev Getter for the amount of shares held by an account.
     */
    function shares(address account) external view returns (uint256) {
        return _shares[account];
    }

    /**
     * @dev Getter for the amount of `token` tokens already released to a payee.
     */
    function released(IERC20 token, address account) external view returns (uint256) {
        return _released[address(token)][account];
    }

    /**
     * @dev Getter for the address of the payee number `index`.
     */
    function payee(uint256 index) external view returns (address) {
        return _payees[index];
    }

    /**
     * @dev Getter for the list of payees.
     */
    function getPayees() external view returns (address[] memory) {
        return _payees;
    }
}
```

## Contract: MockERC20.sol (dependency)

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title MockERC20
 * @dev A simple ERC20 Token for testing purposes
 */
contract MockERC20 is ERC20, Ownable {
    constructor(
        string memory name,
        string memory symbol,
        address initialOwner
    ) ERC20(name, symbol) Ownable(initialOwner) {}

    /**
     * @dev Creates `amount` tokens and assigns them to `account`, increasing
     * the total supply.
     */
    function mint(address account, uint256 amount) external onlyOwner {
        _mint(account, amount);
    }
}
```

## Tests: ERC20PaymentSplitter.test.js

```javascript
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
```
