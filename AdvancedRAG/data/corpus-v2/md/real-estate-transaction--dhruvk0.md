# real-estate-transaction--dhruvk0

- domain: escrow-conditional-payments (escrow)
- level: moderate
- origin: human
- convention: hardhat2-ethers6
- source: https://github.com/DhruvK0/B17-Blockchain-Capstone @ 8d24b57a7a6476f2e4592266b56239b110d27150
- license: MIT
- targets: RealEstateTransaction.sol
- validation: 6 passing tests, 0 failing; statement coverage RealEstateTransaction.sol 96.43 %

## Contract: RealEstateTransaction.sol (primary target)

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

contract RealEstateTransaction is Ownable, ReentrancyGuard {
    constructor() Ownable(msg.sender) {
    }
    enum Role { Buyer, Seller, Agent, Lender }

    struct Participant {
        address payable account;
        Role role;
    }

    struct Property {
        uint256 id;
        string description;
        uint256 price;
        address payable owner;
        bool isListed;
    }

    struct Offer {
        uint256 propertyId;
        address payable buyer;
        uint256 offerPrice;
        bool isAccepted;
        bool escrowInitiated;
    }

    struct Escrow {
        uint256 propertyId;
        address payable buyer;
        address payable seller;
        uint256 amount;
        bool fundsReleased;
    }

    uint256 public propertyCount;

    mapping(uint256 => Property) public properties;
    mapping(uint256 => Offer[]) public offers;
    mapping(uint256 => Escrow) public escrows;
    mapping(address => Participant) public participants;

    event PropertyListed(uint256 propertyId, address owner, uint256 price);
    event OfferMade(uint256 propertyId, address buyer, uint256 offerPrice);
    event OfferAccepted(uint256 propertyId, address buyer, uint256 offerPrice);
    event EscrowInitiated(uint256 propertyId, address buyer, uint256 amount);
    event FundsReleased(uint256 propertyId, uint256 amount);

    function register(Role _role) public {
        participants[msg.sender] = Participant(payable(msg.sender), _role);
    }

    function listProperty(string memory _description, uint256 _price) public {
        require(participants[msg.sender].role == Role.Seller, "Only sellers can list properties");

        propertyCount++;
        properties[propertyCount] = Property(
            propertyCount,
            _description,
            _price,
            payable(msg.sender),
            true
        );

        emit PropertyListed(propertyCount, msg.sender, _price);
    }

    function makeOffer(uint256 _propertyId) public payable {
        Property memory property = properties[_propertyId];

        require(property.isListed, "Property not listed");
        require(msg.value > 0, "Offer must have a positive value");
        require(participants[msg.sender].role == Role.Buyer, "Only buyers can make offers");

        offers[_propertyId].push(Offer(
            _propertyId,
            payable(msg.sender),
            msg.value,
            false,
            false
        ));

        emit OfferMade(_propertyId, msg.sender, msg.value);
    }

    function acceptOffer(uint256 _propertyId, uint256 _offerIndex) public {
        Property storage property = properties[_propertyId];
        Offer storage offer = offers[_propertyId][_offerIndex];

        require(msg.sender == property.owner, "Only the property owner can accept offers");
        require(property.isListed, "Property is not listed");
        require(!offer.isAccepted, "Offer already accepted");

        offer.isAccepted = true;

        // Initiate escrow
        escrows[_propertyId] = Escrow(
            _propertyId,
            offer.buyer,
            property.owner,
            offer.offerPrice,
            false
        );

        emit OfferAccepted(_propertyId, offer.buyer, offer.offerPrice);
    }

    function initiateEscrow(uint256 _propertyId, uint256 _offerIndex) public nonReentrant {
        Offer storage offer = offers[_propertyId][_offerIndex];
        Property storage property = properties[_propertyId];

        require(offer.isAccepted, "Offer not accepted");
        require(!offer.escrowInitiated, "Escrow already initiated");
        require(msg.sender == offer.buyer, "Only the buyer can initiate escrow");

        // Transfer funds to the contract to hold in escrow
        // The funds were already sent during makeOffer and are held in the contract

        // Create the escrow
        escrows[_propertyId] = Escrow(
            _propertyId,
            offer.buyer,
            property.owner,
            offer.offerPrice,
            false
        );

        offer.escrowInitiated = true;

        emit EscrowInitiated(_propertyId, offer.buyer, offer.offerPrice);
    }

    // Function to release funds from escrow
    function releaseFunds(uint256 _propertyId) public nonReentrant {
        Escrow storage escrow = escrows[_propertyId];
        Property storage property = properties[_propertyId];

        require(escrow.fundsReleased == false, "Funds already released");
        require(
            msg.sender == escrow.buyer || msg.sender == escrow.seller,
            "Only buyer or seller can release funds"
        );
        require(escrow.amount > 0, "Escrow not funded");

        // Placeholder for additional checks (e.g., title verification)

        // Transfer funds to the seller
        escrow.seller.transfer(escrow.amount);
        escrow.fundsReleased = true;

        // Transfer property ownership
        property.owner = escrow.buyer;
        property.isListed = false;

        emit FundsReleased(_propertyId, escrow.amount);
    }

    // Function to retrieve contract's balance (for debugging purposes)
    function getContractBalance() public view returns (uint256) {
        return address(this).balance;
    }
}
```

## Tests: RealEstateTransaction.js

```javascript
const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("RealEstateTransaction Contract", function () {
    it("Should allow users to register with a specific role", async function () {
        const [owner, seller, buyer] = await ethers.getSigners();
      
        const RealEstateTransaction = await ethers.getContractFactory("RealEstateTransaction");
        const contract = await RealEstateTransaction.deploy();
      
        // Seller registers
        await contract.connect(seller).register(1); // Role.Seller
        const sellerInfo = await contract.participants(seller.address);
        expect(sellerInfo.role).to.equal(1);
      
        // Buyer registers
        await contract.connect(buyer).register(0); // Role.Buyer
        const buyerInfo = await contract.participants(buyer.address);
        expect(buyerInfo.role).to.equal(0);
    });

    it("Should allow a seller to list a property", async function () {
        const [owner, seller] = await ethers.getSigners();
      
        const RealEstateTransaction = await ethers.getContractFactory("RealEstateTransaction");
        const contract = await RealEstateTransaction.deploy();
      
        // Seller registers
        await contract.connect(seller).register(1); // Role.Seller
      
        // Seller lists a property
        await contract.connect(seller).listProperty("123 Main St", ethers.parseEther("100"));
        const property = await contract.properties(1);
      
        expect(property.description).to.equal("123 Main St");
        expect(property.price).to.equal(ethers.parseEther("100"));
        expect(property.owner).to.equal(seller.address);
        expect(property.isListed).to.be.true;
    });

    it("Should allow a buyer to make an offer on a listed property", async function () {
        const [owner, seller, buyer] = await ethers.getSigners();
      
        const RealEstateTransaction = await ethers.getContractFactory("RealEstateTransaction");
        const contract = await RealEstateTransaction.deploy();
      
        // Participants register
        await contract.connect(seller).register(1); // Role.Seller
        await contract.connect(buyer).register(0); // Role.Buyer
      
        // Seller lists a property
        await contract.connect(seller).listProperty("456 Elm St", ethers.parseEther("150"));
      
        // Buyer makes an offer
        await contract.connect(buyer).makeOffer(1, { value: ethers.parseEther("150") });
        const offer = await contract.offers(1, 0);
      
        expect(offer.buyer).to.equal(buyer.address);
        expect(offer.offerPrice).to.equal(ethers.parseEther("150"));
        expect(offer.isAccepted).to.be.false;
        expect(offer.escrowInitiated).to.be.false;
    });

    it("Should allow a seller to accept an offer", async function () {
        const [owner, seller, buyer] = await ethers.getSigners();
      
        const RealEstateTransaction = await ethers.getContractFactory("RealEstateTransaction");
        const contract = await RealEstateTransaction.deploy();
      
        // Participants register
        await contract.connect(seller).register(1); // Role.Seller
        await contract.connect(buyer).register(0); // Role.Buyer
      
        // Seller lists a property
        await contract.connect(seller).listProperty("789 Oak Ave", ethers.parseEther("200"));
      
        // Buyer makes an offer
        await contract.connect(buyer).makeOffer(1, { value: ethers.parseEther("200") });
      
        // Seller accepts the offer
        await contract.connect(seller).acceptOffer(1, 0);
        const offer = await contract.offers(1, 0);
      
        expect(offer.isAccepted).to.be.true;
    });

    it("Should allow the buyer to initiate escrow after offer acceptance", async function () {
        const [owner, seller, buyer] = await ethers.getSigners();
      
        const RealEstateTransaction = await ethers.getContractFactory("RealEstateTransaction");
        const contract = await RealEstateTransaction.deploy();
      
        // Participants register
        await contract.connect(seller).register(1); // Role.Seller
        await contract.connect(buyer).register(0); // Role.Buyer
      
        // Seller lists a property
        await contract.connect(seller).listProperty("101 Pine Rd", ethers.parseEther("250"));
      
        // Buyer makes an offer
        await contract.connect(buyer).makeOffer(1, { value: ethers.parseEther("250") });
      
        // Seller accepts the offer
        await contract.connect(seller).acceptOffer(1, 0);
      
        // Buyer initiates escrow
        await contract.connect(buyer).initiateEscrow(1, 0);
        const offer = await contract.offers(1, 0);
        const escrow = await contract.escrows(1);
      
        expect(offer.escrowInitiated).to.be.true;
        expect(escrow.amount).to.equal(ethers.parseEther("250"));
        expect(escrow.buyer).to.equal(buyer.address);
        expect(escrow.seller).to.equal(seller.address);
    });

    it("Should allow funds to be released from escrow, transferring ownership and funds", async function () {
        const [owner, seller, buyer] = await ethers.getSigners();
      
        const RealEstateTransaction = await ethers.getContractFactory("RealEstateTransaction");
        const contract = await RealEstateTransaction.deploy();
      
        // Participants register
        await contract.connect(seller).register(1); // Role.Seller
        await contract.connect(buyer).register(0); // Role.Buyer
      
        // Seller lists a property
        await contract.connect(seller).listProperty("202 Maple St", ethers.parseEther("300"));
      
        // Buyer makes an offer
        await contract.connect(buyer).makeOffer(1, { value: ethers.parseEther("300") });
      
        // Seller accepts the offer
        await contract.connect(seller).acceptOffer(1, 0);
      
        // Buyer initiates escrow
        await contract.connect(buyer).initiateEscrow(1, 0);
      
        // Check initial balances
        const sellerInitialBalance = await ethers.provider.getBalance(seller.address);
        const buyerInitialBalance = await ethers.provider.getBalance(buyer.address);
      
        // Release funds
        await contract.connect(buyer).releaseFunds(1);
      
        // Verify escrow is updated
        const escrow = await contract.escrows(1);
        expect(escrow.fundsReleased).to.be.true;
      
        // Verify property ownership transferred
        const property = await contract.properties(1);
        expect(property.owner).to.equal(buyer.address);
        expect(property.isListed).to.be.false;
      
        // Verify seller received funds
        const sellerFinalBalance = await ethers.provider.getBalance(seller.address);
        expect(sellerFinalBalance).to.equal(sellerInitialBalance+ethers.parseEther("300"));
    });
    
      
      
  });
```
