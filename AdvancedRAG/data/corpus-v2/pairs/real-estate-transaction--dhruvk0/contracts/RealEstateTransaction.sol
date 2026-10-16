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
