# ipfs_management--yagotzirck

- domain: registries-identity (file-access-registry)
- level: moderate
- origin: human
- convention: hardhat2-ethers6
- source: https://github.com/Yagotzirck/ipfsEth_fileManagement @ e6b8602f5dc01936feef5de30345b94c062eb4a5
- license: MIT
- targets: IPFS_Management.sol
- validation: 6 passing tests, 0 failing; statement coverage IPFS_Management.sol 72.73 %

## Contract: IPFS_Management.sol (primary target)

```solidity
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
```

## Tests: IPFS_Management.js

```javascript
const { expect } = require("chai");

const {
  loadFixture,
} = require("@nomicfoundation/hardhat-network-helpers");

describe("IPFS_Management contract", function () {
  // We define a fixture to reuse the same setup in every test. We use
  // loadFixture to run this setup once, snapshot that state, and reset Hardhat
  // Network to that snapshot in every test.
  async function deployIPFS_ManagementFixture() {
    // Get the Signers here.
    const [owner, addr1, addr2] = await ethers.getSigners();

    // To deploy our contract, we just have to call ethers.deployContract and await
    // its waitForDeployment() method, which happens once its transaction has been
    // mined.
    const hardhatIPFS_Management = await ethers.deployContract("IPFS_Management");

    await hardhatIPFS_Management.waitForDeployment();

    // Fixtures can return anything you consider useful for your tests
    return { hardhatIPFS_Management, owner, addr1, addr2 };
  }

  describe("Deployment", function () {
    it("Should set the right owner", async function () {
      const {
        hardhatIPFS_Management, owner
      } = await loadFixture(deployIPFS_ManagementFixture);

      expect(await hardhatIPFS_Management.getOwnerAddress()).to.equal(owner.address);
    });

  });

  describe("Transactions", function () {
    it(
    "Authorized users can add new files",
    async function ()
    {
      const {
        hardhatIPFS_Management, owner, addr1
      } = await loadFixture(deployIPFS_ManagementFixture);

      const fileName1 = "Test1.txt";
      const fileCID1 = "QmWBaeu6y1zEcKbsEqCuhuDHPL3W8pZouCPdafMCRCSUWk";

      // The owner adds a new file
      await hardhatIPFS_Management.addFile(fileName1, fileCID1);
      // Check that the file has been added to the list of files associated to
      // the owner's file list

      expect(
        await hardhatIPFS_Management.viewFiles()
      ).deep.equal([ [0, fileName1, fileCID1] ]);


      // The owner authorizes an user, who will proceed to add a file
      await hardhatIPFS_Management.addUser(addr1); 
      IPFS_auth_user = await hardhatIPFS_Management.connect(addr1); 

      await IPFS_auth_user.addFile(fileName1, fileCID1);
      // Check that the file has been added to the list of files associated to
      // the user's file list

      expect(
        await IPFS_auth_user.viewFiles()
      ).deep.equal([ [1, fileName1, fileCID1] ]);

    });

    it(
    "Users not authorized by the owner can't add new files",
    async function()
    {
      const {
        hardhatIPFS_Management, _, addr1
      } = await loadFixture(deployIPFS_ManagementFixture);

      IPFS_not_auth_user = await hardhatIPFS_Management.connect(addr1);

      const fileName1 = "Test1.txt";
      const fileCID1 = "QmWBaeu6y1zEcKbsEqCuhuDHPL3W8pZouCPdafMCRCSUWk";
      
      const revertMsg =
        "Only users authorized by the Smart contract's owner can call " +
        "this function";

      await expect(
        IPFS_not_auth_user.addFile(fileName1, fileCID1)
      ).to.be.revertedWith(revertMsg);

    });
    

    it(
    "Users not authorized by the owner can't call viewFiles()",
    async function()
    {
      const {
        hardhatIPFS_Management, _, addr1
      } = await loadFixture(deployIPFS_ManagementFixture);

      IPFS_not_auth_user = await hardhatIPFS_Management.connect(addr1);

      const revertMsg =
        "Only users authorized by the Smart contract's owner can call " +
        "this function";

      await expect(
        IPFS_not_auth_user.viewFiles()
      ).to.be.revertedWith(revertMsg);

    });
      
    it(
    "Only the owner can add new users",
    async function()
    {
      const {
        hardhatIPFS_Management, _, addr1, addr2
      } = await loadFixture(deployIPFS_ManagementFixture);

      IPFS_not_auth_user = await hardhatIPFS_Management.connect(addr1);

      const revertMsg =
        "Only the Smart Contract's owner/creator can call this function";

      await expect(
        IPFS_not_auth_user.addUser(addr2)
      ).to.be.revertedWith(revertMsg);

    });

    it(
      "Adding a public file should emit a PublicFile event",
      async function()
      {
        const {
          hardhatIPFS_Management, owner
        } = await loadFixture(deployIPFS_ManagementFixture);

        const fileName1 = "Test1.txt";
        const fileCID1 = "QmWBaeu6y1zEcKbsEqCuhuDHPL3W8pZouCPdafMCRCSUWk";

        await expect(
          hardhatIPFS_Management.addPublicFile(
            fileName1, fileCID1
          )
        ).to.emit(
          hardhatIPFS_Management, "PublicFile"
        ).withArgs(owner, 0, fileName1, fileCID1);

      });

  });
});
```
