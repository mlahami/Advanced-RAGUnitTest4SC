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