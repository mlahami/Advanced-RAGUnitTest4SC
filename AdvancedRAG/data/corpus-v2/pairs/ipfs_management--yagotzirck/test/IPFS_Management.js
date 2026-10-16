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