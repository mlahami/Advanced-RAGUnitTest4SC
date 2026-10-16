const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("InterestRateModel", function () {
  let interestRateModel;

  beforeEach(async function () {
    const InterestRateModelFactory = await ethers.getContractFactory("InterestRateModel");
    interestRateModel = await InterestRateModelFactory.deploy();
  });

  describe("Deployment", function () {
    it("should deploy with correct constants", async function () {
      expect(await interestRateModel.OPTIMAL_UTILIZATION()).to.equal(80);
      expect(await interestRateModel.BASE_RATE()).to.equal(0);
      expect(await interestRateModel.SLOPE_1()).to.equal(4);
      expect(await interestRateModel.SLOPE_2()).to.equal(60);
    });
  });

  describe("Calculate Borrow Rate - Slope 1 (0% to 80% utilization)", function () {
    it("should return 0% at 0% utilization", async function () {
      const totalBorrowed = 0;
      const totalSupplied = ethers.parseEther("1000");

      const borrowRate = await interestRateModel.calculateBorrowRate(
        totalBorrowed,
        totalSupplied
      );

      // 0% = 0 basis points
      expect(borrowRate).to.equal(0);
    });

    it("should return 2% at 40% utilization", async function () {
      const totalSupplied = ethers.parseEther("1000");
      const totalBorrowed = ethers.parseEther("400"); // 40% utilization

      const borrowRate = await interestRateModel.calculateBorrowRate(
        totalBorrowed,
        totalSupplied
      );

      // At 40% utilization (halfway to optimal):
      // borrowRate = (40 * 4) / 80 = 2%
      // 2% = 200 basis points
      expect(borrowRate).to.equal(200);
    });

    it("should return 4% at 80% utilization (optimal)", async function () {
      const totalSupplied = ethers.parseEther("1000");
      const totalBorrowed = ethers.parseEther("800"); // 80% utilization

      const borrowRate = await interestRateModel.calculateBorrowRate(
        totalBorrowed,
        totalSupplied
      );

      // At 80% utilization (optimal):
      // borrowRate = (80 * 4) / 80 = 4%
      // 4% = 400 basis points
      expect(borrowRate).to.equal(400);
    });

    it("should return 1% at 20% utilization", async function () {
      const totalSupplied = ethers.parseEther("1000");
      const totalBorrowed = ethers.parseEther("200"); // 20% utilization

      const borrowRate = await interestRateModel.calculateBorrowRate(
        totalBorrowed,
        totalSupplied
      );

      // At 20% utilization:
      // borrowRate = (20 * 4) / 80 = 1%
      // 1% = 100 basis points
      expect(borrowRate).to.equal(100);
    });
  });

  describe("Calculate Borrow Rate - Slope 2 (80% to 100% utilization)", function () {
    it("should return 34% at 90% utilization", async function () {
      const totalSupplied = ethers.parseEther("1000");
      const totalBorrowed = ethers.parseEther("900"); // 90% utilization

      const borrowRate = await interestRateModel.calculateBorrowRate(
        totalBorrowed,
        totalSupplied
      );

      // At 90% utilization:
      // borrowRate = 4% + ((90 - 80) * 60) / 20 = 4% + 30% = 34%
      // 34% = 3400 basis points
      expect(borrowRate).to.equal(3400);
    });

    it("should return 64% at 100% utilization", async function () {
      const totalSupplied = ethers.parseEther("1000");
      const totalBorrowed = ethers.parseEther("1000"); // 100% utilization

      const borrowRate = await interestRateModel.calculateBorrowRate(
        totalBorrowed,
        totalSupplied
      );

      // At 100% utilization:
      // borrowRate = 4% + ((100 - 80) * 60) / 20 = 4% + 60% = 64%
      // 64% = 6400 basis points
      expect(borrowRate).to.equal(6400);
    });

    it("should return 19% at 85% utilization", async function () {
      const totalSupplied = ethers.parseEther("1000");
      const totalBorrowed = ethers.parseEther("850"); // 85% utilization

      const borrowRate = await interestRateModel.calculateBorrowRate(
        totalBorrowed,
        totalSupplied
      );

      // At 85% utilization:
      // borrowRate = 4% + ((85 - 80) * 60) / 20 = 4% + 15% = 19%
      // 19% = 1900 basis points
      expect(borrowRate).to.equal(1900);
    });
  });

  describe("Edge Cases", function () {
    it("should return base rate when totalSupplied is 0", async function () {
      const totalBorrowed = 0;
      const totalSupplied = 0;

      const borrowRate = await interestRateModel.calculateBorrowRate(
        totalBorrowed,
        totalSupplied
      );

      // Should return 0% (base rate)
      expect(borrowRate).to.equal(0);
    });

    it("should handle totalBorrowed > totalSupplied gracefully", async function () {
      const totalSupplied = ethers.parseEther("1000");
      const totalBorrowed = ethers.parseEther("1100"); // 110% utilization

      const borrowRate = await interestRateModel.calculateBorrowRate(
        totalBorrowed,
        totalSupplied
      );

      // Should cap at or handle 100%+ utilization
      // In this case, treat as 100% utilization = 6400 basis points
      expect(borrowRate).to.be.gte(6400);
    });

    it("should handle very small amounts correctly", async function () {
      const totalSupplied = 100; // Very small amount
      const totalBorrowed = 40; // 40% utilization

      const borrowRate = await interestRateModel.calculateBorrowRate(
        totalBorrowed,
        totalSupplied
      );

      // Should still return 2% = 200 basis points
      expect(borrowRate).to.equal(200);
    });

    it("should handle very large amounts correctly", async function () {
      const totalSupplied = ethers.parseEther("1000000000"); // 1B tokens
      const totalBorrowed = ethers.parseEther("800000000"); // 80% utilization

      const borrowRate = await interestRateModel.calculateBorrowRate(
        totalBorrowed,
        totalSupplied
      );

      // Should return 4% = 400 basis points
      expect(borrowRate).to.equal(400);
    });
  });

  describe("Gas Optimization", function () {
    it("should have reasonable deployment gas cost", async function () {
      const InterestRateModelFactory = await ethers.getContractFactory("InterestRateModel");
      const deployTx = await InterestRateModelFactory.getDeployTransaction();
      const estimatedGas = await ethers.provider.estimateGas(deployTx);

      // Should be under 400k gas (includes coverage instrumentation overhead)
      expect(estimatedGas).to.be.lessThan(400_000);
    });

    it("should have low gas cost for rate calculation", async function () {
      const totalSupplied = ethers.parseEther("1000");
      const totalBorrowed = ethers.parseEther("900");

      // For pure/view functions, estimateGas includes transaction overhead
      // The actual computation is very cheap, but estimation includes ~21k base cost
      const gasEstimate = await interestRateModel.calculateBorrowRate.estimateGas(
        totalBorrowed,
        totalSupplied
      );

      // Should be under 30k gas (includes 21k transaction overhead)
      expect(gasEstimate).to.be.lessThan(30_000);
    });
  });

  describe("Precision and Accuracy", function () {
    it("should calculate rates accurately with decimal percentages", async function () {
      const totalSupplied = ethers.parseEther("1000");
      const totalBorrowed = ethers.parseEther("500"); // 50% utilization

      const borrowRate = await interestRateModel.calculateBorrowRate(
        totalBorrowed,
        totalSupplied
      );

      // At 50% utilization:
      // borrowRate = (50 * 4) / 80 = 2.5%
      // 2.5% = 250 basis points
      expect(borrowRate).to.equal(250);
    });

    it("should handle fractional utilization rates", async function () {
      const totalSupplied = ethers.parseEther("1000");
      const totalBorrowed = ethers.parseEther("333"); // ~33.3% utilization

      const borrowRate = await interestRateModel.calculateBorrowRate(
        totalBorrowed,
        totalSupplied
      );

      // Should be approximately 1.665% = ~166-167 basis points
      expect(borrowRate).to.be.closeTo(166, 1);
    });
  });
});
