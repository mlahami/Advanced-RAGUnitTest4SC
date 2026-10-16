# multi-sig-wallet-factory--donguillotine

- domain: multisig-treasury (multisig)
- level: moderate
- origin: human
- convention: hardhat2-ethers6
- source: https://github.com/DonGuillotine/multisig-contract @ 8f0788a4c229931fbd3677aed5c1e2c730790263
- license: MIT
- targets: MultiSigWalletFactory.sol, Multisig.sol
- validation: 5 passing tests, 0 failing; statement coverage MultiSigWalletFactory.sol 100.0 %, Multisig.sol 18.42 %

## Contract: Multisig.sol (dependency)

```solidity
// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.24;
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract Multisig {
    uint8 public quorum;
    uint8 public noOfValidSigners;
    uint256 public txCount;
    uint256 public quorumUpdateProposalId;
    uint8 public proposedQuorum;
    mapping(address => bool) public hasApprovedQuorumUpdate;
    uint8 public quorumUpdateApprovals;

    event QuorumUpdateProposed(uint8 newQuorum);
    event QuorumUpdated(uint8 oldQuorum, uint8 newQuorum);

    struct Transaction {
        uint256 id;
        uint256 amount;
        address sender;
        address recipient;
        bool isCompleted;
        uint256 timestamp;
        uint256 noOfApproval;
        address tokenAddress;
        address[] transactionSigners;
    }

    mapping(address => bool) isValidSigner;
    mapping(uint => Transaction) transactions; // txId -> Transaction
    // signer -> transactionId -> bool (checking if an address has signed)
    mapping(address => mapping(uint256 => bool)) hasSigned;

    constructor(uint8 _quorum, address[] memory _validSigners) {
        require(_validSigners.length > 1, "few valid signers");
        require(_quorum > 1, "quorum is too small");


        for(uint256 i = 0; i < _validSigners.length; i++) {
            require(_validSigners[i] != address(0), "zero address not allowed");
            require(!isValidSigner[_validSigners[i]], "signer already exist");

            isValidSigner[_validSigners[i]] = true;
        }

        noOfValidSigners = uint8(_validSigners.length);

        if (!isValidSigner[msg.sender]){
            isValidSigner[msg.sender] = true;
            noOfValidSigners += 1;
        }

        require(_quorum <= noOfValidSigners, "quorum greater than valid signers");
        quorum = _quorum;
    }

    function transfer(uint256 _amount, address _recipient, address _tokenAddress) external {
        require(msg.sender != address(0), "address zero found");
        require(isValidSigner[msg.sender], "invalid signer");

        require(_amount > 0, "can't send zero amount");
        require(_recipient != address(0), "address zero found");
        require(_tokenAddress != address(0), "address zero found");

        require(IERC20(_tokenAddress).balanceOf(address(this)) >= _amount, "insufficient funds");

        uint256 _txId = txCount + 1;
        Transaction storage trx = transactions[_txId];
        
        trx.id = _txId;
        trx.amount = _amount;
        trx.recipient = _recipient;
        trx.sender = msg.sender;
        trx.timestamp = block.timestamp;
        trx.tokenAddress = _tokenAddress;
        trx.noOfApproval += 1;
        trx.transactionSigners.push(msg.sender);
        hasSigned[msg.sender][_txId] = true;

        txCount += 1;
    }

    function approveTx(uint8 _txId) external {
        Transaction storage trx = transactions[_txId];

        require(trx.id != 0, "invalid tx id");
        
        require(IERC20(trx.tokenAddress).balanceOf(address(this)) >= trx.amount, "insufficient funds");
        require(!trx.isCompleted, "transaction already completed");
        require(trx.noOfApproval < quorum, "approvals already reached");

        // for(uint256 i = 0; i < trx.transactionSigners.length; i++) {
        //     if(trx.transactionSigners[i] == msg.sender) {
        //         revert("can't sign twice");
        //     }
        // }

        require(isValidSigner[msg.sender], "not a valid signer");
        require(!hasSigned[msg.sender][_txId], "can't sign twice");

        hasSigned[msg.sender][_txId] = true;
        trx.noOfApproval += 1;
        trx.transactionSigners.push(msg.sender);

        if(trx.noOfApproval == quorum) {
            trx.isCompleted = true;
            IERC20(trx.tokenAddress).transfer(trx.recipient, trx.amount);
        }
    }

    function proposeQuorumUpdate(uint8 _newQuorum) external {
        require(isValidSigner[msg.sender], "Not a valid signer");
        require(_newQuorum > 1 && _newQuorum <= noOfValidSigners, "Invalid quorum value");
        require(_newQuorum != quorum, "New quorum must be different");
        require(quorumUpdateProposalId == 0, "Existing proposal pending");

        quorumUpdateProposalId = block.timestamp;
        proposedQuorum = _newQuorum;
        quorumUpdateApprovals = 1;
        hasApprovedQuorumUpdate[msg.sender] = true;

        emit QuorumUpdateProposed(_newQuorum);
    }

    function approveQuorumUpdate() external {
        require(isValidSigner[msg.sender], "Not a valid signer");
        require(quorumUpdateProposalId != 0, "No quorum update proposal");
        require(!hasApprovedQuorumUpdate[msg.sender], "Already approved");

        hasApprovedQuorumUpdate[msg.sender] = true;
        quorumUpdateApprovals++;

        if (quorumUpdateApprovals == quorum) {
            uint8 oldQuorum = quorum;
            quorum = proposedQuorum;
            emit QuorumUpdated(oldQuorum, quorum);
            
            quorumUpdateProposalId = 0;
            proposedQuorum = 0;
            quorumUpdateApprovals = 0;
            for (uint i = 0; i < noOfValidSigners; i++) {
                hasApprovedQuorumUpdate[address(uint160(i))] = false;
            }
        }
    }
    receive() external payable {}
}
```

## Contract: MultiSigWalletFactory.sol (primary target)

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "./Multisig.sol";

contract MultiSigWalletFactory {

    Multisig[] public multisigClones;

    event WalletCreated(address indexed wallet, address[] indexed validSigners, uint8 quorum);

    function createMultiSigWallet(address[] memory _validSigners, uint8 quorum) external returns (address wallet){
        Multisig newMsgWallet = new Multisig(quorum, _validSigners);
        emit WalletCreated(address(newMsgWallet), _validSigners, quorum);
        multisigClones.push(newMsgWallet);
        return address(newMsgWallet);
    }

    function getDeployedWallet(uint index) public view returns (address) {
        return address(multisigClones[index]);
    }
}
```

## Tests: MultiSigWalletFactory.js

```javascript
const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("MultiSigWalletFactory", function () {
  let MultiSigWalletFactory;
  let factory;
  let owner;
  let addr1;
  let addr2;
  let addrs;

  beforeEach(async function () {
    [owner, addr1, addr2, ...addrs] = await ethers.getSigners();

    MultiSigWalletFactory = await ethers.getContractFactory("MultiSigWalletFactory");
    factory = await MultiSigWalletFactory.deploy();
    await factory.waitForDeployment();
  });

  describe("Deployment", function () {
    it("Should deploy the factory contract", async function () {
      expect(await factory.getAddress()).to.be.properAddress;
    });
  });

  describe("Wallet Creation", function () {
    it("Should create a new MultiSig wallet", async function () {
        const validSigners = [addr1.address, addr2.address];
        const quorum = 2;
      
        const tx = await factory.createMultiSigWallet(validSigners, quorum);
        const receipt = await tx.wait();

        const event = receipt.logs.find(log => log.eventName === "WalletCreated");
        
        if (event) {
          console.log("WalletCreated event emitted with args:", event.args);
        } else {
          console.log("WalletCreated event not found");
        }

        expect(event).to.not.be.undefined;

        expect(event.args.length).to.equal(3);

        expect(ethers.isAddress(event.args[0])).to.be.true;

        expect(event.args[1]).to.have.property('_isIndexed', true);
    
        expect(event.args[2]).to.equal(BigInt(quorum));
      });
  
    it("Should store the created wallet address", async function () {
      const validSigners = [addr1.address, addr2.address];
      const quorum = 2;
  
      await factory.createMultiSigWallet(validSigners, quorum);
      const storedAddress = await factory.getDeployedWallet(0);
  
      expect(storedAddress).to.be.properAddress;
    });
  });

  describe("Wallet Retrieval", function () {
    it("Should retrieve the correct wallet address", async function () {
      const validSigners = [addr1.address, addr2.address];
      const quorum = 2;

      const tx = await factory.createMultiSigWallet(validSigners, quorum);
      const receipt = await tx.wait();
      const event = receipt.logs.find(log => log.eventName === "WalletCreated");
      const createdWalletAddress = event.args[0];

      const retrievedAddress = await factory.getDeployedWallet(0);

      expect(retrievedAddress).to.equal(createdWalletAddress);
    });

    it("Should revert when trying to retrieve a non-existent wallet", async function () {
      await expect(factory.getDeployedWallet(0))
        .to.be.revertedWithPanic(0x32);
    });
  });
});
```
