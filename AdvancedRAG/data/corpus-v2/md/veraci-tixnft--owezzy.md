# veraci-tixnft--owezzy

- domain: ticketing-events (ticketing-events)
- level: complex
- origin: human
- convention: hardhat2-ethers6
- source: https://github.com/owezzy/nft-ticket @ e63683f42741259f1f0a27d0d3ba58a281d39399
- license: Apache-2.0
- targets: VeraciTIXNFT.sol
- validation: 37 passing tests, 0 failing; statement coverage VeraciTIXNFT.sol 96.97 %

## Contract: VeraciTIXNFT.sol (primary target)

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/token/ERC721/extensions/ERC721URIStorage.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title VeraciTIXNFT
 * @dev NFT-based event ticketing system with anti-scalping features
 * @notice This contract manages the creation, transfer, and validation of event tickets as NFTs
 */
contract VeraciTIXNFT is ERC721, ERC721URIStorage, Ownable {
    // Counter for token IDs
    uint256 private _tokenIdCounter;
    
    // Ticket metadata structure
    struct TicketMetadata {
        uint256 eventId;           // Associated event ID
        string seatNumber;         // Seat number/section
        uint256 originalPrice;     // Original ticket price in wei
        uint256 mintTimestamp;     // When ticket was minted
        bool isUsed;               // Whether ticket has been used for entry
        bool isTransferable;       // Whether ticket can be transferred
    }
    
    // Event structure
    struct Event {
        uint256 id;                // Event ID
        string name;               // Event name
        uint256 date;              // Event date (Unix timestamp)
        string venue;              // Venue name
        uint256 capacity;          // Total capacity
        uint256 ticketsSold;       // Number of tickets sold
        uint256 basePrice;         // Base ticket price in wei
        address organizer;         // Event organizer address
        bool isActive;             // Whether event is active
        bool isCancelled;          // Whether event is cancelled
    }
    
    // Mapping from token ID to ticket metadata
    mapping(uint256 => TicketMetadata) private _ticketMetadata;
    
    // Mapping from event ID to Event
    mapping(uint256 => Event) private _events;
    
    // Counter for event IDs
    uint256 private _eventIdCounter;
    
    // Mapping from event organizer to their event IDs
    mapping(address => uint256[]) private _organizerEvents;
    
    // Maximum markup percentage for resale (e.g., 120 = 20% markup)
    uint256 public maxResaleMarkupPercent = 120;
    
    // Platform fee percentage (e.g., 250 = 2.5%)
    uint256 public platformFeePercent = 250;
    
    // Events
    event EventCreated(uint256 indexed eventId, string name, address indexed organizer);
    event TicketMinted(uint256 indexed tokenId, uint256 indexed eventId, address indexed recipient);
    event TicketValidated(uint256 indexed tokenId, uint256 indexed eventId);
    event TicketTransferred(uint256 indexed tokenId, address indexed from, address indexed to, uint256 price);
    event EventCancelled(uint256 indexed eventId);
    event MaxResaleMarkupUpdated(uint256 newPercent);
    event PlatformFeeUpdated(uint256 newPercent);
    
    /**
     * @dev Constructor initializes the NFT contract
     */
    constructor() ERC721("VeraciTIX", "VTIX") Ownable(msg.sender) {}
    
    /**
     * @dev Creates a new event
     * @param name Event name
     * @param date Event date (Unix timestamp)
     * @param venue Venue name
     * @param capacity Total capacity
     * @param basePrice Base ticket price in wei
     * @return eventId The ID of the created event
     */
    function createEvent(
        string memory name,
        uint256 date,
        string memory venue,
        uint256 capacity,
        uint256 basePrice
    ) external returns (uint256) {
        require(bytes(name).length > 0, "Event name cannot be empty");
        require(date > block.timestamp, "Event date must be in the future");
        require(capacity > 0, "Capacity must be greater than 0");
        require(basePrice > 0, "Base price must be greater than 0");
        
        _eventIdCounter++;
        uint256 eventId = _eventIdCounter;
        
        _events[eventId] = Event({
            id: eventId,
            name: name,
            date: date,
            venue: venue,
            capacity: capacity,
            ticketsSold: 0,
            basePrice: basePrice,
            organizer: msg.sender,
            isActive: true,
            isCancelled: false
        });
        
        _organizerEvents[msg.sender].push(eventId);
        
        emit EventCreated(eventId, name, msg.sender);
        return eventId;
    }
    
    /**
     * @dev Mints a new ticket NFT
     * @param to Address to receive the ticket
     * @param eventId Event ID
     * @param seatNumber Seat number/section
     * @param metadataURI Metadata URI for the ticket
     * @return tokenId The ID of the minted token
     */
    function mintTicket(
        address to,
        uint256 eventId,
        string memory seatNumber,
        string memory metadataURI
    ) external returns (uint256) {
        Event storage ticketEvent = _events[eventId];
        
        require(ticketEvent.isActive, "Event is not active");
        require(!ticketEvent.isCancelled, "Event is cancelled");
        require(ticketEvent.ticketsSold < ticketEvent.capacity, "Event is sold out");
        require(msg.sender == ticketEvent.organizer || msg.sender == owner(), "Not authorized to mint");
        
        _tokenIdCounter++;
        uint256 tokenId = _tokenIdCounter;
        
        _safeMint(to, tokenId);
        _setTokenURI(tokenId, metadataURI);
        
        _ticketMetadata[tokenId] = TicketMetadata({
            eventId: eventId,
            seatNumber: seatNumber,
            originalPrice: ticketEvent.basePrice,
            mintTimestamp: block.timestamp,
            isUsed: false,
            isTransferable: true
        });
        
        ticketEvent.ticketsSold++;
        
        emit TicketMinted(tokenId, eventId, to);
        return tokenId;
    }
    
    /**
     * @dev Validates a ticket for entry (marks as used)
     * @param tokenId Token ID to validate
     */
    function validateTicket(uint256 tokenId) external {
        require(_ownerOf(tokenId) != address(0), "Token does not exist");
        
        TicketMetadata storage metadata = _ticketMetadata[tokenId];
        Event storage ticketEvent = _events[metadata.eventId];
        
        require(msg.sender == ticketEvent.organizer || msg.sender == owner(), "Not authorized to validate");
        require(!metadata.isUsed, "Ticket already used");
        require(!ticketEvent.isCancelled, "Event is cancelled");
        require(block.timestamp <= ticketEvent.date + 1 days, "Event has ended");
        
        metadata.isUsed = true;
        
        emit TicketValidated(tokenId, metadata.eventId);
    }
    
    /**
     * @dev Transfers ticket with price enforcement (anti-scalping)
     * @param from Current owner
     * @param to New owner
     * @param tokenId Token ID to transfer
     * @param price Sale price in wei
     */
    function transferTicketWithPrice(
        address from,
        address to,
        uint256 tokenId,
        uint256 price
    ) external payable {
        require(_ownerOf(tokenId) == from, "From address is not the owner");
        require(msg.sender == to, "Only buyer can call this function");
        
        TicketMetadata storage metadata = _ticketMetadata[tokenId];
        Event storage ticketEvent = _events[metadata.eventId];
        
        require(metadata.isTransferable, "Ticket is not transferable");
        require(!metadata.isUsed, "Ticket already used");
        require(!ticketEvent.isCancelled, "Event is cancelled");
        
        // Anti-scalping: enforce maximum markup
        uint256 maxPrice = (metadata.originalPrice * maxResaleMarkupPercent) / 100;
        require(price <= maxPrice, "Price exceeds maximum markup");
        require(msg.value >= price, "Insufficient payment");
        
        // Calculate platform fee
        uint256 platformFee = (price * platformFeePercent) / 10000;
        uint256 sellerAmount = price - platformFee;
        
        // Transfer funds
        payable(owner()).transfer(platformFee);
        payable(from).transfer(sellerAmount);
        
        // Refund excess payment
        if (msg.value > price) {
            payable(to).transfer(msg.value - price);
        }
        
        // Transfer NFT
        _transfer(from, to, tokenId);
        
        emit TicketTransferred(tokenId, from, to, price);
    }
    
    /**
     * @dev Cancels an event and allows refunds
     * @param eventId Event ID to cancel
     */
    function cancelEvent(uint256 eventId) external {
        Event storage ticketEvent = _events[eventId];
        
        require(msg.sender == ticketEvent.organizer || msg.sender == owner(), "Not authorized");
        require(!ticketEvent.isCancelled, "Event already cancelled");
        
        ticketEvent.isCancelled = true;
        ticketEvent.isActive = false;
        
        emit EventCancelled(eventId);
    }
    
    /**
     * @dev Updates the maximum resale markup percentage
     * @param newPercent New percentage (e.g., 120 = 20% markup)
     */
    function setMaxResaleMarkup(uint256 newPercent) external onlyOwner {
        require(newPercent >= 100, "Markup must be at least 100%");
        require(newPercent <= 200, "Markup cannot exceed 100% increase");
        maxResaleMarkupPercent = newPercent;
        emit MaxResaleMarkupUpdated(newPercent);
    }
    
    /**
     * @dev Updates the platform fee percentage
     * @param newPercent New percentage in basis points (e.g., 250 = 2.5%)
     */
    function setPlatformFee(uint256 newPercent) external onlyOwner {
        require(newPercent <= 1000, "Fee cannot exceed 10%");
        platformFeePercent = newPercent;
        emit PlatformFeeUpdated(newPercent);
    }
    
    /**
     * @dev Sets whether a ticket is transferable
     * @param tokenId Token ID
     * @param transferable Whether ticket can be transferred
     */
    function setTicketTransferable(uint256 tokenId, bool transferable) external {
        require(_ownerOf(tokenId) != address(0), "Token does not exist");
        
        TicketMetadata storage metadata = _ticketMetadata[tokenId];
        Event storage ticketEvent = _events[metadata.eventId];
        
        require(msg.sender == ticketEvent.organizer || msg.sender == owner(), "Not authorized");
        
        metadata.isTransferable = transferable;
    }
    
    // View functions
    
    /**
     * @dev Gets ticket metadata
     * @param tokenId Token ID
     * @return Ticket metadata
     */
    function getTicketMetadata(uint256 tokenId) external view returns (TicketMetadata memory) {
        require(_ownerOf(tokenId) != address(0), "Token does not exist");
        return _ticketMetadata[tokenId];
    }
    
    /**
     * @dev Gets event details
     * @param eventId Event ID
     * @return Event details
     */
    function getEventDetails(uint256 eventId) external view returns (Event memory) {
        require(_events[eventId].id != 0, "Event does not exist");
        return _events[eventId];
    }
    
    /**
     * @dev Gets all events created by an organizer
     * @param organizer Organizer address
     * @return Array of event IDs
     */
    function getOrganizerEvents(address organizer) external view returns (uint256[] memory) {
        return _organizerEvents[organizer];
    }
    
    /**
     * @dev Gets total number of events
     * @return Total event count
     */
    function getTotalEvents() external view returns (uint256) {
        return _eventIdCounter;
    }
    
    /**
     * @dev Gets total number of tickets minted
     * @return Total ticket count
     */
    function getTotalTickets() external view returns (uint256) {
        return _tokenIdCounter;
    }
    
    // Override functions
    
    function tokenURI(uint256 tokenId) public view override(ERC721, ERC721URIStorage) returns (string memory) {
        return super.tokenURI(tokenId);
    }
    
    function supportsInterface(bytes4 interfaceId) public view override(ERC721, ERC721URIStorage) returns (bool) {
        return super.supportsInterface(interfaceId);
    }
}
```

## Tests: VeraciTIXNFT.test.js

```javascript
const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time, loadFixture } = require("@nomicfoundation/hardhat-network-helpers");

describe("VeraciTIXNFT", function () {
  // Fixture to deploy contract
  async function deployVeraciTIXFixture() {
    const [owner, organizer, buyer1, buyer2] = await ethers.getSigners();

    const VeraciTIXNFT = await ethers.getContractFactory("VeraciTIXNFT");
    const contract = await VeraciTIXNFT.deploy();

    return { contract, owner, organizer, buyer1, buyer2 };
  }

  // Fixture with an event already created
  async function deployWithEventFixture() {
    const { contract, owner, organizer, buyer1, buyer2 } = await loadFixture(deployVeraciTIXFixture);

    const eventDate = (await time.latest()) + 86400 * 30; // 30 days from now
    const tx = await contract.connect(organizer).createEvent(
      "Rock Concert 2025",
      eventDate,
      "Madison Square Garden",
      1000,
      ethers.parseEther("0.1") // 0.1 ETH base price
    );
    await tx.wait();

    return { contract, owner, organizer, buyer1, buyer2, eventDate };
  }

  describe("Deployment", function () {
    it("Should set the right owner", async function () {
      const { contract, owner } = await loadFixture(deployVeraciTIXFixture);
      expect(await contract.owner()).to.equal(owner.address);
    });

    it("Should have correct name and symbol", async function () {
      const { contract } = await loadFixture(deployVeraciTIXFixture);
      expect(await contract.name()).to.equal("VeraciTIX");
      expect(await contract.symbol()).to.equal("VTIX");
    });

    it("Should initialize with correct default values", async function () {
      const { contract } = await loadFixture(deployVeraciTIXFixture);
      expect(await contract.maxResaleMarkupPercent()).to.equal(120);
      expect(await contract.platformFeePercent()).to.equal(250);
      expect(await contract.getTotalEvents()).to.equal(0);
      expect(await contract.getTotalTickets()).to.equal(0);
    });
  });

  describe("Event Creation", function () {
    it("Should create an event successfully", async function () {
      const { contract, organizer } = await loadFixture(deployVeraciTIXFixture);

      const eventDate = (await time.latest()) + 86400 * 30; // 30 days from now
      const tx = await contract.connect(organizer).createEvent(
        "Rock Concert 2025",
        eventDate,
        "Madison Square Garden",
        1000,
        ethers.parseEther("0.1")
      );

      await expect(tx)
        .to.emit(contract, "EventCreated")
        .withArgs(1, "Rock Concert 2025", organizer.address);

      const event = await contract.getEventDetails(1);
      expect(event.name).to.equal("Rock Concert 2025");
      expect(event.venue).to.equal("Madison Square Garden");
      expect(event.capacity).to.equal(1000);
      expect(event.organizer).to.equal(organizer.address);
      expect(event.isActive).to.be.true;
      expect(event.isCancelled).to.be.false;
    });

    it("Should increment event counter", async function () {
      const { contract, organizer } = await loadFixture(deployVeraciTIXFixture);

      const eventDate = (await time.latest()) + 86400 * 30;
      await contract.connect(organizer).createEvent("Event 1", eventDate, "Venue", 100, ethers.parseEther("0.1"));
      await contract.connect(organizer).createEvent("Event 2", eventDate, "Venue", 100, ethers.parseEther("0.1"));

      expect(await contract.getTotalEvents()).to.equal(2);
    });

    it("Should track organizer events", async function () {
      const { contract, organizer, buyer1 } = await loadFixture(deployVeraciTIXFixture);

      const eventDate = (await time.latest()) + 86400 * 30;
      await contract.connect(organizer).createEvent("Event 1", eventDate, "Venue", 100, ethers.parseEther("0.1"));
      await contract.connect(organizer).createEvent("Event 2", eventDate, "Venue", 100, ethers.parseEther("0.1"));
      await contract.connect(buyer1).createEvent("Event 3", eventDate, "Venue", 100, ethers.parseEther("0.1"));

      const organizerEvents = await contract.getOrganizerEvents(organizer.address);
      expect(organizerEvents.length).to.equal(2);
      expect(organizerEvents[0]).to.equal(1);
      expect(organizerEvents[1]).to.equal(2);

      const buyer1Events = await contract.getOrganizerEvents(buyer1.address);
      expect(buyer1Events.length).to.equal(1);
      expect(buyer1Events[0]).to.equal(3);
    });

    it("Should reject event with empty name", async function () {
      const { contract, organizer } = await loadFixture(deployVeraciTIXFixture);

      const eventDate = (await time.latest()) + 86400 * 30;
      await expect(
        contract.connect(organizer).createEvent("", eventDate, "Venue", 100, ethers.parseEther("0.1"))
      ).to.be.revertedWith("Event name cannot be empty");
    });

    it("Should reject event with past date", async function () {
      const { contract, organizer } = await loadFixture(deployVeraciTIXFixture);

      const pastDate = (await time.latest()) - 86400; // 1 day ago
      await expect(
        contract.connect(organizer).createEvent("Event", pastDate, "Venue", 100, ethers.parseEther("0.1"))
      ).to.be.revertedWith("Event date must be in the future");
    });

    it("Should reject event with zero capacity", async function () {
      const { contract, organizer } = await loadFixture(deployVeraciTIXFixture);

      const eventDate = (await time.latest()) + 86400 * 30;
      await expect(
        contract.connect(organizer).createEvent("Event", eventDate, "Venue", 0, ethers.parseEther("0.1"))
      ).to.be.revertedWith("Capacity must be greater than 0");
    });

    it("Should reject event with zero price", async function () {
      const { contract, organizer } = await loadFixture(deployVeraciTIXFixture);

      const eventDate = (await time.latest()) + 86400 * 30;
      await expect(
        contract.connect(organizer).createEvent("Event", eventDate, "Venue", 100, 0)
      ).to.be.revertedWith("Base price must be greater than 0");
    });
  });

  describe("Ticket Minting", function () {
    it("Should mint a ticket successfully", async function () {
      const { contract, organizer, buyer1 } = await loadFixture(deployWithEventFixture);

      const tx = await contract.connect(organizer).mintTicket(
        buyer1.address,
        1,
        "A-12",
        "ipfs://metadata-uri"
      );

      await expect(tx)
        .to.emit(contract, "TicketMinted")
        .withArgs(1, 1, buyer1.address);

      expect(await contract.ownerOf(1)).to.equal(buyer1.address);
      expect(await contract.getTotalTickets()).to.equal(1);

      const metadata = await contract.getTicketMetadata(1);
      expect(metadata.eventId).to.equal(1);
      expect(metadata.seatNumber).to.equal("A-12");
      expect(metadata.originalPrice).to.equal(ethers.parseEther("0.1"));
      expect(metadata.isUsed).to.be.false;
      expect(metadata.isTransferable).to.be.true;
    });

    it("Should increment tickets sold counter", async function () {
      const { contract, organizer, buyer1 } = await loadFixture(deployWithEventFixture);

      await contract.connect(organizer).mintTicket(buyer1.address, 1, "A-12", "ipfs://uri");
      await contract.connect(organizer).mintTicket(buyer1.address, 1, "A-13", "ipfs://uri");

      const event = await contract.getEventDetails(1);
      expect(event.ticketsSold).to.equal(2);
    });

    it("Should allow owner to mint tickets", async function () {
      const { contract, owner, buyer1 } = await loadFixture(deployWithEventFixture);

      await expect(
        contract.connect(owner).mintTicket(buyer1.address, 1, "A-12", "ipfs://uri")
      ).to.not.be.reverted;
    });

    it("Should reject minting by unauthorized user", async function () {
      const { contract, buyer1, buyer2 } = await loadFixture(deployWithEventFixture);

      await expect(
        contract.connect(buyer1).mintTicket(buyer2.address, 1, "A-12", "ipfs://uri")
      ).to.be.revertedWith("Not authorized to mint");
    });

    it("Should reject minting for cancelled event", async function () {
      const { contract, organizer, buyer1 } = await loadFixture(deployWithEventFixture);

      await contract.connect(organizer).cancelEvent(1);

      await expect(
        contract.connect(organizer).mintTicket(buyer1.address, 1, "A-12", "ipfs://uri")
      ).to.be.revertedWith("Event is not active");
    });

    it("Should reject minting when sold out", async function () {
      const { contract, organizer, buyer1 } = await loadFixture(deployVeraciTIXFixture);

      const eventDate = (await time.latest()) + 86400 * 30;
      await contract.connect(organizer).createEvent("Small Event", eventDate, "Venue", 2, ethers.parseEther("0.1"));

      await contract.connect(organizer).mintTicket(buyer1.address, 1, "A-1", "ipfs://uri");
      await contract.connect(organizer).mintTicket(buyer1.address, 1, "A-2", "ipfs://uri");

      await expect(
        contract.connect(organizer).mintTicket(buyer1.address, 1, "A-3", "ipfs://uri")
      ).to.be.revertedWith("Event is sold out");
    });
  });

  describe("Ticket Validation", function () {
    it("Should validate a ticket successfully", async function () {
      const { contract, organizer, buyer1 } = await loadFixture(deployWithEventFixture);

      await contract.connect(organizer).mintTicket(buyer1.address, 1, "A-12", "ipfs://uri");

      const tx = await contract.connect(organizer).validateTicket(1);
      await expect(tx).to.emit(contract, "TicketValidated").withArgs(1, 1);

      const metadata = await contract.getTicketMetadata(1);
      expect(metadata.isUsed).to.be.true;
    });

    it("Should allow owner to validate tickets", async function () {
      const { contract, owner, organizer, buyer1 } = await loadFixture(deployWithEventFixture);

      await contract.connect(organizer).mintTicket(buyer1.address, 1, "A-12", "ipfs://uri");

      await expect(contract.connect(owner).validateTicket(1)).to.not.be.reverted;
    });

    it("Should reject validation by unauthorized user", async function () {
      const { contract, organizer, buyer1 } = await loadFixture(deployWithEventFixture);

      await contract.connect(organizer).mintTicket(buyer1.address, 1, "A-12", "ipfs://uri");

      await expect(
        contract.connect(buyer1).validateTicket(1)
      ).to.be.revertedWith("Not authorized to validate");
    });

    it("Should reject double validation", async function () {
      const { contract, organizer, buyer1 } = await loadFixture(deployWithEventFixture);

      await contract.connect(organizer).mintTicket(buyer1.address, 1, "A-12", "ipfs://uri");
      await contract.connect(organizer).validateTicket(1);

      await expect(
        contract.connect(organizer).validateTicket(1)
      ).to.be.revertedWith("Ticket already used");
    });

    it("Should reject validation for cancelled event", async function () {
      const { contract, organizer, buyer1 } = await loadFixture(deployWithEventFixture);

      await contract.connect(organizer).mintTicket(buyer1.address, 1, "A-12", "ipfs://uri");
      await contract.connect(organizer).cancelEvent(1);

      await expect(
        contract.connect(organizer).validateTicket(1)
      ).to.be.revertedWith("Event is cancelled");
    });
  });

  describe("Ticket Transfer with Anti-Scalping", function () {
    it("Should transfer ticket within price limit", async function () {
      const { contract, organizer, buyer1, buyer2 } = await loadFixture(deployWithEventFixture);

      await contract.connect(organizer).mintTicket(buyer1.address, 1, "A-12", "ipfs://uri");

      const resalePrice = ethers.parseEther("0.12"); // 20% markup (within limit)
      const tx = await contract.connect(buyer2).transferTicketWithPrice(
        buyer1.address,
        buyer2.address,
        1,
        resalePrice,
        { value: resalePrice }
      );

      await expect(tx).to.emit(contract, "TicketTransferred");
      expect(await contract.ownerOf(1)).to.equal(buyer2.address);
    });

    it("Should reject transfer exceeding price limit", async function () {
      const { contract, organizer, buyer1, buyer2 } = await loadFixture(deployWithEventFixture);

      await contract.connect(organizer).mintTicket(buyer1.address, 1, "A-12", "ipfs://uri");

      const excessivePrice = ethers.parseEther("0.13"); // 30% markup (exceeds 20% limit)
      await expect(
        contract.connect(buyer2).transferTicketWithPrice(
          buyer1.address,
          buyer2.address,
          1,
          excessivePrice,
          { value: excessivePrice }
        )
      ).to.be.revertedWith("Price exceeds maximum markup");
    });

    it("Should reject transfer of used ticket", async function () {
      const { contract, organizer, buyer1, buyer2 } = await loadFixture(deployWithEventFixture);

      await contract.connect(organizer).mintTicket(buyer1.address, 1, "A-12", "ipfs://uri");
      await contract.connect(organizer).validateTicket(1);

      const resalePrice = ethers.parseEther("0.12");
      await expect(
        contract.connect(buyer2).transferTicketWithPrice(
          buyer1.address,
          buyer2.address,
          1,
          resalePrice,
          { value: resalePrice }
        )
      ).to.be.revertedWith("Ticket already used");
    });

    it("Should refund excess payment", async function () {
      const { contract, organizer, buyer1, buyer2 } = await loadFixture(deployWithEventFixture);

      await contract.connect(organizer).mintTicket(buyer1.address, 1, "A-12", "ipfs://uri");

      const resalePrice = ethers.parseEther("0.12");
      const excessPayment = ethers.parseEther("0.15");

      const buyer2BalanceBefore = await ethers.provider.getBalance(buyer2.address);

      const tx = await contract.connect(buyer2).transferTicketWithPrice(
        buyer1.address,
        buyer2.address,
        1,
        resalePrice,
        { value: excessPayment }
      );
      const receipt = await tx.wait();
      const gasUsed = receipt.gasUsed * receipt.gasPrice;

      const buyer2BalanceAfter = await ethers.provider.getBalance(buyer2.address);

      // Buyer2 should have paid only resalePrice + gas (excess refunded)
      const actualSpent = buyer2BalanceBefore - buyer2BalanceAfter;
      expect(actualSpent).to.be.closeTo(resalePrice + gasUsed, ethers.parseEther("0.001"));
    });
  });

  describe("Event Cancellation", function () {
    it("Should cancel event by organizer", async function () {
      const { contract, organizer } = await loadFixture(deployWithEventFixture);

      const tx = await contract.connect(organizer).cancelEvent(1);
      await expect(tx).to.emit(contract, "EventCancelled").withArgs(1);

      const event = await contract.getEventDetails(1);
      expect(event.isCancelled).to.be.true;
      expect(event.isActive).to.be.false;
    });

    it("Should allow owner to cancel any event", async function () {
      const { contract, owner } = await loadFixture(deployWithEventFixture);

      await expect(contract.connect(owner).cancelEvent(1)).to.not.be.reverted;
    });

    it("Should reject cancellation by unauthorized user", async function () {
      const { contract, buyer1 } = await loadFixture(deployWithEventFixture);

      await expect(
        contract.connect(buyer1).cancelEvent(1)
      ).to.be.revertedWith("Not authorized");
    });

    it("Should reject double cancellation", async function () {
      const { contract, organizer } = await loadFixture(deployWithEventFixture);

      await contract.connect(organizer).cancelEvent(1);

      await expect(
        contract.connect(organizer).cancelEvent(1)
      ).to.be.revertedWith("Event already cancelled");
    });
  });

  describe("Admin Functions", function () {
    it("Should update max resale markup", async function () {
      const { contract, owner } = await loadFixture(deployVeraciTIXFixture);

      const tx = await contract.connect(owner).setMaxResaleMarkup(150);
      await expect(tx).to.emit(contract, "MaxResaleMarkupUpdated").withArgs(150);

      expect(await contract.maxResaleMarkupPercent()).to.equal(150);
    });

    it("Should reject markup below 100%", async function () {
      const { contract, owner } = await loadFixture(deployVeraciTIXFixture);

      await expect(
        contract.connect(owner).setMaxResaleMarkup(90)
      ).to.be.revertedWith("Markup must be at least 100%");
    });

    it("Should reject markup above 200%", async function () {
      const { contract, owner } = await loadFixture(deployVeraciTIXFixture);

      await expect(
        contract.connect(owner).setMaxResaleMarkup(250)
      ).to.be.revertedWith("Markup cannot exceed 100% increase");
    });

    it("Should update platform fee", async function () {
      const { contract, owner } = await loadFixture(deployVeraciTIXFixture);

      const tx = await contract.connect(owner).setPlatformFee(500); // 5%
      await expect(tx).to.emit(contract, "PlatformFeeUpdated").withArgs(500);

      expect(await contract.platformFeePercent()).to.equal(500);
    });

    it("Should reject platform fee above 10%", async function () {
      const { contract, owner } = await loadFixture(deployVeraciTIXFixture);

      await expect(
        contract.connect(owner).setPlatformFee(1100) // 11%
      ).to.be.revertedWith("Fee cannot exceed 10%");
    });

    it("Should only allow owner to update settings", async function () {
      const { contract, buyer1 } = await loadFixture(deployVeraciTIXFixture);

      await expect(
        contract.connect(buyer1).setMaxResaleMarkup(150)
      ).to.be.reverted;

      await expect(
        contract.connect(buyer1).setPlatformFee(500)
      ).to.be.reverted;
    });
  });

  describe("Ticket Transferability", function () {
    it("Should set ticket transferable status", async function () {
      const { contract, organizer, buyer1 } = await loadFixture(deployWithEventFixture);

      await contract.connect(organizer).mintTicket(buyer1.address, 1, "A-12", "ipfs://uri");
      await contract.connect(organizer).setTicketTransferable(1, false);

      const metadata = await contract.getTicketMetadata(1);
      expect(metadata.isTransferable).to.be.false;
    });

    it("Should reject transfer of non-transferable ticket", async function () {
      const { contract, organizer, buyer1, buyer2 } = await loadFixture(deployWithEventFixture);

      await contract.connect(organizer).mintTicket(buyer1.address, 1, "A-12", "ipfs://uri");
      await contract.connect(organizer).setTicketTransferable(1, false);

      const resalePrice = ethers.parseEther("0.12");
      await expect(
        contract.connect(buyer2).transferTicketWithPrice(
          buyer1.address,
          buyer2.address,
          1,
          resalePrice,
          { value: resalePrice }
        )
      ).to.be.revertedWith("Ticket is not transferable");
    });
  });
});
```
