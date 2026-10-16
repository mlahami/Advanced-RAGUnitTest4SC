# multi-sig-wallet--mahdizarrei

- domain: multisig-treasury (multisig-wallet)
- level: complex
- origin: human
- convention: hardhat2-ethers6
- source: https://github.com/mahdiZarrei/MultiSigWallet @ d2f25e76fe1029efd3d7a6d783d39436bb7f6dde
- license: MIT
- targets: MultiSigWallet.sol, ERC1155.sol, ERC20.sol, ERC721.sol
- validation: 64 passing tests, 0 failing; statement coverage MultiSigWallet.sol 92.11 %, ERC1155.sol 33.33 %, ERC20.sol 100.0 %, ERC721.sol 60.0 %

## Contract: ERC1155.sol (dependency)

```solidity
// SPDX-License-Identifier: MIT
// Compatible with OpenZeppelin Contracts ^5.0.0
pragma solidity 0.8.24;

import "@openzeppelin/contracts/token/ERC1155/ERC1155.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

contract MyTokenERC1155 is ERC1155, Ownable {
    constructor(address initialOwner) ERC1155("") Ownable(initialOwner) {}

    function setURI(string memory newuri) public onlyOwner {
        _setURI(newuri);
    }

    function mint(
        address account,
        uint256 id,
        uint256 amount,
        bytes memory data
    ) public onlyOwner {
        _mint(account, id, amount, data);
    }

    function mintBatch(
        address to,
        uint256[] memory ids,
        uint256[] memory amounts,
        bytes memory data
    ) public onlyOwner {
        _mintBatch(to, ids, amounts, data);
    }
}
```

## Contract: ERC20.sol (dependency)

```solidity
// SPDX-License-Identifier: MIT
// Compatible with OpenZeppelin Contracts ^5.0.0
pragma solidity 0.8.24;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract Ether is ERC20 {
    constructor() ERC20("Ether", "ETH") {
        _mint(msg.sender, 1000000000000000000);
    }
}
```

## Contract: ERC721.sol (dependency)

```solidity
// SPDX-License-Identifier: MIT
// Compatible with OpenZeppelin Contracts ^5.0.0
pragma solidity 0.8.24;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/token/ERC721/extensions/ERC721URIStorage.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC721/utils/ERC721Holder.sol";
import "@openzeppelin/contracts/token/ERC1155/utils/ERC1155Holder.sol";

contract MyToken is ERC721, ERC721URIStorage, Ownable, ERC721Holder {
    uint256 private _nextTokenId;

    constructor(
        address initialOwner
    ) ERC721("MyToken", "MTK") Ownable(initialOwner) {}

    function safeMint(address to, string memory uri) public onlyOwner {
        uint256 tokenId = _nextTokenId++;
        _safeMint(to, tokenId);
        _setTokenURI(tokenId, uri);
    }

    // The following functions are overrides required by Solidity.

    function tokenURI(
        uint256 tokenId
    ) public view override(ERC721, ERC721URIStorage) returns (string memory) {
        return super.tokenURI(tokenId);
    }

    function supportsInterface(
        bytes4 interfaceId
    ) public view override(ERC721, ERC721URIStorage) returns (bool) {
        return super.supportsInterface(interfaceId);
    }
}
```

## Contract: MultiSigWallet.sol (primary target)

```solidity
// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "@openzeppelin/contracts/interfaces/IERC1155.sol";
import "@openzeppelin/contracts/interfaces/IERC20.sol";
import "@openzeppelin/contracts/interfaces/IERC721.sol";
import "@openzeppelin/contracts/token/ERC721/utils/ERC721Holder.sol";
import "@openzeppelin/contracts/token/ERC1155/utils/ERC1155Holder.sol";

contract MultiSigWallet is ERC721Holder, ERC1155Holder {
    bool internal locked;
    uint256 public numberOfOwners;
    uint256 public numConfirmationsRequired;

    struct Transaction {
        address to;
        uint256 value;
        bool executed;
        uint256 numConfirmations;
        uint8 currencyType;
        address currencyAdrress;
        uint256 ID;
    }
    struct TransactionOwner {
        address owner;
        bool executed;
        uint256 numConfirmations;
        bool addOwner;
    }
    struct TransactionNewNumConfirmations {
        uint256 NewNumConfirmations;
        bool executed;
        uint256 numConfirmations;
    }
    Transaction[] public transactions;
    TransactionOwner[] public transactionsOwner;
    TransactionNewNumConfirmations[] public transactionNewNumConfirmations;
    mapping(address => bool) public isOwner;

    // mapping from tx index => owner => bool
    mapping(uint256 => mapping(address => bool)) public isConfirmed;
    mapping(uint256 => mapping(address => bool)) public isConfirmedOwner;
    mapping(uint256 => mapping(address => bool))
        public isConfirmedNewNumConfirmations;

    event SubmitTransaction(
        address indexed owner,
        uint256 indexed txIndex,
        address indexed to,
        uint256 value,
        address currencyAdrress,
        uint8 currencyType
    );
    event SubmitTransactionOwner(
        address indexed owner,
        uint256 indexed txIndex,
        address ownerSuggested,
        bool addOwner
    );
    event SubmitTransactionNewNumConfirmations(
        uint256 indexed NewNumConfirmations,
        uint256 indexed txIndex,
        address ownerSuggested
    );
    event ConfirmTransaction(address indexed owner, uint256 indexed txIndex);
    event RevokeConfirmation(address indexed owner, uint256 indexed txIndex);
    event ExecuteTransaction(address indexed owner, uint256 indexed txIndex);

    modifier noReentrant() {
        require(!locked, "No re-entrancy");
        locked = true;
        _;
        locked = false;
    }
    modifier onlyOwner() {
        require(isOwner[msg.sender], "not owner");
        _;
    }

    modifier notExecuted(uint256 txIndex, uint8 operation) {
        if (operation == 1) {
            require(!transactions[txIndex].executed, "tx already executed");
        } else if (operation == 2) {
            require(
                !transactionsOwner[txIndex].executed,
                "tx already executed"
            );
        } else if (operation == 3) {
            require(
                !transactionNewNumConfirmations[txIndex].executed,
                "tx already executed"
            );
        }
        _;
    }

    modifier notConfirmed(uint256 txIndex, uint8 operation) {
        if (operation == 1) {
            require(!isConfirmed[txIndex][msg.sender], "tx already confirmed");
        } else if (operation == 2) {
            require(
                !isConfirmedOwner[txIndex][msg.sender],
                "tx already confirmed"
            );
        } else if (operation == 3) {
            require(
                !isConfirmedNewNumConfirmations[txIndex][msg.sender],
                "tx already confirmed"
            );
        }
        _;
    }
    modifier confirmed(uint256 txIndex, uint8 operation) {
        if (operation == 1) {
            require(isConfirmed[txIndex][msg.sender], "tx not confirmed");
        } else if (operation == 2) {
            require(isConfirmedOwner[txIndex][msg.sender], "tx not confirmed");
        } else if (operation == 3) {
            require(
                isConfirmedNewNumConfirmations[txIndex][msg.sender],
                "tx not confirmed"
            );
        }
        _;
    }
    modifier numRequired(uint256 txIndex, uint8 operation) {
        if (operation == 1) {
            require(
                transactions[txIndex].numConfirmations >=
                    numConfirmationsRequired,
                "cannot execute tx"
            );
        } else if (operation == 2) {
            require(
                transactionsOwner[txIndex].numConfirmations >=
                    numConfirmationsRequired,
                "cannot execute tx"
            );
        } else if (operation == 3) {
            require(
                transactionNewNumConfirmations[txIndex].numConfirmations >=
                    numConfirmationsRequired,
                "cannot execute tx"
            );
        }
        _;
    }

    constructor(address[] memory owners, uint256 numberConfirmationsRequired) {
        require(owners.length > 0, "owners required");
        require(
            numberConfirmationsRequired > 0 &&
                numberConfirmationsRequired <= owners.length,
            "invalid number of required confirmations"
        );

        for (uint256 i = 0; i < owners.length; i++) {
            address owner = owners[i];

            require(owner != address(0), "invalid owner");
            require(!isOwner[owner], "owner not unique");

            isOwner[owner] = true;
        }

        numConfirmationsRequired = numberConfirmationsRequired;
        numberOfOwners = owners.length;
    }

    function submitTransaction(
        address to,
        uint256 value,
        uint8 currencyType,
        address currencyAdrress,
        uint256 ID
    ) external onlyOwner {
        uint256 txIndex = transactions.length;
        require(currencyType < 3, "This type of currency does not exist");
        transactions.push(
            Transaction({
                to: to,
                value: value,
                executed: false,
                numConfirmations: 0,
                currencyType: currencyType,
                currencyAdrress: currencyAdrress,
                ID: ID
            })
        );

        emit SubmitTransaction(
            msg.sender,
            txIndex,
            to,
            value,
            currencyAdrress,
            currencyType
        );
    }

    function confirmTransaction(
        uint256 txIndex
    ) external onlyOwner notExecuted(txIndex, 1) notConfirmed(txIndex, 1) {
        transactions[txIndex].numConfirmations += 1;
        isConfirmed[txIndex][msg.sender] = true;
        emit ConfirmTransaction(msg.sender, txIndex);
    }

    function executeTransaction(
        uint256 txIndex
    )
        external
        payable
        onlyOwner
        notExecuted(txIndex, 1)
        noReentrant
        numRequired(txIndex, 1)
    {
        Transaction storage transaction = transactions[txIndex];

        transactions[txIndex].executed = true;

        if (transaction.currencyType == 0) {
            IERC721(transaction.currencyAdrress).safeTransferFrom(
                address(this),
                transaction.to,
                transaction.ID
            );
        } else if (transaction.currencyType == 1) {
            IERC1155(transaction.currencyAdrress).safeTransferFrom(
                address(this),
                transaction.to,
                transaction.ID,
                transaction.value,
                "0x676574"
            );
        } else if (transaction.currencyType == 2) {
            IERC20(transaction.currencyAdrress).transfer(
                transaction.to,
                transaction.value
            );
        }

        emit ExecuteTransaction(msg.sender, txIndex);
    }

    function revokeConfirmation(
        uint256 txIndex
    ) external onlyOwner notExecuted(txIndex, 1) confirmed(txIndex, 1) {
        Transaction storage transaction = transactions[txIndex];

        transaction.numConfirmations -= 1;
        isConfirmed[txIndex][msg.sender] = false;

        emit RevokeConfirmation(msg.sender, txIndex);
    }

    function submitTransactionOwner(
        address owner,
        bool addOwner
    ) external onlyOwner {
        uint256 txIndex = transactions.length;
        if (addOwner == true) {
            require(!isOwner[owner], "It's her owner");
            require(owner != address(0), "invalid owner");
        } else {
            require(isOwner[owner], "It's not owner");
        }
        transactionsOwner.push(
            TransactionOwner({
                owner: owner,
                executed: false,
                numConfirmations: 0,
                addOwner: addOwner
            })
        );
        emit SubmitTransactionOwner(msg.sender, txIndex, owner, addOwner);
    }

    function confirmTransactionOwner(
        uint256 txIndex
    ) external onlyOwner notExecuted(txIndex, 2) notConfirmed(txIndex, 2) {
        transactionsOwner[txIndex].numConfirmations += 1;
        isConfirmedOwner[txIndex][msg.sender] = true;
        emit ConfirmTransaction(msg.sender, txIndex);
    }

    function executeTransactionOwner(
        uint256 txIndex
    ) external onlyOwner notExecuted(txIndex, 2) numRequired(txIndex, 2) {
        transactionsOwner[txIndex].executed = true;

        if (transactionsOwner[txIndex].addOwner == true) {
            numberOfOwners += 1;
            isOwner[transactionsOwner[txIndex].owner] = true;
        } else if (transactionsOwner[txIndex].addOwner == false) {
            numberOfOwners -= 1;

            isOwner[transactionsOwner[txIndex].owner] = false;
        }
        emit ExecuteTransaction(msg.sender, txIndex);
    }

    function revokeConfirmationOwner(
        uint256 txIndex
    ) external onlyOwner notExecuted(txIndex, 2) confirmed(txIndex, 2) {
        transactionsOwner[txIndex].numConfirmations -= 1;
        isConfirmedOwner[txIndex][msg.sender] = false;

        emit RevokeConfirmation(msg.sender, txIndex);
    }

    function submitTransactionNewNumConfirmations(
        uint256 newNumConfirmations
    ) external onlyOwner {
        require(
            newNumConfirmations > 0 &&
                newNumConfirmations <= numberOfOwners &&
                newNumConfirmations != numConfirmationsRequired,
            "invalid number of required confirmations"
        );
        uint256 txIndex = transactionNewNumConfirmations.length;
        transactionNewNumConfirmations.push(
            TransactionNewNumConfirmations({
                NewNumConfirmations: newNumConfirmations,
                executed: false,
                numConfirmations: 0
            })
        );
        emit SubmitTransactionNewNumConfirmations(
            newNumConfirmations,
            txIndex,
            msg.sender
        );
    }

    function confirmTransactionNewNumConfirmations(
        uint256 txIndex
    ) external onlyOwner notExecuted(txIndex, 3) notConfirmed(txIndex, 3) {
        transactionNewNumConfirmations[txIndex].numConfirmations += 1;
        isConfirmedNewNumConfirmations[txIndex][msg.sender] = true;
        emit ConfirmTransaction(msg.sender, txIndex);
    }

    function executeTransactionNewNumConfirmations(
        uint256 txIndex
    ) external onlyOwner notExecuted(txIndex, 3) numRequired(txIndex, 3) {
        transactionNewNumConfirmations[txIndex].executed = true;
        numConfirmationsRequired = transactionNewNumConfirmations[txIndex]
            .NewNumConfirmations;
        emit ExecuteTransaction(msg.sender, txIndex);
    }

    function revokeConfirmationNewNumConfirmations(
        uint256 txIndex
    ) external onlyOwner confirmed(txIndex, 3) notExecuted(txIndex, 3) {
        TransactionNewNumConfirmations
            storage transaction = transactionNewNumConfirmations[txIndex];

        transaction.numConfirmations -= 1;
        isConfirmed[txIndex][msg.sender] = false;

        emit RevokeConfirmation(msg.sender, txIndex);
    }

    function getTransactionCount() external view returns (uint256) {
        return transactions.length;
    }

    function getTransactionCountOwner() external view returns (uint256) {
        return transactionsOwner.length;
    }

    function getTransactionCountNewNumConfirmations()
        external
        view
        returns (uint256)
    {
        return transactionNewNumConfirmations.length;
    }

    function getTransaction(
        uint256 txIndex
    )
        external
        view
        returns (
            address owner,
            uint256 value,
            bool executed,
            uint256 numConfirmations,
            uint8 currencyType,
            address currencyAdrress,
            uint256 ID
        )
    {
        Transaction storage transaction = transactions[txIndex];

        return (
            transaction.to,
            transaction.value,
            transaction.executed,
            transaction.numConfirmations,
            transaction.currencyType,
            transaction.currencyAdrress,
            transaction.ID
        );
    }

    function getTransactionOwner(
        uint256 txIndex
    )
        external
        view
        returns (
            address owner,
            bool executed,
            uint256 numConfirmations,
            bool addOwner
        )
    {
        TransactionOwner storage transaction = transactionsOwner[txIndex];

        return (
            transaction.owner,
            transaction.executed,
            transaction.numConfirmations,
            transaction.addOwner
        );
    }

    function getTransactionNewNumConfirmations(
        uint256 txIndex
    )
        external
        view
        returns (
            uint256 NewNumConfirmations,
            bool executed,
            uint256 numConfirmations
        )
    {
        TransactionNewNumConfirmations
            storage transaction = transactionNewNumConfirmations[txIndex];

        return (
            transaction.NewNumConfirmations,
            transaction.executed,
            transaction.numConfirmations
        );
    }
}
```

## Tests: MultiSigWallet.js

```javascript
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
```
