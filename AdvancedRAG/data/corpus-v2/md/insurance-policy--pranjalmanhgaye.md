# insurance-policy--pranjalmanhgaye

- domain: insurance (insurance)
- level: moderate
- origin: human
- convention: hardhat2-ethers6
- source: https://github.com/PranjalManhgaye/Automate_India @ a4a4e1e051a878149b54862d10fb38e0e27420cf
- license: MIT
- targets: InsurancePolicy.sol, MockOracle.sol
- validation: 2 passing tests, 0 failing; statement coverage InsurancePolicy.sol 79.31 %, MockOracle.sol 100.0 %

## Contract: InsurancePolicy.sol (primary target)

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

interface IMockOracle {
    function getRainfallMm() external view returns (uint256);
    function lastUpdated() external view returns (uint256);
}

/// @title InsurancePolicy — parametric crop rainfall insurance with oracle-triggered payouts
contract InsurancePolicy is Ownable, ReentrancyGuard {
    enum PolicyStatus {
        Active,
        Triggered,
        PaidOut,
        Cancelled
    }

    struct Policy {
        uint256 id;
        address holder;
        uint256 premium;
        uint256 payoutAmount;
        uint256 thresholdMm;
        uint256 expiresAt;
        uint256 riskScore;
        PolicyStatus status;
        string policyType;
    }

    IMockOracle public oracle;
    uint256 public nextPolicyId;
    uint256 public constant MAX_STALENESS = 3600; // 1 hour

    mapping(uint256 => Policy) public policies;
    mapping(uint256 => mapping(address => bool)) public holderPolicies;

    event PolicyCreated(
        uint256 indexed id,
        address indexed holder,
        uint256 premium,
        uint256 payoutAmount,
        uint256 thresholdMm
    );
    event PolicyTriggered(uint256 indexed id, uint256 rainfallMm);
    event PayoutExecuted(uint256 indexed id, address indexed holder, uint256 amount);
    event PolicyCancelled(uint256 indexed id);

    constructor(address oracleAddress) Ownable(msg.sender) {
        oracle = IMockOracle(oracleAddress);
    }

    function setOracle(address oracleAddress) external onlyOwner {
        oracle = IMockOracle(oracleAddress);
    }

    function createPolicy(
        uint256 payoutAmount,
        uint256 thresholdMm,
        uint256 durationSeconds,
        uint256 riskScore,
        string calldata policyType
    ) external payable nonReentrant returns (uint256) {
        require(msg.value > 0, "Premium required");
        require(payoutAmount > msg.value, "Payout must exceed premium");
        require(thresholdMm > 0, "Invalid threshold");
        require(durationSeconds > 0, "Invalid duration");
        require(riskScore <= 100, "Risk score max 100");

        uint256 id = nextPolicyId++;
        policies[id] = Policy({
            id: id,
            holder: msg.sender,
            premium: msg.value,
            payoutAmount: payoutAmount,
            thresholdMm: thresholdMm,
            expiresAt: block.timestamp + durationSeconds,
            riskScore: riskScore,
            status: PolicyStatus.Active,
            policyType: policyType
        });
        holderPolicies[id][msg.sender] = true;

        emit PolicyCreated(id, msg.sender, msg.value, payoutAmount, thresholdMm);
        return id;
    }

    function checkAndExecutePayout(uint256 policyId) external nonReentrant {
        Policy storage policy = policies[policyId];
        require(policy.holder != address(0), "Policy not found");
        require(policy.status == PolicyStatus.Active, "Policy not active");
        require(block.timestamp <= policy.expiresAt, "Policy expired");

        uint256 rainfall = oracle.getRainfallMm();
        uint256 updated = oracle.lastUpdated();
        require(block.timestamp - updated <= MAX_STALENESS, "Oracle data stale");

        require(rainfall >= policy.thresholdMm, "Threshold not met");

        policy.status = PolicyStatus.Triggered;
        emit PolicyTriggered(policyId, rainfall);

        uint256 payout = policy.payoutAmount;
        require(address(this).balance >= payout, "Insufficient contract balance");

        policy.status = PolicyStatus.PaidOut;
        (bool ok, ) = policy.holder.call{value: payout}("");
        require(ok, "Payout failed");

        emit PayoutExecuted(policyId, policy.holder, payout);
    }

    function cancelPolicy(uint256 policyId) external nonReentrant {
        Policy storage policy = policies[policyId];
        require(policy.holder == msg.sender, "Not policy holder");
        require(policy.status == PolicyStatus.Active, "Cannot cancel");

        policy.status = PolicyStatus.Cancelled;
        emit PolicyCancelled(policyId);
    }

    function fundPool() external payable {}

    receive() external payable {}

    function getPolicy(uint256 policyId) external view returns (Policy memory) {
        return policies[policyId];
    }

    function getPolicyCount() external view returns (uint256) {
        return nextPolicyId;
    }

    function currentRainfall() external view returns (uint256) {
        return oracle.getRainfallMm();
    }
}
```

## Contract: MockOracle.sol (dependency)

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title MockOracle — simulates Chainlink rainfall feed for local/testnet demos
contract MockOracle {
    uint256 private _rainfallMm;
    uint256 private _updatedAt;

    event RainfallUpdated(uint256 rainfallMm);

    constructor(uint256 initialRainfallMm) {
        _rainfallMm = initialRainfallMm;
        _updatedAt = block.timestamp;
    }

    function getRainfallMm() external view returns (uint256) {
        return _rainfallMm;
    }

    function lastUpdated() external view returns (uint256) {
        return _updatedAt;
    }

    function setRainfallMm(uint256 rainfallMm) external {
        _rainfallMm = rainfallMm;
        _updatedAt = block.timestamp;
        emit RainfallUpdated(rainfallMm);
    }
}
```

## Tests: InsurancePolicy.test.js

```javascript
const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("InsurancePolicy", function () {
  it("creates policy and executes payout when threshold met", async function () {
    const [holder] = await ethers.getSigners();

    const MockOracle = await ethers.getContractFactory("MockOracle");
    const oracle = await MockOracle.deploy(30);
    await oracle.waitForDeployment();

    const InsurancePolicy = await ethers.getContractFactory("InsurancePolicy");
    const insurance = await InsurancePolicy.deploy(await oracle.getAddress());
    await insurance.waitForDeployment();

    const premium = ethers.parseEther("0.05");
    const payout = ethers.parseEther("0.25");

    await insurance.connect(holder).createPolicy(
      payout,
      40,
      86400 * 30,
      72,
      "Crop Rainfall",
      { value: premium }
    );

    await holder.sendTransaction({
      to: await insurance.getAddress(),
      value: ethers.parseEther("1"),
    });

    await oracle.setRainfallMm(45);
    await insurance.checkAndExecutePayout(0);

    const policy = await insurance.getPolicy(0);
    expect(policy.status).to.equal(2); // PaidOut
  });

  it("rejects payout when threshold not met", async function () {
    const [holder] = await ethers.getSigners();

    const MockOracle = await ethers.getContractFactory("MockOracle");
    const oracle = await MockOracle.deploy(30);
    await oracle.waitForDeployment();

    const InsurancePolicy = await ethers.getContractFactory("InsurancePolicy");
    const insurance = await InsurancePolicy.deploy(await oracle.getAddress());
    await insurance.waitForDeployment();

    await insurance.connect(holder).createPolicy(
      ethers.parseEther("0.25"),
      40,
      86400 * 30,
      72,
      "Crop Rainfall",
      { value: ethers.parseEther("0.05") }
    );

    await expect(insurance.checkAndExecutePayout(0)).to.be.revertedWith(
      "Threshold not met"
    );
  });
});
```
