const { loadFixture } = require("@nomicfoundation/hardhat-network-helpers");
const { expect, assert } = require("chai");
const hre = require("hardhat");

describe("Lottery", async () => {
  async function deployLotteryFixture() {
    const [owner, account1, account2] = await hre.ethers.getSigners();

    const Lottery = await hre.ethers.getContractFactory("Lottery");
    const lottery = await Lottery.deploy();

    return { lottery, owner, account1, account2 };
  }
  describe("Deployment", async () => {
    it("deploy the contract", async () => {
      const { lottery } = await loadFixture(deployLotteryFixture);
      //print deployed contract address
      assert.isOk(
        lottery.getAddress(),
        "The Contract was successfully deployed"
      );
    });
  });

  describe("Functional Testing", async () => {
    it("Allow one account to enter", async () => {
      const { lottery, owner } = await loadFixture(deployLotteryFixture);
      await lottery.enter({ value: hre.ethers.parseUnits("0.02", "ether") });
      const players = await lottery.getPlayers();
      expect(players[0]).to.equal(owner);
      expect(players.length).to.equal(1);
    });

    it("Allow Multiple accounts to enter", async () => {
      const { lottery, account1, account2 } =
        await loadFixture(deployLotteryFixture);

      await lottery
        .connect(account1)
        .enter({ value: hre.ethers.parseUnits("0.02", "ether") });
      await lottery
        .connect(account2)
        .enter({ value: hre.ethers.parseUnits("0.02", "ether") });
      const players = await lottery.getPlayers();
      expect(players[0]).to.equal(account1);
      expect(players[1]).to.equal(account2);
      expect(players.length).to.equal(2);
    });
    it("Require the minimal amount of ether to enter", async () => {
      const { lottery, account1 } = await loadFixture(deployLotteryFixture);
      try {
        await lottery
          .connect(account1)
          .enter({ value: hre.ethers.parseUnits("0.02", "ether") });
        assert(false);
      } catch (err) {
        assert(err);
      }
    });

    it("Only the manager should pick the winner", async () => {
      const { lottery, account1 } = await loadFixture(deployLotteryFixture);
      try {
        await lottery.connect(account1).pickWinner();
        assert(false);
      } catch (err) {
        assert(err);
      }
    });
  });

  describe("E2E Testing", async () => {
    it("Enter the lottery and pick the winner", async () => {
      const { lottery, account1 } = await loadFixture(deployLotteryFixture);

      await lottery
        .connect(account1)
        .enter({ value: hre.ethers.parseUnits("1", "ether") });

      await lottery.pickWinner();

      const finalBalance = await hre.ethers.provider.getBalance(account1);

      assert(finalBalance > hre.ethers.parseUnits("99.8", "ether"));

      const players = await lottery.getPlayers();

      expect(players.length).to.equal(0);
    });
  });
});
