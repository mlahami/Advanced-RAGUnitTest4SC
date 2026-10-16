const { expect } = require("chai");
const { ethers } = require("hardhat");

const PRECISION = 1_000_000n;
const DEFAULT_L1_BASE_FEE = 30_000_000_000n;
const DEFAULT_L1_BLOB_BASE_FEE = 1_000_000_000n;
const TX_DATA_ZERO_GAS = 4n;
const TX_DATA_NON_ZERO_GAS = 16n;
const ENVELOPE_OVERHEAD = 1088n;

function feeInputs(hexData) {
  const bytes = Buffer.from(hexData.slice(2), "hex");
  let zeroBytes = 0n;

  for (const value of bytes) {
    if (value === 0) {
      zeroBytes += 1n;
    }
  }

  const nonZeroBytes = BigInt(bytes.length) - zeroBytes;
  const dataGas = (zeroBytes * TX_DATA_ZERO_GAS) + (nonZeroBytes * TX_DATA_NON_ZERO_GAS) + ENVELOPE_OVERHEAD;

  return { zeroBytes, nonZeroBytes, dataGas };
}

function compressedGas(hexData, compressionRatio) {
  const { dataGas } = feeInputs(hexData);
  return (dataGas * BigInt(compressionRatio)) / PRECISION;
}

function totalFee(hexData, compressionRatio, scalar, l1Price) {
  const l1GasUsed = compressedGas(hexData, compressionRatio);
  return (l1GasUsed * BigInt(l1Price) * BigInt(scalar)) / PRECISION;
}

describe("L1GasPriceOracle", function () {
  async function deployFixture() {
    const [owner, sequencer, other, newOwner] = await ethers.getSigners();
    const Oracle = await ethers.getContractFactory("L1GasPriceOracle");
    const oracle = await Oracle.deploy(sequencer.address, 1_100_000, 500_000);
    await oracle.waitForDeployment();
    return { oracle, owner, sequencer, other, newOwner };
  }

  it("sets the expected initial state", async function () {
    const { oracle, owner, sequencer } = await deployFixture();

    expect(await oracle.owner()).to.equal(owner.address);
    expect(await oracle.sequencer()).to.equal(sequencer.address);
    expect(await oracle.scalar()).to.equal(1_100_000);
    expect(await oracle.compressionRatio()).to.equal(500_000);
    expect(await oracle.l1BaseFee()).to.equal(DEFAULT_L1_BASE_FEE);
    expect(await oracle.l1BlobBaseFee()).to.equal(DEFAULT_L1_BLOB_BASE_FEE);
    expect(await oracle.useBlobPricing()).to.equal(false);
  });

  it("rejects invalid constructor parameters", async function () {
    const [owner, sequencer] = await ethers.getSigners();
    const Oracle = await ethers.getContractFactory("L1GasPriceOracle");

    await expect(Oracle.deploy(ethers.ZeroAddress, 1_100_000, 500_000)).to.be.revertedWithCustomError(
      Oracle,
      "ZeroAddress"
    );

    await expect(Oracle.deploy(sequencer.address, 1_000_000, 500_000)).to.be.revertedWithCustomError(
      Oracle,
      "InvalidScalar"
    );

    await expect(Oracle.deploy(sequencer.address, 1_100_000, 99_999)).to.be.revertedWithCustomError(
      Oracle,
      "InvalidCompressionRatio"
    );
  });

  it("allows only the sequencer to update L1 gas data", async function () {
    const { oracle, other } = await deployFixture();

    await expect(oracle.connect(other).setL1GasData(40n, 2n, 600_000)).to.be.revertedWithCustomError(
      oracle,
      "OnlySequencer"
    );
  });

  it("updates gas data and records the block", async function () {
    const { oracle, sequencer } = await deployFixture();

    const tx = await oracle.connect(sequencer).setL1GasData(40_000_000_000n, 2_000_000_000n, 600_000);
    const receipt = await tx.wait();

    expect(await oracle.l1BaseFee()).to.equal(40_000_000_000n);
    expect(await oracle.l1BlobBaseFee()).to.equal(2_000_000_000n);
    expect(await oracle.compressionRatio()).to.equal(600_000);
    expect(await oracle.lastUpdateBlock()).to.equal(receipt.blockNumber);
  });

  it("updates scalar within bounds", async function () {
    const { oracle, sequencer } = await deployFixture();

    await expect(oracle.connect(sequencer).setScalar(1_500_000))
      .to.emit(oracle, "ScalarUpdated")
      .withArgs(1_100_000, 1_500_000);

    expect(await oracle.scalar()).to.equal(1_500_000);
  });

  it("rejects invalid scalar updates", async function () {
    const { oracle, sequencer } = await deployFixture();

    await expect(oracle.connect(sequencer).setScalar(1_000_000)).to.be.revertedWithCustomError(
      oracle,
      "InvalidScalar"
    );
  });

  it("supports batched gas and scalar updates", async function () {
    const { oracle, sequencer } = await deployFixture();

    await oracle.connect(sequencer).setL1GasDataAndScalar(50_000_000_000n, 3_000_000_000n, 700_000, 1_250_000);

    expect(await oracle.l1BaseFee()).to.equal(50_000_000_000n);
    expect(await oracle.l1BlobBaseFee()).to.equal(3_000_000_000n);
    expect(await oracle.compressionRatio()).to.equal(700_000);
    expect(await oracle.scalar()).to.equal(1_250_000);
  });

  it("calculates calldata-pricing fees correctly", async function () {
    const { oracle } = await deployFixture();
    const sample = "0x00010200ff";

    const expectedGasUsed = compressedGas(sample, 500_000);
    const expectedFee = totalFee(sample, 500_000, 1_100_000, DEFAULT_L1_BASE_FEE);

    expect(await oracle.getL1GasUsed(sample)).to.equal(expectedGasUsed);
    expect(await oracle.getL1Fee(sample)).to.equal(expectedFee);

    const breakdown = await oracle.getFeeBreakdown(sample);
    expect(breakdown.l1Fee).to.equal(expectedFee);
    expect(breakdown.l1GasUsed).to.equal(expectedGasUsed);
    expect(breakdown.l1Price).to.equal(DEFAULT_L1_BASE_FEE);
    expect(breakdown.currentScalar).to.equal(1_100_000);
    expect(breakdown.currentRatio).to.equal(500_000);
  });

  it("switches to blob pricing when enabled", async function () {
    const { oracle, owner } = await deployFixture();
    const sample = "0x123400";

    await expect(oracle.connect(owner).setUseBlobPricing(true))
      .to.emit(oracle, "BlobPricingToggled")
      .withArgs(true);

    const expectedFee = totalFee(sample, 500_000, 1_100_000, DEFAULT_L1_BLOB_BASE_FEE);

    expect(await oracle.getL1Fee(sample)).to.equal(expectedFee);
    expect(await oracle.getEffectiveL1Price()).to.equal((DEFAULT_L1_BLOB_BASE_FEE * 1_100_000n) / PRECISION);
  });

  it("enforces owner-only admin actions", async function () {
    const { oracle, other } = await deployFixture();

    await expect(oracle.connect(other).setSequencer(other.address)).to.be.revertedWithCustomError(
      oracle,
      "OnlyOwner"
    );
    await expect(oracle.connect(other).transferOwnership(other.address)).to.be.revertedWithCustomError(
      oracle,
      "OnlyOwner"
    );
    await expect(oracle.connect(other).setUseBlobPricing(true)).to.be.revertedWithCustomError(oracle, "OnlyOwner");
  });

  it("updates owner and sequencer", async function () {
    const { oracle, owner, sequencer, other, newOwner } = await deployFixture();

    await expect(oracle.connect(owner).setSequencer(other.address))
      .to.emit(oracle, "SequencerUpdated")
      .withArgs(sequencer.address, other.address);
    expect(await oracle.sequencer()).to.equal(other.address);

    await expect(oracle.connect(owner).transferOwnership(newOwner.address))
      .to.emit(oracle, "OwnerUpdated")
      .withArgs(owner.address, newOwner.address);
    expect(await oracle.owner()).to.equal(newOwner.address);
  });

  it("supports emergency scalar override", async function () {
    const { oracle, owner } = await deployFixture();

    await oracle.connect(owner).emergencySetScalar(5_000_000);
    expect(await oracle.scalar()).to.equal(5_000_000);
  });

  it("reports stale status based on last update block", async function () {
    const { oracle, sequencer } = await deployFixture();

    await oracle.connect(sequencer).setL1GasData(31_000_000_000n, 1_500_000_000n, 500_000);
    expect(await oracle.isStale(0)).to.equal(false);

    await ethers.provider.send("hardhat_mine", ["0x3"]);
    expect(await oracle.isStale(2)).to.equal(true);
  });

  it("returns packed oracle data", async function () {
    const { oracle, sequencer } = await deployFixture();

    await oracle.connect(sequencer).setL1GasDataAndScalar(45_000_000_000n, 2_500_000_000n, 650_000, 1_220_000);
    const result = await oracle.getOracleData();

    expect(result[0]).to.equal(45_000_000_000n);
    expect(result[1]).to.equal(2_500_000_000n);
    expect(result[2]).to.equal(1_220_000);
    expect(result[3]).to.equal(650_000);
    expect(result[5]).to.equal(false);
  });
});
