# oracle-manager--aaravg42

- domain: price-oracles (oracle)
- level: moderate
- origin: human
- convention: hardhat2-ethers6
- source: https://github.com/AaravG42/blanc-protocol @ e4b22af7c73bc86390f90ad479fffc992d7605c8
- license: MIT
- targets: OracleManager.sol
- validation: 10 passing tests, 0 failing; statement coverage OracleManager.sol 76.19 %

## Contract: OracleManager.sol (primary target)

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.18;

import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";

contract OracleManager {
    using ECDSA for bytes32;
    using MessageHashUtils for bytes32;

    uint256 public constant ORACLE_BOND = 0.00001 ether;
    uint256 public constant MIN_ORACLES = 1;

    address public owner;
    address public bondVault;

    struct OracleInfo {
        bool registered;
        bool bonded;
        uint256 bondAmount;
    }

    struct PriceReport {
        uint256 price;
        uint256 timestamp;
        address oracle;
    }

    mapping(address => OracleInfo) public oracles;
    address[] public oracleList;
    mapping(uint32 => PriceReport[]) public epochReports;
    mapping(uint32 => mapping(address => bool)) public hasReported;

    event OracleRegistered(address indexed oracle);
    event OracleBonded(address indexed oracle, uint256 amount);
    event OracleSlashed(address indexed oracle, uint256 amount);
    event PriceReported(uint32 indexed epochId, address indexed oracle, uint256 price);

    modifier onlyOwner() {
        require(msg.sender == owner, "Not owner");
        _;
    }

    modifier onlyRegisteredOracle() {
        require(oracles[msg.sender].registered, "Not registered oracle");
        _;
    }

    constructor() {
        owner = msg.sender;
    }

    function setBondVault(address _bondVault) external onlyOwner {
        bondVault = _bondVault;
    }

    function registerOracle(address oracle) external onlyOwner {
        require(!oracles[oracle].registered, "Already registered");
        
        oracles[oracle] = OracleInfo({
            registered: true,
            bonded: false,
            bondAmount: 0
        });
        oracleList.push(oracle);

        emit OracleRegistered(oracle);
    }

    function bondOracle(address oracle) external payable {
        require(oracles[oracle].registered, "Oracle not registered");
        require(msg.value >= ORACLE_BOND, "Insufficient bond");
        
        oracles[oracle].bonded = true;
        oracles[oracle].bondAmount += msg.value;

        emit OracleBonded(oracle, msg.value);
    }

    function submitSignedReport(
        uint32 epochId,
        uint256 price,
        bytes calldata signature
    ) external {
        bytes32 messageHash = keccak256(abi.encodePacked(epochId, price));
        bytes32 ethSignedHash = messageHash.toEthSignedMessageHash();
        address signer = ethSignedHash.recover(signature);

        require(oracles[signer].registered, "Signer not registered oracle");
        require(oracles[signer].bonded, "Oracle not bonded");
        require(!hasReported[epochId][signer], "Already reported");

        hasReported[epochId][signer] = true;
        epochReports[epochId].push(PriceReport({
            price: price,
            timestamp: block.timestamp,
            oracle: signer
        }));

        emit PriceReported(epochId, signer, price);
    }

    function submitReport(uint32 epochId, uint256 price) external onlyRegisteredOracle {
        require(oracles[msg.sender].bonded, "Oracle not bonded");
        require(!hasReported[epochId][msg.sender], "Already reported");

        hasReported[epochId][msg.sender] = true;
        epochReports[epochId].push(PriceReport({
            price: price,
            timestamp: block.timestamp,
            oracle: msg.sender
        }));

        emit PriceReported(epochId, msg.sender, price);
    }

    function getEpochPrice(uint32 epochId) external view returns (uint256) {
        PriceReport[] storage reports = epochReports[epochId];
        uint256 count = reports.length;
        
        if (count == 0) {
            return 0;
        }

        uint256[] memory prices = new uint256[](count);
        for (uint256 i = 0; i < count; i++) {
            prices[i] = reports[i].price;
        }

        for (uint256 i = 0; i < count - 1; i++) {
            for (uint256 j = 0; j < count - i - 1; j++) {
                if (prices[j] > prices[j + 1]) {
                    uint256 temp = prices[j];
                    prices[j] = prices[j + 1];
                    prices[j + 1] = temp;
                }
            }
        }

        if (count % 2 == 1) {
            return prices[count / 2];
        } else {
            return (prices[count / 2 - 1] + prices[count / 2]) / 2;
        }
    }

    function slashOracle(address oracle, uint256 amount) external {
        require(msg.sender == owner || msg.sender == bondVault, "Not authorized");
        require(oracles[oracle].bondAmount >= amount, "Insufficient bond");

        oracles[oracle].bondAmount -= amount;
        if (oracles[oracle].bondAmount == 0) {
            oracles[oracle].bonded = false;
        }

        emit OracleSlashed(oracle, amount);
    }

    function getReportCount(uint32 epochId) external view returns (uint256) {
        return epochReports[epochId].length;
    }

    function getReport(uint32 epochId, uint256 index) external view returns (
        uint256 price,
        uint256 timestamp,
        address oracle
    ) {
        PriceReport storage report = epochReports[epochId][index];
        return (report.price, report.timestamp, report.oracle);
    }

    function getOracleCount() external view returns (uint256) {
        return oracleList.length;
    }

    function isOracleBonded(address oracle) external view returns (bool) {
        return oracles[oracle].bonded;
    }
}
```

## Tests: oracle.test.js

```javascript
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
```
