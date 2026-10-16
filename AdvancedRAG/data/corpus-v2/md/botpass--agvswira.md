# botpass--agvswira

- domain: ticketing-events (ticketing-events)
- level: moderate
- origin: human
- convention: hardhat2-ethers6
- source: https://github.com/agvswira/botpass @ 80708431829cb48befabba6f2462c865743a04a8
- license: MIT
- targets: BOTPass.sol
- validation: 16 passing tests, 0 failing; statement coverage BOTPass.sol 100.0 %

## Contract: BOTPass.sol (primary target)

```solidity
// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

/// @title BOTPass
/// @notice Multi-organizer Open Claim attendance records on BOT Chain.
contract BOTPass {
    uint256 private constant _MAX_NAME_LENGTH = 100;
    uint256 private constant _MAX_DESCRIPTION_LENGTH = 500;
    uint256 private constant _MAX_LOCATION_LENGTH = 200;

    uint8 private constant _FIELD_NAME = 0;
    uint8 private constant _FIELD_DESCRIPTION = 1;
    uint8 private constant _FIELD_LOCATION = 2;

    struct EventData {
        address organizer;
        string name;
        string description;
        string location;
        uint64 startTime;
        uint64 endTime;
        bool claimOpen;
        uint256 passCount;
    }

    uint256 public eventCount;

    mapping(uint256 eventId => EventData eventData) private _events;
    mapping(uint256 eventId => mapping(address attendee => uint64 timestamp))
        private _claimedAt;

    event EventCreated(
        uint256 indexed eventId,
        address indexed organizer,
        uint64 startTime,
        uint64 endTime
    );
    event ClaimOpenChanged(uint256 indexed eventId, bool isOpen);
    event PassClaimed(
        uint256 indexed eventId,
        address indexed attendee,
        uint64 claimedAt
    );

    error EventNotFound(uint256 eventId);
    error EmptyField(uint8 field);
    error FieldTooLong(uint8 field, uint256 actualLength, uint256 maximumLength);
    error InvalidTimeRange(uint64 startTime, uint64 endTime);
    error EndTimeNotFuture(uint64 endTime);
    error UnauthorizedOrganizer(uint256 eventId, address caller);
    error ClaimClosed(uint256 eventId);
    error EventNotStarted(uint256 eventId, uint64 startTime);
    error EventEnded(uint256 eventId, uint64 endTime);
    error AlreadyClaimed(uint256 eventId, address attendee);

    function createEvent(
        string calldata name,
        string calldata description,
        string calldata location,
        uint64 startTime,
        uint64 endTime
    ) external returns (uint256 eventId) {
        _validateField(name, _FIELD_NAME, _MAX_NAME_LENGTH);
        _validateField(description, _FIELD_DESCRIPTION, _MAX_DESCRIPTION_LENGTH);
        _validateField(location, _FIELD_LOCATION, _MAX_LOCATION_LENGTH);

        if (endTime <= startTime) {
            revert InvalidTimeRange(startTime, endTime);
        }
        if (uint256(endTime) <= block.timestamp) {
            revert EndTimeNotFuture(endTime);
        }

        eventId = ++eventCount;
        _events[eventId] = EventData({
            organizer: msg.sender,
            name: name,
            description: description,
            location: location,
            startTime: startTime,
            endTime: endTime,
            claimOpen: false,
            passCount: 0
        });

        emit EventCreated(eventId, msg.sender, startTime, endTime);
    }

    function setClaimOpen(uint256 eventId, bool isOpen) external {
        EventData storage eventData = _getExistingEvent(eventId);
        if (eventData.organizer != msg.sender) {
            revert UnauthorizedOrganizer(eventId, msg.sender);
        }

        eventData.claimOpen = isOpen;
        emit ClaimOpenChanged(eventId, isOpen);
    }

    function getEvent(uint256 eventId) external view returns (EventData memory) {
        return _getExistingEvent(eventId);
    }

    function claimOpen(uint256 eventId) external returns (uint64 timestamp) {
        EventData storage eventData = _getExistingEvent(eventId);
        if (!eventData.claimOpen) {
            revert ClaimClosed(eventId);
        }
        if (block.timestamp < uint256(eventData.startTime)) {
            revert EventNotStarted(eventId, eventData.startTime);
        }
        if (block.timestamp > uint256(eventData.endTime)) {
            revert EventEnded(eventId, eventData.endTime);
        }
        if (_claimedAt[eventId][msg.sender] != 0) {
            revert AlreadyClaimed(eventId, msg.sender);
        }

        timestamp = uint64(block.timestamp);
        _claimedAt[eventId][msg.sender] = timestamp;
        eventData.passCount += 1;

        emit PassClaimed(eventId, msg.sender, timestamp);
    }

    function claimedAt(
        uint256 eventId,
        address attendee
    ) external view returns (uint64) {
        _getExistingEvent(eventId);
        return _claimedAt[eventId][attendee];
    }

    function _validateField(
        string calldata value,
        uint8 field,
        uint256 maximumLength
    ) private pure {
        uint256 actualLength = bytes(value).length;
        if (actualLength == 0) {
            revert EmptyField(field);
        }
        if (actualLength > maximumLength) {
            revert FieldTooLong(field, actualLength, maximumLength);
        }
    }

    function _getExistingEvent(
        uint256 eventId
    ) private view returns (EventData storage eventData) {
        if (eventId == 0 || eventId > eventCount) {
            revert EventNotFound(eventId);
        }
        return _events[eventId];
    }
}
```

## Tests: BOTPass.test.js

```javascript
const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("BOTPass Open Claim registry", function () {
  const NAME_LIMIT = 100;
  const DESCRIPTION_LIMIT = 500;
  const LOCATION_LIMIT = 200;

  let organizer;
  let secondOrganizer;
  let attendeeOne;
  let attendeeTwo;
  let botPass;

  beforeEach(async function () {
    [organizer, secondOrganizer, attendeeOne, attendeeTwo] =
      await ethers.getSigners();
    botPass = await ethers.deployContract("BOTPass");
    await botPass.waitForDeployment();
  });

  async function futureWindow() {
    const block = await ethers.provider.getBlock("latest");
    return {
      startTime: BigInt(block.timestamp + 60),
      endTime: BigInt(block.timestamp + 3_600),
    };
  }

  async function createEvent({
    signer = organizer,
    name = "BOTPass Build Week",
    description = "An open on-chain attendance event.",
    location = "Makassar",
    startTime,
    endTime,
  } = {}) {
    const window =
      startTime == null || endTime == null
        ? await futureWindow()
        : { startTime, endTime };
    return botPass
      .connect(signer)
      .createEvent(
        name,
        description,
        location,
        window.startTime,
        window.endTime
      );
  }

  async function createOpenActiveEvent() {
    const block = await ethers.provider.getBlock("latest");
    const startTime = BigInt(block.timestamp + 10);
    const endTime = BigInt(block.timestamp + 3_600);
    await createEvent({ startTime, endTime });
    await botPass.setClaimOpen(1, true);
    await ethers.provider.send("evm_setNextBlockTimestamp", [Number(startTime)]);
    return { startTime, endTime };
  }

  describe("events", function () {
    it("creates a closed immutable event owned by its caller", async function () {
      const { startTime, endTime } = await futureWindow();

      await expect(createEvent({ startTime, endTime }))
        .to.emit(botPass, "EventCreated")
        .withArgs(1, organizer.address, startTime, endTime);

      expect(await botPass.eventCount()).to.equal(1);
      expect(await botPass["getEvent(uint256)"](1)).to.deep.equal([
        organizer.address,
        "BOTPass Build Week",
        "An open on-chain attendance event.",
        "Makassar",
        startTime,
        endTime,
        false,
        0,
      ]);
    });

    it("assigns global IDs across independent organizers", async function () {
      await createEvent();
      await createEvent({ signer: secondOrganizer, name: "Second event" });

      expect(await botPass.eventCount()).to.equal(2);
      expect((await botPass["getEvent(uint256)"](2)).organizer).to.equal(
        secondOrganizer.address
      );
    });

    it("allows only the event organizer to open or close claims", async function () {
      await createEvent();

      await expect(botPass.connect(attendeeOne).setClaimOpen(1, true))
        .to.be.revertedWithCustomError(botPass, "UnauthorizedOrganizer")
        .withArgs(1, attendeeOne.address);
      await expect(botPass.setClaimOpen(1, true))
        .to.emit(botPass, "ClaimOpenChanged")
        .withArgs(1, true);
      expect((await botPass["getEvent(uint256)"](1)).claimOpen).to.equal(true);
    });

    for (const [field, limit, overrides] of [
      [0, NAME_LIMIT, { name: "" }],
      [1, DESCRIPTION_LIMIT, { description: "" }],
      [2, LOCATION_LIMIT, { location: "" }],
    ]) {
      it(`rejects empty field ${field}`, async function () {
        await expect(createEvent(overrides))
          .to.be.revertedWithCustomError(botPass, "EmptyField")
          .withArgs(field);
      });

      it(`rejects field ${field} beyond ${limit} UTF-8 bytes`, async function () {
        const key = Object.keys(overrides)[0];
        await expect(createEvent({ [key]: "a".repeat(limit + 1) }))
          .to.be.revertedWithCustomError(botPass, "FieldTooLong")
          .withArgs(field, limit + 1, limit);
      });
    }

    it("counts UTF-8 bytes instead of JavaScript characters", async function () {
      await expect(createEvent({ name: "😀".repeat(26) }))
        .to.be.revertedWithCustomError(botPass, "FieldTooLong")
        .withArgs(0, 104, NAME_LIMIT);
    });

    it("rejects invalid or expired event windows", async function () {
      const block = await ethers.provider.getBlock("latest");
      const timestamp = BigInt(block.timestamp);

      await expect(
        createEvent({ startTime: timestamp + 100n, endTime: timestamp + 100n })
      ).to.be.revertedWithCustomError(botPass, "InvalidTimeRange");
      await expect(
        createEvent({ startTime: timestamp - 100n, endTime: timestamp })
      ).to.be.revertedWithCustomError(botPass, "EndTimeNotFuture");
    });

    it("rejects reads and toggles for nonexistent events", async function () {
      await expect(botPass["getEvent(uint256)"](1))
        .to.be.revertedWithCustomError(botPass, "EventNotFound")
        .withArgs(1);
      await expect(botPass.setClaimOpen(1, true))
        .to.be.revertedWithCustomError(botPass, "EventNotFound")
        .withArgs(1);
      await expect(botPass.claimedAt(1, attendeeOne.address))
        .to.be.revertedWithCustomError(botPass, "EventNotFound")
        .withArgs(1);
    });
  });

  describe("Open Claim", function () {
    it("records the canonical claim timestamp and increments the event count", async function () {
      await createOpenActiveEvent();

      const transaction = await botPass.connect(attendeeOne).claimOpen(1);
      const receipt = await transaction.wait();
      const block = await ethers.provider.getBlock(receipt.blockNumber);

      await expect(transaction)
        .to.emit(botPass, "PassClaimed")
        .withArgs(1, attendeeOne.address, block.timestamp);
      expect(await botPass.claimedAt(1, attendeeOne.address)).to.equal(
        block.timestamp
      );
      expect((await botPass["getEvent(uint256)"](1)).passCount).to.equal(1);
    });

    it("allows different wallets but rejects a duplicate claim", async function () {
      await createOpenActiveEvent();

      await botPass.connect(attendeeOne).claimOpen(1);
      await botPass.connect(attendeeTwo).claimOpen(1);

      await expect(botPass.connect(attendeeOne).claimOpen(1))
        .to.be.revertedWithCustomError(botPass, "AlreadyClaimed")
        .withArgs(1, attendeeOne.address);
      expect((await botPass["getEvent(uint256)"](1)).passCount).to.equal(2);
    });

    it("rejects a claim while organizer availability is closed", async function () {
      await createEvent();
      await expect(botPass.connect(attendeeOne).claimOpen(1))
        .to.be.revertedWithCustomError(botPass, "ClaimClosed")
        .withArgs(1);
    });

    it("enforces inclusive start and end boundaries", async function () {
      const block = await ethers.provider.getBlock("latest");
      const startTime = BigInt(block.timestamp + 20);
      const endTime = startTime + 100n;
      await createEvent({ startTime, endTime });
      await botPass.setClaimOpen(1, true);

      await expect(botPass.connect(attendeeOne).claimOpen(1))
        .to.be.revertedWithCustomError(botPass, "EventNotStarted")
        .withArgs(1, startTime);

      await ethers.provider.send("evm_setNextBlockTimestamp", [Number(startTime)]);
      await botPass.connect(attendeeOne).claimOpen(1);

      await ethers.provider.send("evm_setNextBlockTimestamp", [Number(endTime)]);
      await botPass.connect(attendeeTwo).claimOpen(1);

      await ethers.provider.send("evm_setNextBlockTimestamp", [Number(endTime + 1n)]);
      await expect(botPass.connect(secondOrganizer).claimOpen(1))
        .to.be.revertedWithCustomError(botPass, "EventEnded")
        .withArgs(1, endTime);
    });
  });
});
```
