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
