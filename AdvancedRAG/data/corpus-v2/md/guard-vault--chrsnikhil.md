# guard-vault--chrsnikhil

- domain: rate-limiting (rate-limiting)
- level: moderate
- origin: human
- convention: hardhat2-ethers6
- source: https://github.com/chrsnikhil/ithaca @ 3c3be3c98c924597422997964c3155ab655fea33
- license: MIT
- targets: GuardVault.sol, MockUSDC.sol
- validation: 5 passing tests, 0 failing; statement coverage GuardVault.sol 100.0 %, MockUSDC.sol 66.67 %

## Contract: GuardVault.sol (primary target)

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";

/// @title GuardVault — Guardian's on-chain guard for a defensive agent wallet (ETHOnline 2026)
/// @notice Holds protected USDC. An autonomous `agent` can trigger rescues, but ONLY within the
///         bounds of a `Mandate` the `owner` physically signed on their Ledger Flex (EIP-712).
///         The chain enforces the bounds; the agent only decides *timing*. Worst case — a fully
///         compromised agent — can only move funds to an owner-approved safe haven, up to an
///         owner-signed cap, before expiry. It can never steal. That is the security guarantee.
/// @dev v1 rescue = local transfer to the safe haven. v2 swaps the transfer for a CCTP
///      `depositForBurn` to the Arc safe haven (domain 26). The mandate/authority model is identical.
contract GuardVault is EIP712 {
    using ECDSA for bytes32;

    /// @notice The hardware root of trust — the Ledger Flex address. Signs mandates; sets policy.
    address public immutable owner;
    /// @notice The protected asset.
    IERC20 public immutable usdc;
    /// @notice The autonomous relayer permitted to *trigger* rescues (bounded by the mandate).
    address public agent;

    /// @notice Owner-approved rescue destinations. A rescue can only ever go here.
    mapping(address => bool) public safeHavenAllowed;
    /// @notice Cumulative amount already rescued under each mandate (by its EIP-712 digest).
    mapping(bytes32 => uint256) public spentPerMandate;

    /// @dev The mandate the owner signs once on the Flex: "rescue up to `maxAmount` to `safeHaven`
    ///      until `expiry`." The agent may rescue repeatedly while the cumulative total stays under
    ///      `maxAmount` and the mandate hasn't expired — autonomy within bounds.
    struct Mandate {
        uint256 maxAmount;
        address safeHaven;
        uint256 expiry;
        uint256 nonce;
    }

    bytes32 private constant MANDATE_TYPEHASH =
        keccak256("Mandate(uint256 maxAmount,address safeHaven,uint256 expiry,uint256 nonce)");

    event Deposited(address indexed from, uint256 amount);
    event Rescued(address indexed safeHaven, uint256 amount, uint256 nonce, uint256 spent);
    event SafeHavenSet(address indexed haven, bool allowed);
    event AgentSet(address indexed agent);

    error NotOwner();
    error NotAgent();
    error BadMandateSigner();
    error MandateExpired();
    error AmountOverMandate();
    error SafeHavenNotAllowed();

    constructor(address _owner, IERC20 _usdc) EIP712("Guardian", "1") {
        owner = _owner;
        usdc = _usdc;
    }

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    // --- owner (Ledger) policy controls ---

    function setAgent(address _agent) external onlyOwner {
        agent = _agent;
        emit AgentSet(_agent);
    }

    function setSafeHaven(address haven, bool allowed) external onlyOwner {
        safeHavenAllowed[haven] = allowed;
        emit SafeHavenSet(haven, allowed);
    }

    // --- funding ---

    function deposit(uint256 amount) external {
        usdc.transferFrom(msg.sender, address(this), amount);
        emit Deposited(msg.sender, amount);
    }

    // --- mandate hashing (EIP-712) ---

    function hashMandate(Mandate calldata m) public view returns (bytes32) {
        return _hashTypedDataV4(
            keccak256(abi.encode(MANDATE_TYPEHASH, m.maxAmount, m.safeHaven, m.expiry, m.nonce))
        );
    }

    // --- the autonomous rescue (bounded by the Flex-signed mandate) ---

    /// @param m   the mandate the owner signed on the Ledger
    /// @param sig the owner's EIP-712 signature over `m`
    /// @param amount how much USDC to move to safety this call
    function rescue(Mandate calldata m, bytes calldata sig, uint256 amount) external {
        if (msg.sender != agent) revert NotAgent();

        bytes32 digest = hashMandate(m);
        if (digest.recover(sig) != owner) revert BadMandateSigner();
        if (block.timestamp > m.expiry) revert MandateExpired();
        if (!safeHavenAllowed[m.safeHaven]) revert SafeHavenNotAllowed();

        uint256 newSpent = spentPerMandate[digest] + amount;
        if (newSpent > m.maxAmount) revert AmountOverMandate();
        spentPerMandate[digest] = newSpent;

        usdc.transfer(m.safeHaven, amount); // v2: CCTP depositForBurn → Arc (domain 26)
        emit Rescued(m.safeHaven, amount, m.nonce, newSpent);
    }
}
```

## Contract: MockUSDC.sol (dependency)

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @dev Test-only USDC (6 decimals) for local Guard tests.
contract MockUSDC is ERC20 {
    constructor() ERC20("Mock USDC", "USDC") {
        _mint(msg.sender, 1_000_000e6);
    }

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}
```

## Tests: GuardVault.js

```javascript
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
```
