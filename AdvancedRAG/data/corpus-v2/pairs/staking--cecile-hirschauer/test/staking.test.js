const {expect} = require('chai');
const {ethers} = require('hardhat');

describe('Staking Contract', function () {
    let leafToken, crowdfunding, staking, stakingToken;
    let owner, addr1, addr2, addr3;
    let rewardRate;
    const ONE_MONTH = 2592000;
    const THREE_MONTHS = ONE_MONTH * 3;
    const SIX_MONTHS = ONE_MONTH * 6;


    beforeEach(async function () {
        [owner, addr1, addr2, addr3] = await ethers.getSigners();
        // Deploy ERC20 contract to simulate the staking token Dai
        const MockDai = await ethers.getContractFactory("MockDai");
        stakingToken = await MockDai.deploy(ethers.parseEther("1000000"));
        const LeafToken = await ethers.getContractFactory("LeafToken");
        leafToken = await LeafToken.deploy(ethers.parseEther("1000000"));
        const Crowdfunding = await ethers.getContractFactory("Crowdfunding");
        crowdfunding = await Crowdfunding.deploy(leafToken.target);
        const Staking = await ethers.getContractFactory("Staking");
        staking = await Staking.deploy(stakingToken.target, crowdfunding.target);
    });

    describe('Deployment', function () {
        it("Should set the right stakingToken", async function () {
            expect(await staking.stakingToken()).to.equal(stakingToken.target);
        });

        it("Should set the right crowdfunding contract", async function () {
            expect(await staking.crowdfunding()).to.equal(crowdfunding.target);
        });
    });

    describe('Staking', function () {
        it("Should not allow users to stake 0 tokens", async function () {
            await expect(staking.connect(addr1).stakeTokens(0, ONE_MONTH)).to.be.revertedWith("Amount must be more than 0");
        });

        it('Should revert if duration is different of one month or three months or six months', async function () {
            await expect(staking.connect(addr1).stakeTokens(ethers.parseEther("100"), 0)).to.be.revertedWith("Invalid staking duration");
        });

        it("Should allow users to stake tokens", async function () {
            const amount = ethers.parseEther("100");

            // Step 1: Transfer tokens to addr1
            await stakingToken.connect(owner).transfer(addr1.address, amount);

            // Verify the transfer
            expect(await stakingToken.balanceOf(addr1.address)).to.equal(amount);

            // Step 2: Approve the staking contract to spend the tokens
            await stakingToken.connect(addr1).approve(staking.target, amount);

            // Step 3: Index the tokens
            await staking.connect(addr1).stakeTokens(amount, ONE_MONTH);

            // Verify the stake
            const stake = await staking.stakes(addr1.address);
            expect(stake.amount).to.equal(amount);
            expect(stake.duration).to.equal(ONE_MONTH);

            expect(await stakingToken.balanceOf(staking.target)).to.equal(amount);
        });

        it('Should emit a Staked event', async function () {
            const amount = ethers.parseEther("100");
            await stakingToken.connect(owner).transfer(addr1.address, amount);
            await stakingToken.connect(addr1).approve(staking.target, amount);
            await expect(staking.connect(addr1).stakeTokens(amount, ONE_MONTH))
                .to.emit(staking, 'Staked')
                .withArgs(addr1.address, amount, ONE_MONTH);
        });
    });

    describe('Calculate Staking Rewards', function () {
        beforeEach(async function () {
            const amount = ethers.parseEther("100");
            await stakingToken.connect(owner).transfer(addr1.address, amount);
            await stakingToken.connect(addr1).approve(staking.target, amount);
            await staking.connect(addr1).stakeTokens(amount, ONE_MONTH);

            await stakingToken.connect(owner).transfer(addr2.address, amount);
            await stakingToken.connect(addr2).approve(staking.target, amount);
            await staking.connect(addr2).stakeTokens(amount, THREE_MONTHS);

            await stakingToken.connect(owner).transfer(addr3.address, amount);
            await stakingToken.connect(addr3).approve(staking.target, amount);
            await staking.connect(addr3).stakeTokens(amount, SIX_MONTHS);
        });

        it('Should calculate the staking reward for one month', async function () {
            const amount = ethers.parseEther("100");
            rewardRate = 10;

            // Simulate the passage of one month
            await ethers.provider.send("evm_increaseTime", [ONE_MONTH]); // Augmente le temps de 2592000 secondes (30 jours)
            await ethers.provider.send("evm_mine"); // Mine un nouveau bloc pour appliquer le changement de temps

            // Calculate the expected rewards
            const expectedRewards = BigInt(amount) * BigInt(rewardRate) / BigInt(100) * BigInt(ONE_MONTH) / BigInt(ONE_MONTH * 12);

            const actualRewards = await staking.calculateReward(addr1.address);

            expect(actualRewards).to.equal(expectedRewards);
        });

        it('Should calculate the staking reward for three month', async function () {
            const amount = ethers.parseEther("100");
            rewardRate = 15;

            // Simulate the passage of three months
            await ethers.provider.send("evm_increaseTime", [THREE_MONTHS]); // Augmente le temps de 2592000 secondes (30 jours)
            await ethers.provider.send("evm_mine"); // Mine un nouveau bloc pour appliquer le changement de temps

            // Calculating the expected rewards
            const expectedRewards = BigInt(amount) * BigInt(rewardRate) / BigInt(100) * BigInt(THREE_MONTHS) / BigInt(ONE_MONTH * 12);

            const actualRewards = await staking.calculateReward(addr2.address);

            expect(actualRewards).to.equal(expectedRewards);
        });

        it('Should calculate the staking reward for six month', async function () {
            const amount = ethers.parseEther("100");
            rewardRate = 25;

            // Simulate the passage of six months
            await ethers.provider.send("evm_increaseTime", [SIX_MONTHS]); // Augmente le temps de 2592000 secondes (30 jours)
            await ethers.provider.send("evm_mine"); // Mine un nouveau bloc pour appliquer le changement de temps

            // Calculating the expected rewards
            const expectedRewards = BigInt(amount) * BigInt(rewardRate) / BigInt(100) * BigInt(SIX_MONTHS) / BigInt(ONE_MONTH * 12);

            const actualRewards = await staking.calculateReward(addr3.address);

            expect(actualRewards).to.equal(expectedRewards);
        });
    });

    describe('Reinvest Reward', function () {
        let campaignId;
        const bonusRate = 10; // Assumes a 10% bonus

        beforeEach(async function () {
            const now = await ethers.provider.getBlock('latest').then(block => block.timestamp);
            const campaignStart = now + 300; // Start in 5 minutes
            const campaignEnd = campaignStart + 2592000; // Duration of 30 days

            await crowdfunding.createCampaign("Environmental Project", "A project to help reforest an area", ethers.parseEther("500"), campaignStart, campaignEnd, "https://example.com/image.png");
            campaignId = 0;

            // Index initiale et accumulation des récompenses
            const stakingAmount = ethers.parseEther("100");
            await stakingToken.transfer(addr1.address, stakingAmount);
            await stakingToken.connect(addr1).approve(staking.target, stakingAmount);
            await staking.connect(addr1).stakeTokens(stakingAmount, ONE_MONTH);

            // Simulate the passage of one month
            await ethers.provider.send("evm_increaseTime", [ONE_MONTH]);
            await ethers.provider.send("evm_mine");
        });

        it('Should reinvest the reward into a crowdfunding campaign', async function () {
            // Calculating the initial rewards
            const initialRewards = await staking.calculateReward(addr1.address);

            // Calculating the total investment expected
            const totalInvestmentExpected = BigInt(initialRewards) + BigInt(initialRewards) * BigInt(bonusRate) / BigInt(100);


            // Reinvest the rewards
            await staking.connect(addr1).reinvestReward(campaignId, bonusRate);

            // Check that the rewards were reinvested
            const campaignDetails = await crowdfunding.getCampaign(campaignId);

            // Ensure that the amount collected in the campaign has increased by the expected amount
            expect(campaignDetails.amountCollected).to.be.closeTo(totalInvestmentExpected, ethers.parseEther("0.01"), "The total investment after reinvestment does not match the expected amount");

            // Ensure that the stake amount was reset to 0
            const stakeDetails = await staking.stakes(addr1.address);
            expect(stakeDetails.amount).to.equal(0, "Index amount was not reset after reinvestment");
        });
    });



    describe('Withdraw Staking Rewards', function () {
        beforeEach(async function () {
            const now = await ethers.provider.getBlock('latest').then(block => block.timestamp);
            const campaignStart = now + 300; // Start in 5 minutes
            const campaignEnd = campaignStart + 2592000; // Duration of 30 days

            await crowdfunding.createCampaign("Environmental Project", "A project to help reforest an area", ethers.parseEther("500"), campaignStart, campaignEnd, "https://example.com/image.png");
            campaignId = 0;

            // Index initiale et accumulation des récompenses
            const stakingAmount = ethers.parseEther("100");
            await stakingToken.transfer(addr1.address, stakingAmount);
            await stakingToken.connect(addr1).approve(staking.target, stakingAmount);
            await staking.connect(addr1).stakeTokens(stakingAmount, ONE_MONTH);

            // Simulate the passage of one month
            await ethers.provider.send("evm_increaseTime", [ONE_MONTH]);
            await ethers.provider.send("evm_mine");
        });

        it('Should revert if reward is 0', async function () {
            await expect(staking.connect(addr2).claimReward()).to.be.revertedWith("No rewards available");
        });


        it('Should allow users to withdraw their staking rewards', async function () {
            // Step 1: Calculate the expected rewards
            const stakingAmount = ethers.parseEther("100");
            await stakingToken.connect(owner).transfer(addr1.address, stakingAmount);
            await stakingToken.connect(addr1).approve(staking.target, stakingAmount);
            await staking.connect(addr1).stakeTokens(stakingAmount, ONE_MONTH);

            // Step 2: Simulate the passage of one month
            await ethers.provider.send("evm_increaseTime", [ONE_MONTH]);
            await ethers.provider.send("evm_mine");

            // Step 3: Calculating the expected rewards
            const expectedRewards = await staking.calculateReward(addr1.address);

            // Step 4: Token balance before rewards withdrawal
            const balanceBefore = await stakingToken.balanceOf(addr1.address);

            // Step 5: Withdraw the rewards
            await staking.connect(addr1).claimReward();

            // Step 6: Token balance after rewards withdrawal
            const balanceAfter = await stakingToken.balanceOf(addr1.address);

            // Step 7: Verify that the rewards were received
            expect(balanceAfter - balanceBefore).to.equal(expectedRewards);

            // Step 8: Verify that the stake amount was reset to 0
            const stakeDetailsAfter = await staking.stakes(addr1.address);
            expect(stakeDetailsAfter.amount).to.equal(0);
        });
    });


});
