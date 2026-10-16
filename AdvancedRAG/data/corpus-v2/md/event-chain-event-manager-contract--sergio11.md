# event-chain-event-manager-contract--sergio11

- domain: ticketing-events (ticketing-events)
- level: moderate
- origin: human
- convention: hardhat2-ethers6
- source: https://github.com/sergio11/eventchain_blockchain @ 69ba748ab14665390356ba4bce827eb65b3d14c5
- license: MIT
- targets: EventChainEventManagerContract.sol, EventChainContract.sol, IEventChainContract.sol, IEventChainEventManagerContract.sol
- validation: 9 passing tests, 0 failing; statement coverage EventChainEventManagerContract.sol 100.0 %, EventChainContract.sol 25.81 %, IEventChainContract.sol 100.0 %, IEventChainEventManagerContract.sol 100.0 %

## Contract: EventChainContract.sol (dependency)

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.9;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/token/ERC721/extensions/ERC721Burnable.sol";
import "@openzeppelin/contracts/token/ERC721/extensions/ERC721URIStorage.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "./IEventChainContract.sol";

/**
 * @title EventChainContract
 * @dev A contract to manage event tickets as non-fungible tokens (NFTs) using the ERC721 standard.
 *      This contract allows for minting, transferring, and validating event tickets, and provides
 *      mechanisms to track ownership history and set maximum resale prices.
 */
contract EventChainContract is ERC721, ERC721URIStorage, ERC721Burnable, Ownable, IEventChainContract {

    uint256 private _tokenIdCounter;

    struct Ticket {
        string eventDetails;
        uint256 originalPrice;
        uint256 expirationDate;
        address[] ownershipHistory;
        bool isUsed;
    }

    mapping(uint256 => Ticket) private tickets;  // Mapping from token ID to ticket details
    mapping(uint256 => uint256) public maxResalePrice;  // Mapping from token ID to maximum resale price

    /**
     * @dev Initializes the contract by setting a `initialOwner` and token name and symbol.
     * @param initialOwner The address of the initial owner of the contract.
     */
    constructor(address initialOwner)
        ERC721("EventChainTickets", "ECT")
        Ownable(initialOwner)
    {}

    /**
     * @dev Safely mints a new ticket and assigns it to `to`.
     * @param to The address of the recipient.
     * @param uri The URI of the ticket metadata.
     * @param eventDetails The details of the event.
     * @param originalPrice The original price of the ticket.
     * @param expirationDate The expiration date of the ticket.
     */
    function safeMint(address to, string memory uri, string memory eventDetails, uint256 originalPrice, uint256 expirationDate) public override {
        uint256 tokenId = _tokenIdCounter;
        _tokenIdCounter += 1;
        _safeMint(to, tokenId);
        _setTokenURI(tokenId, uri);
        address[] memory emptyHistory = new address[](0);
        tickets[tokenId] = Ticket({
            eventDetails: eventDetails,
            originalPrice: originalPrice,
            expirationDate: expirationDate,
            ownershipHistory: emptyHistory,
            isUsed: false
        });

        tickets[tokenId].ownershipHistory.push(to);

        emit TicketMinted(tokenId, to, eventDetails, originalPrice, expirationDate);
    }

    /**
     * @dev Validates the ticket by marking it as used.
     * @param tokenId The ID of the ticket to be validated.
     */
    function validateTicket(uint256 tokenId) public override {
        _requireOwned(tokenId);
        require(!tickets[tokenId].isUsed, "Ticket already used");
        require(_isTicketValid(tokenId), "Ticket has expired");
        tickets[tokenId].isUsed = true;
        emit TicketValidated(tokenId, msg.sender);
    }

    /**
     * @dev Returns the ownership history of a ticket.
     * @param tokenId The ID of the ticket.
     * @return An array of addresses representing the ownership history.
     */
    function getTicketHistory(uint256 tokenId) public view override returns (address[] memory) {
        _requireOwned(tokenId);
        return tickets[tokenId].ownershipHistory;
    }

    /**
     * @dev Returns the status of a ticket.
     * @param tokenId The ID of the ticket.
     * @return isUsed Whether the ticket has been used.
     * @return isValid Whether the ticket is still valid.
     */
    function getTicketStatus(uint256 tokenId) public view override returns (bool isUsed, bool isValid) {
        _requireOwned(tokenId);
        isUsed = tickets[tokenId].isUsed;
        isValid = _isTicketValid(tokenId);
    }

    /**
     * @dev Updates the metadata of a ticket.
     * @param tokenId The ID of the ticket to be updated.
     * @param newEventDetails The new event details.
     * @param newURI The new metadata URI.
     */
    function updateTicketMetadata(uint256 tokenId, string memory newEventDetails, string memory newURI) public override onlyOwner {
        _requireOwned(tokenId);
        tickets[tokenId].eventDetails = newEventDetails;
        _setTokenURI(tokenId, newURI);
        emit TicketMetadataUpdated(tokenId, newEventDetails, newURI);
    }

    /**
     * @dev Sets the maximum resale price for a ticket.
     * @param tokenId The ID of the ticket.
     * @param maxPrice The maximum resale price.
     */
    function setMaxResalePrice(uint256 tokenId, uint256 maxPrice) public override onlyOwner {
        _requireOwned(tokenId);
        maxResalePrice[tokenId] = maxPrice;
        emit TicketMaxResalePriceSet(tokenId, maxPrice);
    }

    /**
     * @dev Burns tickets that have expired.
     * @param tokenId The ID of the ticket to be burned.
     */
    function burnExpiredTickets(uint256 tokenId) public override onlyOwner {
        _requireOwned(tokenId);
        require(!_isTicketValid(tokenId), "Ticket is still valid");
        _burn(tokenId);
        emit TicketExpired(tokenId);
    }

    /**
     * @dev Transfers a ticket and updates its ownership history.
     * @param from The address transferring the ticket.
     * @param to The address receiving the ticket.
     * @param tokenId The ID of the ticket to be transferred.
     */
    function transferWithHistoryUpdate(address from, address to, uint256 tokenId) public override onlyOwner {
         _requireOwned(tokenId);
        require(from != address(0) && to != address(0), "Invalid address");
        require(from == ownerOf(tokenId), "Not the token owner");

        tickets[tokenId].ownershipHistory.push(to);
        _transfer(from, to, tokenId);
        emit TicketTransferred(tokenId, from, to);
    }

    /**
     * @dev Internal function to check if a ticket is still valid.
     * @param tokenId The ID of the ticket.
     * @return True if the ticket is valid, false otherwise.
     */
    function _isTicketValid(uint256 tokenId) internal view returns (bool) {
        return (block.timestamp <= tickets[tokenId].expirationDate && !tickets[tokenId].isUsed);
    }

    // The following functions are overrides required by Solidity.

    /**
     * @dev Returns the token URI of a ticket.
     * @param tokenId The ID of the ticket.
     * @return The token URI.
     */
    function tokenURI(uint256 tokenId)
        public
        view
        override(ERC721, ERC721URIStorage)
        returns (string memory)
    {
        return super.tokenURI(tokenId);
    }

    /**
     * @dev Checks if the contract supports a specific interface.
     * @param interfaceId The interface ID.
     * @return True if the interface is supported, false otherwise.
     */
    function supportsInterface(bytes4 interfaceId)
        public
        view
        override(ERC721, ERC721URIStorage)
        returns (bool)
    {
        return super.supportsInterface(interfaceId);
    }
}
```

## Contract: EventChainEventManagerContract.sol (primary target)

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.9;

import "./IEventChainContract.sol";
import "./IEventChainEventManagerContract.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title EventChainEventManagerContract
 * @dev This contract manages the creation and organization of events. It allows event organizers
 *      to create events, mint tickets, and transfer event ownership. The contract is owned by an 
 *      owner who can set the address of the associated EventChainContract.
 */
contract EventChainEventManagerContract is Ownable, IEventChainEventManagerContract {

    uint256 private _eventIdCounter; // Counter to keep track of event IDs

    mapping(uint256 => Event) private events; // Mapping from event ID to event details
    address _eventChainContractAddress; // Address of the associated EventChainContract

    /**
     * @dev Initializes the contract by setting a `initialOwner`.
     * @param initialOwner The address of the initial owner of the contract.
     */
    constructor(address initialOwner, address eventChainContractAddress)
        Ownable(initialOwner)
    {
        _eventChainContractAddress = eventChainContractAddress;
    }

    /**
     * @dev Sets the address of the EventChainContract.
     * @param eventChainContractAddress The address of the EventChainContract.
     */
    function setEventChainAddress(address eventChainContractAddress) external onlyOwner() {
        _eventChainContractAddress = eventChainContractAddress;
    }

    /**
     * @dev Creates a new event.
     * @param name The name of the event.
     * @param location The location of the event.
     * @param date The date of the event.
     * @param ticketPrice The price of a ticket for the event.
     */
    function createEvent(string memory name, string memory location, string memory date, uint256 ticketPrice) public override {
        uint256 eventId = _eventIdCounter;
        _eventIdCounter += 1;
        events[eventId] = Event({
            name: name,
            location: location,
            date: date,
            ticketPrice: ticketPrice,
            organizer: msg.sender
        });
       
        emit EventCreated(eventId, name, location, date, ticketPrice, msg.sender);
    }

    /**
     * @dev Returns the details of an event.
     * @param eventId The ID of the event.
     * @return The event details.
     */
    function getEventDetails(uint256 eventId) public view override returns (Event memory) {
        require(eventId < _eventIdCounter, "Event does not exist");
        return events[eventId];
    }

    /**
     * @dev Mints a ticket for an event.
     * @param eventId The ID of the event.
     * @param to The address of the recipient.
     * @param uri The URI of the ticket metadata.
     */
    function mintTicket(uint256 eventId, address to, string memory uri) public override {
        require(eventId < _eventIdCounter, "Event does not exist");
        require(events[eventId].organizer == msg.sender, "Only the event organizer can mint tickets");
        require(_eventChainContractAddress != address(0), "Event chain contract address is not set");
        require(address(this).balance == 0, "Cannot mint ticket with pending transactions");

        IEventChainContract eventChainContract = IEventChainContract(_eventChainContractAddress);
        eventChainContract.safeMint(to, uri, events[eventId].name, events[eventId].ticketPrice, block.timestamp + 1 weeks); // Ticket expires in 1 week
    }

    /**
     * @dev Transfers the ownership of an event.
     * @param eventId The ID of the event.
     * @param to The address of the new owner.
     */
    function transferEvent(uint256 eventId, address to) external onlyOwner {
        Event storage currentEvent = events[eventId];
        require(currentEvent.organizer == msg.sender, "Only the event organizer can transfer the event");

        currentEvent.organizer = to;
        emit EventTransferred(eventId, msg.sender, to);
    }
}
```

## Contract: IEventChainContract.sol (dependency)

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.9;

/**
 * @title IEventChainContract
 * @dev Interface for EventChainContract that manages ticket minting, validation, metadata updates,
 * maximum resale price settings, and burning expired tickets.
 */
interface IEventChainContract {

    /**
     * @dev Mints a new ticket and assigns it to the specified address.
     * @param to The address to which the ticket will be minted.
     * @param uri The URI for the ticket metadata.
     * @param eventDetails Details of the event associated with the ticket.
     * @param originalPrice The original price of the ticket.
     * @param expirationDate The expiration date of the ticket.
     */
    function safeMint(address to, string memory uri, string memory eventDetails, uint256 originalPrice, uint256 expirationDate) external;

    /**
     * @dev Validates a ticket, marking it as used.
     * @param tokenId The ID of the ticket to validate.
     */
    function validateTicket(uint256 tokenId) external;

    /**
     * @dev Retrieves the ownership history of a ticket.
     * @param tokenId The ID of the ticket to query.
     * @return An array of addresses representing the ownership history of the ticket.
     */
    function getTicketHistory(uint256 tokenId) external view returns (address[] memory);

    /**
     * @dev Retrieves the status of a ticket, indicating whether it has been used and if it is still valid.
     * @param tokenId The ID of the ticket to query.
     * @return isUsed A boolean indicating whether the ticket has been used.
     * @return isValid A boolean indicating whether the ticket is still valid.
     */
    function getTicketStatus(uint256 tokenId) external view returns (bool isUsed, bool isValid);

    /**
     * @dev Updates the metadata of a ticket.
     * @param tokenId The ID of the ticket to update.
     * @param newEventDetails The updated details of the event associated with the ticket.
     * @param newURI The updated URI for the ticket metadata.
     */
    function updateTicketMetadata(uint256 tokenId, string memory newEventDetails, string memory newURI) external;

    /**
     * @dev Sets the maximum resale price for a ticket.
     * @param tokenId The ID of the ticket for which to set the maximum resale price.
     * @param maxPrice The maximum resale price to set.
     */
    function setMaxResalePrice(uint256 tokenId, uint256 maxPrice) external;

    /**
     * @dev Burns an expired ticket, removing it from circulation.
     * @param tokenId The ID of the ticket to burn.
     */
    function burnExpiredTickets(uint256 tokenId) external;

    /**
     * @dev Transfers a ticket from one address to another without updating ownership history.
     * @param from The address from which the ticket is transferred.
     * @param to The address to which the ticket is transferred.
     * @param tokenId The ID of the ticket to transfer.
     */
    function transferWithHistoryUpdate(address from, address to, uint256 tokenId) external;

    /**
     * @dev Emitted when a ticket is minted.
     * @param tokenId The ID of the minted ticket.
     * @param owner The address to which the ticket is minted.
     * @param eventDetails Details of the event associated with the ticket.
     * @param originalPrice The original price of the ticket.
     * @param expirationDate The expiration date of the ticket.
     */
    event TicketMinted(uint256 indexed tokenId, address indexed owner, string eventDetails, uint256 originalPrice, uint256 expirationDate);

    /**
     * @dev Emitted when a ticket is transferred from one address to another.
     * @param tokenId The ID of the transferred ticket.
     * @param from The address from which the ticket is transferred.
     * @param to The address to which the ticket is transferred.
     */
    event TicketTransferred(uint256 indexed tokenId, address indexed from, address indexed to);

    /**
     * @dev Emitted when a ticket is validated.
     * @param tokenId The ID of the validated ticket.
     * @param validator The address of the entity that validates the ticket.
     */
    event TicketValidated(uint256 indexed tokenId, address indexed validator);

    /**
     * @dev Emitted when a ticket expires and is burned.
     * @param tokenId The ID of the expired ticket.
     */
    event TicketExpired(uint256 indexed tokenId);

    /**
     * @dev Emitted when the metadata of a ticket is updated.
     * @param tokenId The ID of the ticket whose metadata is updated.
     * @param newEventDetails The updated details of the event associated with the ticket.
     * @param newURI The updated URI for the ticket metadata.
     */
    event TicketMetadataUpdated(uint256 indexed tokenId, string newEventDetails, string newURI);

    /**
     * @dev Emitted when the maximum resale price of a ticket is set.
     * @param tokenId The ID of the ticket for which the maximum resale price is set.
     * @param maxPrice The maximum resale price that is set.
     */
    event TicketMaxResalePriceSet(uint256 indexed tokenId, uint256 maxPrice);
}
```

## Contract: IEventChainEventManagerContract.sol (dependency)

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.9;

/**
 * @title IEventChainEventManagerContract
 * @dev Interface for EventChainEventManagerContract that manages event creation, ticket minting, and event transfer.
 */
interface IEventChainEventManagerContract {

    /**
     * @dev Creates a new event with the specified details.
     * @param name The name of the event.
     * @param location The location of the event.
     * @param date The date of the event.
     * @param ticketPrice The price of the tickets for the event.
     */
    function createEvent(string memory name, string memory location, string memory date, uint256 ticketPrice) external;

    /**
     * @dev Retrieves the details of a specific event.
     * @param eventId The ID of the event to query.
     * @return An Event struct containing the details of the event.
     */
    function getEventDetails(uint256 eventId) external view returns (Event memory);

    /**
     * @dev Mints a ticket for the specified event and assigns it to the specified address.
     * @param eventId The ID of the event for which to mint the ticket.
     * @param to The address to which the ticket will be minted.
     * @param uri The URI for the ticket metadata.
     */
    function mintTicket(uint256 eventId, address to, string memory uri) external;

    /**
     * @dev Transfers ownership of an event to another organizer.
     * @param eventId The ID of the event to transfer.
     * @param to The address of the new organizer.
     */
    function transferEvent(uint256 eventId, address to) external;

    /**
     * @dev Emitted when a new event is created.
     * @param eventId The ID of the created event.
     * @param name The name of the event.
     * @param location The location of the event.
     * @param date The date of the event.
     * @param ticketPrice The price of the tickets for the event.
     * @param organizer The address of the organizer of the event.
     */
    event EventCreated(uint256 indexed eventId, string name, string location, string date, uint256 ticketPrice, address organizer);

    /**
     * @dev Emitted when an event is transferred to a new organizer.
     * @param eventId The ID of the transferred event.
     * @param fromOrganizer The address of the previous organizer.
     * @param toOrganizer The address of the new organizer.
     */
    event EventTransferred(uint256 indexed eventId, address indexed fromOrganizer, address indexed toOrganizer);


    struct Event {
        string name;
        string location;
        string date;
        uint256 ticketPrice;
        address organizer;
    }
}
```

## Tests: EventChainEventManagerContract.js

```javascript
const { expect } = require("chai");

describe("EventChainEventManagerContract", function () {

  async function deployContractFixture() {
    const [owner, addr1, addr2, addr3] = await ethers.getSigners()
    // Get the ContractFactory and Signers here.
    const eventChainContractFactory = await ethers.getContractFactory("EventChainContract")
    const eventChainContract = await eventChainContractFactory.deploy(owner.address)
    const ContractFactory = await ethers.getContractFactory("EventChainEventManagerContract")
    const instance = await ContractFactory.deploy(owner.address, eventChainContract)
    return { ContractFactory, instance, eventChainContract,  owner, addr1, addr2, addr3 }
  }

 // Test to verify that the contract owner is set correctly
  it("Should set the right owner", async function () {
    const { instance, owner } = await deployContractFixture()
    expect(await instance.owner()).to.equal(owner.address)
  });

  it("Should set the event chain address", async function () {
    const { instance, owner, eventChainContract } = await deployContractFixture()
    expect(instance._eventChainContractAddress).to.equal(eventChainContract.address)
  });

  // Test to verify creating an event
  it("Should create an event", async function () {
    const { instance, owner, addr1 } = await deployContractFixture()
    await instance.createEvent("Event Name", "Location", "2024-12-31", 10)
    const event = await instance.getEventDetails(0)
    expect(event.name).to.equal("Event Name")
    expect(event.location).to.equal("Location")
    expect(event.date).to.equal("2024-12-31")
    expect(event.ticketPrice).to.equal(10)
    expect(event.organizer).to.equal(owner.address)
  });

  // Test to verify minting a ticket
  it("Should mint a ticket", async function () {
    const { instance, owner, addr1, eventChainContract } = await deployContractFixture()
    await instance.createEvent("Event Name", "Location", "2024-12-31", 20)
    await instance.mintTicket(0, addr1.address, "URI")
    const ticketStatus = await eventChainContract.getTicketStatus(0)
    expect(ticketStatus.isUsed).to.be.false
    expect(ticketStatus.isValid).to.be.true
  });

  // Test to verify transferring an event
  it("Should transfer an event", async function () {
    const { instance, owner, addr1, addr2 } = await deployContractFixture()
    await instance.createEvent("Event Name", "Location", "2024-12-31", 10)
    await instance.transferEvent(0, addr1.address)
    const event = await instance.getEventDetails(0)
    expect(event.organizer).to.equal(addr1.address)
  });

  // Test to verify that non-owner cannot transfer an event
  it("Should not allow non-owner to transfer an event", async function () {
    const { instance, owner, addr1, addr2, addr3 } = await deployContractFixture()
    await instance.createEvent("Event Name", "Location", "2024-12-31", 10)
    let errorMessage = null;
    try {
      await instance.connect(addr2).transferEvent(0, addr1.address);
    } catch (error) {
      errorMessage = error.message;
    }
    expect(errorMessage).to.contain("OwnableUnauthorizedAccount");
    const event = await instance.getEventDetails(0)
    expect(event.organizer).to.equal(owner.address)
  });

  // Test to verify that minting a ticket for non-existent event fails
  it("Should not allow minting a ticket for non-existent event", async function () {
    const { instance, owner, addr1 } = await deployContractFixture()
    await expect(instance.mintTicket(0, addr1.address, "URI")).to.be.revertedWith("Event does not exist")
  });

  // Test to verify that minting a ticket by non-organizer fails
  it("Should not allow minting a ticket by non-organizer", async function () {
    const { instance, owner, addr1, addr2 } = await deployContractFixture()
    await instance.createEvent("Event Name", "Location", "2024-12-31", 10)
    await expect(instance.connect(addr2).mintTicket(0, addr1.address, "URI")).to.be.revertedWith("Only the event organizer can mint tickets")
  });

  // Test to verify that accessing non-existent event details fails
  it("Should not allow accessing non-existent event details", async function () {
    const { instance, owner, addr1 } = await deployContractFixture()
    await expect(instance.getEventDetails(0)).to.be.revertedWith("Event does not exist")
  });
});
```
