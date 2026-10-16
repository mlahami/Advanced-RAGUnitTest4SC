# event-manager--donguillotine

- domain: access-control (access-control)
- level: moderate
- origin: human
- convention: hardhat2-ethers6
- source: https://github.com/DonGuillotine/nft-gated-event-manager @ 45541a09799a56c9b723b1ee9885e84fd5929f71
- license: MIT
- targets: EventManager.sol, EventNFT.sol
- validation: 10 passing tests, 0 failing; statement coverage EventManager.sol 100.0 %, EventNFT.sol 60.0 %

## Contract: EventManager.sol (primary target)

```solidity
// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "./EventNFT.sol";

contract EventManager is Ownable, ReentrancyGuard {

    struct Event {
        string name;
        uint256 date;
        uint256 capacity;
        uint256 registeredCount;
        mapping(address => bool) registeredAttendees;
    }

    EventNFT public nftContract;
    uint256 private _eventIdCounter;
    mapping(uint256 => Event) public events;

    event EventCreated(uint256 indexed eventId, string name, uint256 date, uint256 capacity);
    event UserRegistered(uint256 indexed eventId, address indexed user);

    constructor(address initialOwner, address _nftContract) Ownable(initialOwner) {
        nftContract = EventNFT(_nftContract);
    }

    function createEvent(string memory name, uint256 date, uint256 capacity) external onlyOwner {
        uint256 eventId = _eventIdCounter;
        _eventIdCounter += 1;

        Event storage newEvent = events[eventId];
        newEvent.name = name;
        newEvent.date = date;
        newEvent.capacity = capacity;
        newEvent.registeredCount = 0;

        emit EventCreated(eventId, name, date, capacity);
    }

    function registerForEvent(uint256 eventId) external nonReentrant {
        require(nftContract.balanceOf(msg.sender) > 0, "Must own an NFT to register");
        require(eventId < _eventIdCounter, "Event does not exist");
        require(events[eventId].registeredCount < events[eventId].capacity, "Event is full");
        require(!events[eventId].registeredAttendees[msg.sender], "Already registered");

        events[eventId].registeredAttendees[msg.sender] = true;
        events[eventId].registeredCount++;

        emit UserRegistered(eventId, msg.sender);
    }

    function getEventDetails(uint256 eventId) external view returns (string memory name, uint256 date, uint256 capacity, uint256 registeredCount) {
        require(eventId < _eventIdCounter, "Event does not exist");
        Event storage e = events[eventId];
        return (e.name, e.date, e.capacity, e.registeredCount);
    }

    function isRegistered(uint256 eventId, address user) external view returns (bool) {
        require(eventId < _eventIdCounter, "Event does not exist");
        return events[eventId].registeredAttendees[user];
    }
}
```

## Contract: EventNFT.sol (dependency)

```solidity
// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/token/ERC721/extensions/ERC721URIStorage.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

contract EventNFT is ERC721, ERC721URIStorage, Ownable {

    uint256 private _tokenIdCounter;

    constructor(address initialOwner) 
        ERC721("EventNFT", "EVNT") 
        Ownable(initialOwner)
    {}

    function safeMint(address to, string memory uri) public onlyOwner {
        uint256 tokenId = _tokenIdCounter;
        _tokenIdCounter += 1;
        _safeMint(to, tokenId);
        _setTokenURI(tokenId, uri);
    }

    function tokenURI(uint256 tokenId)
        public
        view
        override(ERC721, ERC721URIStorage)
        returns (string memory)
    {
        return super.tokenURI(tokenId);
    }

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

## Tests: EventManager.js

```javascript
const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("EventManager", function () {
  let EventNFT, eventNFT, EventManager, eventManager, owner, addr1, addr2;

  beforeEach(async function () {
    [owner, addr1, addr2] = await ethers.getSigners();

    EventNFT = await ethers.getContractFactory("EventNFT");
    eventNFT = await EventNFT.deploy(owner.address);

    EventManager = await ethers.getContractFactory("EventManager");
    eventManager = await EventManager.deploy(owner.address, await eventNFT.getAddress());
  });

  describe("Deployment", function () {
    it("Should set the right owner", async function () {
      expect(await eventManager.owner()).to.equal(owner.address);
    });

    it("Should set the correct NFT contract address", async function () {
      expect(await eventManager.nftContract()).to.equal(await eventNFT.getAddress());
    });
  });

  describe("Event Creation", function () {
    it("Should allow the owner to create an event", async function () {
      await expect(eventManager.createEvent("Test Event", 1234567890, 100))
        .to.emit(eventManager, "EventCreated")
        .withArgs(0, "Test Event", 1234567890, 100);
    });

    it("Should not allow non-owners to create an event", async function () {
      await expect(eventManager.connect(addr1).createEvent("Test Event", 1234567890, 100))
        .to.be.revertedWithCustomError(eventManager, "OwnableUnauthorizedAccount");
    });
  });

  describe("Event Registration", function () {
    beforeEach(async function () {
      await eventManager.createEvent("Test Event", 1234567890, 100);
      await eventNFT.safeMint(addr1.address, "ipfs://QmTest");
    });

    it("Should allow NFT holders to register for an event", async function () {
      await expect(eventManager.connect(addr1).registerForEvent(0))
        .to.emit(eventManager, "UserRegistered")
        .withArgs(0, addr1.address);
    });

    it("Should not allow non-NFT holders to register for an event", async function () {
      await expect(eventManager.connect(addr2).registerForEvent(0))
        .to.be.revertedWith("Must own an NFT to register");
    });

    it("Should not allow double registration", async function () {
      await eventManager.connect(addr1).registerForEvent(0);
      await expect(eventManager.connect(addr1).registerForEvent(0))
        .to.be.revertedWith("Already registered");
    });

    it("Should not allow registration for non-existent events", async function () {
      await expect(eventManager.connect(addr1).registerForEvent(1))
        .to.be.revertedWith("Event does not exist");
    });
  });

  describe("Event Queries", function () {
    beforeEach(async function () {
      await eventManager.createEvent("Test Event", 1234567890, 100);
      await eventNFT.safeMint(addr1.address, "ipfs://QmTest");
      await eventManager.connect(addr1).registerForEvent(0);
    });

    it("Should return correct event details", async function () {
      const eventDetails = await eventManager.getEventDetails(0);
      expect(eventDetails[0]).to.equal("Test Event");
      expect(eventDetails[1]).to.equal(1234567890);
      expect(eventDetails[2]).to.equal(100);
      expect(eventDetails[3]).to.equal(1);
    });

    it("Should correctly report registration status", async function () {
      expect(await eventManager.isRegistered(0, addr1.address)).to.be.true;
      expect(await eventManager.isRegistered(0, addr2.address)).to.be.false;
    });
  });
});
```
