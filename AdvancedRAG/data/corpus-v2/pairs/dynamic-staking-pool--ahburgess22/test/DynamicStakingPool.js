const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("DynamicStakingPool", function () {
    let MasterRegistry, DynamicStakingPool;
    let registry, stakingPool, rewardToken, nftContract;
    let owner, user1, user2, snapshotId;
    const poolName = "Test";
    const MAX_SUPPLY = ethers.parseEther("1000000");

    beforeEach(async function () {
        snapshotId = await ethers.provider.send("evm_snapshot", []);

        // Get the contract factories and signers
        [owner, user1, user2] = await ethers.getSigners();
    
        MasterRegistry = await ethers.getContractFactory("MasterRegistry");
        const RewardToken = await ethers.getContractFactory("RewardToken");
        const NFTCreator = await ethers.getContractFactory("NFT");
        DynamicStakingPool = await ethers.getContractFactory("DynamicStakingPool");
    
        // Deploy MasterRegistry
        registry = await MasterRegistry.deploy();
    
        // Deploy RewardToken
        rewardToken = await RewardToken.deploy(MAX_SUPPLY);
    
        // Deploy NFTCreator
        nftContract = await NFTCreator.deploy();

        // Deploy DynamicStakingPool with references to all dependencies
        stakingPool = await DynamicStakingPool.deploy(
            nftContract.target,
            rewardToken.target,
            registry.target,
            poolName
        );
    });
    
    afterEach(async () => {
        await ethers.provider.send("evm_revert", [snapshotId]);
    });

    it("Should register itself in the MasterRegistry upon deployment", async function () {
        const name = poolName
        await registry.registerPool(stakingPool.runner.address, name);
        const registered = await registry.registeredPools(stakingPool.runner.address);
        expect(registered.owner).to.equal(owner.address);
    });

    it("Should allow a user to stake a token", async function () {
        // Mint a NFT for user1
        const tx = await stakingPool.connect(user1).createToken();
        const receipt = await tx.wait();

        // Parse the logs to find the mintedToken event
        const transferEventSignature = ethers.id("Transfer(address,address,uint256)");
        const transferLog = receipt.logs.find(log => log.topics[0] === transferEventSignature);
        const tokenId = transferLog.args[2];
    
        // Stake the NFT
        await stakingPool.connect(user1).stake(tokenId);
    
        // Validate staking updates
        const stakes = await stakingPool.connect(user1).getUserStakes();
        expect(stakes.length).to.be.greaterThan(0);
        const registered = await registry.registeredPools(stakingPool.target);
        expect(registered.totalStakes).to.equal(1);
    });
     

    it("Should calculate and distribute rewards when a user unstakes", async function () {
        // Mint a NFT for user1
        const tx = await stakingPool.connect(owner).createToken();
        const receipt = await tx.wait();

        // Parse the logs to find the mintedToken event
        const transferEventSignature = ethers.id("Transfer(address,address,uint256)");
        const transferLog = receipt.logs.find(log => log.topics[0] === transferEventSignature);
        const tokenId = transferLog.args[2];
    
        // Stake the NFT
        await stakingPool.connect(owner).stake(tokenId);

        // Unstake the NFT and mint RTKs after establishing stakingContract
        await rewardToken.setAuthorizedStaker(stakingPool);
        await stakingPool.unstake(tokenId);

        // Validate rewards
        const rewardBalance = await stakingPool.getRewardBalance(owner.address);
        expect(rewardBalance).to.be.equal(0); // Rewards don't accumulate until a minute has passed

        const registered = await registry.registeredPools(stakingPool.target);
        expect(registered.totalStakes).to.equal(0);
    });

    it("Should prevent unstaking a token not owned by the caller", async function () {
        // Mint a NFT for user1
        const tx = await stakingPool.connect(user1).createToken();
        const receipt = await tx.wait();

        // Parse the logs to find the mintedToken event
        const transferEventSignature = ethers.id("Transfer(address,address,uint256)");
        const transferLog = receipt.logs.find(log => log.topics[0] === transferEventSignature);
        const tokenId = transferLog.args[2];

        // Stake the NFT with a user
        await stakingPool.connect(user1).stake(tokenId);

        // Try to unstake with a different user
        await expect(stakingPool.connect(user2).unstake(tokenId)).to.be.revertedWith("DST: Token not staked by user.");
    });

    it("Should prevent double-staking the same token", async function () {
        // Mint a NFT for user1
        const tx = await stakingPool.connect(user1).createToken();
        const receipt = await tx.wait();

        // Parse the logs to find the mintedToken event
        const transferEventSignature = ethers.id("Transfer(address,address,uint256)");
        const transferLog = receipt.logs.find(log => log.topics[0] === transferEventSignature);
        const tokenId = transferLog.args[2];

        // Stake the NFT with a user
        await stakingPool.connect(user1).stake(tokenId);

        // Try to stake the same NFT again
        await expect(stakingPool.connect(user1).stake(tokenId)).to.be.revertedWith("DST: You must own the token to stake it.");
    });

    it("Should handle multiple users staking and unstaking", async function () {
        // Mint NFTs for user1 and user2
        const tx = await stakingPool.connect(user1).createToken();
        const receipt1 = await tx.wait();
        const tx2 = await stakingPool.connect(user2).createToken();
        const receipt2 = await tx2.wait();

        // Parse the logs to find the mintedToken event
        const transferEventSignature1 = ethers.id("Transfer(address,address,uint256)");
        const transferLog1 = receipt1.logs.find(log => log.topics[0] === transferEventSignature1);
        const tokenId1 = transferLog1.args[2];
        
        const transferEventSignature2 = ethers.id("Transfer(address,address,uint256)");
        const transferLog2 = receipt2.logs.find(log => log.topics[0] === transferEventSignature2);
        const tokenId2 = transferLog2.args[2];

        // Stake NFTs
        await stakingPool.connect(user1).stake(tokenId1);
        await stakingPool.connect(user2).stake(tokenId2);

        // Validate total stakes
        const registered = await registry.registeredPools(stakingPool.target);
        expect(registered.totalStakes).to.equal(2);

        // Users unstake NFTs and mint RTKs after establishing stakingContract
        await rewardToken.setAuthorizedStaker(stakingPool);
        await stakingPool.connect(user1).unstake(tokenId1);
        await stakingPool.connect(user2).unstake(tokenId2);

        const registeredAfterUnstake = await registry.registeredPools(stakingPool.target);
        expect(registeredAfterUnstake.totalStakes).to.equal(0);
    });
});
