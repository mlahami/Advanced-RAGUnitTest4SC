# batch-minter1155--joraemon-event

- domain: nft-marketplace (multi-token)
- level: moderate
- origin: human
- convention: hardhat2-ethers6
- source: https://github.com/Joraemon-Event/hardhat @ 72395f8fd6a780dfa5669679fdb606323b7c2b85
- license: MIT
- targets: batchMinter1155.sol, base1155.sol
- validation: 7 passing tests, 0 failing; statement coverage batchMinter1155.sol 100.0 %, base1155.sol 50.0 %

## Contract: base1155.sol (dependency)

```solidity
// SPDX-License-Identifier: MIT
// Compatible with OpenZeppelin Contracts ^5.0.0
pragma solidity ^0.8.22;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {ERC1155} from "@openzeppelin/contracts/token/ERC1155/ERC1155.sol";
import {ERC1155Burnable} from "@openzeppelin/contracts/token/ERC1155/extensions/ERC1155Burnable.sol";
import {ERC1155Pausable} from "@openzeppelin/contracts/token/ERC1155/extensions/ERC1155Pausable.sol";
import {ERC1155Supply} from "@openzeppelin/contracts/token/ERC1155/extensions/ERC1155Supply.sol";
import {ERC2981} from "@openzeppelin/contracts/token/common/ERC2981.sol";

contract Base1155 is ERC1155, AccessControl, ERC1155Pausable, ERC1155Burnable, ERC1155Supply, ERC2981 {
    bytes32 public constant URI_SETTER_ROLE = keccak256("URI_SETTER_ROLE");
    bytes32 public constant PAUSER_ROLE = keccak256("PAUSER_ROLE");
    bytes32 public constant MINTER_ROLE = keccak256("MINTER_ROLE");

    string _name;
    string _symbol;

    //feeNumerator 100% is 10000
    constructor(address defaultAdmin, address uriSetter, address pauser, address minter, address royaltyRecipient, uint96 feeNumerator) ERC1155("") {
        _grantRole(DEFAULT_ADMIN_ROLE, defaultAdmin);
        _grantRole(URI_SETTER_ROLE, uriSetter);
        _grantRole(PAUSER_ROLE, pauser);
        _grantRole(MINTER_ROLE, minter);
        _setDefaultRoyalty(royaltyRecipient, feeNumerator);
    }

    function name() public view returns (string memory) {
        return _name;
    }

    function symbol() public view returns (string memory) {
        return _symbol;
    }

    function setURI(string memory newuri) public virtual onlyRole(URI_SETTER_ROLE) {
        _setURI(newuri);
    }

    function pause() public onlyRole(PAUSER_ROLE) {
        _pause();
    }

    function unpause() public onlyRole(PAUSER_ROLE) {
        _unpause();
    }

    function mint(address account, uint256 id, uint256 amount, bytes memory data)
        public
        onlyRole(MINTER_ROLE)
    {
        _mint(account, id, amount, data);
    }

    function mintBatch(address to, uint256[] memory ids, uint256[] memory amounts, bytes memory data)
        public
        onlyRole(MINTER_ROLE)
    {
        _mintBatch(to, ids, amounts, data);
    }

    // The following functions are overrides required by Solidity.

    function _update(address from, address to, uint256[] memory ids, uint256[] memory values)
        internal
        override(ERC1155, ERC1155Pausable, ERC1155Supply)
    {
        super._update(from, to, ids, values);
    }

    function supportsInterface(bytes4 interfaceId)
        public
        view
        override(ERC1155, AccessControl, ERC2981)
        returns (bool)
    {
        return super.supportsInterface(interfaceId);
    }
}
```

## Contract: batchMinter1155.sol (primary target)

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.22;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {Base1155} from "./base1155.sol";

contract BatchMinter1155 is AccessControl{
  Base1155 public nft;
  bytes32 public constant MINTER_ROLE = keccak256("MINTER_ROLE");

  constructor (address defaultAdmin, address minter) {
    _grantRole(DEFAULT_ADMIN_ROLE, defaultAdmin);
    _grantRole(MINTER_ROLE, minter);
  }

  function setNFT(address nft_) public onlyRole(MINTER_ROLE) {
    require(nft_ != address(0), "Invalid address.");
    nft = Base1155(nft_);
  }

  function mintBatch(address[] memory accounts, uint256[] memory ids) public onlyRole(MINTER_ROLE) {
    require(accounts.length == ids.length, "Invalid input.");

    for (uint i = 0; i < accounts.length; i++) {
      nft.mint(accounts[i], ids[i], 1, "");
    }
  }
}
```

## Tests: batchMinter1155.js

```javascript
const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("BatchMinter1155", function () {
  let batchMinter1155;
  let owner;
  let minter;
  let recipient;
  let anotherRecipient;
  let base1155;

  beforeEach(async function () {
    [owner, minter, recipient, anotherRecipient] = await ethers.getSigners();

    const BatchMinter1155 = await ethers.getContractFactory("BatchMinter1155");
    batchMinter1155 = await BatchMinter1155.deploy(owner.address, minter.address);
    const batchMinter1155Address = await batchMinter1155.getAddress();

    const Base1155 = await ethers.getContractFactory("Base1155");
    base1155 = await Base1155.deploy(owner.address, owner.address, owner.address, batchMinter1155Address, owner.address, 1000);
  });

  describe("setNFT", function () {
    it("Should allow minter to set NFT contract", async function () {
      const base1155Address = await base1155.getAddress();
      await batchMinter1155.connect(minter).setNFT(base1155Address);
      expect(await batchMinter1155.nft()).to.equal(base1155Address);
    });

    it("Should revert if not minter", async function () {
      const base1155Address = await base1155.getAddress();
      await expect(batchMinter1155.connect(owner).setNFT(base1155Address)).to.be.revertedWithCustomError(batchMinter1155, "AccessControlUnauthorizedAccount");
    });

    it("Should revert if setting to zero address", async function () {
      await expect(batchMinter1155.connect(minter).setNFT(ethers.ZeroAddress)).to.be.revertedWith("Invalid address.");
    });
  });


  describe("mintBatch", function () {
    beforeEach(async function () {
      const base1155Address = await base1155.getAddress();
      await batchMinter1155.connect(minter).setNFT(base1155Address);
      await base1155.grantRole(await base1155.MINTER_ROLE(), base1155Address);
    });

    it("Should allow minter to batch mint", async function () {
      const ids = [1, 2, 3];
      await batchMinter1155.connect(minter).mintBatch([recipient.address, recipient.address, anotherRecipient.address], ids);

      expect(await base1155.balanceOf(recipient.address, 1)).to.equal(1);
      expect(await base1155.balanceOf(recipient.address, 2)).to.equal(1);
      expect(await base1155.balanceOf(anotherRecipient.address, 3)).to.equal(1);
    });

    it("Should revert if not minter", async function () {
      const ids = [1, 2, 3];
      await expect(batchMinter1155.connect(recipient).mintBatch([recipient.address], ids)).to.be.revertedWithCustomError(batchMinter1155, "AccessControlUnauthorizedAccount");
    });

    it("Should revert if arrays length mismatch", async function () {
      const ids = [1, 2, 3];
      await expect(batchMinter1155.connect(minter).mintBatch([recipient.address, recipient.address], ids)).to.be.reverted;
    });

    it("Should revert if minting to zero address", async function () {
      const ids = [1, 2, 3];
      await expect(batchMinter1155.connect(minter).mintBatch([ethers.ZeroAddress, recipient.address, recipient.address], ids)).to.be.reverted;
    });
  });
});
```
