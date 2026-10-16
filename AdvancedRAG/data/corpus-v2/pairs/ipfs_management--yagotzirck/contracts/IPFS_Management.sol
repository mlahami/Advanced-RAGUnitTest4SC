// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

struct File {
    uint    fileId;     // An incremental number associated to each loaded file
    string  fileName;   // "<filename>.<extension>"" format, e.g. "book.pdf" 
    string  cid;        // The file's CID in the IPFS network
}

struct User {
    bool    isAuthorized;  // true if the user has been authorized by the owner
    File[]  files; 
}


contract IPFS_Management {
    /****************************************************
     * Variables
     ***************************************************/

    // The smart contract's creator / admin
    address private owner;

    // An incremental ID to assign to each File's "fileId" field
    uint private currId;

    // A mapping associating each authorized user to its User struct
    mapping (address => User) private users;

    // Event that will be emitted when sent files are marked as public
    event PublicFile(
        address indexed uploader,
        uint fileID,
        string fileName,
        string cid
    );


    /****************************************************
     * Modifiers
     ***************************************************/
    modifier onlyOwner() {
        require(
            msg.sender == owner,
            "Only the Smart Contract's owner/creator can call this function"
        );
        _;
    }

    modifier onlyAuthUsers() {
        require(
            users[msg.sender].isAuthorized == true,
            "Only users authorized by the Smart contract's owner can call "
            "this function"
        );
        _;
    }
    

    /****************************************************
     * Functions
     ***************************************************/
     constructor() {
        owner = msg.sender;
        users[owner].isAuthorized = true;
     }


     function addUser(address newUser) external onlyOwner {
        users[newUser].isAuthorized = true;
     }
     

     function addFile(
        string calldata fileName,
        string calldata cid
     ) external onlyAuthUsers
     {
        address userAddr = msg.sender;
        users[userAddr].files.push(
            File(
                currId++,
                fileName,
                cid
            )
        );
     }


     function addPublicFile(
        string calldata fileName,
        string calldata cid
     ) external onlyAuthUsers
     {
        emit PublicFile(msg.sender, currId++, fileName, cid);
     }


     function viewFiles()
     external view onlyAuthUsers
     returns (File[] memory files)
     {
        address userAddr = msg.sender;
        return users[userAddr].files;
     }


     function getOwnerAddress()
     external view
     returns (address ownerAddr)
     {
        return owner;
     }


     function isAuthorized()
     external view
     returns (bool)
     {
        address userAddr = msg.sender;
        return users[userAddr].isAuthorized;
     }


     function isAdmin()
     external view
     returns (bool)
     {
        return msg.sender == owner;
     }
}