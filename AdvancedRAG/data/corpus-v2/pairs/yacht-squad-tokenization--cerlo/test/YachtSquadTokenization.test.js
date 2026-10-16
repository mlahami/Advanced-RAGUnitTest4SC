  const {loadFixture} = require("@nomicfoundation/hardhat-network-helpers");
  const { ethers } = require("hardhat");
  const { expect } = require("chai");

describe("YachtSquadTokenisation contract", function () {
    
    const status ={
        IntialMint:0,     // The yacht is listed and available for sale
        PreSale:1,        // Sale for holders of at least one SFT of yacht
        PublicSale:2,     // Public sale open to new investors
        Chartered:3,      // The yacht is currently chartered
        Maintenance:4,    // The yacht is under maintenance
        Sold:5            // The yacht has been sold
    }
    const yacht0= {
        id:0,
        mmsi:319113100, //mmsi/AIS => yacht identification
        tokenPrice:2000, 
        maxSupply:100000,
        name: 'Black Pearl',
        uri: 'bafkreiabh7oeweksbqznghhapoc5ekgmsjr64ia3bhors3ws3rzuyybjny', // string : Image du boat
        legal: '07762f76dfdbb1597218313ea27680c28bac238600230cc7a20c7e2cd9de4d73', //Black Pearl is owned by YachtSquad 
        paymentWallet:"0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266",
        status : status.IntialMint
    }
    
    const yacht1= {
        id:1,
        mmsi:319085900, //mmsi/AIS => yacht identification
        tokenPrice:1000, 
        maxSupply:100000,
        name: 'Aquijo',
        uri:'bafkreihcta63ik4fe5cuttvdjx4smtp5acd5qzv4joypeg7nb7ggasxipq',
        legal: 'a899fc0d56ef54e9a2a9e7b8ef16e79f4ca11a56d86d79f6366d14b0c3c690aa', //Aquijo is owned by YachtSquad
        paymentWallet:"0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
        status : status.PreSale
    }
    
    const yacht2= {
        id:2,
        mmsi:229383000, //mmsi/AIS => yacht identification
        tokenPrice:100, 
        maxSupply:175000,
        name: 'Running on Waves',
        uri: 'cb8480dedb3a9f7fbb1d5707e228d80c119fc57184651bdecfdb1cef9c0dc899',
        legal: 'a0e02d6e77a73995d16888e188074198f0d96cecf79edd52d4072d3547207f54', //Running on Waves is owned by YachtSquad
        paymentWallet:"0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC",
        status : status.PublicSale
    }

    /**
     * 
     * @returns 
     */
    async function deployTokenization_init() {
        const [owner ] = await ethers.getSigners();
        const YachtSquadTokenisation = await ethers.getContractFactory("YachtSquadTokenization");
        const yachtSquadToken = await YachtSquadTokenisation.deploy(YachtSquadTokenisation);
        return { yachtSquadToken, owner};
    }

    async function deployContract_SCholderYcc() {
        const [owner, scHolder, yachtCharterCompany] = await ethers.getSigners();
        const YachtSquadTokenisation = await ethers.getContractFactory("YachtSquadTokenization");
        const yachtSquadToken = await YachtSquadTokenisation.deploy(YachtSquadTokenisation);
        return { yachtSquadToken, owner ,scHolder, yachtCharterCompany};
    }

    async function deployContract_SCholderYccnvestor() {
        const [owner, scHolder ,yachtCharterCompany, investor1, investor2, lead1] = await ethers.getSigners();
        const YachtSquadTokenisation = await ethers.getContractFactory("YachtSquadTokenization");
        const yachtSquadToken = await YachtSquadTokenisation.deploy(YachtSquadTokenisation);
        return { yachtSquadToken, owner ,scHolder, yachtCharterCompany, investor1, investor2, lead1};
    }

        // Test suite for testing the deployment phase of the Voting contract
    describe("Deployment", function () {
        // Test case to ensure the contract is deployed with the correct owner
        it("Should set the owner", async function () {
            // Deploying the contract and retrieving the owner
            const { yachtSquadToken, owner } = await loadFixture(deployTokenization_init);
            // Asserting that the deployed contract has the correct owner
            expect(await yachtSquadToken.owner()).to.be.equal(owner.address);
        });
    })

    describe("Support interface", function(){
        let yachtSquadTokenization;

        // Chargement du contrat avant chaque test
        beforeEach(async function () {
            const { yachtSquadToken } = await loadFixture(deployTokenization_init);
            yachtSquadTokenization = yachtSquadToken;
        });
        
        /** à doccumenter dans le REDME.md
         * Dans les normes ERC, chaque interface est représentée par un identifiant unique de 4 octets (bytes4). Par exemple :

                ERC1155: 0xd9b67a26
                ERC2981 (Royalties): 0x2a55205a

            Ces identifiants sont calculés à partir de la concaténation des signatures de fonction de l'interface, puis en prenant le keccak256 de cette chaîne et en gardant les 4 premiers octets.
         */
        it("Should support ERC1155 interface", async function () {
            const interfaceIdERC1155 = "0xd9b67a26"; 
            expect(await yachtSquadTokenization.supportsInterface(interfaceIdERC1155)).to.be.true;
        });
    
        it("Should support ERC2981 interface", async function () {
            const interfaceIdERC2981 = "0x2a55205a";
            expect(await yachtSquadTokenization.supportsInterface(interfaceIdERC2981)).to.be.true;
        });
    
        it("Should not support an invalid interface", async function () {
            const invalidInterfaceId = "0xabcdef01";
            expect(await yachtSquadTokenization.supportsInterface(invalidInterfaceId)).to.be.false;
        });
    })
    

    describe("Minting Yachts", async function() {
        it("Should mint yacht0 correctly", async function() {
            const { yachtSquadToken, owner, scHolder,yachtCharterCompany} = await loadFixture(deployContract_SCholderYcc);

            await yachtSquadToken.connect(owner).mintyachts(
                scHolder.address, 
                yacht0.mmsi, 
                yacht0.tokenPrice,
                yacht0.maxSupply,
                yacht0.name, 
                yacht0.uri,  
                yacht0.legal, 
                yachtCharterCompany.address
            );
            const yacht = await yachtSquadToken.getYacht(0);
            expect(yacht.id).to.equal(yacht0.id);
            expect(yacht.mmsi).to.equal(yacht0.mmsi);
            expect(yacht.tokenPrice).to.equal(yacht0.tokenPrice);
            expect(yacht.maxSupply).to.equal(yacht0.maxSupply);
            expect(yacht.name).to.equal(yacht0.name);
            expect(yacht.uri).to.equal(yacht0.uri);
            expect(yacht.legal).to.equal(yacht0.legal);
            expect(yacht.paymentWallet).to.equal(yachtCharterCompany.address);
            expect(yacht.status).to.equal(status.IntialMint);
        });

        it("Should not mint yacht0 correctly", async function() {
            const { yachtSquadToken, owner, scHolder,yachtCharterCompany} = await loadFixture(deployContract_SCholderYcc);

            await expect(yachtSquadToken.connect(scHolder).mintyachts(
                scHolder.address, 
                yacht0.mmsi, 
                yacht0.tokenPrice,
                yacht0.maxSupply,
                yacht0.name, 
                yacht0.uri,  
                yacht0.legal, 
                yachtCharterCompany.address
            )).to.be.revertedWithCustomError(yachtSquadToken, "OwnableUnauthorizedAccount");
        });

        it("Should not mint yacht0 correctly", async function() {
            const { yachtSquadToken, owner, scHolder,yachtCharterCompany} = await loadFixture(deployContract_SCholderYcc);

            await expect(yachtSquadToken.connect(scHolder).mintyachts(
                scHolder.address, 
                yacht0.mmsi, 
                yacht0.tokenPrice,
                yacht0.maxSupply,
                yacht0.name, 
                yacht0.uri,  
                yacht0.legal, 
                yachtCharterCompany.address
            )).to.be.revertedWithCustomError(yachtSquadToken, "OwnableUnauthorizedAccount");
        });

        it("Should emit new minted yacht id, supply and name", async function () {
            //Deploying the contract for this test case and retriving datas
            const { yachtSquadToken, owner, scHolder,yachtCharterCompany} = await loadFixture(deployContract_SCholderYcc);
            // Registering voters
            await expect(yachtSquadToken.connect(owner).mintyachts(
                scHolder.address, 
                yacht0.mmsi, 
                yacht0.tokenPrice,
                yacht0.maxSupply,
                yacht0.name, 
                yacht0.uri,  
                yacht0.legal, 
                yachtCharterCompany.address)).to.emit(yachtSquadToken, 'NewMint')
                .withArgs(0, yacht0.maxSupply, yacht0.name);
        });

    });

    /**
     * @notice Here is the test of Yacht status management :
     * 
     */
    describe("Yacht status management", function () {
        let yachtSquadTokenization;
        let owner;
    
        /**
         * @notice Deploy the contract and get the owner account. Mint a Yacht for testing
         */
        beforeEach(async function () {
            const fixture = await loadFixture(deployTokenization_init);
            yachtSquadTokenization = fixture.yachtSquadToken;
            owner = fixture.owner;

            await yachtSquadTokenization.connect(owner).mintyachts(
                owner.address, 
                yacht0.mmsi, 
                yacht0.tokenPrice, 
                yacht0.maxSupply, 
                yacht0.name, 
                yacht0.uri, 
                yacht0.legal, 
                owner.address
            );
        });
    
        /**
         * @notice  Change the status of the yacht 
         *          Retrieve the yacht to check its new status
         *          Verify the status has been updated
         */
        it("Should allow the owner to change the yacht's status", async function () {
            const newYachtStatus = status.PreSale;
            await yachtSquadTokenization.connect(owner).statusManagement(0, newYachtStatus);
            const yacht = await yachtSquadTokenization.getYacht(0);
            expect(yacht.status).to.equal(newYachtStatus);
        });
    
        /**
         * @notice Attempt to change the yacht's status as a non-owner
         * 
         */
        it("Should not allow non-owners to change the yacht's status", async function () {
            const [_, nonOwner] = await ethers.getSigners();
            const newYachtStatus = status.PreSale;
            await expect(
                yachtSquadTokenization.connect(nonOwner).statusManagement(0, newYachtStatus)
            ).to.be.revertedWithCustomError(yachtSquadTokenization, "OwnableUnauthorizedAccount"); 
        });
    
        /**
         * @notice Expect the transaction to emit an event with the correct arguments
         */
        it("Should emit StatusChange event on status update", async function () {
            const newYachtStatus = status.PreSale;
            await expect(yachtSquadTokenization.connect(owner).statusManagement(0, newYachtStatus))
                .to.emit(yachtSquadTokenization, "StatusChange")
                .withArgs(0, status.IntialMint, newYachtStatus);
        });
    
        /**
         * @notice Attempt to set the yacht's status to its current value 
         * @dev require must be introduce int the smart contract : https://remyc.atlassian.net/browse/CHTSQD2-151
         */
        it("Should revert if the new status is the same as the current one", async function () {
            const currentStatus = status.IntialMint; // Assuming this is the initial status after minting
            await expect(
                yachtSquadTokenization.connect(owner).statusManagement(0, currentStatus)
            ).to.be.revertedWith("It is the same status"); 
        });
    });

    describe("Royalty Info", function() {
        let yachtSquadTokenization;
        let owner;
    
        beforeEach(async function () {
            const fixture = await loadFixture(deployTokenization_init);
            yachtSquadTokenization = fixture.yachtSquadToken;
            owner = fixture.owner;
    
            // Mint a yacht to set its royalty info
            await yachtSquadTokenization.connect(owner).mintyachts(
                owner.address, 
                yacht0.mmsi, 
                yacht0.tokenPrice,
                yacht0.maxSupply,
                yacht0.name, 
                yacht0.uri,  
                yacht0.legal, 
                owner.address
            );
        });
    
        it("Should return correct royalty info for a token", async function() {
            const tokenId = 0;
            const salePrice = await ethers.parseEther("1"); // 1 ETH for example
            
            // Assuming the royalty percentage is 2% as per your contract
            const expectedRoyaltyAmount = salePrice;

            const [receiver, royaltyAmount] = await yachtSquadTokenization.royaltyInfo(tokenId, salePrice);
    
            expect(receiver).to.equal(owner.address); // Assuming the owner receives the royalties
            expect(royaltyAmount).to.equal(expectedRoyaltyAmount);
        });
    });

    describe("Safe Transfert process", async function(){
        let _yachtSquadTokenization;
        let _owner;
        let _investor1;
        let _scHolder;
        let _yachtCharterCompany;
    
        beforeEach(async function () {
            const { yachtSquadToken, owner, scHolder ,yachtCharterCompany, investor1} = await loadFixture(deployContract_SCholderYccnvestor);
            _yachtSquadTokenization= yachtSquadToken;
            _owner = owner;
            _investor1 = investor1;
            _scHolder = scHolder
            _yachtCharterCompany = yachtCharterCompany;
        });
    
        describe("SafeTransfert for ons SFT", function () {
                
            it("Should update balances correctly after safeTransferFrom", async function () {
                const tokenId = 0;
                const amount = 100;
    
                // Minting yacht to yachtTokenHolderAddress
                await _yachtSquadTokenization.connect(_owner).mintyachts(
                    _scHolder.address, 
                    yacht0.mmsi, 
                    yacht0.tokenPrice,
                    yacht0.maxSupply,
                    yacht0.name, 
                    yacht0.uri,  
                    yacht0.legal, 
                    _yachtCharterCompany.address
                );

                await _yachtSquadTokenization.connect(_scHolder).setApprovalForAll(_owner.address, true);
                
                // Transferring tokens from yachtTokenHolderAddress to otherAccount
                await _yachtSquadTokenization.connect(_owner).safeTransferFrom(
                    _scHolder.address, 
                    _investor1.address, 
                    tokenId, 
                    amount, 
                    "0x"
                );
    
                const balanceHolder = await _yachtSquadTokenization.balanceOf(_scHolder.address, tokenId);
                const balanceOther = await _yachtSquadTokenization.balanceOf(_investor1.address, tokenId);
    
                expect(balanceHolder).to.equal(yacht0.maxSupply - amount);
                expect(balanceOther).to.equal(amount);
            });
    
            it("Should emit RecivedToken event on safeTransferFrom", async function () {
                const tokenId = 0;
                const amount = 100;
    
                // Minting yacht to yachtTokenHolderAddress
                await _yachtSquadTokenization.connect(_owner).mintyachts(
                    _scHolder.address, 
                    yacht0.mmsi, 
                    yacht0.tokenPrice,
                    yacht0.maxSupply,
                    yacht0.name, 
                    yacht0.uri,  
                    yacht0.legal, 
                    _yachtCharterCompany.address
                );
                // sett approvalForAll to the smartcontract owner 
                await _yachtSquadTokenization.connect(_scHolder).setApprovalForAll(_owner.address, true);
                // Transferring tokens from yachtTokenHolderAddress to otherAccount
                await expect(_yachtSquadTokenization.connect(_owner).safeTransferFrom(
                    _scHolder.address, 
                    _investor1.address,  
                    tokenId, 
                    amount, 
                    "0x"
                )).to.emit(_yachtSquadTokenization, "RecivedToken").withArgs(_scHolder.address, _investor1.address, tokenId, amount);
            });
        });

        describe("SafeTransfert batch of sft", function() {
            it("Should update balances correctly after safeBatchTransferFrom", async function () {
                const tokenIds = [0,1];
                const amounts = [10000,5000];
    
                // Minting yacht to yachtTokenHolderAddress
                await _yachtSquadTokenization.connect(_owner).mintyachts(
                    _scHolder.address, 
                    yacht0.mmsi, 
                    yacht0.tokenPrice,
                    yacht0.maxSupply,
                    yacht0.name, 
                    yacht0.uri,  
                    yacht0.legal, 
                    _yachtCharterCompany.address
                );
                await _yachtSquadTokenization.connect(_owner).mintyachts(
                    _scHolder.address, 
                    yacht1.mmsi, 
                    yacht1.tokenPrice,
                    yacht1.maxSupply,
                    yacht1.name, 
                    yacht1.uri,  
                    yacht1.legal, 
                    _yachtCharterCompany.address
                );

                await _yachtSquadTokenization.connect(_scHolder).setApprovalForAll(_owner.address, true);
                
                // Transferring tokens from yachtTokenHolderAddress to otherAccount
                await _yachtSquadTokenization.connect(_owner).safeBatchTransferFrom(
                    _scHolder.address, 
                    _investor1.address, 
                    tokenIds, 
                    amounts, 
                    "0x"
                );
    
                const balanceHolder0 = await _yachtSquadTokenization.balanceOf(_scHolder.address, tokenIds[0]);
                const balanceOther0 = await _yachtSquadTokenization.balanceOf(_investor1.address, tokenIds[0]);
                const balanceHolder1 = await _yachtSquadTokenization.balanceOf(_scHolder.address, tokenIds[1]);
                const balanceOther1 = await _yachtSquadTokenization.balanceOf(_investor1.address, tokenIds[1]);
    
                expect(balanceHolder0).to.equal(yacht0.maxSupply - amounts[0]);
                expect(balanceOther0).to.equal(amounts[0]);
                expect(balanceHolder1).to.equal(yacht0.maxSupply - amounts[1]);
                expect(balanceOther1).to.equal(amounts[1]);
            });
    
            it("Should emit RecivedToken event on safeBatchTransferFrom", async function () {
                const tokenIds = [0,1];
                const amounts = [10000,5000];
    
                // Minting yacht to yachtTokenHolderAddress
                await _yachtSquadTokenization.connect(_owner).mintyachts(
                    _scHolder.address, 
                    yacht0.mmsi, 
                    yacht0.tokenPrice,
                    yacht0.maxSupply,
                    yacht0.name, 
                    yacht0.uri,  
                    yacht0.legal, 
                    _yachtCharterCompany.address
                );
                await _yachtSquadTokenization.connect(_owner).mintyachts(
                    _scHolder.address, 
                    yacht1.mmsi, 
                    yacht1.tokenPrice,
                    yacht1.maxSupply,
                    yacht1.name, 
                    yacht1.uri,  
                    yacht1.legal, 
                    _yachtCharterCompany.address
                );
    
                await _yachtSquadTokenization.connect(_scHolder).setApprovalForAll(_owner.address, true);
                // Transferring tokens from yachtTokenHolderAddress to otherAccount
                await expect(_yachtSquadTokenization.connect(_owner).safeBatchTransferFrom(
                    _scHolder.address, 
                    _investor1.address,  
                    tokenIds, 
                    amounts, 
                    "0x"
                )).to.emit(_yachtSquadTokenization, "RecivedTokens").withArgs(_scHolder.address, _investor1.address, tokenIds, amounts);
            });
        }); //end describe SafeTransfert batch of sft

        
    })
    describe("URI Tests", function(){
        let yachtSquadTokenization;
        let owner;
    
        beforeEach(async function () {
            const fixture = await loadFixture(deployTokenization_init);
            yachtSquadTokenization = fixture.yachtSquadToken;
            owner = fixture.owner;
        });
    
        it("Should correctly set and retrieve token URI", async function() {
    
            // Mint a yacht to set its URI
            await yachtSquadTokenization.connect(owner).mintyachts(
                owner.address, 
                yacht0.mmsi, 
                yacht0.tokenPrice,
                yacht0.maxSupply,
                yacht0.name, 
                yacht0.uri,  
                yacht0.legal, 
                owner.address
            );
    
            // Retrieve the URI of the minted yacht
            const retrievedURI = await yachtSquadTokenization.uri(0);
    
            // Check if the retrieved URI matches the test URI
            expect(retrievedURI).to.equal(`ipfs://${yacht0.uri}`);
        });        
    });

    describe("Getters", function(){
        let yachtSquadTokenization;
        let owner;
        let investor1;

        beforeEach(async function () {
            const fixture = await loadFixture(deployContract_SCholderYccnvestor);
            yachtSquadTokenization = fixture.yachtSquadToken;
            owner = fixture.owner;
            investor1 = fixture.investor1;

            // Mint some yachts for folling tests
            await yachtSquadTokenization.connect(owner).mintyachts(owner.address, yacht0.mmsi, yacht0.tokenPrice, yacht0.maxSupply, yacht0.name, yacht0.uri, yacht0.legal, owner.address);
            await yachtSquadTokenization.connect(owner).mintyachts(owner.address, yacht1.mmsi, yacht1.tokenPrice, yacht1.maxSupply, yacht1.name, yacht1.uri, yacht1.legal, owner.address);
        });

        it("Should return all yachts", async function() {
            const yachts = await yachtSquadTokenization.getYachts();
            expect(yachts.length).to.equal(2);
            expect(yachts[0].name).to.equal(yacht0.name);
            expect(yachts[1].name).to.equal(yacht1.name);
        });

        it("Should return a specific yacht by ID", async function() {
            const yacht = await yachtSquadTokenization.getYacht(0);
            expect(yacht.name).to.equal(yacht0.name);
        });

        it("Should return yachts owned by an investor", async function() {
            // Transfer some tokens to investor1
            await yachtSquadTokenization.connect(owner).safeTransferFrom(owner.address, investor1.address, 0, 100, "0x");

            const investments = await yachtSquadTokenization.getInvestments(investor1.address);
            expect(investments.length).to.equal(1);
            expect(investments[0].name).to.equal(yacht0.name);
        });
    }); // end getters



})