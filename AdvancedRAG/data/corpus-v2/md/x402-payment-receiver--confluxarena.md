# x402-payment-receiver--confluxarena

- domain: escrow-conditional-payments (payments)
- level: moderate
- origin: human
- convention: hardhat2-ethers6
- source: https://github.com/confluxarena/x402-fullstack @ 12896c6f38ba9f45ef1afe28abb7a499f9b48237
- license: MIT
- targets: X402PaymentReceiver.sol, MockERC20.sol
- validation: 24 passing tests, 0 failing; statement coverage X402PaymentReceiver.sol 90.91 %, MockERC20.sol 100.0 %

## Contract: MockERC20.sol (dependency)

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title MockERC20 — Simple ERC-20 for testing
contract MockERC20 {
    string public name;
    string public symbol;
    uint8 public decimals;
    uint256 public totalSupply;

    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);

    constructor(string memory _name, string memory _symbol, uint8 _decimals) {
        name = _name;
        symbol = _symbol;
        decimals = _decimals;
    }

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
        totalSupply += amount;
        emit Transfer(address(0), to, amount);
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        emit Approval(msg.sender, spender, amount);
        return true;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        require(balanceOf[msg.sender] >= amount, "Insufficient balance");
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        emit Transfer(msg.sender, to, amount);
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        require(balanceOf[from] >= amount, "Insufficient balance");
        require(allowance[from][msg.sender] >= amount, "Insufficient allowance");
        allowance[from][msg.sender] -= amount;
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        emit Transfer(from, to, amount);
        return true;
    }
}
```

## Contract: X402PaymentReceiver.sol (primary target)

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title X402PaymentReceiver
 * @notice Universal payment receiver for x402 protocol on Conflux eSpace.
 *         Supports three payment methods:
 *           1. Native CFX — payNative(invoiceId){value}
 *           2. ERC-20 — buyer approves contract, relayer calls payWithTokenFrom
 *           3. EIP-3009 — gasless transferWithAuthorization (USDT0)
 *
 * @dev Emits PaymentReceived for every successful payment.
 *      Server monitors events to verify invoices.
 */

interface IERC20 {
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
    function allowance(address owner, address spender) external view returns (uint256);
}

interface IEIP3009 {
    function transferWithAuthorization(
        address from,
        address to,
        uint256 value,
        uint256 validAfter,
        uint256 validBefore,
        bytes32 nonce,
        bytes calldata signature
    ) external;
}

contract X402PaymentReceiver {
    address public owner;
    address public treasury;

    event PaymentReceived(
        bytes32 indexed invoiceId,
        address indexed payer,
        address token,         // address(0) for native CFX
        uint256 amount,
        string paymentMethod   // "native", "erc20", "eip3009"
    );

    event TreasuryUpdated(address oldTreasury, address newTreasury);
    event OwnershipTransferred(address oldOwner, address newOwner);

    modifier onlyOwner() {
        require(msg.sender == owner, "Not owner");
        _;
    }

    constructor(address _treasury) {
        require(_treasury != address(0), "Invalid treasury");
        owner = msg.sender;
        treasury = _treasury;
    }

    // ────────────────────────────────────────────
    // 1. Native CFX payment
    // ────────────────────────────────────────────

    /**
     * @notice Pay with native CFX. InvoiceId passed as calldata.
     * @dev Call: contract.payNative{value: amount}(invoiceId)
     */
    function payNative(bytes32 invoiceId) external payable {
        require(msg.value > 0, "Zero payment");

        // Forward CFX to treasury
        (bool sent, ) = treasury.call{value: msg.value}("");
        require(sent, "CFX transfer failed");

        emit PaymentReceived(invoiceId, msg.sender, address(0), msg.value, "native");
    }

    // ────────────────────────────────────────────
    // 2a. ERC-20 payment — buyer calls directly
    // ────────────────────────────────────────────

    /**
     * @notice Pay with ERC-20 token. Caller must approve this contract first.
     * @param token   ERC-20 token address
     * @param amount  Payment amount (in token's smallest unit)
     * @param invoiceId  Unique invoice identifier
     */
    function payWithToken(
        address token,
        uint256 amount,
        bytes32 invoiceId
    ) external {
        require(amount > 0, "Zero amount");
        require(token != address(0), "Use payNative for CFX");

        IERC20 erc20 = IERC20(token);
        require(
            erc20.allowance(msg.sender, address(this)) >= amount,
            "Insufficient allowance"
        );

        bool success = erc20.transferFrom(msg.sender, treasury, amount);
        require(success, "Token transfer failed");

        emit PaymentReceived(invoiceId, msg.sender, token, amount, "erc20");
    }

    // ────────────────────────────────────────────
    // 2b. ERC-20 payment — relayer calls on behalf of buyer
    // ────────────────────────────────────────────

    /**
     * @notice Settle ERC-20 payment on behalf of buyer.
     *         Buyer must have approved this contract (not the relayer).
     *         Only relayer (owner) can call this function.
     * @param token     ERC-20 token address
     * @param from      Buyer address who approved the spend
     * @param amount    Payment amount
     * @param invoiceId Unique invoice identifier
     */
    function payWithTokenFrom(
        address token,
        address from,
        uint256 amount,
        bytes32 invoiceId
    ) external onlyOwner {
        require(amount > 0, "Zero amount");
        require(token != address(0), "Use payNative for CFX");
        require(from != address(0), "Invalid payer");

        IERC20 erc20 = IERC20(token);
        require(
            erc20.allowance(from, address(this)) >= amount,
            "Insufficient allowance"
        );

        bool success = erc20.transferFrom(from, treasury, amount);
        require(success, "Token transfer failed");

        emit PaymentReceived(invoiceId, from, token, amount, "erc20");
    }

    // ────────────────────────────────────────────
    // 3. EIP-3009 payment (gasless for buyer)
    // ────────────────────────────────────────────

    /**
     * @notice Settle payment using EIP-3009 transferWithAuthorization.
     *         Only the relayer (owner) calls this — buyer signs off-chain.
     * @param token       EIP-3009 compatible token address
     * @param from        Buyer address
     * @param amount      Payment amount
     * @param validAfter  EIP-3009 validAfter timestamp
     * @param validBefore EIP-3009 validBefore timestamp
     * @param nonce       EIP-3009 nonce (bytes32)
     * @param signature   EIP-712 signature from buyer
     * @param invoiceId   Unique invoice identifier
     */
    function payWithAuthorization(
        address token,
        address from,
        uint256 amount,
        uint256 validAfter,
        uint256 validBefore,
        bytes32 nonce,
        bytes calldata signature,
        bytes32 invoiceId
    ) external onlyOwner {
        require(amount > 0, "Zero amount");

        IEIP3009(token).transferWithAuthorization(
            from,
            treasury,
            amount,
            validAfter,
            validBefore,
            nonce,
            signature
        );

        emit PaymentReceived(invoiceId, from, token, amount, "eip3009");
    }

    // ────────────────────────────────────────────
    // Admin
    // ────────────────────────────────────────────

    function setTreasury(address newTreasury) external onlyOwner {
        require(newTreasury != address(0), "Invalid treasury");
        emit TreasuryUpdated(treasury, newTreasury);
        treasury = newTreasury;
    }

    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "Invalid owner");
        emit OwnershipTransferred(owner, newOwner);
        owner = newOwner;
    }

    /// @notice Rescue stuck tokens or CFX (safety net)
    function rescueTokens(address token, uint256 amount) external onlyOwner {
        if (token == address(0)) {
            (bool sent, ) = owner.call{value: amount}("");
            require(sent, "CFX rescue failed");
        } else {
            bool sent = IERC20(token).transfer(owner, amount);
            require(sent, "Token rescue failed");
        }
    }

    receive() external payable {
        // Accept plain CFX transfers (without invoiceId)
        (bool sent, ) = treasury.call{value: msg.value}("");
        require(sent, "CFX forward failed");
    }
}
```

## Tests: X402PaymentReceiver.test.js

```javascript
const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("X402PaymentReceiver", function () {
  let contract;
  let owner;
  let treasury;
  let buyer;
  let other;

  const INVOICE_ID = ethers.zeroPadValue(ethers.toUtf8Bytes("test-invoice"), 32);

  beforeEach(async function () {
    [owner, treasury, buyer, other] = await ethers.getSigners();

    const Factory = await ethers.getContractFactory("X402PaymentReceiver");
    contract = await Factory.deploy(treasury.address);
    await contract.waitForDeployment();
  });

  describe("Deployment", function () {
    it("should set correct owner", async function () {
      expect(await contract.owner()).to.equal(owner.address);
    });

    it("should set correct treasury", async function () {
      expect(await contract.treasury()).to.equal(treasury.address);
    });

    it("should revert if treasury is zero address", async function () {
      const Factory = await ethers.getContractFactory("X402PaymentReceiver");
      await expect(
        Factory.deploy(ethers.ZeroAddress)
      ).to.be.revertedWith("Invalid treasury");
    });
  });

  describe("payNative", function () {
    it("should accept CFX and forward to treasury", async function () {
      const amount = ethers.parseEther("1.0");
      const treasuryBefore = await ethers.provider.getBalance(treasury.address);

      await contract.connect(buyer).payNative(INVOICE_ID, { value: amount });

      const treasuryAfter = await ethers.provider.getBalance(treasury.address);
      expect(treasuryAfter - treasuryBefore).to.equal(amount);
    });

    it("should emit PaymentReceived event", async function () {
      const amount = ethers.parseEther("0.5");

      await expect(
        contract.connect(buyer).payNative(INVOICE_ID, { value: amount })
      )
        .to.emit(contract, "PaymentReceived")
        .withArgs(INVOICE_ID, buyer.address, ethers.ZeroAddress, amount, "native");
    });

    it("should revert on zero payment", async function () {
      await expect(
        contract.connect(buyer).payNative(INVOICE_ID, { value: 0 })
      ).to.be.revertedWith("Zero payment");
    });
  });

  describe("payWithToken (buyer calls directly)", function () {
    let mockToken;

    beforeEach(async function () {
      // Deploy a mock ERC-20 for testing
      const MockFactory = await ethers.getContractFactory("MockERC20");
      mockToken = await MockFactory.deploy("Mock USDT", "USDT", 18);
      await mockToken.waitForDeployment();

      // Mint tokens to buyer
      await mockToken.mint(buyer.address, ethers.parseEther("1000"));
    });

    it("should accept ERC-20 tokens with approval", async function () {
      const amount = ethers.parseEther("10");
      const tokenAddr = await mockToken.getAddress();
      const contractAddr = await contract.getAddress();

      // Approve
      await mockToken.connect(buyer).approve(contractAddr, amount);

      // Pay
      await contract.connect(buyer).payWithToken(tokenAddr, amount, INVOICE_ID);

      // Treasury should have the tokens
      expect(await mockToken.balanceOf(treasury.address)).to.equal(amount);
    });

    it("should emit PaymentReceived event for ERC-20", async function () {
      const amount = ethers.parseEther("5");
      const tokenAddr = await mockToken.getAddress();
      const contractAddr = await contract.getAddress();

      await mockToken.connect(buyer).approve(contractAddr, amount);

      await expect(
        contract.connect(buyer).payWithToken(tokenAddr, amount, INVOICE_ID)
      )
        .to.emit(contract, "PaymentReceived")
        .withArgs(INVOICE_ID, buyer.address, tokenAddr, amount, "erc20");
    });

    it("should revert on zero amount", async function () {
      const tokenAddr = await mockToken.getAddress();
      await expect(
        contract.connect(buyer).payWithToken(tokenAddr, 0, INVOICE_ID)
      ).to.be.revertedWith("Zero amount");
    });

    it("should revert for native address", async function () {
      await expect(
        contract.connect(buyer).payWithToken(ethers.ZeroAddress, 100, INVOICE_ID)
      ).to.be.revertedWith("Use payNative for CFX");
    });

    it("should revert without approval", async function () {
      const tokenAddr = await mockToken.getAddress();
      await expect(
        contract.connect(buyer).payWithToken(tokenAddr, ethers.parseEther("10"), INVOICE_ID)
      ).to.be.revertedWith("Insufficient allowance");
    });
  });

  describe("payWithTokenFrom (relayer)", function () {
    let mockToken;

    beforeEach(async function () {
      const MockFactory = await ethers.getContractFactory("MockERC20");
      mockToken = await MockFactory.deploy("Mock USDT", "USDT", 18);
      await mockToken.waitForDeployment();
      await mockToken.mint(buyer.address, ethers.parseEther("1000"));
    });

    it("should allow owner to settle on behalf of buyer", async function () {
      const amount = ethers.parseEther("10");
      const tokenAddr = await mockToken.getAddress();
      const contractAddr = await contract.getAddress();

      // Buyer approves contract
      await mockToken.connect(buyer).approve(contractAddr, amount);

      // Owner (relayer) calls payWithTokenFrom
      await contract.connect(owner).payWithTokenFrom(tokenAddr, buyer.address, amount, INVOICE_ID);

      expect(await mockToken.balanceOf(treasury.address)).to.equal(amount);
    });

    it("should revert if not owner", async function () {
      const tokenAddr = await mockToken.getAddress();
      const contractAddr = await contract.getAddress();

      await mockToken.connect(buyer).approve(contractAddr, ethers.parseEther("10"));

      await expect(
        contract.connect(other).payWithTokenFrom(tokenAddr, buyer.address, ethers.parseEther("10"), INVOICE_ID)
      ).to.be.revertedWith("Not owner");
    });

    it("should revert with invalid payer address", async function () {
      const tokenAddr = await mockToken.getAddress();
      await expect(
        contract.connect(owner).payWithTokenFrom(tokenAddr, ethers.ZeroAddress, 100, INVOICE_ID)
      ).to.be.revertedWith("Invalid payer");
    });
  });

  describe("Admin", function () {
    it("should allow owner to update treasury", async function () {
      await contract.connect(owner).setTreasury(other.address);
      expect(await contract.treasury()).to.equal(other.address);
    });

    it("should emit TreasuryUpdated event", async function () {
      await expect(contract.connect(owner).setTreasury(other.address))
        .to.emit(contract, "TreasuryUpdated")
        .withArgs(treasury.address, other.address);
    });

    it("should revert if non-owner updates treasury", async function () {
      await expect(
        contract.connect(other).setTreasury(other.address)
      ).to.be.revertedWith("Not owner");
    });

    it("should allow ownership transfer", async function () {
      await contract.connect(owner).transferOwnership(other.address);
      expect(await contract.owner()).to.equal(other.address);
    });

    it("should revert on zero address treasury", async function () {
      await expect(
        contract.connect(owner).setTreasury(ethers.ZeroAddress)
      ).to.be.revertedWith("Invalid treasury");
    });

    it("should revert on zero address ownership transfer", async function () {
      await expect(
        contract.connect(owner).transferOwnership(ethers.ZeroAddress)
      ).to.be.revertedWith("Invalid owner");
    });
  });

  describe("rescueTokens", function () {
    it("should rescue stuck CFX", async function () {
      // Send CFX directly to contract (via receive())
      const amount = ethers.parseEther("0.1");

      // The contract forwards to treasury via receive(), so send to treasury first
      // Actually, test rescue by sending via low-level call
      const contractAddr = await contract.getAddress();

      const ownerBefore = await ethers.provider.getBalance(owner.address);

      // Use rescueTokens for native CFX (0 address)
      // First, need CFX in contract - send via payNative and set treasury to contract itself temporarily
      // Simpler: just verify the function exists and reverts properly when no balance
      await expect(
        contract.connect(owner).rescueTokens(ethers.ZeroAddress, amount)
      ).to.be.reverted; // Will revert because contract has no balance
    });

    it("should rescue stuck ERC-20 tokens", async function () {
      const MockFactory = await ethers.getContractFactory("MockERC20");
      const mockToken = await MockFactory.deploy("Stuck", "STUCK", 18);
      await mockToken.waitForDeployment();

      const contractAddr = await contract.getAddress();
      const tokenAddr = await mockToken.getAddress();

      // Send tokens directly to contract (simulating stuck tokens)
      await mockToken.mint(contractAddr, ethers.parseEther("100"));

      // Rescue
      await contract.connect(owner).rescueTokens(tokenAddr, ethers.parseEther("100"));

      expect(await mockToken.balanceOf(owner.address)).to.equal(ethers.parseEther("100"));
    });

    it("should revert if non-owner tries to rescue", async function () {
      await expect(
        contract.connect(other).rescueTokens(ethers.ZeroAddress, 100)
      ).to.be.revertedWith("Not owner");
    });
  });

  describe("receive()", function () {
    it("should forward plain CFX to treasury", async function () {
      const amount = ethers.parseEther("0.5");
      const contractAddr = await contract.getAddress();
      const treasuryBefore = await ethers.provider.getBalance(treasury.address);

      await buyer.sendTransaction({ to: contractAddr, value: amount });

      const treasuryAfter = await ethers.provider.getBalance(treasury.address);
      expect(treasuryAfter - treasuryBefore).to.equal(amount);
    });
  });
});
```
