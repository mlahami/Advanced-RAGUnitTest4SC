# user-ticket-hub--abhisheky2401

- domain: ticketing-events (ticketing-events)
- level: complex
- origin: human
- convention: hardhat2-ethers6
- source: https://github.com/abhishekY2401/event-dapp-backend @ 8cae2ab28a6c561828dd4e3cb12eb55df2a0cfeb
- license: MIT
- targets: UserTicketHub.sol, EventCore.sol, EventFactory.sol, TicketManager.sol
- validation: 28 passing tests, 0 failing; statement coverage UserTicketHub.sol 95.4 %, EventCore.sol 83.33 %, EventFactory.sol 100.0 %, TicketManager.sol 95.0 %

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

## Contract: UserTicketHub.sol (primary target)

```solidity
// SPDX-License-Identifier: Unlicense
pragma solidity ^0.8.18;

import "./EventCore.sol";
import "./TicketManager.sol";
import "./EventFactory.sol";

/**
 * @title UserTicketHub
 * @dev Central contract for users to manage their ticket purchases and interactions
 */

contract UserTicketHub {
    // Contract Owner
    address public owner;

    // reference to EventFactory contract
    EventFactory public eventFactory;

    // User Profiles
    struct UserProfile {
        string userName;
        string email;
        bool isRegistered;
        uint totalTicketsOwned;
        uint[] attendingEvents; // Events which users are attending
    }

    // Mapping from user address to their profile
    mapping(address => UserProfile) public userProfiles;

    // Mapping from user address to their favorite events
    mapping(address => mapping(uint => bool)) public favoriteEvents;

    // Mapping to track user purchased tickets across all events
    // user address => eventId => ticketCount
    mapping(address => mapping(uint => uint)) public userTickets;

    // Add a new mapping to track pending transfers
    mapping(address => mapping(uint => mapping(address => uint))) public pendingTransfers; // from => eventId => to => quantity

    // Events
    event UserRegistered(address indexed user, string userName);
    event ProfileUpdated(address indexed user, string userName);
    event TicketsPurchased(
        address indexed user,
        uint indexed eventId,
        uint quantity
    );
    event TicketsTransferred(
        address indexed from,
        address indexed to,
        uint indexed eventId,
        uint quantity
    );
    event EventFavorited(address indexed user, uint indexed eventId);
    event EventUnfavorited(address indexed user, uint indexed eventId);
    event TransferInitiated(
        address indexed from,
        address indexed to,
        uint indexed eventId,
        uint quantity
    );

    /**
     * @dev Constructor to initialize the UserTicketHub with EventFactory
     * @param _eventFactoryAddress Address of the EventFactory contract
     */

    constructor(address _eventFactoryAddress) {
        owner = msg.sender;
        eventFactory = EventFactory(_eventFactoryAddress);
    }

    /**
     * @dev Register a new user profile
     * @param userName Display name for the user profile
     * @param email Optional email for notifications (can be empty)
     */

    function registerUser(
        string memory userName,
        string memory email
    ) external {
        require(
            !userProfiles[msg.sender].isRegistered,
            "User already registered"
        );

        userProfiles[msg.sender] = UserProfile({
            userName: userName,
            email: email,
            isRegistered: true,
            totalTicketsOwned: 0,
            attendingEvents: new uint[](0)
        });

        emit UserRegistered(msg.sender, userName);
    }

    /**
     * @dev Update user profile information
     * @param userName New display name
     * @param email New email address
     */
    function updateProfile(
        string memory userName,
        string memory email
    ) external {
        require(userProfiles[msg.sender].isRegistered, "User not registered");

        userProfiles[msg.sender].userName = userName;
        userProfiles[msg.sender].email = email;

        emit ProfileUpdated(msg.sender, userName);
    }

    /**
     * @dev Buy tickets for an event
     * @param eventId ID of the event to buy tickets for
     * @param quantity Number of tickets to buy
     */

    function buyTickets(uint eventId, uint quantity) external payable {
        // get the event contract address
        address eventAddress = eventFactory.getEventContract(eventId);
        require(eventAddress != address(0), "Event does not exist");

        // get the event details
        EventCore eventCore = EventCore(payable(eventAddress));
        (, , uint eventDate, uint ticketPrice, , uint ticketRemain) = eventCore
            .getEventDetails();

        // Validate event and payment
        require(block.timestamp < eventDate, "Event has already occurred");
        require(ticketRemain >= quantity, "Not enough tickets available");
        require(msg.value >= ticketPrice * quantity, "Insufficient Ether sent");

        // Get the ticket manager address and contract
        TicketManager ticketManager = eventCore.ticketManager();

        // Purchase the tickets through the TicketManager
        ticketManager.buyTicket{value: msg.value}(quantity);

        // Update user profile records
        userTickets[msg.sender][eventId] += quantity;
        userProfiles[msg.sender].totalTicketsOwned += quantity;

        // Add the event to the user's attending list if not already there
        bool eventFound = false;
        for (
            uint i = 0;
            i < userProfiles[msg.sender].attendingEvents.length;
            i++
        ) {
            if (userProfiles[msg.sender].attendingEvents[i] == eventId) {
                eventFound = true;
                break;
            }
        }

        if (!eventFound) {
            userProfiles[msg.sender].attendingEvents.push(eventId);
        }

        emit TicketsPurchased(msg.sender, eventId, quantity);
    }

    /**
     * @dev Transfer tickets to another user
     * @param eventId ID of the event
     * @param to Address to transfer tickets to
     * @param quantity Number of tickets to transfer
     */
    function transferTickets(uint eventId, address to, uint quantity) external payable {
        require(to != address(0), "Cannot transfer to zero address");
        require(to != msg.sender, "Cannot transfer to yourself");
        require(
            userTickets[msg.sender][eventId] >= quantity,
            "Insufficient tickets owned"
        );

        // Get the event and ticket manager contracts
        address eventAddress = eventFactory.getEventContract(eventId);
        require(eventAddress != address(0), "Event does not exist");

        EventCore eventCore = EventCore(payable(eventAddress));
        TicketManager ticketManager = eventCore.ticketManager();

        // Get event details to calculate transfer amount
        (, , uint eventDate, uint ticketPrice, , ) = eventCore.getEventDetails();
        require(block.timestamp < eventDate, "Event has already occurred");
        uint transferAmount = ticketPrice * quantity;

        // Validate payment from recipient
        require(msg.value >= transferAmount, "Insufficient payment from recipient");

        // Transfer the tickets using the TicketManager
        ticketManager.transferTicket{value: msg.value}(quantity, to);

        // Update user records
        userTickets[msg.sender][eventId] -= quantity;
        userTickets[to][eventId] += quantity;

        userProfiles[msg.sender].totalTicketsOwned -= quantity;

        // If recipient is registered, update their total count
        if (userProfiles[to].isRegistered) {
            userProfiles[to].totalTicketsOwned += quantity;
            
            // Add the event to the recipient's attending list if not already there
            bool eventFound = false;
            for (uint i = 0; i < userProfiles[to].attendingEvents.length; i++) {
                if (userProfiles[to].attendingEvents[i] == eventId) {
                    eventFound = true;
                    break;
                }
            }

            if (!eventFound) {
                userProfiles[to].attendingEvents.push(eventId);
            }
        }

        // Remove event from sender's attending list if they no longer have tickets
        if (userTickets[msg.sender][eventId] == 0) {
            _removeAttendingEvent(msg.sender, eventId);
        }

        emit TicketsTransferred(msg.sender, to, eventId, quantity);
    }

    /**
     * @dev Add an event to user's favorites
     * @param eventId ID of the event to favorite
     */
    function favoriteEvent(uint eventId) external {
        require(userProfiles[msg.sender].isRegistered, "User not registered");
        require(
            eventFactory.getEventContract(eventId) != address(0),
            "Event does not exist"
        );

        favoriteEvents[msg.sender][eventId] = true;
        emit EventFavorited(msg.sender, eventId);
    }

    /**
     * @dev Remove an event from user's favorites
     * @param eventId ID of the event to unfavorite
     */
    function unfavoriteEvent(uint eventId) external {
        require(userProfiles[msg.sender].isRegistered, "User not registered");

        favoriteEvents[msg.sender][eventId] = false;
        emit EventUnfavorited(msg.sender, eventId);
    }

    /**
     * @dev Check if a user has favorited an event
     * @param user Address of the user
     * @param eventId ID of the event
     * @return boolean indicating favorite status
     */
    function isEventFavorite(
        address user,
        uint eventId
    ) external view returns (bool) {
        return favoriteEvents[user][eventId];
    }

    /**
     * @dev Get user's ticket balance for a specific event
     * @param user Address of the user
     * @param eventId ID of the event
     * @return Number of tickets owned for the event
     */
    function getUserTicketCount(
        address user,
        uint eventId
    ) external view returns (uint) {
        return userTickets[user][eventId];
    }

    /**
     * @dev Get all events a user is attending
     * @param user Address of the user
     * @return Array of event IDs the user is attending
     */
    function getUserAttendingEvents(
        address user
    ) external view returns (uint[] memory) {
        return userProfiles[user].attendingEvents;
    }

    /**
     * @dev Get user profile information
     * @param user Address of the user
     * @return userName User's name
     * @return email User's email
     * @return isRegistered Whether user is registered
     * @return totalTicketsOwned Total tickets owned across all events
     */
    function getUserProfile(
        address user
    )
        external
        view
        returns (
            string memory userName,
            string memory email,
            bool isRegistered,
            uint totalTicketsOwned
        )
    {
        UserProfile memory profile = userProfiles[user];
        return (
            profile.userName,
            profile.email,
            profile.isRegistered,
            profile.totalTicketsOwned
        );
    }

    /**
     * @dev Remove an event from user's attending list (called when all tickets are transferred)
     * @param user Address of the user
     * @param eventId ID of the event to remove
     */
    function _removeAttendingEvent(address user, uint eventId) internal {
        uint[] storage attendingEvents = userProfiles[user].attendingEvents;
        for (uint i = 0; i < attendingEvents.length; i++) {
            if (attendingEvents[i] == eventId) {
                // Replace with the last element and pop
                attendingEvents[i] = attendingEvents[
                    attendingEvents.length - 1
                ];
                attendingEvents.pop();
                break;
            }
        }
    }

    /**
     * @dev Initiate a ticket transfer (without payment)
     * @param eventId ID of the event
     * @param to Address to transfer tickets to
     * @param quantity Number of tickets to transfer
     */
    function initiateTransfer(uint eventId, address to, uint quantity) external {
        require(to != address(0), "Cannot transfer to zero address");
        require(to != msg.sender, "Cannot transfer to yourself");
        require(
            userTickets[msg.sender][eventId] >= quantity,
            "Insufficient tickets owned"
        );

        // Get the event contract
        address eventAddress = eventFactory.getEventContract(eventId);
        require(eventAddress != address(0), "Event does not exist");

        EventCore eventCore = EventCore(payable(eventAddress));
        TicketManager ticketManager = eventCore.ticketManager();

        // Check if event has already occurred
        (, , uint eventDate, , , ) = eventCore.getEventDetails();
        require(block.timestamp < eventDate, "Event has already occurred");

        // Check if there's already a pending transfer in either direction
        require(
            pendingTransfers[msg.sender][eventId][to] == 0,
            "Transfer already initiated"
        );
        require(
            pendingTransfers[to][eventId][msg.sender] == 0,
            "Recipient has a pending transfer to sender"
        );

        // Store the pending transfer
        pendingTransfers[msg.sender][eventId][to] = quantity;

        emit TransferInitiated(msg.sender, to, eventId, quantity);
    }

    /**
     * @dev Accept and pay for a ticket transfer
     * @param from Address of the ticket owner
     * @param eventId ID of the event
     */
    function acceptTransfer(address from, uint eventId) external payable {
        uint quantity = pendingTransfers[from][eventId][msg.sender];
        require(quantity > 0, "No pending transfer found");

        // Get the event and ticket manager contracts
        address eventAddress = eventFactory.getEventContract(eventId);
        require(eventAddress != address(0), "Event does not exist");

        EventCore eventCore = EventCore(payable(eventAddress));
        TicketManager ticketManager = eventCore.ticketManager();

        // Get event details to calculate transfer amount
        (, , uint eventDate, uint ticketPrice, , ) = eventCore.getEventDetails();
        
        // Check if event has already occurred
        require(block.timestamp < eventDate, "Event has already occurred");

        // Check if sender still has enough tickets
        require(
            userTickets[from][eventId] >= quantity,
            "Sender no longer has enough tickets"
        );

        uint transferAmount = ticketPrice * quantity;

        // Validate payment from recipient
        require(msg.value >= transferAmount, "Insufficient payment from recipient");

        // Transfer the tickets using the TicketManager
        ticketManager.transferTicket{value: msg.value}(quantity, msg.sender);

        // Update user records
        userTickets[from][eventId] -= quantity;
        userTickets[msg.sender][eventId] += quantity;

        userProfiles[from].totalTicketsOwned -= quantity;

        // If recipient is registered, update their total count
        if (userProfiles[msg.sender].isRegistered) {
            userProfiles[msg.sender].totalTicketsOwned += quantity;
            
            // Add the event to the recipient's attending list if not already there
            bool eventFound = false;
            for (uint i = 0; i < userProfiles[msg.sender].attendingEvents.length; i++) {
                if (userProfiles[msg.sender].attendingEvents[i] == eventId) {
                    eventFound = true;
                    break;
                }
            }

            if (!eventFound) {
                userProfiles[msg.sender].attendingEvents.push(eventId);
            }
        }

        // Remove event from sender's attending list if they no longer have tickets
        if (userTickets[from][eventId] == 0) {
            _removeAttendingEvent(from, eventId);
        }

        // Clear the pending transfer
        delete pendingTransfers[from][eventId][msg.sender];

        emit TicketsTransferred(from, msg.sender, eventId, quantity);
    }
}
```

## Tests: UserTicketHub.test.js

```javascript
/**
 * @file UserTicketHub.test.js
 * @description Test suite for the UserTicketHub contract
 * Tests user registration, profile management, ticket operations, and event interactions
 */

const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("UserTicketHub", function () {
  // Test variables
  let userTicketHub;
  let eventFactory;
  let eventCore;
  let ticketManager;
  let owner;
  let organizer;
  let user1;
  let user2;
  let eventName = "Test Event";
  let eventDate;
  let ticketPrice = ethers.parseEther("0.1");
  let ticketCount = 100;

  // Setup before each test
  beforeEach(async function () {
    // Get test accounts
    [owner, organizer, user1, user2] = await ethers.getSigners();
    
    // Set event date to 1 day from current block timestamp
    const latestBlock = await ethers.provider.getBlock('latest');
    eventDate = latestBlock.timestamp + 86400;

    // Deploy EventFactory
    const EventFactory = await ethers.getContractFactory("EventFactory");
    eventFactory = await EventFactory.deploy();
    await eventFactory.waitForDeployment();

    // Deploy UserTicketHub
    const UserTicketHub = await ethers.getContractFactory("UserTicketHub");
    userTicketHub = await UserTicketHub.deploy(await eventFactory.getAddress());
    await userTicketHub.waitForDeployment();

    // Create a test event
    const tx = await eventFactory.connect(organizer).createEvent(
      eventName,
      eventDate,
      ticketPrice,
      ticketCount
    );
    const receipt = await tx.wait();
    const eventContractAddress = await eventFactory.getEventContract(0);
    
    // Get EventCore and TicketManager instances
    const EventCore = await ethers.getContractFactory("EventCore");
    eventCore = EventCore.attach(eventContractAddress);
    const ticketManagerAddress = await eventCore.ticketManager();
    const TicketManager = await ethers.getContractFactory("TicketManager");
    ticketManager = TicketManager.attach(ticketManagerAddress);
  });

  // Test user registration functionality
  describe("User Registration", function () {
    it("Should allow user registration", async function () {
      const userName = "TestUser";
      const email = "test@example.com";
      
      await userTicketHub.connect(user1).registerUser(userName, email);
      
      const profile = await userTicketHub.getUserProfile(user1.address);
      expect(profile[0]).to.equal(userName);
      expect(profile[1]).to.equal(email);
      expect(profile[2]).to.be.true;
      expect(profile[3]).to.equal(0);
    });

    it("Should not allow duplicate registration", async function () {
      const userName = "TestUser";
      const email = "test@example.com";
      
      await userTicketHub.connect(user1).registerUser(userName, email);
      
      await expect(
        userTicketHub.connect(user1).registerUser(userName, email)
      ).to.be.revertedWith("User already registered");
    });

    it("Should emit UserRegistered event", async function () {
      const userName = "TestUser";
      const email = "test@example.com";
      
      await expect(userTicketHub.connect(user1).registerUser(userName, email))
        .to.emit(userTicketHub, "UserRegistered")
        .withArgs(user1.address, userName);
    });
  });

  // Test profile management functionality
  describe("Profile Management", function () {
    beforeEach(async function () {
      await userTicketHub.connect(user1).registerUser("TestUser", "test@example.com");
    });

    it("Should allow profile updates", async function () {
      const newUserName = "UpdatedUser";
      const newEmail = "updated@example.com";
      
      await userTicketHub.connect(user1).updateProfile(newUserName, newEmail);
      
      const profile = await userTicketHub.getUserProfile(user1.address);
      expect(profile[0]).to.equal(newUserName);
      expect(profile[1]).to.equal(newEmail);
    });

    it("Should emit ProfileUpdated event", async function () {
      const newUserName = "UpdatedUser";
      const newEmail = "updated@example.com";
      
      await expect(userTicketHub.connect(user1).updateProfile(newUserName, newEmail))
        .to.emit(userTicketHub, "ProfileUpdated")
        .withArgs(user1.address, newUserName);
    });

    it("Should not allow updates for unregistered users", async function () {
      await expect(
        userTicketHub.connect(user2).updateProfile("NewUser", "new@example.com")
      ).to.be.revertedWith("User not registered");
    });
  });

  // Test ticket operations
  describe("Ticket Operations", function () {
    beforeEach(async function () {
      await userTicketHub.connect(user1).registerUser("TestUser", "test@example.com");
      await userTicketHub.connect(user2).registerUser("TestUser2", "test2@example.com");
    });

    it("Should allow buying tickets", async function () {
      const quantity = 2;
      await userTicketHub.connect(user1).buyTickets(0, quantity, { value: ticketPrice * BigInt(quantity) });
      
      const ticketCount = await userTicketHub.getUserTicketCount(user1.address, 0);
      expect(ticketCount).to.equal(quantity);
    });

    it("Should emit TicketsPurchased event", async function () {
      const quantity = 1;
      await expect(userTicketHub.connect(user1).buyTickets(0, quantity, { value: ticketPrice }))
        .to.emit(userTicketHub, "TicketsPurchased")
        .withArgs(user1.address, 0, quantity);
    });

    it("Should allow transferring tickets", async function () {
      // First buy tickets
      const quantity = 2;
      await userTicketHub.connect(user1).buyTickets(0, quantity, { value: ticketPrice * BigInt(quantity) });

      // Ensure user1 has enough tickets
      const initialUser1Balance = await userTicketHub.getUserTicketCount(user1.address, 0);
      expect(initialUser1Balance).to.be.gte(1);      // Then transfer one ticket
      await userTicketHub.connect(user1).transferTickets(0, user2.address, 1, {
        value: ticketPrice
      });      expect(Number(await userTicketHub.getUserTicketCount(user1.address, 0))).to.equal(Number(initialUser1Balance) - 1);
      expect(Number(await userTicketHub.getUserTicketCount(user2.address, 0))).to.equal(1);
    });

    it("Should emit TicketsTransferred event", async function () {
      // First buy tickets
      await userTicketHub.connect(user1).buyTickets(0, 1, { value: ticketPrice });      // Then transfer ticket
      await expect(userTicketHub.connect(user1).transferTickets(0, user2.address, 1, {
        value: ticketPrice
      }))
        .to.emit(userTicketHub, "TicketsTransferred")
        .withArgs(user1.address, user2.address, 0, 1);
    });

    it("Should not allow transferring to zero address", async function () {
      // First buy tickets
      await userTicketHub.connect(user1).buyTickets(0, 1, { value: ticketPrice });

      // Attempt transfer to zero address
      await expect(
        userTicketHub.connect(user1).transferTickets(0, ethers.ZeroAddress, 1)
      ).to.be.revertedWith("Cannot transfer to zero address");
    });

    it("Should not allow transferring more tickets than owned", async function () {
      await userTicketHub.connect(user1).buyTickets(0, 1, { value: ticketPrice });
      
      await expect(
        userTicketHub.connect(user1).transferTickets(0, user2.address, 2)
      ).to.be.revertedWith("Insufficient tickets owned");
    });
  });

  // Test event interactions
  describe("Event Interactions", function () {
    beforeEach(async function () {
      await userTicketHub.connect(user1).registerUser("TestUser", "test@example.com");
    });

    it("Should allow favoriting events", async function () {
      await userTicketHub.connect(user1).favoriteEvent(0);
      
      expect(await userTicketHub.isEventFavorite(user1.address, 0)).to.be.true;
    });

    it("Should emit EventFavorited event", async function () {
      await expect(userTicketHub.connect(user1).favoriteEvent(0))
        .to.emit(userTicketHub, "EventFavorited")
        .withArgs(user1.address, 0);
    });

    it("Should allow unfavoriting events", async function () {
      await userTicketHub.connect(user1).favoriteEvent(0);
      await userTicketHub.connect(user1).unfavoriteEvent(0);
      
      expect(await userTicketHub.isEventFavorite(user1.address, 0)).to.be.false;
    });

    it("Should emit EventUnfavorited event", async function () {
      await userTicketHub.connect(user1).favoriteEvent(0);
      
      await expect(userTicketHub.connect(user1).unfavoriteEvent(0))
        .to.emit(userTicketHub, "EventUnfavorited")
        .withArgs(user1.address, 0);
    });

    it("Should track attending events", async function () {
      await userTicketHub.connect(user1).buyTickets(0, 1, { value: ticketPrice });
      
      const attendingEvents = await userTicketHub.getUserAttendingEvents(user1.address);
      expect(attendingEvents.length).to.equal(1);
      expect(attendingEvents[0]).to.equal(0);
    });
  });

  // Test transfer functionality
  describe("Transfer Operations", function () {
    beforeEach(async function () {
      await userTicketHub.connect(user1).registerUser("TestUser", "test@example.com");
      await userTicketHub.connect(user2).registerUser("TestUser2", "test2@example.com");
      
      // Buy tickets for user1
      const quantity = 2;
      await userTicketHub.connect(user1).buyTickets(0, quantity, { value: ticketPrice * BigInt(quantity) });
    });

    it("Should allow initiating a transfer", async function () {
      const quantity = 1;
      await userTicketHub.connect(user1).initiateTransfer(0, user2.address, quantity);
      
      const pendingQty = await userTicketHub.pendingTransfers(user1.address, 0, user2.address);
      expect(pendingQty).to.equal(quantity);
    });

    it("Should emit TransferInitiated event", async function () {
      const quantity = 1;
      await expect(userTicketHub.connect(user1).initiateTransfer(0, user2.address, quantity))
        .to.emit(userTicketHub, "TransferInitiated")
        .withArgs(user1.address, user2.address, 0, quantity);
    });

    it("Should not allow initiating transfer to self", async function () {
      await expect(
        userTicketHub.connect(user1).initiateTransfer(0, user1.address, 1)
      ).to.be.revertedWith("Cannot transfer to yourself");
    });

    it("Should not allow initiating transfer with insufficient tickets", async function () {
      await expect(
        userTicketHub.connect(user1).initiateTransfer(0, user2.address, 3)
      ).to.be.revertedWith("Insufficient tickets owned");
    });

    it("Should not allow duplicate pending transfers", async function () {
      await userTicketHub.connect(user1).initiateTransfer(0, user2.address, 1);
      
      await expect(
        userTicketHub.connect(user1).initiateTransfer(0, user2.address, 1)
      ).to.be.revertedWith("Transfer already initiated");
    });

    it("Should allow accepting a transfer", async function () {
      const quantity = 1;
      await userTicketHub.connect(user1).initiateTransfer(0, user2.address, quantity);
      
      await userTicketHub.connect(user2).acceptTransfer(user1.address, 0, {
        value: ticketPrice * BigInt(quantity)
      });
      
      const user1Tickets = await userTicketHub.getUserTicketCount(user1.address, 0);
      const user2Tickets = await userTicketHub.getUserTicketCount(user2.address, 0);
      
      expect(user1Tickets).to.equal(1); // 2 - 1
      expect(user2Tickets).to.equal(1);
    });

    it("Should emit TicketsTransferred event on acceptance", async function () {
      const quantity = 1;
      await userTicketHub.connect(user1).initiateTransfer(0, user2.address, quantity);
      
      await expect(userTicketHub.connect(user2).acceptTransfer(user1.address, 0, {
        value: ticketPrice * BigInt(quantity)
      }))
        .to.emit(userTicketHub, "TicketsTransferred")
        .withArgs(user1.address, user2.address, 0, quantity);
    });

    it("Should not allow accepting non-existent transfer", async function () {
      await expect(
        userTicketHub.connect(user2).acceptTransfer(user1.address, 0, {
          value: ticketPrice
        })
      ).to.be.revertedWith("No pending transfer found");
    });

    it("Should not allow accepting transfer with insufficient payment", async function () {
      await userTicketHub.connect(user1).initiateTransfer(0, user2.address, 1);
      
      await expect(
        userTicketHub.connect(user2).acceptTransfer(user1.address, 0, {
          value: ticketPrice / BigInt(2) // Half the required amount
        })
      ).to.be.revertedWith("Insufficient payment from recipient");
    });

    it("Should clear pending transfer after acceptance", async function () {
      const quantity = 1;
      await userTicketHub.connect(user1).initiateTransfer(0, user2.address, quantity);
      
      await userTicketHub.connect(user2).acceptTransfer(user1.address, 0, {
        value: ticketPrice * BigInt(quantity)
      });
      
      const pendingQty = await userTicketHub.pendingTransfers(user1.address, 0, user2.address);
      expect(pendingQty).to.equal(0);
    });

    it("Should not allow accepting transfer if sender no longer has enough tickets", async function () {
      // First transfer one ticket to owner to leave user1 with exactly 1 ticket
      await userTicketHub.connect(user1).transferTickets(0, owner.address, 1, {
        value: ticketPrice
      });

      // Initiate transfer of the last ticket
      await userTicketHub.connect(user1).initiateTransfer(0, user2.address, 1);
      
      // Transfer the last ticket to someone else
      const tx = await userTicketHub.connect(user1).transferTickets(0, owner.address, 1, {
        value: ticketPrice
      });
      
      // Wait for the transfer transaction to be mined
      await tx.wait();
      
      // Try to accept the pending transfer
      await expect(
        userTicketHub.connect(user2).acceptTransfer(user1.address, 0, {
          value: ticketPrice
        })
      ).to.be.revertedWith("Sender no longer has enough tickets");
    });
  });
});
```
