const { expect } = require("chai");
const { ethers } = require("hardhat");

// The owner wallet stands in for the Ledger Flex (same EIP-712 signature the DMK produces on-device).
describe("GuardVault", () => {
  const USDC = 1_000_000n; // 1 USDC = 1e6
  const u = (n) => n * USDC;

  async function deploy() {
    const [deployer, agent, attacker] = await ethers.getSigners();
    // owner = a fresh wallet we hold the key for (stands in for the Ledger)
    const owner = ethers.Wallet.createRandom().connect(ethers.provider);
    await deployer.sendTransaction({ to: owner.address, value: ethers.parseEther("1") });

    const MockUSDC = await ethers.getContractFactory("MockUSDC");
    const usdc = await MockUSDC.deploy();

    const GuardVault = await ethers.getContractFactory("GuardVault");
    const vault = await GuardVault.deploy(owner.address, await usdc.getAddress());

    // owner (Ledger) sets policy: the agent + one allowed safe haven
    const safeHaven = ethers.Wallet.createRandom().address;
    await vault.connect(owner).setAgent(agent.address);
    await vault.connect(owner).setSafeHaven(safeHaven, true);

    // fund the vault with 1000 USDC
    await usdc.mint(deployer.address, u(1000n));
    await usdc.approve(await vault.getAddress(), u(1000n));
    await vault.deposit(u(1000n));

    return { vault, usdc, owner, agent, attacker, safeHaven };
  }

  async function signMandate(vaultAddr, signer, m) {
    const domain = { name: "Guardian", version: "1", chainId: 31337, verifyingContract: vaultAddr };
    const types = {
      Mandate: [
        { name: "maxAmount", type: "uint256" },
        { name: "safeHaven", type: "address" },
        { name: "expiry", type: "uint256" },
        { name: "nonce", type: "uint256" },
      ],
    };
    return signer.signTypedData(domain, types, m);
  }

  it("rescues within the signed mandate", async () => {
    const { vault, usdc, owner, agent, safeHaven } = await deploy();
    const m = { maxAmount: u(500n), safeHaven, expiry: 2000000000n, nonce: 1n };
    const sig = await signMandate(await vault.getAddress(), owner, m);

    await vault.connect(agent).rescue(m, sig, u(300n));
    expect(await usdc.balanceOf(safeHaven)).to.equal(u(300n));

    // second rescue within the remaining budget is allowed (autonomy within bounds)
    await vault.connect(agent).rescue(m, sig, u(200n));
    expect(await usdc.balanceOf(safeHaven)).to.equal(u(500n));
  });

  it("REVERTS when the amount exceeds the mandate cap", async () => {
    const { vault, owner, agent, safeHaven } = await deploy();
    const m = { maxAmount: u(500n), safeHaven, expiry: 2000000000n, nonce: 1n };
    const sig = await signMandate(await vault.getAddress(), owner, m);
    await expect(vault.connect(agent).rescue(m, sig, u(501n)))
      .to.be.revertedWithCustomError(vault, "AmountOverMandate");
  });

  it("REVERTS when the mandate is signed by someone other than the owner (Ledger)", async () => {
    const { vault, agent, attacker, safeHaven } = await deploy();
    const m = { maxAmount: u(500n), safeHaven, expiry: 2000000000n, nonce: 1n };
    const sig = await signMandate(await vault.getAddress(), attacker, m); // NOT the Ledger
    await expect(vault.connect(agent).rescue(m, sig, u(100n)))
      .to.be.revertedWithCustomError(vault, "BadMandateSigner");
  });

  it("REVERTS when the destination is not an owner-approved safe haven", async () => {
    const { vault, owner, agent } = await deploy();
    const evilHaven = ethers.Wallet.createRandom().address;
    const m = { maxAmount: u(500n), safeHaven: evilHaven, expiry: 2000000000n, nonce: 1n };
    const sig = await signMandate(await vault.getAddress(), owner, m);
    await expect(vault.connect(agent).rescue(m, sig, u(100n)))
      .to.be.revertedWithCustomError(vault, "SafeHavenNotAllowed");
  });

  it("REVERTS when a non-agent tries to trigger a rescue", async () => {
    const { vault, owner, attacker, safeHaven } = await deploy();
    const m = { maxAmount: u(500n), safeHaven, expiry: 2000000000n, nonce: 1n };
    const sig = await signMandate(await vault.getAddress(), owner, m);
    await expect(vault.connect(attacker).rescue(m, sig, u(100n)))
      .to.be.revertedWithCustomError(vault, "NotAgent");
  });
});
