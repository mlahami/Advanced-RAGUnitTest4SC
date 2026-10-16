const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("Lottery Contract", function () {
  let lottery;
  let _owner;
  let addr1;
  let addr2;
  let addr3;

  beforeEach(async function () {
    [_owner, addr1, addr2, addr3] = await ethers.getSigners();

    const LotteryFactory = await ethers.getContractFactory("Lottery");
    lottery = await LotteryFactory.deploy();
    await lottery.waitForDeployment();
  });

  describe("部署", function () {
    it("应该正确初始化合约", async function () {
      expect(await lottery.nextLotteryId()).to.equal(0);
    });
  });

  describe("创建抽签", function () {
    it("应该能够创建新的抽签", async function () {
      const duration = 3600; // 1小时

      await expect(lottery.connect(addr1).createLottery(duration)).to.emit(lottery, "LotteryCreated");

      const lotteryInfo = await lottery.getLotteryInfo(0);
      expect(lotteryInfo.isActive).to.be.true;
      expect(lotteryInfo.creator).to.equal(addr1.address);
      expect(Number(lotteryInfo.endTime)).to.be.greaterThan(Number(lotteryInfo.endTime) - duration);
    });

    it("不应该允许创建持续时间为0的抽签", async function () {
      await expect(lottery.createLottery(0)).to.be.revertedWith("Duration must be greater than zero");
    });

    it("不应该允许创建超过7天的抽签", async function () {
      const duration = 7 * 24 * 3600 + 1; // 7天+1秒
      await expect(lottery.createLottery(duration)).to.be.revertedWith("Duration cannot exceed 7 days");
    });
  });

  describe("参与抽签", function () {
    beforeEach(async function () {
      await lottery.connect(addr1).createLottery(3600); // 创建1小时的抽签
    });

    it("应该能够参与抽签", async function () {
      await expect(lottery.connect(addr2).joinLottery(0)).to.emit(lottery, "LotteryJoined").withArgs(0, addr2.address);

      const hasParticipated = await lottery.hasParticipated(0, addr2.address);
      expect(hasParticipated).to.be.true;
    });

    it("不应该允许重复参与", async function () {
      await lottery.connect(addr2).joinLottery(0);
      await expect(lottery.connect(addr2).joinLottery(0)).to.be.revertedWith("Already participated");
    });

    it("多个用户可以参与同一个抽签", async function () {
      await lottery.connect(addr2).joinLottery(0);
      await lottery.connect(addr3).joinLottery(0);

      const participants = await lottery.getParticipants(0);
      expect(participants).to.include(addr2.address);
      expect(participants).to.include(addr3.address);
    });
  });

  describe("开奖", function () {
    beforeEach(async function () {
      await lottery.connect(addr1).createLottery(3600); // 创建1小时的抽签
    });

    it("应该在抽签结束后能够开奖", async function () {
      // 先参与抽签
      await lottery.connect(addr2).joinLottery(0);
      await lottery.connect(addr3).joinLottery(0);

      // 使用 evm_increaseTime 增加时间
      await ethers.provider.send("evm_increaseTime", ["3601"]); // 增加1小时多1秒
      await ethers.provider.send("evm_mine", []); // 挖一个新区块

      await expect(lottery.connect(addr1).drawWinner(0)).to.emit(lottery, "WinnerPicked");

      const lotteryInfo = await lottery.getLotteryInfo(0);
      expect(lotteryInfo.winner).to.be.oneOf([addr2.address, addr3.address]);
      expect(lotteryInfo.isActive).to.be.false;
    });

    it("不应该在抽签结束前开奖", async function () {
      await expect(lottery.connect(addr1).drawWinner(0)).to.be.revertedWith("Lottery is still ongoing");
    });

    it("不应该在没有参与者时开奖", async function () {
      // 创建一个新的抽签但不参与
      await lottery.connect(addr1).createLottery(3600);

      // 使用 evm_increaseTime 增加时间
      await ethers.provider.send("evm_increaseTime", ["3601"]);
      await ethers.provider.send("evm_mine", []);

      await expect(lottery.connect(addr1).drawWinner(1)).to.be.revertedWith("No participants in the lottery");
    });

    it("不应该重复开奖", async function () {
      // 先参与抽签
      await lottery.connect(addr2).joinLottery(0);

      // 使用 evm_increaseTime 增加时间
      await ethers.provider.send("evm_increaseTime", ["3601"]);
      await ethers.provider.send("evm_mine", []);

      await lottery.connect(addr1).drawWinner(0);
      await expect(lottery.connect(addr1).drawWinner(0)).to.be.revertedWith("Lottery is not active");
    });
  });

  describe("查询功能", function () {
    beforeEach(async function () {
      await lottery.connect(addr1).createLottery(3600);
      await lottery.connect(addr2).createLottery(7200);
      await lottery.connect(addr2).joinLottery(0);
      await lottery.connect(addr3).joinLottery(0);
    });

    it("应该能够获取所有抽签信息", async function () {
      const allLotteries = await lottery.getAllLotteries();

      expect(allLotteries.lotteryIds).to.have.lengthOf(2);
      expect(allLotteries.lotteryIds[0]).to.equal(0);
      expect(allLotteries.lotteryIds[1]).to.equal(1);
      expect(allLotteries.participantCounts[0]).to.equal(2);
      expect(allLotteries.participantCounts[1]).to.equal(0);
    });

    it("应该能够检查是否已参与", async function () {
      expect(await lottery.hasParticipated(0, addr2.address)).to.be.true;
      expect(await lottery.hasParticipated(0, addr1.address)).to.be.false;
    });
  });
});
