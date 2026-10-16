// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/token/ERC721/extensions/ERC721URIStorage.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title RegenNFT
 * @dev A regenerative NFT contract for environmental and social impact projects
 */
contract RegenNFT is ERC721, ERC721URIStorage, Ownable {
    uint256 private _tokenIdCounter;
    
    // Base URI for metadata
    string private _baseTokenURI;
    
    // Mapping from token ID to impact data
    mapping(uint256 => string) public impactData;
    
    // Events
    event NFTMinted(address indexed to, uint256 indexed tokenId, string tokenURI);
    event ImpactDataUpdated(uint256 indexed tokenId, string impactData);
    event BaseURIUpdated(string newBaseURI);

    constructor(
        string memory name,
        string memory symbol,
        string memory baseTokenURI
    ) ERC721(name, symbol) Ownable(msg.sender) {
        _baseTokenURI = baseTokenURI;
    }

    /**
     * @dev Mint a new Regen NFT
     * @param to Address to mint the NFT to
     * @param uri Metadata URI for the NFT
     * @param _impactData Impact data associated with this NFT
     */
    function mintNFT(
        address to,
        string memory uri,
        string memory _impactData
    ) public onlyOwner returns (uint256) {
        uint256 tokenId = _tokenIdCounter;
        _tokenIdCounter++;
        
        _safeMint(to, tokenId);
        _setTokenURI(tokenId, uri);
        
        if (bytes(_impactData).length > 0) {
            impactData[tokenId] = _impactData;
            emit ImpactDataUpdated(tokenId, _impactData);
        }
        
        emit NFTMinted(to, tokenId, uri);
        return tokenId;
    }

    /**
     * @dev Batch mint multiple NFTs
     * @param to Address to mint the NFTs to
     * @param tokenURIs Array of metadata URIs
     * @param _impactDataArray Array of impact data
     */
    function batchMintNFT(
        address to,
        string[] memory tokenURIs,
        string[] memory _impactDataArray
    ) public onlyOwner {
        require(tokenURIs.length == _impactDataArray.length, "Arrays length mismatch");
        
        for (uint256 i = 0; i < tokenURIs.length; i++) {
            mintNFT(to, tokenURIs[i], _impactDataArray[i]);
        }
    }

    /**
     * @dev Update impact data for a token
     * @param tokenId Token ID to update
     * @param _impactData New impact data
     */
    function updateImpactData(uint256 tokenId, string memory _impactData) public onlyOwner {
        require(_ownerOf(tokenId) != address(0), "Token does not exist");
        impactData[tokenId] = _impactData;
        emit ImpactDataUpdated(tokenId, _impactData);
    }

    /**
     * @dev Set the base URI for token metadata
     * @param baseTokenURI New base URI
     */
    function setBaseURI(string memory baseTokenURI) public onlyOwner {
        _baseTokenURI = baseTokenURI;
        emit BaseURIUpdated(baseTokenURI);
    }

    /**
     * @dev Get the total number of tokens minted
     */
    function totalSupply() public view returns (uint256) {
        return _tokenIdCounter;
    }

    /**
     * @dev Get impact data for a token
     * @param tokenId Token ID to query
     */
    function getImpactData(uint256 tokenId) public view returns (string memory) {
        require(_ownerOf(tokenId) != address(0), "Token does not exist");
        return impactData[tokenId];
    }

    // Override functions required by Solidity
    function _baseURI() internal view override returns (string memory) {
        return _baseTokenURI;
    }

    function tokenURI(uint256 tokenId)
        public
        view
        override(ERC721, ERC721URIStorage)
        returns (string memory)
    {
        return super.tokenURI(tokenId);
    }

    function supportsInterface(bytes4 interfaceId)
        public
        view
        override(ERC721, ERC721URIStorage)
        returns (bool)
    {
        return super.supportsInterface(interfaceId);
    }
} 