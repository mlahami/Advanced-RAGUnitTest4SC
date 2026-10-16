# event-chain-contract--sergio11

- domain: ticketing-events (ticketing-events)
- level: moderate
- origin: human
- convention: hardhat2-ethers6
- source: https://github.com/sergio11/eventchain_blockchain @ 69ba748ab14665390356ba4bce827eb65b3d14c5
- license: MIT
- targets: EventChainContract.sol, IEventChainContract.sol
- validation: 13 passing tests, 0 failing; statement coverage EventChainContract.sol 96.77 %, IEventChainContract.sol 100.0 %

## Contract: EventChainContract.sol (primary target)

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

## Tests: EventChainContract.js

```javascript
const { expect } = require("chai");

describe("EventChainContract", function () {

  async function deployContractFixture() {
    const [owner, addr1, addr2, addr3] = await ethers.getSigners()
    // Get the ContractFactory and Signers here.
    const ContractFactory = await ethers.getContractFactory("EventChainContract")
    const instance = await ContractFactory.deploy(owner.address)
    return { ContractFactory, instance, owner, addr1, addr2, addr3 }
  }

  // Test to verify that the contract owner is set correctly
  it("Should set the right owner", async function () {
    const { instance, owner } = await deployContractFixture();
    expect(await instance.owner()).to.equal(owner.address);
  });

  // Test to verify minting a ticket and checking ownership history
  it("Should mint a ticket", async function () {
    const { instance, owner, addr1 } = await deployContractFixture();
    await expect(instance.safeMint(addr1.address, "uri", "eventDetails", 100, 1893456000))
      .to.emit(instance, 'TicketMinted')
      .withArgs(0, addr1.address, "eventDetails", 100, 1893456000);

    const history = await instance.getTicketHistory(0);
    expect(history).to.deep.equal([addr1.address]);
  });

  // Test to verify validating a ticket
  it("Should validate a ticket", async function () {
    const { instance, owner, addr1 } = await deployContractFixture();
    await instance.safeMint(addr1.address, "uri", "eventDetails", 100, 1893456000);
    await expect(instance.validateTicket(0))
      .to.emit(instance, 'TicketValidated')
      .withArgs(0, owner.address);

    const status = await instance.getTicketStatus(0);
    expect(status[0]).to.be.true;  // isUsed
  });

  // Test to verify validation of an already used ticket fails
  it("Should fail to validate an already used ticket", async function () {
    const { instance, owner, addr1 } = await deployContractFixture();
    await instance.safeMint(addr1.address, "uri", "eventDetails", 100, 1893456000);
    await instance.validateTicket(0);
    let errorMessage = null;
    try {
      await instance.validateTicket(0);
    } catch (error) {
      errorMessage = error.message;
    }
    expect(errorMessage).to.contain("Ticket already used");
  });

  // Test to verify validation of an expired ticket fails
  it("Should fail to validate an expired ticket", async function () {
    const { instance, addr1 } = await deployContractFixture();
    await instance.safeMint(addr1.address, "uri", "eventDetails", 100, 0); // expired ticket
    let errorMessage = null;
    try {
      await instance.validateTicket(0);
    } catch (error) {
      errorMessage = error.message;
    }
    expect(errorMessage).to.contain("Ticket has expired");
  });

  // Test to verify updating ticket metadata
  it("Should update ticket metadata", async function () {
    const { instance, owner, addr1 } = await deployContractFixture();
    await instance.safeMint(addr1.address, "uri", "eventDetails", 100, 1893456000);
    await expect(instance.updateTicketMetadata(0, "newEventDetails", "newURI"))
      .to.emit(instance, 'TicketMetadataUpdated')
      .withArgs(0, "newEventDetails", "newURI");

    const tokenURI = await instance.tokenURI(0);
    expect(tokenURI).to.equal("newURI");
  });

  // Test to verify that non-owner cannot update ticket metadata
  it("Should not allow non-owner to update ticket metadata", async function () {
    const { instance, addr1, addr2 } = await deployContractFixture();
    await instance.safeMint(addr1.address, "uri", "eventDetails", 100, 1893456000);
    let errorMessage = null;
    try {
      await instance.connect(addr2).updateTicketMetadata(0, "newEventDetails", "newURI");
    } catch (error) {
      errorMessage = error.message;
    }
    expect(errorMessage).to.contain("OwnableUnauthorizedAccount");
  });

  // Test to verify setting max resale price
  it("Should set max resale price", async function () {
    const { instance, owner, addr1 } = await deployContractFixture();
    await instance.safeMint(addr1.address, "uri", "eventDetails", 100, 1893456000);
    await expect(instance.setMaxResalePrice(0, 200))
      .to.emit(instance, 'TicketMaxResalePriceSet')
      .withArgs(0, 200);

    const maxPrice = await instance.maxResalePrice(0);
    expect(maxPrice).to.equal(200);
  });

  // Test to verify that non-owner cannot set max resale price
  it("Should not allow non-owner to set max resale price", async function () {
    const { instance, addr1, addr2 } = await deployContractFixture();
    await instance.safeMint(addr1.address, "uri", "eventDetails", 100, 1893456000);
    let errorMessage = null;
    try {
      await instance.connect(addr2).setMaxResalePrice(0, 200);
    } catch (error) {
      errorMessage = error.message;
    }
    expect(errorMessage).to.contain("OwnableUnauthorizedAccount");
  });

  // Test to verify burning expired tickets
  it("Should burn expired tickets", async function () {
    const { instance, owner, addr1 } = await deployContractFixture();
    await instance.safeMint(addr1.address, "uri", "eventDetails", 100, 0); // expired ticket
    await expect(instance.burnExpiredTickets(0))
      .to.emit(instance, 'TicketExpired')
      .withArgs(0);
    let errorMessage = null;
    try {
      await instance.ownerOf(0);
    } catch (error) {
      errorMessage = error.message;
    }
    expect(errorMessage).to.contain("ERC721NonexistentToken(0)");
  });

  // Test to verify that valid tickets cannot be burned
  it("Should not allow burning of valid tickets", async function () {
    const { instance, addr1 } = await deployContractFixture();
    await instance.safeMint(addr1.address, "uri", "eventDetails", 100, 1893456000); // valid ticket
    let errorMessage = null;
    try {
      await instance.burnExpiredTickets(0);
    } catch (error) {
      errorMessage = error.message;
    }
    expect(errorMessage).to.contain("Ticket is still valid");
  });

  // Test to verify transfer of ticket with history update
  it("Should transfer ticket with history update", async function () {
    const { instance, owner, addr1, addr2 } = await deployContractFixture();
    await instance.safeMint(addr1.address, "uri", "eventDetails", 100, 1893456000);
    await instance.transferWithHistoryUpdate(addr1.address, addr2.address, 0);

    const history = await instance.getTicketHistory(0);
    expect(history).to.deep.equal([addr1.address, addr2.address]);

    expect(await instance.ownerOf(0)).to.equal(addr2.address);
  });

  // Test to verify that non-owner cannot transfer ticket
  it("Should not allow non-owner to transfer ticket", async function () {
    const { instance, addr1, addr2, addr3 } = await deployContractFixture();
    await instance.safeMint(addr1.address, "uri", "eventDetails", 100, 1893456000);
    let errorMessage = null;
    try {
      await instance.connect(addr2).transferWithHistoryUpdate(addr1.address, addr3.address, 0);
    } catch (error) {
      errorMessage = error.message;
    }
    expect(errorMessage).to.contain("OwnableUnauthorizedAccount");
  });
});
```
