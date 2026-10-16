# multi-sig--muhammadkorra

- domain: multisig-treasury (multisig-wallet)
- level: moderate
- origin: human
- convention: hardhat2-ethers6
- source: https://github.com/muhammadkorra/multisig-wallet-eth @ 5f6118011febde4a0457480f72071020023d02af
- license: MIT
- targets: MultiSig.sol, Test.sol
- validation: 12 passing tests, 0 failing; statement coverage MultiSig.sol 91.67 %, Test.sol 50.0 %

## Contract: MultiSig.sol (primary target)

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

contract MultiSig {

    // define a Transaction structure
    struct Transaction {
        // the destination address of the transaction
        address destination;

        // value of the transaction (in wei)
        uint256 value;

        // the transaction data
        bytes data;

        // whether the tansaction has been executed or not (to prevent re-execution)
        bool executed;

        // quorum received on this transaction (must be > requiredQuorum) for transaction to execute
        uint256 quorum;
    }

    // list of authorized signers
    address[] public authorizedSigners;

    // required quorum
    uint256 public requiredQuorum;

    // wallet owner
    address public owner;

    // to permit O(1) lookup for the signers, instead O(n) every time a function is called
    mapping(address => bool) public isSigner;

    // add this mapping to avoid duplicating approvals
    // this maps trxnId => signerAddress => alreadyApproved (true/false)
    mapping(uint256 => mapping(address => bool)) alreadyApproved;

    // the list of transactions since contract deployment
    Transaction[] public transactions;

    /**
     *   Events
     */

    // event emitted when a new transaction is proposed
    event TransactionProposed(uint256 trxnId, address proposedBy);

    // event emitted when a transaction reaches the no. of approvals required for execution
    event TransactionConfirmed(uint256 trxnId, uint256 quorum);

    // event emitted when a signer approves a transaction
    event TransactionApproved(uint256 trxnId, address approvedBy);

    // event emitted when a transaction is executed
    event TransactionExecuted(uint256 trxnId, address destination, address executedBy, uint256 value);

    /**
     * Modifiers
     */

    // allows only authorized signers and owner to perform the action
    modifier onlySigners() {
        require(msg.sender == owner || isSigner[msg.sender] , "Only contract owner or authorized signers can perform this action");
        _;
    }

    constructor(address[] memory _signers, uint256 _requiredQuorum) {
        owner = msg.sender;
        // authorizedSigners = _signers;

        // perform this step to decrease lookup time for signers
        for (uint i = 0; i < _signers.length; i++) {
            address signer = _signers[i];

            require(!isSigner[signer], "signer already exists");

            isSigner[signer] = true;
            authorizedSigners.push(signer);
        }

        requiredQuorum = _requiredQuorum;
    }
    
    // this is not protected since "anyone" can propose a transaction
    function proposeTransaction(address _destination, uint256 _value, bytes memory _data) external{
        uint256 trxnId = transactions.length;

        // create a new transaction and push it to the transactions list
        transactions.push(Transaction({
            destination: _destination,
            value: _value,
            data: _data,
            executed: false,
            quorum: 0
        }));

        // emit the proposed event
        emit TransactionProposed(trxnId, msg.sender);
    }

    // only contract owner or authorized signers can perform this action
    function approveTransaction(uint256 _trxnId) external onlySigners {
        
        // make sure transaction exists
        require(transactions.length > _trxnId, "Transaction does not exist");

        // make sure that it is not already executed
        require(!transactions[_trxnId].executed, "Transaction already executed");

        // make sure that the approvals are unique
        require(!alreadyApproved[_trxnId][msg.sender], "Signer can only approve once");

        Transaction storage trxn = transactions[_trxnId];

        // increment number of received confirmations
        trxn.quorum += 1;

        // add the address to the signers that already approved the transaction
        alreadyApproved[_trxnId][msg.sender] = true;

        // emit the confirmed event
        emit TransactionApproved(_trxnId, msg.sender);

        // if transaction quorum is reached emit the approved event
        // useful if listening to events from a front end app - instead of polling
        if(trxn.quorum >= requiredQuorum)
            emit TransactionConfirmed(_trxnId, trxn.quorum);
    }

    function executeTransaction(uint256 _trxnId) external onlySigners {
        // verify transaction exists
        require(transactions.length > _trxnId, "Transaction does not exist");

        // make sure that the transaction has not already executed
        require(!transactions[_trxnId].executed, "Transaction already executed");

        Transaction storage trxn = transactions[_trxnId];

        // make sure that the transaction reached quorum
        require(trxn.quorum >= requiredQuorum, "Transaction has not yet reached the required quorum");

        // mark it as executed before executing to avoid reentrancy attacks
        trxn.executed = true;

        // execute transaction
        (bool success, ) = trxn.destination.call{ value: trxn.value }(trxn.data);

        // verify transaction success
        require(success, "Failed to execute transaction");

        // emit execution event
        emit TransactionExecuted(_trxnId, trxn.destination, msg.sender, trxn.value);
    }

    function getTransactions() external view returns (Transaction[] memory) {
        return transactions;
    }

    function getAuthorizedSigners() external view returns (address[] memory) {
        return authorizedSigners;
    }
}
```

## Contract: Test.sol (dependency)

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

contract Test {
    int256 public counter;

    constructor() {
        counter = 0;
    }

    function increment() external returns(int256 newValue) {
        counter += 1;
        return counter;
    }

    function decrement() external returns(int256 newValue) {
        counter -= 1;
        return counter;
    }
}
```

## Tests: MultiSig.js

```javascript
const { expect } = require('chai');
const { loadFixture } = require("@nomicfoundation/hardhat-network-helpers");
const { ethers } = require('hardhat');

const REQUIRED_QUORUM = 2;
const TRXN_ID = 0;

describe("MultiSig Contract", function() {

    async function deployContractFixture() {
        const [owner, signer1, signer2] = await ethers.getSigners();

        const multiSig = await ethers.deployContract("MultiSig", [[signer1.address, signer2.address], REQUIRED_QUORUM])

        return { owner, multiSig, signer1, signer2 }
    }

    // another fixture to propose a transaction
    async function deployWithProposedTransaction() {
        const { multiSig, owner, signer1, signer2 } = await loadFixture(deployContractFixture);
        const signers = await ethers.getSigners();

        // deploy the test contract
        const test = await ethers.deployContract("Test");
        
        // prepare transaction data
        const trxn = await test.increment.populateTransaction();

        // propse a transaction from a non-signer
        await multiSig.connect(signers[3]).proposeTransaction(trxn.to, 0, trxn.data);

        return { multiSig, test, owner, signer1, signer2, signers }
    }

    async function deployWithConfirmedTransactionFixture() {
        const { multiSig, signer1, signer2, owner, signers, test } = await loadFixture(deployWithProposedTransaction);

        await multiSig.connect(signer1).approveTransaction(TRXN_ID);
        await multiSig.connect(signer2).approveTransaction(TRXN_ID);

        return { multiSig, test, signer1, signer2, owner, signers }
    }

    describe("Deployment", function() {

        it("Should set the right owner", async function() {
            const { multiSig, owner } = await loadFixture(deployContractFixture);

            // verify the owner from the contract state
            expect(await multiSig.owner()).to.equal(owner.address);
        })

        it("Should set the right number of quorum", async function() {
            const { multiSig } = await loadFixture(deployContractFixture);
            
            // verify the required quorum from the contract state
            expect(await multiSig.requiredQuorum()).to.equal(REQUIRED_QUORUM);
        })

        it("Should set the right signers", async function() {
            const { multiSig, signer1, signer2 } = await loadFixture(deployContractFixture);

            // verify the first signer
            expect(await multiSig.authorizedSigners(0)).to.equal(signer1.address);

            // verify the second signer
            expect(await multiSig.authorizedSigners(1)).to.equal(signer2.address);
        })
    });

    describe("Transactions", async function() {
        it("Should propose a new valid transaction", async function() {
            const { multiSig } = await loadFixture(deployContractFixture);
            const signers = await ethers.getSigners();
            
            // validate that the transaction emits the right event
            await expect(multiSig.connect(signers[3]).proposeTransaction(signers[4].address, 100, "0x"))
                .to.emit(multiSig, "TransactionProposed")
                .withArgs(0, signers[3].address)

            // get the transaction
            const transaction = await multiSig.transactions(TRXN_ID);
            
            // validate transaction parameters
           expect(transaction.destination).to.equal(signers[4].address);
           expect(transaction.value).to.equal(100);
           expect(transaction.data).to.equal("0x");
           expect(transaction.executed).to.equal(false);
           expect(transaction.quorum).to.equal(0);
        })

        it("Should approve a valid transactions", async function() {
            const { multiSig, signer1 } = await loadFixture(deployWithProposedTransaction);

            // approve the transaction from a valid signer
            await expect(multiSig.connect(signer1).approveTransaction(TRXN_ID))
                .to.emit(multiSig, "TransactionApproved")
                .withArgs(TRXN_ID, signer1.address);
            
            const trxn = await multiSig.transactions(TRXN_ID);

            // validate the new quorum count
            expect(trxn.quorum).to.be.equal(1);
        })

        it("Should fail to approve transaction if sender is not a valid signer", async function(){
            const { multiSig, signers } = await loadFixture(deployWithProposedTransaction);

            await expect(multiSig.connect(signers[5]).approveTransaction(TRXN_ID))
                .to.be.revertedWith("Only contract owner or authorized signers can perform this action");
        })

        it("Should fail to approve more than once for the same signer", async function() {
            const { multiSig, signer2 } = await loadFixture(deployWithProposedTransaction);
        
            // duplicate approvals from signer2
            await multiSig.connect(signer2).approveTransaction(TRXN_ID);

            await expect(multiSig.connect(signer2).approveTransaction(TRXN_ID))
                .to.be.revertedWith("Signer can only approve once");
        })

        it("Should confirm the transaction after required quorum number", async function(){
            const { multiSig, signer1, signer2 } = await loadFixture(deployWithProposedTransaction);
            
            // first approval
            await multiSig.connect(signer1).approveTransaction(TRXN_ID);
            
            // second approval -- emits the confirmation
            await expect(multiSig.connect(signer2).approveTransaction(TRXN_ID))
                .to.emit(multiSig, "TransactionConfirmed")
                .withArgs(TRXN_ID, REQUIRED_QUORUM);
        })

        it("Should fail to execute transaction if sender is not a valid signer", async function() {
            const { multiSig, signers } = await loadFixture(deployWithProposedTransaction);

            await expect(multiSig.connect(signers[4]).executeTransaction(TRXN_ID))
                .to.be.revertedWith("Only contract owner or authorized signers can perform this action");
        })


        it("Should fail to execute transaction if does not have enough quorum", async function() {
            const { multiSig, signer1 } = await loadFixture(deployWithProposedTransaction);

            await expect(multiSig.connect(signer1).executeTransaction(TRXN_ID))
                .to.be.revertedWith("Transaction has not yet reached the required quorum");
        })


        it("Should execute if reached enough quorum", async function() {
            const { multiSig, signer1, test } = await loadFixture(deployWithConfirmedTransactionFixture);

            // verify that the event was emitted with right paramters
            await expect(multiSig.connect(signer1).executeTransaction(TRXN_ID))
                .to.emit(multiSig, "TransactionExecuted")
                .withArgs(TRXN_ID, await test.getAddress(), signer1.address, 0);

            // verify the transaction executed in the test contract
            expect(await test.counter()).to.equal(1);
        })

        it("Should fail to execute the transaction more than once", async function() {
            const { multiSig, signer1 } = await loadFixture(deployWithConfirmedTransactionFixture);

            // execute first time
            await multiSig.connect(signer1).executeTransaction(TRXN_ID);

            // execute second time
            await expect(multiSig.connect(signer1).executeTransaction(TRXN_ID))
                .to.be.revertedWith("Transaction already executed");
        })
    })
})
```
