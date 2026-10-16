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
