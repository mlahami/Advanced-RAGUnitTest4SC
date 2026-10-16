const {
  loadFixture,
} = require("@nomicfoundation/hardhat-network-helpers");
const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("HeadSoccerRubies Deploy", function () {
  async function deployFixture() {
    const [owner, otherAccount1, otherAccount2] = await ethers.getSigners();

    const TestToken = await ethers.getContractFactory("TestToken");
    const tokenTest = await TestToken.deploy(ethers.parseEther("100"), owner);

    const HeadSoccerRubies = await ethers.getContractFactory(
      "HeadSoccerRubies"
    );
    const RubiesToken = await HeadSoccerRubies.deploy(
      otherAccount1,
      await tokenTest.getAddress()
    );
    const user1 = await RubiesToken.connect(otherAccount1);
    const user2 = await RubiesToken.connect(otherAccount2);

    return {
      owner,
      RubiesToken,
      otherAccount1,
      otherAccount2,
      user1,
      user2,
      tokenTest,
    };
  }

  describe("Deployment", function () {
    it("Should set the right owner and role", async function () {
      const { owner, RubiesToken, tokenTest, otherAccount1 } =
        await loadFixture(deployFixture);
      expect(await tokenTest.balanceOf(owner.address)).to.equal(
        ethers.parseEther("100")
      );
      const defaultRole =
        "0x0000000000000000000000000000000000000000000000000000000000000000";
      const frontRole = await RubiesToken.FRONTEND_WALLET();
      expect(await RubiesToken.hasRole(defaultRole, owner.address)).to.be.true;
      expect(await RubiesToken.hasRole(frontRole, otherAccount1.address)).to.be
        .true;
    });
  });

  describe("ChangeCommission", function () {
    it("Function changeCommission work right", async function () {
      const { RubiesToken } = await loadFixture(deployFixture);
      await RubiesToken.changeCommission(33);
      expect(await RubiesToken.commissions()).to.equal(33);
    });

    it("Function changeCommission to be revert", async function () {
      const { otherAccount1, RubiesToken } = await loadFixture(deployFixture);
      await expect(RubiesToken.changeCommission(101)).to.be.reverted;
      const user1 = await RubiesToken.connect(otherAccount1);
      await expect(user1.changeCommission(10)).to.be.reverted;
    });
  });

  describe("ChangeERC20toRubie and changeRubieToERC20", function () {
    it("Functions change work right", async function () {
      const { RubiesToken, tokenTest, owner } = await loadFixture(
        deployFixture
      );
      const tokenTestAddress = await tokenTest.getAddress();
      const tokenRubiesAddress = await RubiesToken.getAddress();

      await tokenTest.approve(tokenRubiesAddress, ethers.parseEther("10"));
      const changeTokens = await RubiesToken.changeERC20toRubie(
        ethers.parseEther("10")
      );

      await expect(changeTokens).to.changeTokenBalances(
        RubiesToken,
        [owner.address, tokenRubiesAddress],
        [ethers.parseEther("100"), 0]
      );
      await expect(changeTokens).to.changeTokenBalances(
        tokenTest,
        [owner.address, tokenRubiesAddress],
        [-10000000, 10000000]
      );

      await expect(changeTokens)
        .to.emit(RubiesToken, "ChangeERC20toRubies")
        .withArgs(ethers.parseEther("10"), tokenTestAddress);

      await expect(RubiesToken.changeRubieToERC20(ethers.parseEther("101"))).to
        .be.reverted;

      const changeTokensToRubie = await RubiesToken.changeRubieToERC20(
        ethers.parseEther("10")
      );

      await expect(changeTokensToRubie).to.changeTokenBalances(
        RubiesToken,
        [owner.address, tokenRubiesAddress],
        [-ethers.parseEther("10"), 0]
      );
      await expect(changeTokensToRubie).to.changeTokenBalances(
        tokenTest,
        [owner.address, tokenRubiesAddress],
        [1000000n, -1000000n]
      );

      await expect(changeTokensToRubie)
        .to.emit(RubiesToken, "ChangeRubiesToERC20")
        .withArgs(ethers.parseEther("10"), tokenTestAddress);
    });
  });

  describe("changeRubieToThings", function () {
    it("Function changeRubieToThings work right", async function () {
      const { owner, RubiesToken, tokenTest } = await loadFixture(
        deployFixture
      );

      await tokenTest.getAddress();
      const tokenRubiesAddress = await RubiesToken.getAddress();
      await tokenTest.approve(tokenRubiesAddress, ethers.parseEther("10"));
      await RubiesToken.changeERC20toRubie(ethers.parseEther("10"));

      await expect(RubiesToken.changeRubieToThings(ethers.parseEther("101"))).to
        .be.reverted;
      const changeRubies = await RubiesToken.changeRubieToThings(
        ethers.parseEther("50")
      );

      await expect(changeRubies).to.changeTokenBalances(
        RubiesToken,
        [tokenRubiesAddress, owner.address],
        [ethers.parseEther("0"), -ethers.parseEther("50")]
      );
      await expect(changeRubies).to.changeTokenBalances(
        tokenTest,
        [tokenRubiesAddress, owner.address],
        [-5000000n, 5000000n]
      );

      await expect(changeRubies)
        .to.emit(RubiesToken, "ChangeRubies")
        .withArgs(ethers.parseEther("50"));
    });
  });

  describe("startGame", function () {
    it("Function startGame work right", async function () {
      const { otherAccount2, tokenTest, owner, user1, user2, RubiesToken } =
        await loadFixture(deployFixture);

      await tokenTest.getAddress();
      const tokenRubiesAddress = await RubiesToken.getAddress();
      await tokenTest.approve(tokenRubiesAddress, ethers.parseEther("10"));
      await RubiesToken.changeERC20toRubie(ethers.parseEther("10"));
      await RubiesToken.transfer(
        otherAccount2.address,
        ethers.parseEther("20")
      );

      await expect(
        user2.startGame(
          owner.address,
          otherAccount2.address,
          ethers.parseEther("20")
        )
      ).to.be.reverted;

      const startGame = await user1.startGame(
        owner.address,
        otherAccount2.address,
        ethers.parseEther("20")
      );

      await expect(startGame).to.changeTokenBalances(
        RubiesToken,
        [otherAccount2.address, owner.address, tokenRubiesAddress],
        [-ethers.parseEther("20"), -ethers.parseEther("20"), 0]
      );
      await expect(startGame).to.changeTokenBalances(
        tokenTest,
        [otherAccount2.address, owner.address, tokenRubiesAddress],
        [0, 800000n, -800000n]
      );

      await expect(startGame)
        .to.emit(RubiesToken, "StartGameEvent")
        .withArgs(
          ethers.parseEther("20"),
          owner.address,
          otherAccount2.address
        );
    });
  });

  describe("finishGame", function () {
    it("Function finishGame work right", async function () {
      const { owner, RubiesToken, tokenTest, user2, user1 } = await loadFixture(
        deployFixture
      );
      const tokenRubiesAddress = await RubiesToken.getAddress();

      await expect(user2.finishGame(owner.address, ethers.parseEther("10"))).to
        .be.reverted;
      const finishGame = await user1.finishGame(
        owner.address,
        ethers.parseEther("50")
      );

      await expect(finishGame).to.changeTokenBalances(
        RubiesToken,
        [tokenRubiesAddress, owner.address],
        [ethers.parseEther("0"), ethers.parseEther("50")]
      );
      await expect(finishGame).to.changeTokenBalances(
        tokenTest,
        [tokenRubiesAddress, owner.address],
        [0, 0]
      );

      await expect(finishGame)
        .to.emit(RubiesToken, "FinishGameEvent")
        .withArgs(owner.address, ethers.parseEther("50"));
    });
  });

  describe("changeConversion", function () {
    it("Function changeConversion work right", async function () {
      const { owner, RubiesToken, tokenTest } = await loadFixture(
        deployFixture
      );
      const tokenRubiesAddress = await RubiesToken.getAddress();

      await RubiesToken.changeConversion(100);

      await expect(RubiesToken.changeConversion(0)).to.be.reverted;
      await tokenTest.approve(tokenRubiesAddress, ethers.parseEther("10"));
      const changeTokens = await RubiesToken.changeERC20toRubie(
        ethers.parseEther("10")
      );

      await expect(changeTokens).to.changeTokenBalances(
        RubiesToken,
        [tokenRubiesAddress, owner.address],
        [ethers.parseEther("0"), ethers.parseEther("1000")]
      );
      await expect(changeTokens).to.changeTokenBalances(
        tokenTest,
        [tokenRubiesAddress, owner.address],
        [10000000n, -10000000n]
      );
    });
  });
});
