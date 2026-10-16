const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("OracleManager", function () {
  let oracleManager;
  let owner;
  let oracle1;
  let oracle2;
  let oracle3;

  beforeEach(async function () {
    [owner, oracle1, oracle2, oracle3] = await ethers.getSigners();

    const OracleManager = await ethers.getContractFactory("OracleManager");
    oracleManager = await OracleManager.deploy();

    await oracleManager.registerOracle(oracle1.address);
    await oracleManager.registerOracle(oracle2.address);
    await oracleManager.registerOracle(oracle3.address);

    await oracleManager.connect(oracle1).bondOracle(oracle1.address, { value: ethers.parseEther("1") });
    await oracleManager.connect(oracle2).bondOracle(oracle2.address, { value: ethers.parseEther("1") });
    await oracleManager.connect(oracle3).bondOracle(oracle3.address, { value: ethers.parseEther("1") });
  });

  describe("Oracle Registration", function () {
    it("should register oracles correctly", async function () {
      expect(await oracleManager.getOracleCount()).to.equal(3);
    });

    it("should mark bonded oracles correctly", async function () {
      expect(await oracleManager.isOracleBonded(oracle1.address)).to.be.true;
      expect(await oracleManager.isOracleBonded(oracle2.address)).to.be.true;
    });

    it("should reject duplicate registrations", async function () {
      await expect(oracleManager.registerOracle(oracle1.address)).to.be.revertedWith(
        "Already registered"
      );
    });
  });

  describe("Price Reports", function () {
    it("should accept price reports from bonded oracles", async function () {
      const epochId = 1;
      const price = 1000000n;

      await expect(oracleManager.connect(oracle1).submitReport(epochId, price))
        .to.emit(oracleManager, "PriceReported")
        .withArgs(epochId, oracle1.address, price);

      expect(await oracleManager.getReportCount(epochId)).to.equal(1);
    });

    it("should reject duplicate reports from same oracle", async function () {
      const epochId = 1;
      const price = 1000000n;

      await oracleManager.connect(oracle1).submitReport(epochId, price);
      await expect(oracleManager.connect(oracle1).submitReport(epochId, price)).to.be.revertedWith(
        "Already reported"
      );
    });
  });

  describe("Median Computation", function () {
    it("should compute median with odd number of reports", async function () {
      const epochId = 1;

      await oracleManager.connect(oracle1).submitReport(epochId, 1000000n);
      await oracleManager.connect(oracle2).submitReport(epochId, 1100000n);
      await oracleManager.connect(oracle3).submitReport(epochId, 900000n);

      const medianPrice = await oracleManager.getEpochPrice(epochId);
      expect(medianPrice).to.equal(1000000n);
    });

    it("should compute median with even number of reports", async function () {
      const epochId = 1;

      await oracleManager.connect(oracle1).submitReport(epochId, 1000000n);
      await oracleManager.connect(oracle2).submitReport(epochId, 1100000n);

      const medianPrice = await oracleManager.getEpochPrice(epochId);
      expect(medianPrice).to.equal(1050000n);
    });

    it("should return 0 for epoch with no reports", async function () {
      const epochId = 999;
      const price = await oracleManager.getEpochPrice(epochId);
      expect(price).to.equal(0);
    });
  });

  describe("Oracle Slashing", function () {
    it("should allow owner to slash oracle bond", async function () {
      const initialBond = (await oracleManager.oracles(oracle1.address)).bondAmount;

      await oracleManager.slashOracle(oracle1.address, ethers.parseEther("0.5"));

      const newBond = (await oracleManager.oracles(oracle1.address)).bondAmount;
      expect(newBond).to.equal(initialBond - ethers.parseEther("0.5"));
    });

    it("should mark oracle as unbonded when bond depleted", async function () {
      await oracleManager.slashOracle(oracle1.address, ethers.parseEther("1"));

      expect(await oracleManager.isOracleBonded(oracle1.address)).to.be.false;
    });
  });
});

