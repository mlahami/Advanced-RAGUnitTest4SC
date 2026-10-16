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