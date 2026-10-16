# bit-brics--ac12644

- domain: nft-marketplace (nft-erc1155)
- level: moderate
- origin: human
- convention: hardhat2-ethers6
- source: https://github.com/ac12644/bitbrics-erc1155 @ a914ff7fe87ad31d3a6a55f6550e2faed57983d5
- license: MIT
- targets: BitBrics.sol
- validation: 11 passing tests, 0 failing; statement coverage BitBrics.sol 100.0 %

## Contract: BitBrics.sol (primary target)

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title BitBrics Real Estate Income Token (ERC1155, KYC, Pausable, Admin Transfer)
/// @author BitBrics
/// @notice Fractional real estate income token with max supply, KYC, pause, backend controls, and admin recovery

import "@openzeppelin/contracts/token/ERC1155/extensions/ERC1155Supply.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";

contract BitBricsERC1155 is ERC1155Supply, Ownable, Pausable {
    address public backendOperator;
    mapping(address => bool) public isKYCApproved;
    mapping(uint256 => uint256) public maxSupply;
    mapping(uint256 => bool) public isMaxSupplySet;

    event BackendOperatorUpdated(address indexed oldOperator, address indexed newOperator);
    event KYCStatusUpdated(address indexed user, bool approved);
    event MaxSupplySet(uint256 indexed propertyId, uint256 maxSupply);
    event AdminForceTransfer(address indexed from, address indexed to, uint256 indexed tokenId, uint256 amount, string reason);

    /// @dev Only backend operator or owner
    modifier onlyBackendOrOwner() {
        require(
            msg.sender == backendOperator || msg.sender == owner(),
            "Not backend or owner"
        );
        _;
    }
    modifier supplySet(uint256 id) {
        require(isMaxSupplySet[id], "Max supply not set");
        _;
    }

    constructor(string memory uri_, address initialOwner) ERC1155(uri_) Ownable(initialOwner) {
        backendOperator = msg.sender;
    }

    /// @notice Owner: update metadata base URI (applies to all tokens)
    function setURI(string memory newuri) external onlyOwner {
        _setURI(newuri);
    }

    function pause() external onlyOwner { _pause(); }
    function unpause() external onlyOwner { _unpause(); }
    function setBackendOperator(address newOperator) external onlyOwner {
        emit BackendOperatorUpdated(backendOperator, newOperator);
        backendOperator = newOperator;
    }
    /// @notice Backend or Owner: set KYC status for an address
    function setKYC(address user, bool approved) external onlyBackendOrOwner {
        isKYCApproved[user] = approved;
        emit KYCStatusUpdated(user, approved);
    }
    function setMaxSupply(uint256 id, uint256 _maxSupply) external onlyOwner {
        require(!isMaxSupplySet[id], "Max supply already set");
        require(_maxSupply > 0, "Supply must be positive");
        maxSupply[id] = _maxSupply;
        isMaxSupplySet[id] = true;
        emit MaxSupplySet(id, _maxSupply);
    }
    /// @notice Backend or Owner: mint tokens to KYC’d user (respects max supply)
    function mint(address to, uint256 id, uint256 amount, bytes memory data)
        external onlyBackendOrOwner whenNotPaused supplySet(id)
    {
        require(isKYCApproved[to], "KYC required");
        require(totalSupply(id) + amount <= maxSupply[id], "Exceeds property supply");
        _mint(to, id, amount, data);
    }
    /// @notice Backend or Owner: batch mint
    function mintBatch(address to, uint256[] memory ids, uint256[] memory amounts, bytes memory data)
        external onlyBackendOrOwner whenNotPaused
    {
        require(isKYCApproved[to], "KYC required");
        for (uint256 i = 0; i < ids.length; ++i) {
            require(isMaxSupplySet[ids[i]], "Supply not set");
            require(totalSupply(ids[i]) + amounts[i] <= maxSupply[ids[i]], "Exceeds property supply");
        }
        _mintBatch(to, ids, amounts, data);
    }
    /// @notice Backend or Owner: platform transfer (resale, exit, etc.)
    function platformTransfer(address from, address to, uint256 id, uint256 amount, bytes memory data)
        external onlyBackendOrOwner whenNotPaused supplySet(id)
    {
        require(isKYCApproved[from] && isKYCApproved[to], "KYC required");
        _safeTransferFrom(from, to, id, amount, data);
    }
    /// @notice Backend or Owner: batch platform transfer
    function platformBatchTransfer(address from, address to, uint256[] memory ids, uint256[] memory amounts, bytes memory data)
        external onlyBackendOrOwner whenNotPaused
    {
        require(isKYCApproved[from] && isKYCApproved[to], "KYC required");
        for (uint256 i = 0; i < ids.length; ++i) require(isMaxSupplySet[ids[i]], "Supply not set");
        _safeBatchTransferFrom(from, to, ids, amounts, data);
    }
    function adminForceTransfer(address from, address to, uint256 id, uint256 amount, string calldata reason)
        external onlyOwner whenNotPaused supplySet(id)
    {
        _safeTransferFrom(from, to, id, amount, "");
        emit AdminForceTransfer(from, to, id, amount, reason);
    }
    function _update(
        address from,
        address to,
        uint256[] memory ids,
        uint256[] memory values
    ) internal override {
        if (from != address(0) && to != address(0)) {
            require(
                msg.sender == backendOperator || msg.sender == owner(),
                "Only backend/operator can transfer"
            );
            require(isKYCApproved[from] && isKYCApproved[to], "KYC required");
        }
        super._update(from, to, ids, values);
    }
    function setApprovalForAll(address, bool) public pure override { revert("Approvals disabled"); }
    function isApprovedForAll(address, address) public pure override returns (bool) { return false; }
}
```

## Tests: BitBrics.js

```javascript
const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("BitBricsERC1155", function () {
  let owner, backend, user1, user2, other;
  let bitbrics;
  const uri = "https://example.com/metadata/{id}.json";
  const propertyId = 1;
  const maxSupply = 1000;

  beforeEach(async () => {
    [owner, backend, user1, user2, other] = await ethers.getSigners();
    const BitBrics = await ethers.getContractFactory("BitBricsERC1155");
    bitbrics = (await BitBrics.deploy(uri, owner.address));
    await bitbrics.waitForDeployment();

    await bitbrics.connect(owner).setBackendOperator(backend.address);
  });

  it("sets and updates the URI", async () => {
    expect(await bitbrics.uri(propertyId)).to.equal(uri);
    await bitbrics
      .connect(owner)
      .setURI("https://newdomain.com/metadata/{id}.json");
    expect(await bitbrics.uri(propertyId)).to.equal(
      "https://newdomain.com/metadata/{id}.json"
    );
  });

  it("only owner or backend can set KYC", async () => {
    await expect(
      bitbrics.connect(user1).setKYC(user1.address, true)
    ).to.be.revertedWith("Not backend or owner");

    await bitbrics.connect(owner).setKYC(user1.address, true);
    expect(await bitbrics.isKYCApproved(user1.address)).to.be.true;

    await bitbrics.connect(backend).setKYC(user2.address, true);
    expect(await bitbrics.isKYCApproved(user2.address)).to.be.true;
  });

  it("owner sets max supply only once", async () => {
    await bitbrics.connect(owner).setMaxSupply(propertyId, maxSupply);
    expect(await bitbrics.maxSupply(propertyId)).to.equal(maxSupply);

    await expect(
      bitbrics.connect(owner).setMaxSupply(propertyId, 500)
    ).to.be.revertedWith("Max supply already set");
  });

  it("backend or owner can mint to KYC'd user up to max supply", async () => {
    await bitbrics.connect(owner).setMaxSupply(propertyId, maxSupply);
    await bitbrics.connect(backend).setKYC(user1.address, true);

    await expect(
      bitbrics.connect(backend).mint(user1.address, propertyId, 100, "0x")
    ).to.emit(bitbrics, "TransferSingle");

    await expect(
      bitbrics.connect(backend).mint(user1.address, propertyId, maxSupply, "0x")
    ).to.be.revertedWith("Exceeds property supply");
  });

  it("prevents minting/transfers to non-KYC users", async () => {
    await bitbrics.connect(owner).setMaxSupply(propertyId, maxSupply);
    await bitbrics.connect(backend).setKYC(user1.address, true);

    await bitbrics.connect(backend).mint(user1.address, propertyId, 1, "0x");

    await expect(
      bitbrics.connect(backend).mint(user2.address, propertyId, 1, "0x")
    ).to.be.revertedWith("KYC required");
  });

  it("only backend or owner can transfer between users (platformTransfer)", async () => {
    await bitbrics.connect(owner).setMaxSupply(propertyId, maxSupply);
    await bitbrics.connect(backend).setKYC(user1.address, true);
    await bitbrics.connect(backend).setKYC(user2.address, true);
    await bitbrics.connect(backend).mint(user1.address, propertyId, 10, "0x");

    await expect(
      bitbrics
        .connect(user1)
        .safeTransferFrom(user1.address, user2.address, propertyId, 1, "0x")
    ).to.be.revertedWith("Only backend/operator can transfer");

    await expect(
      bitbrics
        .connect(backend)
        .platformTransfer(user1.address, user2.address, propertyId, 5, "0x")
    ).to.emit(bitbrics, "TransferSingle");

    expect(await bitbrics.balanceOf(user2.address, propertyId)).to.equal(5);
  });

  it("adminForceTransfer by owner works in emergencies", async () => {
    await bitbrics.connect(owner).setMaxSupply(propertyId, maxSupply);
    await bitbrics.connect(backend).setKYC(user1.address, true);
    await bitbrics.connect(backend).setKYC(user2.address, true);
    await bitbrics.connect(backend).mint(user1.address, propertyId, 10, "0x");

    await expect(
      bitbrics
        .connect(owner)
        .adminForceTransfer(
          user1.address,
          user2.address,
          propertyId,
          3,
          "compliance"
        )
    ).to.emit(bitbrics, "AdminForceTransfer");

    expect(await bitbrics.balanceOf(user2.address, propertyId)).to.equal(3);
  });

  it("pausing blocks minting and transfers", async () => {
    await bitbrics.connect(owner).setMaxSupply(propertyId, maxSupply);
    await bitbrics.connect(backend).setKYC(user1.address, true);

    await bitbrics.connect(owner).pause();

    await expect(
      bitbrics.connect(backend).mint(user1.address, propertyId, 1, "0x")
    ).to.be.revertedWithCustomError(bitbrics, "EnforcedPause");

    await bitbrics.connect(owner).unpause();
    await expect(
      bitbrics.connect(backend).mint(user1.address, propertyId, 1, "0x")
    ).to.emit(bitbrics, "TransferSingle");
  });

  it("owner or backend can batch mint and batch transfer", async () => {
    const ids = [2, 3];
    const amts = [50, 60];
    await bitbrics.connect(owner).setMaxSupply(ids[0], 100);
    await bitbrics.connect(owner).setMaxSupply(ids[1], 100);
    await bitbrics.connect(backend).setKYC(user1.address, true);
    await bitbrics.connect(backend).setKYC(user2.address, true);

    await expect(
      bitbrics.connect(backend).mintBatch(user1.address, ids, amts, "0x")
    ).to.emit(bitbrics, "TransferBatch");

    await expect(
      bitbrics
        .connect(backend)
        .platformBatchTransfer(user1.address, user2.address, ids, amts, "0x")
    ).to.emit(bitbrics, "TransferBatch");
  });

  it("owner can rotate backend operator", async () => {
    await bitbrics.connect(owner).setBackendOperator(other.address);
    await expect(
      bitbrics.connect(backend).mint(user1.address, propertyId, 1, "0x")
    ).to.be.revertedWith("Not backend or owner");

    await bitbrics.connect(other).setKYC(user1.address, true);
    expect(await bitbrics.isKYCApproved(user1.address)).to.be.true;
  });

  it("does not allow approvals or public transfers", async () => {
    await expect(
      bitbrics.connect(user1).setApprovalForAll(user2.address, true)
    ).to.be.revertedWith("Approvals disabled");
    expect(
      await bitbrics.isApprovedForAll(user1.address, user2.address)
    ).to.equal(false);
  });
});
```
