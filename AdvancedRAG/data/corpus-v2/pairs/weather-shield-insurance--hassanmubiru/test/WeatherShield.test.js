const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

describe("WeatherShieldInsurance", function () {
  let flareDataConnector;
  let weatherShieldInsurance;
  let weatherOracle;
  let owner;
  let farmer1;
  let farmer2;
  let treasury;

  const TRIGGER_TYPES = {
    RainfallBelow: 0,
    RainfallAbove: 1,
    TemperatureBelow: 2,
    TemperatureAbove: 3,
    WindSpeedAbove: 4,
  };

  const POLICY_STATUS = {
    Active: 0,
    Expired: 1,
    ClaimPaid: 2,
    Cancelled: 3,
  };

  // Test location hash
  let testLocationHash;

  beforeEach(async function () {
    [owner, farmer1, farmer2, treasury] = await ethers.getSigners();

    // Deploy FlareDataConnector
    const FlareDataConnector = await ethers.getContractFactory("FlareDataConnector");
    flareDataConnector = await FlareDataConnector.deploy();
    await flareDataConnector.waitForDeployment();

    // Deploy WeatherShieldInsurance
    const WeatherShieldInsurance = await ethers.getContractFactory("WeatherShieldInsurance");
    weatherShieldInsurance = await WeatherShieldInsurance.deploy(
      await flareDataConnector.getAddress(),
      treasury.address
    );
    await weatherShieldInsurance.waitForDeployment();

    // Deploy WeatherOracle
    const WeatherOracle = await ethers.getContractFactory("WeatherOracle");
    weatherOracle = await WeatherOracle.deploy(await flareDataConnector.getAddress());
    await weatherOracle.waitForDeployment();

    // Authorize oracle as FDC provider
    await flareDataConnector.authorizeProvider(await weatherOracle.getAddress());

    // Create test location hash
    testLocationHash = await flareDataConnector.createLocationHash(41900000, -93100000);

    // Fund treasury
    await weatherShieldInsurance.fundTreasury({ value: ethers.parseEther("10") });
  });

  describe("Deployment", function () {
    it("Should set the correct FDC address", async function () {
      expect(await weatherShieldInsurance.flareDataConnector()).to.equal(
        await flareDataConnector.getAddress()
      );
    });

    it("Should set the correct treasury address", async function () {
      expect(await weatherShieldInsurance.treasury()).to.equal(treasury.address);
    });

    it("Should set the correct owner", async function () {
      expect(await weatherShieldInsurance.owner()).to.equal(owner.address);
    });

    it("Should have funded treasury", async function () {
      expect(await weatherShieldInsurance.treasuryBalance()).to.equal(ethers.parseEther("10"));
    });
  });

  describe("Policy Creation", function () {
    it("Should create a policy with correct parameters", async function () {
      const coverageAmount = ethers.parseEther("1");
      const duration = 30 * 24 * 60 * 60; // 30 days
      const premium = await weatherShieldInsurance.calculatePremium(
        coverageAmount,
        duration,
        TRIGGER_TYPES.RainfallBelow
      );

      await expect(
        weatherShieldInsurance.connect(farmer1).createPolicy(
          testLocationHash,
          TRIGGER_TYPES.RainfallBelow,
          5000, // 50mm threshold
          coverageAmount,
          duration,
          "Corn",
          50000, // 500 hectares
          { value: premium }
        )
      )
        .to.emit(weatherShieldInsurance, "PolicyCreated")
        .withArgs(1, farmer1.address, testLocationHash);

      const policy = await weatherShieldInsurance.getPolicy(1);
      expect(policy.policyholder).to.equal(farmer1.address);
      expect(policy.locationHash).to.equal(testLocationHash);
      expect(policy.triggerType).to.equal(TRIGGER_TYPES.RainfallBelow);
      expect(policy.triggerThreshold).to.equal(5000);
      expect(policy.coverageAmount).to.equal(coverageAmount);
      expect(policy.status).to.equal(POLICY_STATUS.Active);
      expect(policy.cropType).to.equal("Corn");
      expect(policy.farmSize).to.equal(50000);
    });

    it("Should reject insufficient premium", async function () {
      const coverageAmount = ethers.parseEther("1");
      const duration = 30 * 24 * 60 * 60;

      await expect(
        weatherShieldInsurance.connect(farmer1).createPolicy(
          testLocationHash,
          TRIGGER_TYPES.RainfallBelow,
          5000,
          coverageAmount,
          duration,
          "Corn",
          50000,
          { value: ethers.parseEther("0.0001") } // Too low
        )
      ).to.be.revertedWith("WS: insufficient premium");
    });

    it("Should reject coverage below minimum", async function () {
      await expect(
        weatherShieldInsurance.connect(farmer1).createPolicy(
          testLocationHash,
          TRIGGER_TYPES.RainfallBelow,
          5000,
          ethers.parseEther("0.001"), // Below min
          30 * 24 * 60 * 60,
          "Corn",
          50000,
          { value: ethers.parseEther("0.1") }
        )
      ).to.be.revertedWith("WS: coverage too low");
    });

    it("Should reject duration below minimum", async function () {
      await expect(
        weatherShieldInsurance.connect(farmer1).createPolicy(
          testLocationHash,
          TRIGGER_TYPES.RainfallBelow,
          5000,
          ethers.parseEther("0.1"),
          1 * 24 * 60 * 60, // 1 day - too short
          "Corn",
          50000,
          { value: ethers.parseEther("0.1") }
        )
      ).to.be.revertedWith("WS: duration too short");
    });

    it("Should refund excess premium", async function () {
      const coverageAmount = ethers.parseEther("1");
      const duration = 30 * 24 * 60 * 60;
      const premium = await weatherShieldInsurance.calculatePremium(
        coverageAmount,
        duration,
        TRIGGER_TYPES.RainfallBelow
      );
      const excess = ethers.parseEther("0.5");
      const totalSent = premium + excess;

      const balanceBefore = await ethers.provider.getBalance(farmer1.address);

      const tx = await weatherShieldInsurance.connect(farmer1).createPolicy(
        testLocationHash,
        TRIGGER_TYPES.RainfallBelow,
        5000,
        coverageAmount,
        duration,
        "Corn",
        50000,
        { value: totalSent }
      );

      const receipt = await tx.wait();
      const gasUsed = receipt.gasUsed * receipt.gasPrice;
      const balanceAfter = await ethers.provider.getBalance(farmer1.address);

      // Balance should decrease by premium + gas, not by total sent
      expect(balanceBefore - balanceAfter - gasUsed).to.be.closeTo(premium, ethers.parseEther("0.001"));
    });
  });

  describe("Policy Cancellation", function () {
    beforeEach(async function () {
      const coverageAmount = ethers.parseEther("1");
      const duration = 30 * 24 * 60 * 60;
      const premium = await weatherShieldInsurance.calculatePremium(
        coverageAmount,
        duration,
        TRIGGER_TYPES.RainfallBelow
      );

      await weatherShieldInsurance.connect(farmer1).createPolicy(
        testLocationHash,
        TRIGGER_TYPES.RainfallBelow,
        5000,
        coverageAmount,
        duration,
        "Corn",
        50000,
        { value: premium }
      );
    });

    it("Should allow policyholder to cancel", async function () {
      await expect(weatherShieldInsurance.connect(farmer1).cancelPolicy(1))
        .to.emit(weatherShieldInsurance, "PolicyCancelled")
        .withArgs(1, farmer1.address);

      const policy = await weatherShieldInsurance.getPolicy(1);
      expect(policy.status).to.equal(POLICY_STATUS.Cancelled);
    });

    it("Should not allow non-policyholder to cancel", async function () {
      await expect(
        weatherShieldInsurance.connect(farmer2).cancelPolicy(1)
      ).to.be.revertedWith("WS: not policyholder");
    });

    it("Should provide partial refund on cancellation", async function () {
      const balanceBefore = await ethers.provider.getBalance(farmer1.address);

      // Move time forward by 10 days
      await time.increase(10 * 24 * 60 * 60);

      const tx = await weatherShieldInsurance.connect(farmer1).cancelPolicy(1);
      const receipt = await tx.wait();
      const gasUsed = receipt.gasUsed * receipt.gasPrice;

      const balanceAfter = await ethers.provider.getBalance(farmer1.address);

      // Should have received some refund (minus gas)
      expect(balanceAfter + gasUsed).to.be.gt(balanceBefore);
    });
  });

  describe("Claim Processing", function () {
    let policyId;

    beforeEach(async function () {
      const coverageAmount = ethers.parseEther("1");
      const duration = 30 * 24 * 60 * 60;
      const premium = await weatherShieldInsurance.calculatePremium(
        coverageAmount,
        duration,
        TRIGGER_TYPES.RainfallBelow
      );

      const tx = await weatherShieldInsurance.connect(farmer1).createPolicy(
        testLocationHash,
        TRIGGER_TYPES.RainfallBelow,
        5000, // 50mm threshold
        coverageAmount,
        duration,
        "Corn",
        50000,
        { value: premium }
      );

      const receipt = await tx.wait();
      policyId = 1;
    });

    it("Should initiate a claim", async function () {
      await expect(weatherShieldInsurance.connect(farmer1).initiateClaim(policyId))
        .to.emit(weatherShieldInsurance, "ClaimInitiated")
        .withArgs(1, policyId, farmer1.address);

      const claim = await weatherShieldInsurance.getClaim(1);
      expect(claim.policyId).to.equal(policyId);
      expect(claim.processed).to.equal(false);
    });

    it("Should process claim and payout when trigger met", async function () {
      // Initiate claim
      await weatherShieldInsurance.connect(farmer1).initiateClaim(policyId);
      const claim = await weatherShieldInsurance.getClaim(1);

      // Fulfill weather data with rainfall below threshold (drought)
      await flareDataConnector.fulfillWeatherData(
        claim.weatherDataRequestId,
        2500, // 25°C
        3000, // 30mm - below 50mm threshold
        6500, // 65% humidity
        1500  // 15 km/h wind
      );

      const balanceBefore = await ethers.provider.getBalance(farmer1.address);

      // Process claim
      const tx = await weatherShieldInsurance.processClaim(1);
      const receipt = await tx.wait();

      const balanceAfter = await ethers.provider.getBalance(farmer1.address);

      // Farmer should have received payout
      expect(balanceAfter).to.be.gt(balanceBefore);

      // Check claim status
      const processedClaim = await weatherShieldInsurance.getClaim(1);
      expect(processedClaim.processed).to.equal(true);
      expect(processedClaim.payoutAmount).to.equal(ethers.parseEther("1"));

      // Check policy status
      const policy = await weatherShieldInsurance.getPolicy(policyId);
      expect(policy.status).to.equal(POLICY_STATUS.ClaimPaid);
    });

    it("Should not payout when trigger not met", async function () {
      // Initiate claim
      await weatherShieldInsurance.connect(farmer1).initiateClaim(policyId);
      const claim = await weatherShieldInsurance.getClaim(1);

      // Fulfill weather data with rainfall above threshold (no drought)
      await flareDataConnector.fulfillWeatherData(
        claim.weatherDataRequestId,
        2500, // 25°C
        8000, // 80mm - above 50mm threshold
        6500,
        1500
      );

      // Process claim
      await weatherShieldInsurance.processClaim(1);

      // Check claim - no payout
      const processedClaim = await weatherShieldInsurance.getClaim(1);
      expect(processedClaim.processed).to.equal(true);
      expect(processedClaim.payoutAmount).to.equal(0);

      // Policy should still be active
      const policy = await weatherShieldInsurance.getPolicy(policyId);
      expect(policy.status).to.equal(POLICY_STATUS.Active);
    });

    it("Should not allow claim on non-active policy", async function () {
      // Cancel policy first
      await weatherShieldInsurance.connect(farmer1).cancelPolicy(policyId);

      await expect(
        weatherShieldInsurance.connect(farmer1).initiateClaim(policyId)
      ).to.be.revertedWith("WS: policy not active");
    });

    it("Should not allow non-policyholder to initiate claim", async function () {
      await expect(
        weatherShieldInsurance.connect(farmer2).initiateClaim(policyId)
      ).to.be.revertedWith("WS: not policyholder");
    });
  });

  describe("Premium Calculation", function () {
    it("Should calculate correct base premium", async function () {
      const coverageAmount = ethers.parseEther("1");
      const duration = 365 * 24 * 60 * 60; // 1 year

      const premium = await weatherShieldInsurance.calculatePremium(
        coverageAmount,
        duration,
        TRIGGER_TYPES.RainfallBelow
      );

      // Base rate is 5%, drought multiplier is 1.2x, duration multiplier is 1x for 1 year
      // Expected: 1 ETH * 0.05 * 1.2 = 0.06 ETH
      expect(premium).to.be.closeTo(ethers.parseEther("0.06"), ethers.parseEther("0.01"));
    });

    it("Should apply higher multiplier for flood risk", async function () {
      const coverageAmount = ethers.parseEther("1");
      const duration = 365 * 24 * 60 * 60;

      const droughtPremium = await weatherShieldInsurance.calculatePremium(
        coverageAmount,
        duration,
        TRIGGER_TYPES.RainfallBelow
      );

      const floodPremium = await weatherShieldInsurance.calculatePremium(
        coverageAmount,
        duration,
        TRIGGER_TYPES.RainfallAbove
      );

      // Flood (1.5x) should be higher than drought (1.2x)
      expect(floodPremium).to.be.gt(droughtPremium);
    });
  });

  describe("Admin Functions", function () {
    it("Should allow owner to set premium rate", async function () {
      await weatherShieldInsurance.setBasePremiumRate(1000); // 10%
      expect(await weatherShieldInsurance.basePremiumRate()).to.equal(1000);
    });

    it("Should allow owner to pause/unpause", async function () {
      await weatherShieldInsurance.pause();
      
      await expect(
        weatherShieldInsurance.connect(farmer1).createPolicy(
          testLocationHash,
          TRIGGER_TYPES.RainfallBelow,
          5000,
          ethers.parseEther("1"),
          30 * 24 * 60 * 60,
          "Corn",
          50000,
          { value: ethers.parseEther("0.1") }
        )
      ).to.be.reverted;

      await weatherShieldInsurance.unpause();

      // Should work now
      const premium = await weatherShieldInsurance.calculatePremium(
        ethers.parseEther("1"),
        30 * 24 * 60 * 60,
        TRIGGER_TYPES.RainfallBelow
      );
      
      await weatherShieldInsurance.connect(farmer1).createPolicy(
        testLocationHash,
        TRIGGER_TYPES.RainfallBelow,
        5000,
        ethers.parseEther("1"),
        30 * 24 * 60 * 60,
        "Corn",
        50000,
        { value: premium }
      );
    });

    it("Should allow owner to withdraw from treasury", async function () {
      const treasuryBalanceBefore = await ethers.provider.getBalance(treasury.address);
      
      await weatherShieldInsurance.withdrawFromTreasury(ethers.parseEther("5"));
      
      const treasuryBalanceAfter = await ethers.provider.getBalance(treasury.address);
      expect(treasuryBalanceAfter - treasuryBalanceBefore).to.equal(ethers.parseEther("5"));
    });
  });
});

describe("FlareDataConnector", function () {
  let flareDataConnector;
  let owner;
  let provider;
  let user;

  beforeEach(async function () {
    [owner, provider, user] = await ethers.getSigners();

    const FlareDataConnector = await ethers.getContractFactory("FlareDataConnector");
    flareDataConnector = await FlareDataConnector.deploy();
    await flareDataConnector.waitForDeployment();
  });

  describe("Weather Data Requests", function () {
    it("Should create location hash correctly", async function () {
      const hash = await flareDataConnector.createLocationHash(41900000, -93100000);
      expect(hash).to.not.equal(ethers.ZeroHash);
    });

    it("Should request weather data", async function () {
      const locationHash = await flareDataConnector.createLocationHash(41900000, -93100000);
      const timestamp = Math.floor(Date.now() / 1000);

      await expect(flareDataConnector.requestWeatherData(locationHash, timestamp))
        .to.emit(flareDataConnector, "WeatherDataRequested");
    });

    it("Should fulfill weather data by authorized provider", async function () {
      await flareDataConnector.authorizeProvider(provider.address);

      const locationHash = await flareDataConnector.createLocationHash(41900000, -93100000);
      const timestamp = Math.floor(Date.now() / 1000);

      const tx = await flareDataConnector.requestWeatherData(locationHash, timestamp);
      const receipt = await tx.wait();
      
      // Get requestId from event
      const event = receipt.logs.find(log => {
        try {
          return flareDataConnector.interface.parseLog(log)?.name === "WeatherDataRequested";
        } catch {
          return false;
        }
      });
      const parsedEvent = flareDataConnector.interface.parseLog(event);
      const requestId = parsedEvent.args[0];

      // Fulfill data
      await expect(
        flareDataConnector.connect(provider).fulfillWeatherData(
          requestId,
          2500, // 25°C
          8000, // 80mm
          6500, // 65%
          1500  // 15 km/h
        )
      ).to.emit(flareDataConnector, "WeatherDataFulfilled");

      // Verify data
      const data = await flareDataConnector.getWeatherData(requestId);
      expect(data.temperature).to.equal(2500);
      expect(data.rainfall).to.equal(8000);
      expect(data.isVerified).to.equal(true);
    });

    it("Should reject unauthorized provider", async function () {
      const locationHash = await flareDataConnector.createLocationHash(41900000, -93100000);
      const timestamp = Math.floor(Date.now() / 1000);

      const tx = await flareDataConnector.requestWeatherData(locationHash, timestamp);
      const receipt = await tx.wait();
      
      const event = receipt.logs.find(log => {
        try {
          return flareDataConnector.interface.parseLog(log)?.name === "WeatherDataRequested";
        } catch {
          return false;
        }
      });
      const parsedEvent = flareDataConnector.interface.parseLog(event);
      const requestId = parsedEvent.args[0];

      await expect(
        flareDataConnector.connect(user).fulfillWeatherData(requestId, 2500, 8000, 6500, 1500)
      ).to.be.revertedWith("FDC: not authorized provider");
    });
  });
});

describe("PolicyFactory", function () {
  let flareDataConnector;
  let weatherShieldInsurance;
  let policyFactory;
  let owner;
  let farmer;
  let treasury;
  let testLocationHash;

  beforeEach(async function () {
    [owner, farmer, treasury] = await ethers.getSigners();

    const FlareDataConnector = await ethers.getContractFactory("FlareDataConnector");
    flareDataConnector = await FlareDataConnector.deploy();
    await flareDataConnector.waitForDeployment();

    const WeatherShieldInsurance = await ethers.getContractFactory("WeatherShieldInsurance");
    weatherShieldInsurance = await WeatherShieldInsurance.deploy(
      await flareDataConnector.getAddress(),
      treasury.address
    );
    await weatherShieldInsurance.waitForDeployment();

    const PolicyFactory = await ethers.getContractFactory("PolicyFactory");
    policyFactory = await PolicyFactory.deploy(await weatherShieldInsurance.getAddress());
    await policyFactory.waitForDeployment();

    testLocationHash = await flareDataConnector.createLocationHash(41900000, -93100000);

    // Fund treasury
    await weatherShieldInsurance.fundTreasury({ value: ethers.parseEther("10") });
  });

  describe("Templates", function () {
    it("Should have default templates", async function () {
      expect(await policyFactory.templateCount()).to.equal(5);
    });

    it("Should get active templates", async function () {
      const templates = await policyFactory.getActiveTemplates();
      expect(templates.length).to.equal(5);
    });

    it("Should create policy from template", async function () {
      const baseCoverage = ethers.parseEther("1");
      const premium = await policyFactory.estimatePremium(1, baseCoverage);

      await policyFactory.connect(farmer).createPolicyFromTemplate(
        1, // Drought protection template
        testLocationHash,
        baseCoverage,
        "Wheat",
        30000,
        { value: premium }
      );

      const policyCount = await weatherShieldInsurance.getPolicyCount();
      expect(policyCount).to.equal(1);
    });
  });
});
