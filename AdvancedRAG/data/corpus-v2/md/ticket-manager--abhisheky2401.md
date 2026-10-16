# ticket-manager--abhisheky2401

- domain: ticketing-events (ticketing-events)
- level: moderate
- origin: human
- convention: hardhat2-ethers6
- source: https://github.com/abhishekY2401/event-dapp-backend @ 8cae2ab28a6c561828dd4e3cb12eb55df2a0cfeb
- license: MIT
- targets: TicketManager.sol, EventCore.sol
- validation: 10 passing tests, 0 failing; statement coverage TicketManager.sol 100.0 %, EventCore.sol 83.33 %

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

## Contract: TicketManager.sol (primary target)

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

## Tests: TicketManager.test.js

```javascript
/**
 * @file TicketManager.test.js
 * @description Test suite for the TicketManager contract
 * Tests ticket purchase, transfer, and balance functionality
 */

const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("TicketManager", function () {
  // Test variables
  let ticketManager;
  let eventCore;
  let organizer;
  let buyer;
  let recipient;
  let eventName = "Test Event";
  let eventDate;
  let ticketPrice = ethers.parseEther("0.1");
  let ticketCount = 100;

  // Setup before each test
  beforeEach(async function () {
    // Get test accounts
    [organizer, buyer, recipient] = await ethers.getSigners();

    // Set event date to 2 days from now to ensure enough time for tests
    const currentBlock = await ethers.provider.getBlock("latest");
    eventDate = currentBlock.timestamp + 172800; // 2 days in seconds

    // Deploy EventCore contract
    const EventCore = await ethers.getContractFactory("EventCore");
    eventCore = await EventCore.deploy(
      organizer.address,
      eventName,
      eventDate,
      ticketPrice,
      ticketCount
    );
    await eventCore.waitForDeployment();

    // Get and attach TicketManager contract
    const ticketManagerAddress = await eventCore.ticketManager();
    const TicketManager = await ethers.getContractFactory("TicketManager");
    ticketManager = TicketManager.attach(ticketManagerAddress);
  });

  // Test ticket purchase functionality
  describe("Ticket Purchase", function () {
    it("Should allow buying tickets", async function () {
      const quantity = 2;

      await ticketManager.connect(buyer).buyTicket(quantity, {
        value: ticketPrice * BigInt(quantity),
      });

      const balance = await ticketManager.getTicketBalance(buyer.address);
      expect(balance).to.equal(quantity);
    });

    it("Should emit TicketsPurchased event", async function () {
      const quantity = 2;

      await expect(
        ticketManager.connect(buyer).buyTicket(quantity, {
          value: ticketPrice * BigInt(quantity),
        })
      )
        .to.emit(ticketManager, "TicketsPurchased")
        .withArgs(buyer.address, quantity);
    });

    it("Should not allow buying tickets with insufficient payment", async function () {
      const quantity = 2;

      await expect(
        ticketManager.connect(buyer).buyTicket(quantity, {
          value: ticketPrice * BigInt(quantity - 1),
        })
      ).to.be.revertedWith("Insufficient Ether sent");
    });

    it("Should not allow buying tickets after event date", async function () {
      // Fast forward time past event date
      await ethers.provider.send("evm_increaseTime", [172800 * 2]); // 4 days
      await ethers.provider.send("evm_mine");

      const quantity = 2;

      await expect(
        ticketManager.connect(buyer).buyTicket(quantity, {
          value: ticketPrice * BigInt(quantity),
        })
      ).to.be.revertedWith("Event has already occurred");
    });
  });

  // Test ticket transfer functionality
  describe("Ticket Transfer", function () {
    beforeEach(async function () {
      // Buy tickets for the buyer first
      const quantity = 2;
      await ticketManager.connect(buyer).buyTicket(quantity, {
        value: ticketPrice * BigInt(quantity),
      });
    });

    it("Should allow transferring tickets", async function () {
      const transferQuantity = 1;

      await ticketManager
        .connect(buyer)
        .transferTicket(transferQuantity, recipient.address, {
          value: ticketPrice * BigInt(transferQuantity),
        });

      const buyerBalance = await ticketManager.getTicketBalance(buyer.address);
      const recipientBalance = await ticketManager.getTicketBalance(recipient.address);

      expect(buyerBalance).to.equal(1);
      expect(recipientBalance).to.equal(1);
    });

    it("Should emit TicketsTransferred event", async function () {
      const transferQuantity = 1;

      await expect(
        ticketManager
          .connect(buyer)
          .transferTicket(transferQuantity, recipient.address, {
            value: ticketPrice * BigInt(transferQuantity),
          })
      )
        .to.emit(ticketManager, "TicketsTransferred")
        .withArgs(buyer.address, recipient.address, transferQuantity, ticketPrice * BigInt(transferQuantity));
    });

    it("Should not allow transferring more tickets than owned", async function () {
      const transferQuantity = 3;

      await expect(
        ticketManager
          .connect(buyer)
          .transferTicket(transferQuantity, recipient.address, {
            value: ticketPrice * BigInt(transferQuantity),
          })
      ).to.be.revertedWith("Insufficient tickets owned");
    });

    it("Should not allow transferring to zero address", async function () {
      const transferQuantity = 1;

      await expect(
        ticketManager
          .connect(buyer)
          .transferTicket(transferQuantity, ethers.ZeroAddress, {
            value: ticketPrice * BigInt(transferQuantity),
          })
      ).to.be.revertedWith("Cannot transfer to zero address");
    });

    it("Should not allow transferring tickets after event date", async function () {
      // Fast forward time past event date
      await ethers.provider.send("evm_increaseTime", [172800 * 2]); // 4 days
      await ethers.provider.send("evm_mine");

      // Verify we're past the event date
      const currentBlock = await ethers.provider.getBlock("latest");
      expect(currentBlock.timestamp).to.be.greaterThan(eventDate);

      const transferQuantity = 1;

      // First verify the event date in the contract
      const contractEventDate = await eventCore.date();
      expect(currentBlock.timestamp).to.be.greaterThan(contractEventDate);

      // Now attempt the transfer
      await expect(
        ticketManager
          .connect(buyer)
          .transferTicket(transferQuantity, recipient.address)
      ).to.be.revertedWith("Event has already occurred");
    });
  });

  // Test ticket balance functionality
  describe("Ticket Balance", function () {
    it("Should return correct ticket balance", async function () {
      const quantity = 2;

      await ticketManager.connect(buyer).buyTicket(quantity, {
        value: ticketPrice * BigInt(quantity),
      });

      const balance = await ticketManager.getTicketBalance(buyer.address);
      expect(balance).to.equal(quantity);
    });
  });
});
```
