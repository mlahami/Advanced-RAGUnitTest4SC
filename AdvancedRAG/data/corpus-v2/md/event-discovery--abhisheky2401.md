# event-discovery--abhisheky2401

- domain: ticketing-events (ticketing-events)
- level: complex
- origin: human
- convention: hardhat2-ethers6
- source: https://github.com/abhishekY2401/event-dapp-backend @ 8cae2ab28a6c561828dd4e3cb12eb55df2a0cfeb
- license: MIT
- targets: EventDiscovery.sol, EventCore.sol, EventFactory.sol, TicketManager.sol
- validation: 14 passing tests, 0 failing; statement coverage EventDiscovery.sol 100.0 %, EventCore.sol 33.33 %, EventFactory.sol 100.0 %, TicketManager.sol 0.0 %

## Contract: EventCore.sol (dependency)

```solidity
// SPDX-License-Identifier: Unlicense
pragma solidity ^0.8.18;

import "./TicketManager.sol";

/**
 * @title EventCore
 * @dev Core contract containing event details and ownership
 */
contract EventCore {
    // Event details
    address payable public organizer;
    string public name;
    uint public date;
    uint public price;
    uint public ticketCount;
    uint public ticketRemain;

    // Ticket management contract
    TicketManager public ticketManager;

    // Events
    event TicketsManaged(address ticketManager);
    event PaymentReceived(address from, uint amount);
    event PaymentForwarded(address to, uint amount);

    /**
     * @dev Constructor for creating a new event
     * @param _organizer Address of the event organizer
     * @param _name Name of the event
     * @param _date Date of the event (unix timestamp)
     * @param _price Price of each ticket in wei
     * @param _ticketCount Total number of tickets available
     */
    constructor(
        address _organizer,
        string memory _name,
        uint _date,
        uint _price,
        uint _ticketCount
    ) {
        organizer = payable(_organizer);
        name = _name;
        date = _date;
        price = _price;
        ticketCount = _ticketCount;
        ticketRemain = _ticketCount;

        // Create a new ticket manager for this event
        ticketManager = new TicketManager(address(this));
        emit TicketsManaged(address(ticketManager));
    }

    /**
     * @dev Modifier to check if sender is the organizer
     */
    modifier onlyOrganizer() {
        require(
            msg.sender == organizer,
            "Only the organizer can call this function"
        );
        _;
    }

    /**
     * @dev Updates the number of remaining tickets
     * @param quantity The number of tickets to decrease
     * @return success Whether the update was successful
     */
    function decreaseTicketRemain(
        uint quantity
    ) external returns (bool success) {
        require(
            msg.sender == address(ticketManager),
            "Only ticket manager can update ticket count"
        );
        require(ticketRemain >= quantity, "Not enough tickets available");

        ticketRemain -= quantity;
        return true;
    }

    /**
     * @dev Gets event details
     * @return _organizer Address of the event organizer
     * @return _name Name of the event
     * @return _date Date of the event
     * @return _price Price of each ticket
     * @return _ticketCount Total number of tickets
     * @return _ticketRemain Number of remaining tickets
     */
    function getEventDetails()
        external
        view
        returns (
            address _organizer,
            string memory _name,
            uint _date,
            uint _price,
            uint _ticketCount,
            uint _ticketRemain
        )
    {
        return (organizer, name, date, price, ticketCount, ticketRemain);
    }

    /**
     * @dev Function to receive Ether
     */
    receive() external payable {
        emit PaymentReceived(msg.sender, msg.value);
        // Forward payment to organizer
        (bool sent, ) = organizer.call{value: msg.value}("");
        require(sent, "Failed to forward payment to organizer");
        emit PaymentForwarded(organizer, msg.value);
    }
}
```

## Contract: EventDiscovery.sol (primary target)

```solidity
// SPDX-License-Identifier: Unlicense
pragma solidity ^0.8.18;

import "./EventFactory.sol";
import "./EventCore.sol";

/**
 * @title EventDiscovery
 * @dev Contract for users to discover and filter events
 */
contract EventDiscovery {
    // Reference to the EventFactory contract
    EventFactory public eventFactory;

    // Event categories
    enum Category {
        Music,
        Sports,
        Arts,
        Technology,
        Business,
        Other
    }

    // Event metadata
    struct EventMetadata {
        uint eventId;
        Category category;
        string location;
        string description;
        string imageHash; // IPFS hash for event image
        uint createdAt;
        bool isFeatured;
        uint popularity; // Simple popularity metric (can be updated)
    }

    // Mapping from event ID to its metadata
    mapping(uint => EventMetadata) public eventMetadata;

    // Featured events
    uint[] public featuredEvents;

    // Events by category
    mapping(uint => uint[]) public eventsByCategory;

    // Events
    event EventMetadataAdded(uint indexed eventId, Category category);
    event EventFeatured(uint indexed eventId);
    event EventUnfeatured(uint indexed eventId);
    event EventPopularityUpdated(uint indexed eventId, uint newPopularity);

    /**
     * @dev Constructor to initialize the EventDiscovery with EventFactory
     * @param _eventFactoryAddress Address of the EventFactory contract
     */
    constructor(address _eventFactoryAddress) {
        eventFactory = EventFactory(_eventFactoryAddress);
    }

    /**
     * @dev Add metadata for an event
     * @param eventId ID of the event
     * @param category Event category
     * @param location Event location
     * @param description Event description
     * @param imageHash IPFS hash for event image
     */
    function addEventMetadata(
        uint eventId,
        Category category,
        string memory location,
        string memory description,
        string memory imageHash
    ) external {
        // Verify event exists
        address eventAddress = eventFactory.getEventContract(eventId);
        require(eventAddress != address(0), "Event does not exist");

        // Get event details to verify organizer
        EventCore eventCore = EventCore(payable(eventAddress));
        (address organizer, , , , , ) = eventCore.getEventDetails();

        // Only organizer can add metadata
        require(msg.sender == organizer, "Only the organizer can add metadata");

        // Create metadata
        eventMetadata[eventId] = EventMetadata({
            eventId: eventId,
            category: category,
            location: location,
            description: description,
            imageHash: imageHash,
            createdAt: block.timestamp,
            isFeatured: false,
            popularity: 0
        });

        // Add to category mapping
        eventsByCategory[uint(category)].push(eventId);

        emit EventMetadataAdded(eventId, category);
    }

    /**
     * @dev Feature an event (only owner can call)
     * @param eventId ID of the event to feature
     */
    function featureEvent(uint eventId) external {
        // Verify event exists
        address eventAddress = eventFactory.getEventContract(eventId);
        require(eventAddress != address(0), "Event does not exist");

        // Verify metadata exists
        require(
            eventMetadata[eventId].eventId == eventId,
            "Event metadata does not exist"
        );

        // Get event details to verify organizer
        EventCore eventCore = EventCore(payable(eventAddress));
        (address organizer, , , , , ) = eventCore.getEventDetails();

        // Only organizer can feature their event
        require(
            msg.sender == organizer,
            "Only the organizer can feature this event"
        );

        // Mark as featured if not already
        if (!eventMetadata[eventId].isFeatured) {
            eventMetadata[eventId].isFeatured = true;
            featuredEvents.push(eventId);
            emit EventFeatured(eventId);
        }
    }

    /**
     * @dev Unfeature an event
     * @param eventId ID of the event to unfeature
     */
    function unfeatureEvent(uint eventId) external {
        // Verify event exists
        address eventAddress = eventFactory.getEventContract(eventId);
        require(eventAddress != address(0), "Event does not exist");

        // Get event details to verify organizer
        EventCore eventCore = EventCore(payable(eventAddress));
        (address organizer, , , , , ) = eventCore.getEventDetails();

        // Only organizer can unfeature their event
        require(
            msg.sender == organizer,
            "Only the organizer can unfeature this event"
        );

        // Mark as not featured if currently featured
        if (eventMetadata[eventId].isFeatured) {
            eventMetadata[eventId].isFeatured = false;

            // Remove from featured events array
            for (uint i = 0; i < featuredEvents.length; i++) {
                if (featuredEvents[i] == eventId) {
                    featuredEvents[i] = featuredEvents[
                        featuredEvents.length - 1
                    ];
                    featuredEvents.pop();
                    break;
                }
            }

            emit EventUnfeatured(eventId);
        }
    }

    /**
     * @dev Update event popularity (internal function, called by interaction contract)
     * @param eventId ID of the event
     * @param newPopularity New popularity score
     */
    function updateEventPopularity(uint eventId, uint newPopularity) external {
        // Verify event exists
        address eventAddress = eventFactory.getEventContract(eventId);
        require(eventAddress != address(0), "Event does not exist");

        // Get event details to verify organizer
        EventCore eventCore = EventCore(payable(eventAddress));
        (address organizer, , , , , ) = eventCore.getEventDetails();

        // Only organizer can update popularity
        require(
            msg.sender == organizer,
            "Only the organizer can update popularity"
        );

        eventMetadata[eventId].popularity = newPopularity;
        emit EventPopularityUpdated(eventId, newPopularity);
    }

    /**
     * @dev Get featured events
     * @param count Maximum number of events to return
     * @return Array of featured event IDs
     */
    function getFeaturedEvents(
        uint count
    ) external view returns (uint[] memory) {
        uint resultCount = count < featuredEvents.length
            ? count
            : featuredEvents.length;
        uint[] memory result = new uint[](resultCount);

        for (uint i = 0; i < resultCount; i++) {
            result[i] = featuredEvents[i];
        }

        return result;
    }

    /**
     * @dev Get events by category
     * @param category Event category
     * @param count Maximum number of  events to return
     * @return Array of event IDs in the specified category
     */
    function getEventsByCategory(
        Category category,
        uint count
    ) external view returns (uint[] memory) {
        uint[] storage categoryEvents = eventsByCategory[uint(category)];
        uint resultCount = count < categoryEvents.length
            ? count
            : categoryEvents.length;
        uint[] memory result = new uint[](resultCount);

        for (uint i = 0; i < resultCount; i++) {
            result[i] = categoryEvents[i];
        }

        return result;
    }

    /**
     * @dev Get event metadata
     * @param eventId ID of the event
     * @return category Event category
     * @return location Event location
     * @return description Event description
     * @return imageHash IPFS hash for event image
     * @return createdAt Timestamp when metadata was created
     * @return isFeatured Whether the event is featured
     * @return popularity Event popularity score
     */
    function getEventMetadata(
        uint eventId
    )
        external
        view
        returns (
            Category category,
            string memory location,
            string memory description,
            string memory imageHash,
            uint createdAt,
            bool isFeatured,
            uint popularity
        )
    {
        EventMetadata memory metadata = eventMetadata[eventId];
        require(metadata.eventId == eventId, "Event metadata does not exist");

        return (
            metadata.category,
            metadata.location,
            metadata.description,
            metadata.imageHash,
            metadata.createdAt,
            metadata.isFeatured,
            metadata.popularity
        );
    }

    /**
     * @dev Get total number of events by category
     * @param category Event category
     * @return Count of events in the category
     */
    function getCategoryEventCount(
        Category category
    ) external view returns (uint) {
        return eventsByCategory[uint(category)].length;
    }
}
```

## Contract: EventFactory.sol (dependency)

```solidity
// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.18;

import "./EventCore.sol";

/**
 * @title EventFactory
 * @dev Contract for creating new events
 */

contract EventFactory {
    uint public nextEventId;
    address public owner;

    //mapping to tract deployed event contracts
    mapping(uint => address) public eventContracts;

    //events
    event EventCreated(
        uint indexed eventId,
        address indexed eventContract,
        address indexed organizer,
        string name
    );

    constructor() {
        owner = msg.sender;
    }

    /**
     * @dev Created a new event contract
     * @param name name of the event
     * @param date Date of the event (unix timetamp)
     * @param price Price of the event
     * @param ticketCount Total number of tickets available
     * @return eventId ID of the newly created event
     */

    function createEvent(
        string calldata name,
        uint date,
        uint price,
        uint ticketCount
    ) external returns (uint eventId) {
        require(date > block.timestamp, "Event date must be in the future");
        require(ticketCount > 0, "Ticket count must be greater than 0");

        //Create new event contract
        EventCore newEvent = new EventCore(
            msg.sender,
            name,
            date,
            price,
            ticketCount
        );

        //Store the event contract address
        eventId = nextEventId;
        eventContracts[eventId] = address(newEvent);

        //increment the event ID counter
        nextEventId++;

        //emit event
        emit EventCreated(eventId, address(newEvent), msg.sender, name);

        return eventId;
    }

    /**
     * @dev Gets an event contract address by event ID
     * @param eventId ID of the event
     * @return eventContract Address of the event contract
     */

    function getEventContract(uint eventId) external view returns (address) {
        return eventContracts[eventId];
    }
}
```

## Contract: TicketManager.sol (dependency)

```solidity
// SPDX-License-Identifier: Unlicense
pragma solidity ^0.8.18;

import "./EventCore.sol";

/**
 * @title TicketManager
 * @dev Contract for managing tickets, including buying and transferring
 */
contract TicketManager {
    // Reference to the associated event contract
    EventCore public eventCore;

    // Mapping to track ticket ownership
    mapping(address => uint) public tickets;

    // Events
    event TicketsPurchased(address indexed buyer, uint quantity);
    event TicketsTransferred(
        address indexed from,
        address indexed to,
        uint quantity,
        uint amount
    );

    /**
     * @dev Constructor to initialize the ticket manager with an event
     * @param _eventCore Address of the associated event contract
     */
    constructor(address _eventCore) {
        eventCore = EventCore(payable(_eventCore));
    }

    /**
     * @dev Allows a user to buy tickets
     * @param quantity Number of tickets to buy
     */
    function buyTicket(uint quantity) external payable {
        // Get event details
        (, , uint eventDate, uint ticketPrice, , ) = eventCore
            .getEventDetails();

        // Validate event and payment
        require(block.timestamp < eventDate, "Event has already occurred");
        require(msg.value >= ticketPrice * quantity, "Insufficient Ether sent");

        // Update ticket count in event contract
        bool success = eventCore.decreaseTicketRemain(quantity);
        require(success, "Failed to update ticket count");

        // Update buyer's ticket count
        tickets[msg.sender] += quantity;

        // Transfer payment to the event contract
        (bool sent, ) = payable(address(eventCore)).call{value: msg.value}("");
        require(sent, "Failed to send Ether");

        // Emit event
        emit TicketsPurchased(msg.sender, quantity);
    }

    /**
     * @dev Allows the current owner to transfer tickets to another address
     * @param quantity Number of tickets to transfer
     * @param to Address to transfer tickets to
     */
    function transferTicket(uint quantity, address to) external payable {
        // Get event details
        (, , uint eventDate, uint ticketPrice, , ) = eventCore.getEventDetails();

        // Validate event date and transfer
        require(block.timestamp < eventDate, "Event has already occurred");
        require(msg.sender != address(0), "Invalid sender address");
        require(to != address(0), "Cannot transfer to zero address");
        require(msg.sender != to, "Sender and recipient cannot be the same");
        require(tickets[msg.sender] >= quantity, "Insufficient tickets owned");

        // Calculate the total amount for the transfer
        uint transferAmount = ticketPrice * quantity;

        // Validate payment from recipient
        require(msg.value >= transferAmount, "Insufficient payment from recipient");

        // Transfer the payment to the event contract
        (bool sent, ) = payable(address(eventCore)).call{value: transferAmount}("");
        require(sent, "Failed to transfer payment to event contract");

        // Update ticket counts
        tickets[msg.sender] -= quantity;
        tickets[to] += quantity;

        // Emit event with payment information
        emit TicketsTransferred(msg.sender, to, quantity, msg.value);
    }

    /**
     * @dev Gets the number of tickets owned by an address
     * @param owner The address to check
     * @return The number of tickets owned
     */
    function getTicketBalance(address owner) external view returns (uint) {
        return tickets[owner];
    }
}
```

## Tests: EventDiscovery.test.js

```javascript
/**
 * @file EventDiscovery.test.js
 * @description Test suite for the EventDiscovery contract
 * Tests event metadata management, categorization, featuring, and discovery functionality
 */

const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("EventDiscovery", function () {
  // Test variables
  let eventDiscovery;
  let eventFactory;
  let eventCore;
  let owner;
  let organizer;
  let user1;
  let eventName = "Test Event";
  let eventDate;
  let ticketPrice = ethers.parseEther("0.1");
  let ticketCount = 100;

  // Setup before each test
  beforeEach(async function () {
    // Get test accounts
    [owner, organizer, user1] = await ethers.getSigners();
    
    // Set event date to 1 day from current block timestamp
    const latestBlock = await ethers.provider.getBlock('latest');
    eventDate = latestBlock.timestamp + 86400;

    // Deploy EventFactory
    const EventFactory = await ethers.getContractFactory("EventFactory");
    eventFactory = await EventFactory.deploy();
    await eventFactory.waitForDeployment();

    // Deploy EventDiscovery
    const EventDiscovery = await ethers.getContractFactory("EventDiscovery");
    eventDiscovery = await EventDiscovery.deploy(await eventFactory.getAddress());
    await eventDiscovery.waitForDeployment();

    // Create a test event
    const tx = await eventFactory.connect(organizer).createEvent(
      eventName,
      eventDate,
      ticketPrice,
      ticketCount
    );
    const receipt = await tx.wait();
    const eventContractAddress = await eventFactory.getEventContract(0);
    
    // Get EventCore instance
    const EventCore = await ethers.getContractFactory("EventCore");
    eventCore = EventCore.attach(eventContractAddress);
  });

  // Test event metadata functionality
  describe("Event Metadata", function () {
    it("Should allow adding event metadata", async function () {
      const category = 0; // Music
      const location = "New York";
      const description = "A great music event";
      const imageHash = "QmHash123";

      await eventDiscovery.connect(organizer).addEventMetadata(
        0,
        category,
        location,
        description,
        imageHash
      );

      const metadata = await eventDiscovery.getEventMetadata(0);
      expect(metadata[0]).to.equal(category);
      expect(metadata[1]).to.equal(location);
      expect(metadata[2]).to.equal(description);
      expect(metadata[3]).to.equal(imageHash);
    });

    it("Should emit EventMetadataAdded event", async function () {
      const category = 0; // Music
      const location = "New York";
      const description = "A great music event";
      const imageHash = "QmHash123";

      await expect(
        eventDiscovery.connect(organizer).addEventMetadata(
          0,
          category,
          location,
          description,
          imageHash
        )
      )
        .to.emit(eventDiscovery, "EventMetadataAdded")
        .withArgs(0, category);
    });

    it("Should not allow non-organizer to add metadata", async function () {
      const category = 0; // Music
      const location = "New York";
      const description = "A great music event";
      const imageHash = "QmHash123";

      await expect(
        eventDiscovery.connect(user1).addEventMetadata(
          0,
          category,
          location,
          description,
          imageHash
        )
      ).to.be.revertedWith("Only the organizer can add metadata");
    });
  });

  // Test event featuring functionality
  describe("Event Featuring", function () {
    beforeEach(async function () {
      // Add metadata first
      await eventDiscovery.connect(organizer).addEventMetadata(
        0,
        0, // Music
        "New York",
        "A great music event",
        "QmHash123"
      );
    });

    it("Should allow featuring an event", async function () {
      await eventDiscovery.connect(organizer).featureEvent(0);
      
      const metadata = await eventDiscovery.getEventMetadata(0);
      expect(metadata[5]).to.be.true; // isFeatured
    });

    it("Should emit EventFeatured event", async function () {
      await expect(eventDiscovery.connect(organizer).featureEvent(0))
        .to.emit(eventDiscovery, "EventFeatured")
        .withArgs(0);
    });

    it("Should allow unfeaturing an event", async function () {
      // First feature the event
      await eventDiscovery.connect(organizer).featureEvent(0);
      
      // Then unfeature it
      await eventDiscovery.connect(organizer).unfeatureEvent(0);
      
      const metadata = await eventDiscovery.getEventMetadata(0);
      expect(metadata[5]).to.be.false; // isFeatured
    });

    it("Should emit EventUnfeatured event", async function () {
      // First feature the event
      await eventDiscovery.connect(organizer).featureEvent(0);
      
      // Then unfeature it
      await expect(eventDiscovery.connect(organizer).unfeatureEvent(0))
        .to.emit(eventDiscovery, "EventUnfeatured")
        .withArgs(0);
    });

    it("Should not allow non-organizer to feature/unfeature", async function () {
      await expect(
        eventDiscovery.connect(user1).featureEvent(0)
      ).to.be.revertedWith("Only the organizer can feature this event");

      await expect(
        eventDiscovery.connect(user1).unfeatureEvent(0)
      ).to.be.revertedWith("Only the organizer can unfeature this event");
    });
  });

  // Test event discovery functionality
  describe("Event Discovery", function () {
    beforeEach(async function () {
      // Add metadata for multiple events
      await eventDiscovery.connect(organizer).addEventMetadata(
        0,
        0, // Music
        "New York",
        "A great music event",
        "QmHash123"
      );

      // Create and add metadata for a second event
      const tx = await eventFactory.connect(organizer).createEvent(
        "Sports Event",
        eventDate,
        ticketPrice,
        ticketCount
      );
      await tx.wait();

      await eventDiscovery.connect(organizer).addEventMetadata(
        1,
        1, // Sports
        "Los Angeles",
        "A great sports event",
        "QmHash456"
      );
    });

    it("Should get featured events", async function () {
      // Feature the first event
      await eventDiscovery.connect(organizer).featureEvent(0);
      
      const featuredEvents = await eventDiscovery.getFeaturedEvents(10);
      expect(featuredEvents.length).to.equal(1);
      expect(featuredEvents[0]).to.equal(0);
    });

    it("Should get events by category", async function () {
      const musicEvents = await eventDiscovery.getEventsByCategory(0, 10); // Music category
      const sportsEvents = await eventDiscovery.getEventsByCategory(1, 10); // Sports category
      
      expect(musicEvents.length).to.equal(1);
      expect(sportsEvents.length).to.equal(1);
      expect(musicEvents[0]).to.equal(0);
      expect(sportsEvents[0]).to.equal(1);
    });

    it("Should get correct category event count", async function () {
      const musicCount = await eventDiscovery.getCategoryEventCount(0); // Music category
      const sportsCount = await eventDiscovery.getCategoryEventCount(1); // Sports category
      
      expect(musicCount).to.equal(1);
      expect(sportsCount).to.equal(1);
    });
  });

  // Test event popularity functionality
  describe("Event Popularity", function () {
    beforeEach(async function () {
      // Add metadata first
      await eventDiscovery.connect(organizer).addEventMetadata(
        0,
        0, // Music
        "New York",
        "A great music event",
        "QmHash123"
      );
    });

    it("Should allow updating event popularity", async function () {
      const newPopularity = 100;
      await eventDiscovery.connect(organizer).updateEventPopularity(0, newPopularity);
      
      const metadata = await eventDiscovery.getEventMetadata(0);
      expect(metadata[6]).to.equal(newPopularity); // popularity
    });

    it("Should emit EventPopularityUpdated event", async function () {
      const newPopularity = 100;
      await expect(eventDiscovery.connect(organizer).updateEventPopularity(0, newPopularity))
        .to.emit(eventDiscovery, "EventPopularityUpdated")
        .withArgs(0, newPopularity);
    });

    it("Should not allow non-organizer to update popularity", async function () {
      await expect(
        eventDiscovery.connect(user1).updateEventPopularity(0, 100)
      ).to.be.revertedWith("Only the organizer can update popularity");
    });
  });
});
```
