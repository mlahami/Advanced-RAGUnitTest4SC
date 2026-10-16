// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;
import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

contract YourContract is ERC721, Ownable {
    uint256 public tokenCounter;
    mapping(uint256 => mapping(address => bool)) public certificateExists;
    struct CertificateData {
        uint256 courseId;
        string courseName;
        string courseDescription;
        uint256 timestamp;
    }
    mapping(uint256 => CertificateData) public certificateData;
    event POAPMinted(address indexed recipient, uint256 indexed tokenId, uint256 indexed courseId, string courseName, string courseDescription, uint256 timestamp);
    
    constructor() ERC721("POAPademyOnChain", "POAP") Ownable(msg.sender) {
        tokenCounter = 1;
    }
    
    function mintPOAP(address recipient, uint256 courseId, string memory courseName, string memory courseDescription) public onlyOwner returns (uint256) {
        require(!certificateExists[courseId][recipient], "Certificate already minted for this course for this recipient");
        uint256 tokenId = tokenCounter;
        _safeMint(recipient, tokenId);
        certificateData[tokenId] = CertificateData(courseId, courseName, courseDescription, block.timestamp);
        certificateExists[courseId][recipient] = true;
        emit POAPMinted(recipient, tokenId, courseId, courseName, courseDescription, block.timestamp);
        tokenCounter += 1;
        return tokenId;
    }
}