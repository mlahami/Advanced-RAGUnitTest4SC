# stablecoin--kcolbchain

- domain: fungible-tokens (stablecoin)
- level: complex
- origin: human
- convention: hardhat2-ethers6
- source: https://github.com/kcolbchain/stablecoin-toolkit @ 2753ad360f14935d1485060a3006a4b6cc3129ce
- license: MIT
- targets: Stablecoin.sol, ChainlinkPoRAdapter.sol, ReserveManager.sol, IAggregatorV3.sol
- validation: 10 passing tests, 0 failing; statement coverage Stablecoin.sol 100.0 %, ChainlinkPoRAdapter.sol 0.0 %, ReserveManager.sol 36.36 %, IAggregatorV3.sol 100.0 %

## Contract: ChainlinkPoRAdapter.sol (dependency)

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "./IAggregatorV3.sol";

/**
 * @title ChainlinkPoRAdapter
 * @notice Adapter to pull reserve data from Chainlink Proof of Reserves feeds.
 * @dev Part of kcolbchain/stablecoin-toolkit
 */
contract ChainlinkPoRAdapter {
    AggregatorV3Interface public immutable porFeed;

    uint8 public constant FEED_DECIMALS = 8; // Chainlink PoR feeds typically use 8 decimals

    event PorFeedSet(address indexed feed);
    event ReserveDataPulled(uint256 reserveAmount, uint256 timestamp);

    error FeedNotAvailable();
    error FeedDataStale(uint256 updatedAt);
    error InvalidFeedAnswer();

    constructor(address _porFeed) {
        if (_porFeed == address(0)) revert FeedNotAvailable();
        porFeed = AggregatorV3Interface(_porFeed);
        emit PorFeedSet(_porFeed);
    }

    /**
     * @notice Pulls the latest reserve amount from the Chainlink PoR feed.
     * @return reserveAmount The current reserve amount (already scaled to feed decimals)
     * @return updatedAt The timestamp of the last update
     */
    function getLatestReserveAmount() public view returns (uint256 reserveAmount, uint256 updatedAt) {
        try porFeed.latestRoundData() returns (
            uint80,
            int256 answer,
            uint256,
            uint256 updatedAt_,
            uint80
        ) {
            if (answer < 0) revert InvalidFeedAnswer();
            return (uint256(answer), updatedAt_);
        } catch {
            revert FeedNotAvailable();
        }
    }

    /**
     * @notice Converts a raw feed answer to stablecoin-equivalent units (6 decimals).
     * @dev PoR feeds typically return values with 8 decimals; this converts to 6 decimals
     *      to match the stablecoin's 6-decimal precision used in ReserveManager.
     * @param rawAmount The raw amount from the PoR feed
     * @return converted The amount converted to 6-decimal stablecoin units
     */
    function convertToStablecoinUnits(uint256 rawAmount) public pure returns (uint256 converted) {
        // Convert from 8 decimals (feed) to 6 decimals (stablecoin) = divide by 100
        return rawAmount / 100;
    }

    /**
     * @notice Convenience function that pulls and converts in one call.
     * @return reserveAmount The reserve amount in stablecoin units (6 decimals)
     * @return updatedAt The timestamp of the last feed update
     */
    function getReserveInStablecoinUnits() external returns (uint256 reserveAmount, uint256 updatedAt) {
        (uint256 rawAmount, uint256 ts) = getLatestReserveAmount();
        reserveAmount = convertToStablecoinUnits(rawAmount);
        updatedAt = ts;
        emit ReserveDataPulled(reserveAmount, ts);
    }

    /**
     * @notice Returns feed metadata (description and decimals) for off-chain verification.
     */
    function getFeedInfo() external view returns (string memory description, uint8 decimals) {
        try porFeed.description() returns (string memory desc) {
            description = desc;
        } catch {
            description = "";
        }
        try porFeed.decimals() returns (uint8 d) {
            decimals = d;
        } catch {
            decimals = FEED_DECIMALS;
        }
    }
}
```

## Contract: IAggregatorV3.sol (dependency)

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

interface AggregatorV3Interface {
  function decimals() external view returns (uint8);
  function description() external view returns (string memory);
  function version() external view returns (uint256);
  function latestRoundData()
    external
    view
    returns (
      uint80 roundId,
      int256 answer,
      uint256 startedAt,
      uint256 updatedAt,
      uint80 answeredInRound
    );
  function getRoundData(uint80 _roundId)
    external
    view
    returns (
      uint80 roundId,
      int256 answer,
      uint256 startedAt,
      uint256 updatedAt,
      uint80 answeredInRound
    );
}
```

## Contract: ReserveManager.sol (dependency)

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/Ownable.sol";
import "./ChainlinkPoRAdapter.sol";

/**
 * @title ReserveManager
 * @notice Multi-asset reserve tracking with proof of reserves and ratio enforcement.
 * @dev Part of kcolbchain/stablecoin-toolkit. Supports both manual attestation
 *      and Chainlink Proof of Reserves feeds via ChainlinkPoRAdapter.
 */
contract ReserveManager is Ownable {
    struct ReserveAsset {
        string name;
        uint256 amount;       // in stablecoin-equivalent units (6 decimals)
        uint256 lastUpdated;
        bool active;
    }

    mapping(bytes32 => ReserveAsset) public reserves;
    bytes32[] public reserveIds;

    uint256 public totalReserves;
    uint256 public totalSupplyTracked; // updated by Minter
    uint256 public minimumRatioBps;    // e.g. 10000 = 100%, 10500 = 105%

    /// @dev Chainlink PoR adapter for on-chain reserve verification
    ChainlinkPoRAdapter public porAdapter;
    /// @dev Canonical reserve asset ID for the Chainlink-backed reserve
    bytes32 public constant POR_RESERVE_ID = bytes32(0);

    event ReserveUpdated(bytes32 indexed assetId, string name, uint256 amount);
    event SupplyUpdated(uint256 newSupply);
    event MinimumRatioUpdated(uint256 newRatioBps);
    event PorAdapterSet(address indexed adapter);
    event PorReservePulled(uint256 amount, uint256 updatedAt);

    error ReserveRatioTooLow(uint256 currentRatioBps, uint256 requiredRatioBps);
    error PorAdapterNotSet();
    error PorFeedFailed(string reason);

    constructor(uint256 _minimumRatioBps) Ownable(msg.sender) {
        minimumRatioBps = _minimumRatioBps;
    }

    function addReserveAsset(bytes32 assetId, string calldata name, uint256 amount) external onlyOwner {
        if (!reserves[assetId].active) {
            reserveIds.push(assetId);
        }
        reserves[assetId] = ReserveAsset({
            name: name,
            amount: amount,
            lastUpdated: block.timestamp,
            active: true
        });
        _recalcTotal();
        emit ReserveUpdated(assetId, name, amount);
    }

    function updateReserve(bytes32 assetId, uint256 amount) external onlyOwner {
        require(reserves[assetId].active, "Asset not active");
        reserves[assetId].amount = amount;
        reserves[assetId].lastUpdated = block.timestamp;
        _recalcTotal();
        emit ReserveUpdated(assetId, reserves[assetId].name, amount);
    }

    function updateTrackedSupply(uint256 supply) external onlyOwner {
        totalSupplyTracked = supply;
        emit SupplyUpdated(supply);
    }

    function setMinimumRatio(uint256 ratioBps) external onlyOwner {
        minimumRatioBps = ratioBps;
        emit MinimumRatioUpdated(ratioBps);
    }

    /**
     * @notice Sets the Chainlink PoR adapter address.
     * @param adapter Address of the ChainlinkPoRAdapter contract.
     */
    function setPorAdapter(address adapter) external onlyOwner {
        if (adapter == address(0)) revert PorAdapterNotSet();
        porAdapter = ChainlinkPoRAdapter(adapter);
        emit PorAdapterSet(adapter);
    }

    /**
     * @notice Pulls reserve data from the configured Chainlink PoR feed and
     *         updates the canonical PoR reserve asset.
     * @dev The adapter returns values in feed decimals (8); this contract
     *      converts to stablecoin units (6) before storing.
     */
    function pullPorReserve() public onlyOwner returns (uint256 reserveAmount, uint256 updatedAt) {
        if (address(porAdapter) == address(0)) revert PorAdapterNotSet();

        (uint256 rawAmount, uint256 timestamp) = porAdapter.getLatestReserveAmount();

        // Convert from feed decimals (8) to stablecoin units (6)
        reserveAmount = rawAmount / 100;

        // Upsert the PoR reserve asset
        reserves[POR_RESERVE_ID] = ReserveAsset({
            name: "Chainlink PoR Reserve",
            amount: reserveAmount,
            lastUpdated: timestamp,
            active: true
        });

        // Add to reserveIds if new
        bool found = false;
        for (uint256 i = 0; i < reserveIds.length; i++) {
            if (reserveIds[i] == POR_RESERVE_ID) {
                found = true;
                break;
            }
        }
        if (!found) {
            reserveIds.push(POR_RESERVE_ID);
        }

        _recalcTotal();
        emit PorReservePulled(reserveAmount, timestamp);
        return (reserveAmount, timestamp);
    }

    function getReserveRatioBps() public view returns (uint256) {
        if (totalSupplyTracked == 0) return type(uint256).max;
        return (totalReserves * 10000) / totalSupplyTracked;
    }

    function checkReserveRatio() public view {
        uint256 ratio = getReserveRatioBps();
        if (ratio < minimumRatioBps) {
            revert ReserveRatioTooLow(ratio, minimumRatioBps);
        }
    }

    /**
     * @notice Convenience: pull from PoR and check reserve ratio in one call.
     */
    function pullPorReserveAndCheck() external onlyOwner {
        if (address(porAdapter) == address(0)) revert PorAdapterNotSet();
        pullPorReserve();
        checkReserveRatio();
    }

    function getReserveCount() external view returns (uint256) {
        return reserveIds.length;
    }

    function _recalcTotal() internal {
        uint256 total = 0;
        for (uint256 i = 0; i < reserveIds.length; i++) {
            if (reserves[reserveIds[i]].active) {
                total += reserves[reserveIds[i]].amount;
            }
        }
        totalReserves = total;
    }
}
```

## Contract: Stablecoin.sol (primary target)

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Burnable.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Pausable.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Permit.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";

/**
 * @title Stablecoin
 * @notice Core stablecoin ERC-20 with mint/burn, pause, blacklist, and EIP-2612 permit.
 * @dev Part of kcolbchain/stablecoin-toolkit
 */
contract Stablecoin is ERC20, ERC20Burnable, ERC20Pausable, ERC20Permit, AccessControl {
    bytes32 public constant MINTER_ROLE = keccak256("MINTER_ROLE");
    bytes32 public constant PAUSER_ROLE = keccak256("PAUSER_ROLE");
    bytes32 public constant BLACKLISTER_ROLE = keccak256("BLACKLISTER_ROLE");

    mapping(address => bool) private _blacklisted;

    event Blacklisted(address indexed account);
    event Unblacklisted(address indexed account);

    error AccountBlacklisted(address account);

    constructor(
        string memory name_,
        string memory symbol_,
        address admin
    ) ERC20(name_, symbol_) ERC20Permit(name_) {
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(MINTER_ROLE, admin);
        _grantRole(PAUSER_ROLE, admin);
        _grantRole(BLACKLISTER_ROLE, admin);
    }

    function mint(address to, uint256 amount) external onlyRole(MINTER_ROLE) {
        if (_blacklisted[to]) revert AccountBlacklisted(to);
        _mint(to, amount);
    }

    function pause() external onlyRole(PAUSER_ROLE) {
        _pause();
    }

    function unpause() external onlyRole(PAUSER_ROLE) {
        _unpause();
    }

    function blacklist(address account) external onlyRole(BLACKLISTER_ROLE) {
        _blacklisted[account] = true;
        emit Blacklisted(account);
    }

    function unblacklist(address account) external onlyRole(BLACKLISTER_ROLE) {
        _blacklisted[account] = false;
        emit Unblacklisted(account);
    }

    function isBlacklisted(address account) external view returns (bool) {
        return _blacklisted[account];
    }

    function decimals() public pure override returns (uint8) {
        return 6; // USDC-style 6 decimals
    }

    function _update(
        address from,
        address to,
        uint256 value
    ) internal override(ERC20, ERC20Pausable) {
        if (_blacklisted[from]) revert AccountBlacklisted(from);
        if (_blacklisted[to]) revert AccountBlacklisted(to);
        super._update(from, to, value);
    }
}
```

## Tests: Stablecoin.test.js

```javascript
const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("Stablecoin", function () {
  let stablecoin, owner, user1, user2;

  beforeEach(async function () {
    [owner, user1, user2] = await ethers.getSigners();
    const Stablecoin = await ethers.getContractFactory("Stablecoin");
    stablecoin = await Stablecoin.deploy("Test Stablecoin", "TSTBL", owner.address);
    await stablecoin.waitForDeployment();
  });

  it("should have correct name and symbol", async function () {
    expect(await stablecoin.name()).to.equal("Test Stablecoin");
    expect(await stablecoin.symbol()).to.equal("TSTBL");
  });

  it("should have 6 decimals", async function () {
    expect(await stablecoin.decimals()).to.equal(6);
  });

  it("should allow minter to mint", async function () {
    await stablecoin.mint(user1.address, 1000000n); // 1 token
    expect(await stablecoin.balanceOf(user1.address)).to.equal(1000000n);
  });

  it("should not allow non-minter to mint", async function () {
    await expect(
      stablecoin.connect(user1).mint(user2.address, 1000000n)
    ).to.be.reverted;
  });

  it("should allow pausing and unpausing", async function () {
    await stablecoin.mint(user1.address, 1000000n);
    await stablecoin.pause();

    await expect(
      stablecoin.connect(user1).transfer(user2.address, 500000n)
    ).to.be.reverted;

    await stablecoin.unpause();
    await stablecoin.connect(user1).transfer(user2.address, 500000n);
    expect(await stablecoin.balanceOf(user2.address)).to.equal(500000n);
  });

  it("should allow blacklisting", async function () {
    await stablecoin.mint(user1.address, 1000000n);
    await stablecoin.blacklist(user1.address);

    expect(await stablecoin.isBlacklisted(user1.address)).to.be.true;

    await expect(
      stablecoin.connect(user1).transfer(user2.address, 500000n)
    ).to.be.revertedWithCustomError(stablecoin, "AccountBlacklisted");

    await stablecoin.unblacklist(user1.address);
    await stablecoin.connect(user1).transfer(user2.address, 500000n);
    expect(await stablecoin.balanceOf(user2.address)).to.equal(500000n);
  });

  it("should not mint to blacklisted address", async function () {
    await stablecoin.blacklist(user1.address);
    await expect(
      stablecoin.mint(user1.address, 1000000n)
    ).to.be.revertedWithCustomError(stablecoin, "AccountBlacklisted");
  });
});

describe("ReserveManager", function () {
  let reserveManager, owner;

  beforeEach(async function () {
    [owner] = await ethers.getSigners();
    const ReserveManager = await ethers.getContractFactory("ReserveManager");
    reserveManager = await ReserveManager.deploy(10000); // 100% minimum
    await reserveManager.waitForDeployment();
  });

  it("should track reserves", async function () {
    const assetId = ethers.id("USD_BANK");
    await reserveManager.addReserveAsset(assetId, "USD Bank Deposit", 10000000n);
    expect(await reserveManager.totalReserves()).to.equal(10000000n);
  });

  it("should enforce reserve ratio", async function () {
    const assetId = ethers.id("USD_BANK");
    await reserveManager.addReserveAsset(assetId, "USD Bank Deposit", 5000000n);
    await reserveManager.updateTrackedSupply(10000000n);

    // Ratio is 50% but minimum is 100%
    await expect(
      reserveManager.checkReserveRatio()
    ).to.be.revertedWithCustomError(reserveManager, "ReserveRatioTooLow");
  });

  it("should pass when reserves are sufficient", async function () {
    const assetId = ethers.id("USD_BANK");
    await reserveManager.addReserveAsset(assetId, "USD Bank Deposit", 10000000n);
    await reserveManager.updateTrackedSupply(10000000n);
    await reserveManager.checkReserveRatio(); // should not revert
  });
});
```
