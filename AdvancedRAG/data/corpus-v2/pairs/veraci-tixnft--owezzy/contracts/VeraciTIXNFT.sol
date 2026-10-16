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
