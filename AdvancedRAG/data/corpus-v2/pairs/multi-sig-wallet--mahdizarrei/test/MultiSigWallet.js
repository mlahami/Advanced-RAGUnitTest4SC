const {
  loadFixture,
} = require("@nomicfoundation/hardhat-network-helpers");
const { expect } = require("chai");

describe("MultiSigWallet", () => {
  const deploy = async () => {
    const [account, account2, account3, isNotOwner] = await ethers.getSigners();
    const owners = [account, account2, account3];
    const numConfirmationsRequired = 1;

    const MultiSigWallet = await ethers.getContractFactory("MultiSigWallet");
    const multiSigWallet = await MultiSigWallet.deploy(
      owners,
      numConfirmationsRequired
    );
    const MyToken = await ethers.getContractFactory("MyToken");
    const myTokenNFT = await MyToken.deploy(owners[0]);

    const MyTokenERC1155 = await ethers.getContractFactory("MyTokenERC1155");
    const myTokenERC1155 = await MyTokenERC1155.deploy(owners[0]);

    const Ether = await ethers.getContractFactory("Ether");
    const ether = await Ether.deploy();

    return {
      multiSigWallet,
      myTokenNFT,
      myTokenERC1155,
      ether,
      owners,
      numConfirmationsRequired,
      isNotOwner,
    };
  };
  describe("Deployment", () => {
    it("Should set the right owners", async () => {
      const { multiSigWallet, owners } = await loadFixture(deploy);
      for (let i = 0; i < owners.length; i++) {
        expect(await multiSigWallet.isOwner(owners[i])).to.equal(true);
      }
    });
    it("Should set the right numConfirmationsRequired", async () => {
      const { multiSigWallet, numConfirmationsRequired } = await loadFixture(
        deploy
      );
      expect(await multiSigWallet.numConfirmationsRequired()).to.equal(
        numConfirmationsRequired
      );
    });
  });
  describe("receive", async () => {
    it("Should receive if send ERC20", async () => {
      const { multiSigWallet, ether } = await loadFixture(deploy);
      await ether.transfer(multiSigWallet.getAddress(), 200);
      expect(await ether.balanceOf(multiSigWallet.getAddress())).to.equal(200);
    });
    it("Should receive if send ERC721", async () => {
      const { multiSigWallet, myTokenNFT } = await loadFixture(deploy);
      await myTokenNFT.safeMint(
        multiSigWallet.getAddress(),
        "myTokenNFT.github.io"
      );
      expect(await myTokenNFT.balanceOf(multiSigWallet.getAddress())).to.equal(
        1
      );
    });
    it("Should receive if send ERC1155", async () => {
      const { multiSigWallet, myTokenERC1155 } = await loadFixture(deploy);
      await myTokenERC1155.mint(
        multiSigWallet.getAddress(),
        0,
        2000,
        "0x74657374206861726468617420626562696e69656d20766869206d69736865"
      );
      expect(
        await myTokenERC1155.balanceOf(multiSigWallet.getAddress(), 0)
      ).to.equal(2000);
    });
  });
  describe("submitTransaction", () => {
    describe("Validations", () => {
      it("Should revert with the right error if called from another account", async () => {
        const { multiSigWallet, isNotOwner, ether } = await loadFixture(deploy);
        await expect(
          multiSigWallet
            .connect(isNotOwner)
            .submitTransaction(isNotOwner, 200, 2, ether.getAddress(), 0)
        ).to.be.revertedWith("not owner");
      });
      it("Should revert with the right error if currencyType should be greater than 2", async () => {
        const { multiSigWallet, isNotOwner, ether } = await loadFixture(deploy);
        await expect(
          multiSigWallet.submitTransaction(
            isNotOwner,
            200,
            3,
            ether.getAddress(),
            0
          )
        ).to.be.revertedWith("This type of currency does not exist");
      });
    });
    describe("Event", () => {
      it("Should emit an event on submitTransaction", async () => {
        const { multiSigWallet, isNotOwner, ether, owners } = await loadFixture(
          deploy
        );
        await expect(
          multiSigWallet.submitTransaction(
            isNotOwner,
            200,
            2,
            ether.getAddress(),
            0
          )
        )
          .to.emit(multiSigWallet, "SubmitTransaction")
          .withArgs(owners[0], 0, isNotOwner, 200, ether.getAddress(), 2);
      });
    });
    describe("Executed", () => {
      it("Should push the right in transactions", async () => {
        const { multiSigWallet, isNotOwner, ether } = await loadFixture(deploy);
        await multiSigWallet.submitTransaction(
          isNotOwner,
          200,
          2,
          ether.getAddress(),
          0
        );
        expect(await multiSigWallet.getTransactionCount()).to.be.equal(1);
      });
    });
  });
  describe("submitTransactionOwner", () => {
    describe("Validations", () => {
      it("Should revert with the right error if called from another account", async () => {
        const { multiSigWallet, isNotOwner, owners } = await loadFixture(
          deploy
        );
        await expect(
          multiSigWallet
            .connect(isNotOwner)
            .submitTransactionOwner(owners[0], false)
        ).to.be.revertedWith("not owner");
      });
      it("Should revert with the right error if isOwner == true ", async () => {
        const { multiSigWallet, owners } = await loadFixture(deploy);
        await expect(
          multiSigWallet.submitTransactionOwner(owners[0], true)
        ).to.be.revertedWith("It's her owner");
      });
      it("Should revert with the right error if owner == address(0) ", async () => {
        const { multiSigWallet } = await loadFixture(deploy);
        await expect(
          multiSigWallet.submitTransactionOwner(
            "0x0000000000000000000000000000000000000000",
            true
          )
        ).to.be.revertedWith("invalid owner");
      });
      it("Should revert with the right error if isOwner == false ", async () => {
        const { multiSigWallet, isNotOwner } = await loadFixture(deploy);
        await expect(
          multiSigWallet.submitTransactionOwner(isNotOwner, false)
        ).to.be.revertedWith("It's not owner");
      });
    });

    describe("Event", () => {
      it("Should emit an event on SubmitTransactionOwner", async () => {
        const { multiSigWallet, isNotOwner, owners } = await loadFixture(
          deploy
        );
        await expect(multiSigWallet.submitTransactionOwner(isNotOwner, true))
          .to.emit(multiSigWallet, "SubmitTransactionOwner")
          .withArgs(owners[0], 0, isNotOwner, true);
      });
    });
    describe("Executed", () => {
      it("Should push the right in transactionsOwner if addOwner == true", async () => {
        const { multiSigWallet, isNotOwner } = await loadFixture(deploy);
        await multiSigWallet.submitTransactionOwner(isNotOwner, true);
        expect(await multiSigWallet.getTransactionCountOwner()).to.be.equal(1);
      });
      it("Should push the right in transactionsOwner if addOwner == false", async () => {
        const { multiSigWallet, owners } = await loadFixture(deploy);
        await multiSigWallet.submitTransactionOwner(owners[0], false);
        expect(await multiSigWallet.getTransactionCountOwner()).to.be.equal(1);
      });
    });
  });
  describe("submitTransactionNewNumConfirmations", () => {
    describe("Validations", () => {
      it("Should revert with the right error if called from another account", async () => {
        const { multiSigWallet, isNotOwner } = await loadFixture(deploy);
        await expect(
          multiSigWallet
            .connect(isNotOwner)
            .submitTransactionNewNumConfirmations(2)
        ).to.be.revertedWith("not owner");
      });
      it("Should revert with the right error if  newNumConfirmations <= 0 ", async () => {
        const { multiSigWallet } = await loadFixture(deploy);
        await expect(
          multiSigWallet.submitTransactionNewNumConfirmations(0)
        ).to.be.revertedWith("invalid number of required confirmations");
      });
      it("Should revert with the right error if newNumConfirmations > numberOfOwners ", async () => {
        const { multiSigWallet } = await loadFixture(deploy);
        await expect(
          multiSigWallet.submitTransactionNewNumConfirmations(4)
        ).to.be.revertedWith("invalid number of required confirmations");
      });
      it("Should revert with the right error if  newNumConfirmations == numConfirmationsRequired", async () => {
        const { multiSigWallet } = await loadFixture(deploy);
        await expect(
          multiSigWallet.submitTransactionNewNumConfirmations(1)
        ).to.be.revertedWith("invalid number of required confirmations");
      });
    });
    describe("Event", () => {
      it("Should emit an event on SubmitTransactionNewNumConfirmations", async () => {
        const { multiSigWallet, owners } = await loadFixture(deploy);
        await expect(multiSigWallet.submitTransactionNewNumConfirmations(2))
          .to.emit(multiSigWallet, "SubmitTransactionNewNumConfirmations")
          .withArgs(2, 0, owners[0]);
      });
    });
    describe("Executed", () => {
      it("Should push the right in transactionNewNumConfirmations", async () => {
        const { multiSigWallet } = await loadFixture(deploy);
        await multiSigWallet.submitTransactionNewNumConfirmations(2);
        expect(
          await multiSigWallet.getTransactionCountNewNumConfirmations()
        ).to.be.equal(1);
      });
    });
  });
  describe("confirmTransactionNewNumConfirmations", () => {
    describe("Validations", () => {
      it("Should revert with the right error if called from another account", async () => {
        const { multiSigWallet, isNotOwner } = await loadFixture(deploy);
        await expect(
          multiSigWallet
            .connect(isNotOwner)
            .confirmTransactionNewNumConfirmations(0)
        ).to.be.revertedWith("not owner");
      });

      it("Should revert with the right error if transactionNewNumConfirmations[txIndex].Executed == true", async () => {
        const { multiSigWallet, owners } = await loadFixture(deploy);
        await multiSigWallet.submitTransactionNewNumConfirmations(2);
        await multiSigWallet.confirmTransactionNewNumConfirmations(0);
        await multiSigWallet.executeTransactionNewNumConfirmations(0);
        await expect(
          multiSigWallet
            .connect(owners[1])
            .confirmTransactionNewNumConfirmations(0)
        ).to.be.revertedWith("tx already executed");
      });
      it("Should revert with the right error if isConfirmedNewNumConfirmations[txIndex][msg.sender] == true", async () => {
        const { multiSigWallet } = await loadFixture(deploy);
        await multiSigWallet.submitTransactionNewNumConfirmations(2);
        await multiSigWallet.confirmTransactionNewNumConfirmations(0);

        await expect(
          multiSigWallet.confirmTransactionNewNumConfirmations(0)
        ).to.be.revertedWith("tx already confirmed");
      });
    });
    describe("Event", () => {
      it("Should emit an event on ConfirmTransaction", async () => {
        const { multiSigWallet, owners } = await loadFixture(deploy);

        await multiSigWallet.submitTransactionNewNumConfirmations(2);

        await expect(multiSigWallet.confirmTransactionNewNumConfirmations(0))
          .to.emit(multiSigWallet, "ConfirmTransaction")
          .withArgs(owners[0], 0);
      });
    });
  });
  describe("confirmTransactionOwner", () => {
    describe("Validations", () => {
      it("Should revert with the right error if called from another account", async () => {
        const { multiSigWallet, isNotOwner } = await loadFixture(deploy);
        await expect(
          multiSigWallet.connect(isNotOwner).confirmTransactionOwner(0)
        ).to.be.revertedWith("not owner");
      });

      it("Should revert with the right error if transactionsOwner[txIndex].Executed == true", async () => {
        const { multiSigWallet, isNotOwner, owners } = await loadFixture(
          deploy
        );
        await multiSigWallet.submitTransactionOwner(isNotOwner, true);
        await multiSigWallet.confirmTransactionOwner(0);
        await multiSigWallet.executeTransactionOwner(0);
        await expect(
          multiSigWallet.connect(owners[1]).confirmTransactionOwner(0)
        ).to.be.revertedWith("tx already executed");
      });
      it("Should revert with the right error if isConfirmedOwner[txIndex][msg.sender] == true", async () => {
        const { multiSigWallet, isNotOwner } = await loadFixture(deploy);
        await multiSigWallet.submitTransactionOwner(isNotOwner, true);
        await multiSigWallet.confirmTransactionOwner(0);

        await expect(
          multiSigWallet.confirmTransactionOwner(0)
        ).to.be.revertedWith("tx already confirmed");
      });
    });
    describe("Event", () => {
      it("Should emit an event on ConfirmTransaction", async () => {
        const { multiSigWallet, isNotOwner, owners } = await loadFixture(
          deploy
        );
        await multiSigWallet.submitTransactionOwner(isNotOwner, true);

        await expect(multiSigWallet.confirmTransactionOwner(0))
          .to.emit(multiSigWallet, "ConfirmTransaction")
          .withArgs(owners[0], 0);
      });
    });
  });
  describe("confirmTransaction", () => {
    describe("Validations", () => {
      it("Should revert with the right error if called from another account", async () => {
        const { multiSigWallet, isNotOwner } = await loadFixture(deploy);
        await expect(
          multiSigWallet.connect(isNotOwner).confirmTransaction(0)
        ).to.be.revertedWith("not owner");
      });

      it("Should revert with the right error if transactions[txIndex].Executed == true", async () => {
        const { multiSigWallet, isNotOwner, ether, owners } = await loadFixture(
          deploy
        );
        await multiSigWallet.submitTransaction(
          isNotOwner,
          200,
          2,
          ether.getAddress(),
          0
        );
        await multiSigWallet.confirmTransaction(0);
        await ether.transfer(multiSigWallet.getAddress(), 2000);
        await multiSigWallet.executeTransaction(0);
        await expect(
          multiSigWallet.connect(owners[1]).confirmTransaction(0)
        ).to.be.revertedWith("tx already executed");
      });
      it("Should revert with the right error if isConfirmed[txIndex][msg.sender] == true", async () => {
        const { multiSigWallet, isNotOwner, ether } = await loadFixture(deploy);
        await multiSigWallet.submitTransaction(
          isNotOwner,
          200,
          2,
          ether.getAddress(),
          0
        );
        await multiSigWallet.confirmTransaction(0);

        await expect(multiSigWallet.confirmTransaction(0)).to.be.revertedWith(
          "tx already confirmed"
        );
      });
    });
    describe("Event", () => {
      it("Should emit an event on ConfirmTransaction", async () => {
        const { multiSigWallet, isNotOwner, ether, owners } = await loadFixture(
          deploy
        );
        await multiSigWallet.submitTransaction(
          isNotOwner,
          200,
          2,
          ether.getAddress(),
          0
        );

        await expect(multiSigWallet.confirmTransaction(0))
          .to.emit(multiSigWallet, "ConfirmTransaction")
          .withArgs(owners[0], 0);
      });
    });
  });
  describe("executeTransactionOwner", () => {
    describe("Validations", () => {
      it("Should revert with the right error if called from another account", async () => {
        const { multiSigWallet, isNotOwner } = await loadFixture(deploy);
        await expect(
          multiSigWallet.connect(isNotOwner).executeTransactionOwner(0)
        ).to.be.revertedWith("not owner");
      });

      it("Should revert with the right error if transactionsOwner[txIndex].Executed == true", async () => {
        const { multiSigWallet, isNotOwner, owners } = await loadFixture(
          deploy
        );
        await multiSigWallet.submitTransactionOwner(isNotOwner, true);
        await multiSigWallet.confirmTransactionOwner(0);
        await multiSigWallet.executeTransactionOwner(0);
        await expect(
          multiSigWallet.connect(owners[1]).executeTransactionOwner(0)
        ).to.be.revertedWith("tx already executed");
      });
      it("Should revert with the right error if  transactionsOwner[txIndex].numConfirmations < numConfirmationsRequired", async () => {
        const { multiSigWallet, isNotOwner } = await loadFixture(deploy);
        await multiSigWallet.submitTransactionOwner(isNotOwner, true);
        await expect(
          multiSigWallet.executeTransactionOwner(0)
        ).to.be.revertedWith("cannot execute tx");
      });
    });
    describe("Event", () => {
      it("Should emit an event on ExecuteTransaction", async () => {
        const { multiSigWallet, isNotOwner, owners } = await loadFixture(
          deploy
        );
        await multiSigWallet.submitTransactionOwner(isNotOwner, true);
        await multiSigWallet.confirmTransactionOwner(0);
        await expect(multiSigWallet.executeTransactionOwner(0))
          .to.emit(multiSigWallet, "ExecuteTransaction")
          .withArgs(owners[0], 0);
      });
    });
    describe("Executed", () => {
      it("Should add owner the right ", async () => {
        const { multiSigWallet, isNotOwner } = await loadFixture(deploy);
        await multiSigWallet.submitTransactionOwner(isNotOwner, true);
        await multiSigWallet.confirmTransactionOwner(0);
        await multiSigWallet.executeTransactionOwner(0);
        expect(await multiSigWallet.isOwner(isNotOwner)).to.be.equal(true);
      });
      it("Should remove owner the right ", async () => {
        const { multiSigWallet, owners } = await loadFixture(deploy);
        await multiSigWallet.submitTransactionOwner(owners[1], false);
        await multiSigWallet.confirmTransactionOwner(0);
        await multiSigWallet.executeTransactionOwner(0);
        expect(await multiSigWallet.isOwner(owners[1])).to.be.equal(false);
      });
    });
  });

  describe("executeTransactionNewNumConfirmations", () => {
    describe("Validations", () => {
      it("Should revert with the right error if called from another account", async () => {
        const { multiSigWallet, isNotOwner } = await loadFixture(deploy);
        await expect(
          multiSigWallet
            .connect(isNotOwner)
            .executeTransactionNewNumConfirmations(0)
        ).to.be.revertedWith("not owner");
      });

      it("Should revert with the right error if transactionNewNumConfirmations[txIndex].Executed == true", async () => {
        const { multiSigWallet, owners } = await loadFixture(deploy);
        await multiSigWallet.submitTransactionNewNumConfirmations(2);
        await multiSigWallet.confirmTransactionNewNumConfirmations(0);
        await multiSigWallet.executeTransactionNewNumConfirmations(0);
        await expect(
          multiSigWallet
            .connect(owners[1])
            .executeTransactionNewNumConfirmations(0)
        ).to.be.revertedWith("tx already executed");
      });
      it("Should revert with the right error if  transactionNewNumConfirmations[txIndex].numConfirmations < numConfirmationsRequired", async () => {
        const { multiSigWallet } = await loadFixture(deploy);
        await multiSigWallet.submitTransactionNewNumConfirmations(2);
        await expect(
          multiSigWallet.executeTransactionNewNumConfirmations(0)
        ).to.be.revertedWith("cannot execute tx");
      });
    });
    describe("Event", () => {
      it("Should emit an event on ExecuteTransaction", async () => {
        const { multiSigWallet, owners } = await loadFixture(deploy);
        await multiSigWallet.submitTransactionNewNumConfirmations(2);
        await multiSigWallet.confirmTransactionNewNumConfirmations(0);
        await expect(multiSigWallet.executeTransactionNewNumConfirmations(0))
          .to.emit(multiSigWallet, "ExecuteTransaction")
          .withArgs(owners[0], 0);
      });
    });
    describe("Executed", () => {
      it("Should change numConfirmationsRequired the right ", async () => {
        const { multiSigWallet } = await loadFixture(deploy);
        await multiSigWallet.submitTransactionNewNumConfirmations(2);
        await multiSigWallet.confirmTransactionNewNumConfirmations(0);
        await multiSigWallet.executeTransactionNewNumConfirmations(0);
        await multiSigWallet.submitTransactionNewNumConfirmations(3);
        await multiSigWallet.confirmTransactionNewNumConfirmations(1);

        await expect(
          multiSigWallet.executeTransactionNewNumConfirmations(1)
        ).to.be.revertedWith("cannot execute tx");
      });
    });
  });

  describe("executeTransaction", () => {
    describe("Validations", () => {
      it("Should revert with the right error if called from another account", async () => {
        const { multiSigWallet, isNotOwner } = await loadFixture(deploy);
        await expect(
          multiSigWallet.connect(isNotOwner).executeTransaction(0)
        ).to.be.revertedWith("not owner");
      });

      it("Should revert with the right error if transactions[txIndex].Executed == true", async () => {
        const { multiSigWallet, isNotOwner, ether, owners } = await loadFixture(
          deploy
        );
        await multiSigWallet.submitTransaction(
          isNotOwner,
          200,
          2,
          ether.getAddress(),
          0
        );
        await multiSigWallet.confirmTransaction(0);
        await ether.transfer(multiSigWallet.getAddress(), 2000);
        await multiSigWallet.executeTransaction(0);

        await expect(
          multiSigWallet.connect(owners[1]).executeTransaction(0)
        ).to.be.revertedWith("tx already executed");
      });
      it("Should revert with the right error if  transactionsOwner[txIndex].numConfirmations < numConfirmationsRequired", async () => {
        const { multiSigWallet, isNotOwner, ether } = await loadFixture(deploy);
        await multiSigWallet.submitTransaction(
          isNotOwner,
          200,
          2,
          ether.getAddress(),
          0
        );
        await expect(multiSigWallet.executeTransaction(0)).to.be.revertedWith(
          "cannot execute tx"
        );
      });
    });
    describe("Event", () => {
      it("Should emit an event on ExecuteTransaction", async () => {
        const { multiSigWallet, isNotOwner, ether, owners } = await loadFixture(
          deploy
        );
        await multiSigWallet.submitTransaction(
          isNotOwner,
          200,
          2,
          ether.getAddress(),
          0
        );
        await multiSigWallet.confirmTransaction(0);
        await ether.transfer(multiSigWallet.getAddress(), 2000);
        await expect(multiSigWallet.executeTransaction(0))
          .to.emit(multiSigWallet, "ExecuteTransaction")
          .withArgs(owners[0], 0);
      });
    });
    describe("Executed", () => {
      it("Should send ERC721 the right ", async () => {
        const { multiSigWallet, myTokenNFT } = await loadFixture(deploy);
        await myTokenNFT.safeMint(
          multiSigWallet.getAddress(),
          "myTokenNFT.github.io"
        );
        await multiSigWallet.submitTransaction(
          myTokenNFT.getAddress(),
          200,
          0,
          myTokenNFT.getAddress(),
          0
        );
        await multiSigWallet.confirmTransaction(0);
        await multiSigWallet.executeTransaction(0);
        expect(await myTokenNFT.balanceOf(myTokenNFT.getAddress())).to.equal(1);
      });
      it("Should send ERC1155 the right ", async () => {
        const { multiSigWallet, myTokenERC1155, owners } = await loadFixture(
          deploy
        );
        await myTokenERC1155.mint(
          multiSigWallet.getAddress(),
          0,
          2000,
          "0x74657374206861726468617420626562696e69656d20766869206d69736865"
        );
        await multiSigWallet.submitTransaction(
          owners[1],
          200,
          1,
          myTokenERC1155.getAddress(),
          0
        );
        await multiSigWallet.confirmTransaction(0);
        await multiSigWallet.executeTransaction(0);

        expect(
          await myTokenERC1155.balanceOf(owners[1].getAddress(), 0)
        ).to.equal(200);
      });
      it("Should send ERC1155 the right ", async () => {
        const { multiSigWallet, ether, owners } = await loadFixture(deploy);
        await ether.transfer(multiSigWallet.getAddress(), 200);

        await multiSigWallet.submitTransaction(
          owners[1],
          200,
          2,
          ether.getAddress(),
          0
        );
        await multiSigWallet.confirmTransaction(0);
        await multiSigWallet.executeTransaction(0);
        expect(await ether.balanceOf(multiSigWallet.getAddress())).to.equal(0);
      });
    });
  });
  describe("revokeConfirmation", () => {
    describe("Validations", () => {
      it("Should revert with the right error if called from another account", async () => {
        const { multiSigWallet, isNotOwner } = await loadFixture(deploy);
        await expect(
          multiSigWallet.connect(isNotOwner).revokeConfirmation(0)
        ).to.be.revertedWith("not owner");
      });

      it("Should revert with the right error if transactions[txIndex].Executed == true", async () => {
        const { multiSigWallet, isNotOwner, ether, owners } = await loadFixture(
          deploy
        );
        await multiSigWallet.submitTransaction(
          isNotOwner,
          200,
          2,
          ether.getAddress(),
          0
        );
        await multiSigWallet.connect(owners[1]).confirmTransaction(0);
        await multiSigWallet.confirmTransaction(0);
        await ether.transfer(multiSigWallet.getAddress(), 2000);
        await multiSigWallet.executeTransaction(0);

        await expect(
          multiSigWallet.connect(owners[1]).revokeConfirmation(0)
        ).to.be.revertedWith("tx already executed");
      });
      it("Should revert with the right error if isConfirmed[txIndex][msg.sender] == false", async () => {
        const { multiSigWallet, isNotOwner, ether } = await loadFixture(deploy);
        await multiSigWallet.submitTransaction(
          isNotOwner,
          200,
          2,
          ether.getAddress(),
          0
        );

        await expect(multiSigWallet.revokeConfirmation(0)).to.be.revertedWith(
          "tx not confirmed"
        );
      });
    });
    describe("Event", () => {
      it("Should emit an event on RevokeConfirmation", async () => {
        const { multiSigWallet, isNotOwner, ether, owners } = await loadFixture(
          deploy
        );
        await multiSigWallet.submitTransaction(
          isNotOwner,
          200,
          2,
          ether.getAddress(),
          0
        );
        await multiSigWallet.confirmTransaction(0);
        await expect(multiSigWallet.revokeConfirmation(0))
          .to.emit(multiSigWallet, "RevokeConfirmation")
          .withArgs(owners[0], 0);
      });
    });
  });
  describe("revokeConfirmationNewNumConfirmations", () => {
    describe("Validations", () => {
      it("Should revert with the right error if called from another account", async () => {
        const { multiSigWallet, isNotOwner } = await loadFixture(deploy);
        await expect(
          multiSigWallet
            .connect(isNotOwner)
            .revokeConfirmationNewNumConfirmations(0)
        ).to.be.revertedWith("not owner");
      });

      it("Should revert with the right error if transactionNewNumConfirmations[txIndex].Executed == true", async () => {
        const { multiSigWallet } = await loadFixture(deploy);
        await multiSigWallet.submitTransactionNewNumConfirmations(2);
        await multiSigWallet.confirmTransactionNewNumConfirmations(0);
        await multiSigWallet.executeTransactionNewNumConfirmations(0);
        await expect(
          multiSigWallet.revokeConfirmationNewNumConfirmations(0)
        ).to.be.revertedWith("tx already executed");
      });
      it("Should revert with the right error if isConfirmedNewNumConfirmations[txIndex][msg.sender] == false", async () => {
        const { multiSigWallet } = await loadFixture(deploy);
        await multiSigWallet.submitTransactionNewNumConfirmations(2);

        await expect(
          multiSigWallet.revokeConfirmationNewNumConfirmations(0)
        ).to.be.revertedWith("tx not confirmed");
      });
    });
    describe("Event", () => {
      it("Should emit an event on RevokeConfirmation", async () => {
        const { multiSigWallet, owners } = await loadFixture(deploy);
        await multiSigWallet.submitTransactionNewNumConfirmations(2);

        await multiSigWallet.confirmTransactionNewNumConfirmations(0);
        await expect(multiSigWallet.revokeConfirmationNewNumConfirmations(0))
          .to.emit(multiSigWallet, "RevokeConfirmation")
          .withArgs(owners[0], 0);
      });
    });
  });

  describe("revokeConfirmationOwner", () => {
    describe("Validations", () => {
      it("Should revert with the right error if called from another account", async () => {
        const { multiSigWallet, isNotOwner } = await loadFixture(deploy);
        await expect(
          multiSigWallet.connect(isNotOwner).revokeConfirmationOwner(0)
        ).to.be.revertedWith("not owner");
      });

      it("Should revert with the right error if transactionsOwner[txIndex].Executed == true", async () => {
        const { multiSigWallet, isNotOwner, ether, owners } = await loadFixture(
          deploy
        );
        await multiSigWallet.submitTransactionOwner(isNotOwner, true);
        await multiSigWallet.connect(owners[1]).confirmTransactionOwner(0);
        await multiSigWallet.confirmTransactionOwner(0);
        await ether.transfer(multiSigWallet.getAddress(), 2000);
        await multiSigWallet.executeTransactionOwner(0);

        await expect(
          multiSigWallet.connect(owners[1]).revokeConfirmationOwner(0)
        ).to.be.revertedWith("tx already executed");
      });
      it("Should revert with the right error if isConfirmedOwner[txIndex][msg.sender] == false", async () => {
        const { multiSigWallet, isNotOwner } = await loadFixture(deploy);
        await multiSigWallet.submitTransactionOwner(isNotOwner, true);

        await expect(
          multiSigWallet.revokeConfirmationOwner(0)
        ).to.be.revertedWith("tx not confirmed");
      });
    });
    describe("Event", () => {
      it("Should emit an event on RevokeConfirmation", async () => {
        const { multiSigWallet, isNotOwner, owners } = await loadFixture(
          deploy
        );
        await multiSigWallet.submitTransactionOwner(isNotOwner, true);
        await multiSigWallet.confirmTransactionOwner(0);
        await expect(multiSigWallet.revokeConfirmationOwner(0))
          .to.emit(multiSigWallet, "RevokeConfirmation")
          .withArgs(owners[0], 0);
      });
    });
  });
});
