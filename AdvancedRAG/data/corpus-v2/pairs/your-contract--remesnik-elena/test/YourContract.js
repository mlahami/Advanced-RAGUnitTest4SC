const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("YourContract - Escrow System", function () {
  let escrowContract;
  let owner;
  let buyer;
  let seller;
  let arbiter;
  let otherUser;

  const escrowAmount = ethers.parseEther("1.0");
  const arbiterFee = ethers.parseEther("0.05");
  const description = "Test product sale";

  beforeEach(async () => {
    [owner, buyer, seller, arbiter, otherUser] = await ethers.getSigners();

    const escrowContractFactory = await ethers.getContractFactory("YourContract");
    escrowContract = (await escrowContractFactory.deploy(owner.address));
    await escrowContract.waitForDeployment();
  });

  describe("Развертывание", function () {
    it("Должен установить правильного владельца", async function () {
      expect(await escrowContract.owner()).to.equal(owner.address);
    });

    it("Должен инициализировать счетчик эскроу с нуля", async function () {
      expect(await escrowContract.escrowCounter()).to.equal(0);
    });

    it("Должен установить начальную комиссию платформы", async function () {
      expect(await escrowContract.platformFeePercent()).to.equal(1);
    });

    it("Должен инициализировать общий объем с нуля", async function () {
      expect(await escrowContract.totalVolume()).to.equal(0);
    });
  });

  describe("Создание эскроу", function () {
    it("Должен создать эскроу с правильными параметрами", async function () {
      await escrowContract
        .connect(buyer)
        .createEscrow(seller.address, arbiter.address, arbiterFee, description, { value: escrowAmount });

      const escrow = await escrowContract.getEscrow(0);

      expect(escrow.id).to.equal(0);
      expect(escrow.buyer).to.equal(buyer.address);
      expect(escrow.seller).to.equal(seller.address);
      expect(escrow.arbiter).to.equal(arbiter.address);
      expect(escrow.amount).to.equal(escrowAmount);
      expect(escrow.arbiterFee).to.equal(arbiterFee);
      expect(escrow.status).to.equal(1); // FUNDED
      expect(escrow.description).to.equal(description);
    });

    it("Должен увеличить счетчик эскроу", async function () {
      await escrowContract
        .connect(buyer)
        .createEscrow(seller.address, arbiter.address, arbiterFee, description, { value: escrowAmount });

      expect(await escrowContract.escrowCounter()).to.equal(1);
    });

    it("Должен добавить эскроу в список пользователя", async function () {
      await escrowContract
        .connect(buyer)
        .createEscrow(seller.address, arbiter.address, arbiterFee, description, { value: escrowAmount });

      const buyerEscrows = await escrowContract.getUserEscrows(buyer.address);
      const sellerEscrows = await escrowContract.getUserEscrows(seller.address);

      expect(buyerEscrows.length).to.equal(1);
      expect(sellerEscrows.length).to.equal(1);
      expect(buyerEscrows[0]).to.equal(0);
      expect(sellerEscrows[0]).to.equal(0);
    });

    it("Должен обновить общий объем", async function () {
      await escrowContract
        .connect(buyer)
        .createEscrow(seller.address, arbiter.address, arbiterFee, description, { value: escrowAmount });

      expect(await escrowContract.totalVolume()).to.equal(escrowAmount);
    });

    it("Должен испустить событие EscrowCreated", async function () {
      await expect(
        escrowContract
          .connect(buyer)
          .createEscrow(seller.address, arbiter.address, arbiterFee, description, { value: escrowAmount }),
      )
        .to.emit(escrowContract, "EscrowCreated")
        .withArgs(0, buyer.address, seller.address, arbiter.address, escrowAmount, description);
    });

    it("Должен отклонить создание с нулевой суммой", async function () {
      await expect(
        escrowContract
          .connect(buyer)
          .createEscrow(seller.address, arbiter.address, arbiterFee, description, { value: 0 }),
      ).to.be.revertedWith("Amount must be greater than 0");
    });

    it("Должен отклонить создание с невалидным адресом продавца", async function () {
      await expect(
        escrowContract
          .connect(buyer)
          .createEscrow(ethers.ZeroAddress, arbiter.address, arbiterFee, description, { value: escrowAmount }),
      ).to.be.revertedWith("Invalid seller address");
    });

    it("Должен отклонить создание когда покупатель = продавец", async function () {
      await expect(
        escrowContract
          .connect(buyer)
          .createEscrow(buyer.address, arbiter.address, arbiterFee, description, { value: escrowAmount }),
      ).to.be.revertedWith("Buyer and seller cannot be the same");
    });

    it("Должен отклонить создание со слишком высокой комиссией арбитра", async function () {
      const highFee = ethers.parseEther("0.2"); // 20% от 1 ETH
      await expect(
        escrowContract
          .connect(buyer)
          .createEscrow(seller.address, arbiter.address, highFee, description, { value: escrowAmount }),
      ).to.be.revertedWith("Arbiter fee too high (max 10%)");
    });
  });

  describe("Подтверждение доставки", function () {
    beforeEach(async () => {
      await escrowContract
        .connect(buyer)
        .createEscrow(seller.address, arbiter.address, arbiterFee, description, { value: escrowAmount });
    });

    it("Должен позволить продавцу подтвердить доставку", async function () {
      await escrowContract.connect(seller).confirmDelivery(0);

      const escrow = await escrowContract.getEscrow(0);
      expect(escrow.status).to.equal(2); // DELIVERED
      expect(escrow.sellerApproved).to.equal(true);
    });

    it("Должен испустить событие EscrowDelivered", async function () {
      await expect(escrowContract.connect(seller).confirmDelivery(0))
        .to.emit(escrowContract, "EscrowDelivered")
        .withArgs(0, seller.address);
    });

    it("Должен отклонить подтверждение не продавцом", async function () {
      await expect(escrowContract.connect(buyer).confirmDelivery(0)).to.be.revertedWith("Only seller can call this");
    });

    it("Должен отклонить подтверждение в неправильном статусе", async function () {
      await escrowContract.connect(seller).confirmDelivery(0);

      await expect(escrowContract.connect(seller).confirmDelivery(0)).to.be.revertedWith("Invalid escrow status");
    });
  });

  describe("Подтверждение получения", function () {
    beforeEach(async () => {
      await escrowContract
        .connect(buyer)
        .createEscrow(seller.address, arbiter.address, arbiterFee, description, { value: escrowAmount });
      await escrowContract.connect(seller).confirmDelivery(0);
    });

    it("Должен позволить покупателю подтвердить получение", async function () {
      await escrowContract.connect(buyer).confirmReceipt(0);

      const escrow = await escrowContract.getEscrow(0);
      expect(escrow.status).to.equal(3); // COMPLETED
      expect(escrow.buyerApproved).to.equal(true);
    });

    it("Должен перевести средства на ожидающий вывод продавцу", async function () {
      await escrowContract.connect(buyer).confirmReceipt(0);

      const platformFee = (escrowAmount * 1n) / 100n; // 1%
      const sellerAmount = escrowAmount - platformFee;

      expect(await escrowContract.getPendingWithdrawal(seller.address)).to.equal(sellerAmount);
      expect(await escrowContract.getPendingWithdrawal(owner.address)).to.equal(platformFee);
    });

    it("Должен испустить событие EscrowCompleted", async function () {
      const tx = await escrowContract.connect(buyer).confirmReceipt(0);
      const receipt = await tx.wait();
      const block = await ethers.provider.getBlock(receipt .blockNumber);

      await expect(tx).to.emit(escrowContract, "EscrowCompleted").withArgs(0, block .timestamp);
    });

    it("Должен отклонить подтверждение не покупателем", async function () {
      await expect(escrowContract.connect(seller).confirmReceipt(0)).to.be.revertedWith("Only buyer can call this");
    });
  });

  describe("Открытие спора", function () {
    beforeEach(async () => {
      await escrowContract
        .connect(buyer)
        .createEscrow(seller.address, arbiter.address, arbiterFee, description, { value: escrowAmount });
    });

    it("Должен позволить покупателю открыть спор", async function () {
      await escrowContract.connect(buyer).raiseDispute(0);

      const escrow = await escrowContract.getEscrow(0);
      expect(escrow.status).to.equal(4); // DISPUTED
    });

    it("Должен позволить продавцу открыть спор", async function () {
      await escrowContract.connect(seller).raiseDispute(0);

      const escrow = await escrowContract.getEscrow(0);
      expect(escrow.status).to.equal(4); // DISPUTED
    });

    it("Должен испустить событие EscrowDisputed", async function () {
      await expect(escrowContract.connect(buyer).raiseDispute(0))
        .to.emit(escrowContract, "EscrowDisputed")
        .withArgs(0, buyer.address);
    });

    it("Должен отклонить открытие спора другим пользователем", async function () {
      await expect(escrowContract.connect(otherUser).raiseDispute(0)).to.be.revertedWith(
        "Only buyer or seller can raise dispute",
      );
    });
  });

  describe("Разрешение спора", function () {
    beforeEach(async () => {
      await escrowContract
        .connect(buyer)
        .createEscrow(seller.address, arbiter.address, arbiterFee, description, { value: escrowAmount });
      await escrowContract.connect(buyer).raiseDispute(0);
    });

    it("Должен разрешить спор в пользу покупателя", async function () {
      await escrowContract.connect(arbiter).resolveDispute(0, true);

      const escrow = await escrowContract.getEscrow(0);
      expect(escrow.status).to.equal(5); // REFUNDED

      const refundAmount = escrowAmount - arbiterFee;
      expect(await escrowContract.getPendingWithdrawal(buyer.address)).to.equal(refundAmount);
      expect(await escrowContract.getPendingWithdrawal(arbiter.address)).to.equal(arbiterFee);
    });

    it("Должен разрешить спор в пользу продавца", async function () {
      await escrowContract.connect(arbiter).resolveDispute(0, false);

      const escrow = await escrowContract.getEscrow(0);
      expect(escrow.status).to.equal(3); // COMPLETED

      const amountAfterArbiter = escrowAmount - arbiterFee;
      const platformFee = (amountAfterArbiter * 1n) / 100n;
      const sellerAmount = amountAfterArbiter - platformFee;

      expect(await escrowContract.getPendingWithdrawal(seller.address)).to.equal(sellerAmount);
      expect(await escrowContract.getPendingWithdrawal(arbiter.address)).to.equal(arbiterFee);
    });

    it("Должен испустить событие DisputeResolved", async function () {
      const refundAmount = escrowAmount - arbiterFee;

      await expect(escrowContract.connect(arbiter).resolveDispute(0, true))
        .to.emit(escrowContract, "DisputeResolved")
        .withArgs(0, buyer.address, refundAmount);
    });

    it("Должен отклонить разрешение не арбитром", async function () {
      await expect(escrowContract.connect(buyer).resolveDispute(0, true)).to.be.revertedWith(
        "Only arbiter can call this",
      );
    });
  });

  describe("Отмена эскроу", function () {
    beforeEach(async () => {
      await escrowContract
        .connect(buyer)
        .createEscrow(seller.address, arbiter.address, arbiterFee, description, { value: escrowAmount });
    });

    it("Должен позволить покупателю отменить эскроу", async function () {
      await escrowContract.connect(buyer).cancelEscrow(0);

      const escrow = await escrowContract.getEscrow(0);
      expect(escrow.status).to.equal(6); // CANCELLED
      expect(await escrowContract.getPendingWithdrawal(buyer.address)).to.equal(escrowAmount);
    });

    it("Должен позволить продавцу отменить эскроу", async function () {
      await escrowContract.connect(seller).cancelEscrow(0);

      const escrow = await escrowContract.getEscrow(0);
      expect(escrow.status).to.equal(6); // CANCELLED
    });

    it("Должен испустить события EscrowCancelled и EscrowRefunded", async function () {
      await expect(escrowContract.connect(buyer).cancelEscrow(0))
        .to.emit(escrowContract, "EscrowCancelled")
        .withArgs(0)
        .and.to.emit(escrowContract, "EscrowRefunded")
        .withArgs(0, escrowAmount);
    });

    it("Должен отклонить отмену другим пользователем", async function () {
      await expect(escrowContract.connect(otherUser).cancelEscrow(0)).to.be.revertedWith(
        "Only buyer or seller can cancel",
      );
    });
  });

  describe("Вывод средств", function () {
    beforeEach(async () => {
      await escrowContract
        .connect(buyer)
        .createEscrow(seller.address, arbiter.address, arbiterFee, description, { value: escrowAmount });
      await escrowContract.connect(seller).confirmDelivery(0);
      await escrowContract.connect(buyer).confirmReceipt(0);
    });

    it("Должен позволить продавцу вывести средства", async function () {
      const pendingAmount = await escrowContract.getPendingWithdrawal(seller.address);
      const initialBalance = await ethers.provider.getBalance(seller.address);

      const tx = await escrowContract.connect(seller).withdraw();
      const receipt = await tx.wait();
      const gasCost = receipt .gasUsed * receipt .gasPrice;

      const finalBalance = await ethers.provider.getBalance(seller.address);

      expect(finalBalance).to.equal(initialBalance + pendingAmount - gasCost);
      expect(await escrowContract.getPendingWithdrawal(seller.address)).to.equal(0);
    });

    it("Должен испустить событие WithdrawalProcessed", async function () {
      const pendingAmount = await escrowContract.getPendingWithdrawal(seller.address);

      await expect(escrowContract.connect(seller).withdraw())
        .to.emit(escrowContract, "WithdrawalProcessed")
        .withArgs(seller.address, pendingAmount);
    });

    it("Должен отклонить вывод без доступных средств", async function () {
      await expect(escrowContract.connect(otherUser).withdraw()).to.be.revertedWith("No funds to withdraw");
    });
  });

  describe("Обновление комиссии платформы", function () {
    it("Должен позволить владельцу обновить комиссию", async function () {
      await escrowContract.connect(owner).updatePlatformFee(2);
      expect(await escrowContract.platformFeePercent()).to.equal(2);
    });

    it("Должен отклонить обновление не владельцем", async function () {
      await expect(escrowContract.connect(buyer).updatePlatformFee(2)).to.be.revertedWith("Not the owner");
    });

    it("Должен отклонить слишком высокую комиссию", async function () {
      await expect(escrowContract.connect(owner).updatePlatformFee(6)).to.be.revertedWith("Fee too high (max 5%)");
    });
  });

  describe("Статистика платформы", function () {
    it("Должен вернуть правильную статистику", async function () {
      await escrowContract
        .connect(buyer)
        .createEscrow(seller.address, arbiter.address, arbiterFee, description, { value: escrowAmount });

      const stats = await escrowContract.getPlatformStats();

      expect(stats[0]).to.equal(1); // totalEscrows
      expect(stats[1]).to.equal(escrowAmount); // totalVolume
      expect(stats[2]).to.equal(1); // platformFeePercent
    });
  });

  describe("Получение данных", function () {
    it("Должен вернуть детали эскроу", async function () {
      await escrowContract
        .connect(buyer)
        .createEscrow(seller.address, arbiter.address, arbiterFee, description, { value: escrowAmount });

      const escrow = await escrowContract.getEscrow(0);
      expect(escrow.buyer).to.equal(buyer.address);
      expect(escrow.seller).to.equal(seller.address);
    });

    it("Должен отклонить получение несуществующего эскроу", async function () {
      await expect(escrowContract.getEscrow(999)).to.be.revertedWith("Escrow does not exist");
    });

    it("Должен вернуть эскроу пользователя", async function () {
      await escrowContract
        .connect(buyer)
        .createEscrow(seller.address, arbiter.address, arbiterFee, description, { value: escrowAmount });

      const escrows = await escrowContract.getUserEscrows(buyer.address);
      expect(escrows.length).to.equal(1);
      expect(escrows[0]).to.equal(0);
    });
  });
});
