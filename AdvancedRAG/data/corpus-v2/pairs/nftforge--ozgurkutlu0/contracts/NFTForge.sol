// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {ERC721URIStorage} from "@openzeppelin/contracts/token/ERC721/extensions/ERC721URIStorage.sol";

/// @title NFTForge — open ERC-721 minter
/// @notice Anyone can mint a token by providing a metadata URI (typically `ipfs://<cid>`).
contract NFTForge is ERC721URIStorage {
    uint256 private _nextTokenId;

    event Minted(address indexed to, uint256 indexed tokenId, string tokenURI);

    constructor() ERC721("NFTForge", "FORGE") {}

    /// @notice Mint a new NFT to `to` with metadata at `tokenURI_`.
    /// @dev Returns the new token ID.
    function mint(address to, string calldata tokenURI_) external returns (uint256 tokenId) {
        tokenId = _nextTokenId++;
        _safeMint(to, tokenId);
        _setTokenURI(tokenId, tokenURI_);
        emit Minted(to, tokenId, tokenURI_);
    }

    /// @notice Total number of tokens minted (next id == this value).
    function totalMinted() external view returns (uint256) {
        return _nextTokenId;
    }
}
