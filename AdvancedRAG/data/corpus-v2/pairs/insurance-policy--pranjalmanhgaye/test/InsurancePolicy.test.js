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
