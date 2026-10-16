# p2-pescrow--rjaysolamo

- domain: escrow-conditional-payments (escrow)
- level: moderate
- origin: human
- convention: hardhat2-ethers6
- source: https://github.com/rjaysolamo/airchainpay @ 70390b2aa9c00b067f68477c1aea12435032fe2b
- license: MIT
- targets: P2PEscrow.sol, MockERC20.sol
- validation: 12 passing tests, 0 failing; statement coverage P2PEscrow.sol 97.87 %, MockERC20.sol 100.0 %

## Contract: MockERC20.sol (dependency)

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.21;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title MockERC20
 * @dev Simple ERC20 token for testing purposes
 */
contract MockERC20 is ERC20, Ownable {
    constructor(string memory name, string memory symbol) ERC20(name, symbol) Ownable(msg.sender) {}

    /**
     * @dev Mint tokens to an address (only owner)
     * @param to Address to mint tokens to
     * @param amount Amount to mint
     */
    function mint(address to, uint256 amount) external onlyOwner {
        _mint(to, amount);
    }
}
```

## Contract: P2PEscrow.sol (primary target)

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/**
 * @title P2PEscrow
 * @dev payment contract supporting both native tokens and ERC-20 stablecoins
 * Supports USDC, USDT, and other ERC-20 tokens alongside native currency
 * Now includes offline-signed transaction support via meta-transactions
 */
contract P2PEscrow is ReentrancyGuard, Ownable {
    using SafeERC20 for IERC20;

    constructor() Ownable(msg.sender) {}

    struct Sale {
        address seller;
        address buyer;
        address token;
        uint256 amount;
        uint256 price;
        string currency;
        bool isPaid;
        bool isFinished;
        bool isCanceled;
        uint256 createdAt;
    }

    struct Master {
        uint256 nextSaleId;
        bool initialized;
    }

    Master public master;
    mapping(uint256 => Sale) public sales;
    mapping(uint256 => address[]) public saleBuyers;
    mapping(uint256 => mapping(address => bool)) public isBuyerInSale;

    event MasterInitialized();
    event SaleCreated(uint256 indexed saleId, address indexed seller, uint256 amount, uint256 price, string currency);
    event BuyerAdded(uint256 indexed saleId, address indexed buyer);
    event BuyerRemoved(uint256 indexed saleId, address indexed buyer);
    event PaymentMarked(uint256 indexed saleId);
    event PaymentClaimed(uint256 indexed saleId, address indexed buyer);
    event SaleCanceled(uint256 indexed saleId);
    event BuyerForceRemoved(uint256 indexed saleId, address indexed buyer);

    modifier onlyInitialized() {
        require(master.initialized, "Master not initialized");
        _;
    }

    modifier saleExists(uint256 saleId) {
        require(saleId < master.nextSaleId, "Sale does not exist");
        _;
    }

    modifier onlySeller(uint256 saleId) {
        require(sales[saleId].seller == msg.sender, "Not the seller");
        _;
    }

    modifier onlyBuyer(uint256 saleId) {
        require(sales[saleId].buyer == msg.sender, "Not the buyer");
        _;
    }

    modifier saleActive(uint256 saleId) {
        require(!sales[saleId].isCanceled, "Sale is canceled");
        require(!sales[saleId].isFinished, "Sale is finished");
        _;
    }

    function initMaster() external {
        require(!master.initialized, "Master already initialized");
        master.initialized = true;
        master.nextSaleId = 0;
        emit MasterInitialized();
    }

    function createSale(
        address token,
        uint256 amount,
        uint256 price,
        string memory currency
    ) external onlyInitialized nonReentrant {
        require(amount > 0, "Amount must be greater than 0");
        require(price > 0, "Price must be greater than 0");
        require(bytes(currency).length > 0, "Currency cannot be empty");

        uint256 saleId = master.nextSaleId;
        master.nextSaleId++;

        IERC20(token).safeTransferFrom(msg.sender, address(this), amount);

        sales[saleId] = Sale({
            seller: msg.sender,
            buyer: address(0),
            token: token,
            amount: amount,
            price: price,
            currency: currency,
            isPaid: false,
            isFinished: false,
            isCanceled: false,
            createdAt: block.timestamp
        });

        emit SaleCreated(saleId, msg.sender, amount, price, currency);
    }

    function addBuyer(uint256 saleId, address buyerAddress) 
        external 
        saleExists(saleId) 
        onlySeller(saleId) 
        saleActive(saleId) 
    {
        require(buyerAddress != address(0), "Invalid buyer address");
        require(buyerAddress != sales[saleId].seller, "Seller cannot be buyer");
        require(!isBuyerInSale[saleId][buyerAddress], "Buyer already added");

        saleBuyers[saleId].push(buyerAddress);
        isBuyerInSale[saleId][buyerAddress] = true;

        if (sales[saleId].buyer == address(0)) {
            sales[saleId].buyer = buyerAddress;
        }

        emit BuyerAdded(saleId, buyerAddress);
    }

    function removeBuyer(uint256 saleId, address buyerAddress) 
        external 
        saleExists(saleId) 
        onlySeller(saleId) 
        saleActive(saleId) 
    {
        require(isBuyerInSale[saleId][buyerAddress], "Buyer not in sale");
        require(!sales[saleId].isPaid, "Cannot remove buyer after payment");

        isBuyerInSale[saleId][buyerAddress] = false;

        address[] storage buyers = saleBuyers[saleId];
        for (uint256 i = 0; i < buyers.length; i++) {
            if (buyers[i] == buyerAddress) {
                buyers[i] = buyers[buyers.length - 1];
                buyers.pop();
                break;
            }
        }

        if (sales[saleId].buyer == buyerAddress) {
            sales[saleId].buyer = buyers.length > 0 ? buyers[0] : address(0);
        }

        emit BuyerRemoved(saleId, buyerAddress);
    }

    function markPaid(uint256 saleId) 
        external 
        saleExists(saleId) 
        onlyBuyer(saleId) 
        saleActive(saleId) 
    {
        require(!sales[saleId].isPaid, "Already marked as paid");
        
        sales[saleId].isPaid = true;
        emit PaymentMarked(saleId);
    }

    function claimPayment(uint256 saleId) 
        external 
        saleExists(saleId) 
        onlyBuyer(saleId) 
        saleActive(saleId) 
        nonReentrant 
    {
        require(sales[saleId].isPaid, "Payment not marked as paid");
        require(!sales[saleId].isFinished, "Payment already claimed");

        sales[saleId].isFinished = true;
        
        IERC20(sales[saleId].token).safeTransfer(
            sales[saleId].buyer, 
            sales[saleId].amount
        );

        emit PaymentClaimed(saleId, sales[saleId].buyer);
    }

    function cancelSale(uint256 saleId) 
        external 
        saleExists(saleId) 
        onlySeller(saleId) 
        saleActive(saleId) 
        nonReentrant 
    {
        require(!sales[saleId].isPaid, "Cannot cancel after payment");
        
        sales[saleId].isCanceled = true;
        
        IERC20(sales[saleId].token).safeTransfer(
            sales[saleId].seller, 
            sales[saleId].amount
        );

        emit SaleCanceled(saleId);
    }

    function forceRemoveBuyer(uint256 saleId, address buyerAddress) 
        external 
        onlyOwner 
        saleExists(saleId) 
        saleActive(saleId) 
    {
        require(isBuyerInSale[saleId][buyerAddress], "Buyer not in sale");

        isBuyerInSale[saleId][buyerAddress] = false;

        address[] storage buyers = saleBuyers[saleId];
        for (uint256 i = 0; i < buyers.length; i++) {
            if (buyers[i] == buyerAddress) {
                buyers[i] = buyers[buyers.length - 1];
                buyers.pop();
                break;
            }
        }

        if (sales[saleId].buyer == buyerAddress) {
            sales[saleId].buyer = buyers.length > 0 ? buyers[0] : address(0);
        }

        emit BuyerForceRemoved(saleId, buyerAddress);
    }

    function getSale(uint256 saleId) external view returns (Sale memory) {
        return sales[saleId];
    }

    function getSaleBuyers(uint256 saleId) external view returns (address[] memory) {
        return saleBuyers[saleId];
    }

    function getNextSaleId() external view returns (uint256) {
        return master.nextSaleId;
    }
}
```

## Tests: P2PEscrow.test.js

```javascript
const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("P2PEscrow", function () {
  let p2pEscrow;
  let mockToken;
  let owner;
  let seller;
  let buyer1;
  let buyer2;
  let addrs;

  beforeEach(async function () {
    [owner, seller, buyer1, buyer2, ...addrs] = await ethers.getSigners();

    // Deploy mock ERC20 token
    const MockERC20 = await ethers.getContractFactory("MockERC20");
    mockToken = await MockERC20.deploy("Test Token", "TEST");
    await mockToken.waitForDeployment();

    // Deploy P2P Escrow
    const P2PEscrow = await ethers.getContractFactory("P2PEscrow");
    p2pEscrow = await P2PEscrow.deploy();
    await p2pEscrow.waitForDeployment();

    // Mint tokens to seller
    await mockToken.mint(seller.address, ethers.parseEther("1000"));
    
    // Approve escrow contract
    await mockToken.connect(seller).approve(await p2pEscrow.getAddress(), ethers.parseEther("1000"));
  });

  describe("Master Initialization", function () {
    it("Should initialize master", async function () {
      await p2pEscrow.initMaster();
      const master = await p2pEscrow.master();
      expect(master.initialized).to.be.true;
      expect(master.nextSaleId).to.equal(0);
    });

    it("Should not allow double initialization", async function () {
      await p2pEscrow.initMaster();
      await expect(p2pEscrow.initMaster()).to.be.revertedWith("Master already initialized");
    });
  });

  describe("Sale Creation", function () {
    beforeEach(async function () {
      await p2pEscrow.initMaster();
    });

    it("Should create a sale", async function () {
      const amount = ethers.parseEther("100");
      const price = 50000; // $500.00
      const currency = "USD";

      await expect(
        p2pEscrow.connect(seller).createSale(await mockToken.getAddress(), amount, price, currency)
      )
        .to.emit(p2pEscrow, "SaleCreated")
        .withArgs(0, seller.address, amount, price, currency);

      const sale = await p2pEscrow.getSale(0);
      expect(sale.seller).to.equal(seller.address);
      expect(sale.amount).to.equal(amount);
      expect(sale.price).to.equal(price);
      expect(sale.currency).to.equal(currency);
    });

    it("Should transfer tokens to escrow", async function () {
      const amount = ethers.parseEther("100");
      const initialBalance = await mockToken.balanceOf(seller.address);
      
      await p2pEscrow.connect(seller).createSale(await mockToken.getAddress(), amount, 50000, "USD");
      
      const finalBalance = await mockToken.balanceOf(seller.address);
      const escrowBalance = await mockToken.balanceOf(await p2pEscrow.getAddress());
      
      expect(finalBalance).to.equal(initialBalance - amount);
      expect(escrowBalance).to.equal(amount);
    });
  });

  describe("Buyer Management", function () {
    beforeEach(async function () {
      await p2pEscrow.initMaster();
      await p2pEscrow.connect(seller).createSale(
        await mockToken.getAddress(),
        ethers.parseEther("100"),
        50000,
        "USD"
      );
    });

    it("Should add buyer to sale", async function () {
      await expect(
        p2pEscrow.connect(seller).addBuyer(0, buyer1.address)
      )
        .to.emit(p2pEscrow, "BuyerAdded")
        .withArgs(0, buyer1.address);

      const buyers = await p2pEscrow.getSaleBuyers(0);
      expect(buyers).to.include(buyer1.address);
      
      const sale = await p2pEscrow.getSale(0);
      expect(sale.buyer).to.equal(buyer1.address);
    });

    it("Should remove buyer from sale", async function () {
      await p2pEscrow.connect(seller).addBuyer(0, buyer1.address);
      
      await expect(
        p2pEscrow.connect(seller).removeBuyer(0, buyer1.address)
      )
        .to.emit(p2pEscrow, "BuyerRemoved")
        .withArgs(0, buyer1.address);

      const buyers = await p2pEscrow.getSaleBuyers(0);
      expect(buyers).to.not.include(buyer1.address);
    });

    it("Should force remove buyer (admin only)", async function () {
      await p2pEscrow.connect(seller).addBuyer(0, buyer1.address);
      
      await expect(
        p2pEscrow.connect(owner).forceRemoveBuyer(0, buyer1.address)
      )
        .to.emit(p2pEscrow, "BuyerForceRemoved")
        .withArgs(0, buyer1.address);

      const buyers = await p2pEscrow.getSaleBuyers(0);
      expect(buyers).to.not.include(buyer1.address);
    });
  });

  describe("Payment Flow", function () {
    beforeEach(async function () {
      await p2pEscrow.initMaster();
      await p2pEscrow.connect(seller).createSale(
        await mockToken.getAddress(),
        ethers.parseEther("100"),
        50000,
        "USD"
      );
      await p2pEscrow.connect(seller).addBuyer(0, buyer1.address);
    });

    it("Should mark payment as paid", async function () {
      await expect(
        p2pEscrow.connect(buyer1).markPaid(0)
      )
        .to.emit(p2pEscrow, "PaymentMarked")
        .withArgs(0);

      const sale = await p2pEscrow.getSale(0);
      expect(sale.isPaid).to.be.true;
    });

    it("Should allow buyer to claim payment", async function () {
      await p2pEscrow.connect(buyer1).markPaid(0);
      
      const initialBalance = await mockToken.balanceOf(buyer1.address);
      
      await expect(
        p2pEscrow.connect(buyer1).claimPayment(0)
      )
        .to.emit(p2pEscrow, "PaymentClaimed")
        .withArgs(0, buyer1.address);

      const finalBalance = await mockToken.balanceOf(buyer1.address);
      expect(finalBalance).to.equal(initialBalance + ethers.parseEther("100"));
      
      const sale = await p2pEscrow.getSale(0);
      expect(sale.isFinished).to.be.true;
    });

    it("Should not allow claim without payment marked", async function () {
      await expect(
        p2pEscrow.connect(buyer1).claimPayment(0)
      ).to.be.revertedWith("Payment not marked as paid");
    });
  });

  describe("Sale Cancellation", function () {
    beforeEach(async function () {
      await p2pEscrow.initMaster();
      await p2pEscrow.connect(seller).createSale(
        await mockToken.getAddress(),
        ethers.parseEther("100"),
        50000,
        "USD"
      );
    });

    it("Should allow seller to cancel sale", async function () {
      const initialBalance = await mockToken.balanceOf(seller.address);
      
      await expect(
        p2pEscrow.connect(seller).cancelSale(0)
      )
        .to.emit(p2pEscrow, "SaleCanceled")
        .withArgs(0);

      const finalBalance = await mockToken.balanceOf(seller.address);
      expect(finalBalance).to.equal(initialBalance + ethers.parseEther("100"));
      
      const sale = await p2pEscrow.getSale(0);
      expect(sale.isCanceled).to.be.true;
    });

    it("Should not allow cancel after payment marked", async function () {
      await p2pEscrow.connect(seller).addBuyer(0, buyer1.address);
      await p2pEscrow.connect(buyer1).markPaid(0);
      
      await expect(
        p2pEscrow.connect(seller).cancelSale(0)
      ).to.be.revertedWith("Cannot cancel after payment");
    });
  });
});
```
