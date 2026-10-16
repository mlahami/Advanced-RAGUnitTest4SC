const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture, time } = require("@nomicfoundation/hardhat-network-helpers");

// ─── Fixture ────────────────────────────────────────────────────────────────
async function deployCrowdFundingFixture() {
    const [owner, addr1, addr2] = await ethers.getSigners();
    // Contract renamed to CrowdFundOptimized
    const CrowdFunding = await ethers.getContractFactory("CrowdFundOptimized");
    const crowdFunding = await CrowdFunding.deploy();
    await crowdFunding.waitForDeployment();
    return { crowdFunding, owner, addr1, addr2 };
}

// Helper: extract campaignId from CampaignCreated event (ethers v6)
function getCampaignId(crowdFunding, receipt) {
    const event = receipt.logs
        .map(log => { try { return crowdFunding.interface.parseLog(log); } catch { return null; } })
        .find(e => e?.name === "CampaignCreated");
    if (!event) throw new Error("CampaignCreated event not found in receipt");
    return event.args.campaign_id;
}

// ─── Tests ──────────────────────────────────────────────────────────────────
describe("CrowdFundOptimized", function () {

    // ── Creating a Campaign ────────────────────────────────────────────────
    describe("Creating a Campaign", function () {

        it("Should create a campaign successfully", async function () {
            const { crowdFunding, owner } = await loadFixture(deployCrowdFundingFixture);
            const goal     = ethers.parseEther("1");
            const deadline = (await time.latest()) + 7 * 24 * 60 * 60;

            const tx      = await crowdFunding.connect(owner).createCampaign(goal, deadline, "");
            const receipt = await tx.wait();
            expect(receipt).to.not.be.undefined;
        });

        it("Should emit CampaignCreated with correct args (metadataCID lives in event only)", async function () {
            const { crowdFunding, owner } = await loadFixture(deployCrowdFundingFixture);
            const goal     = ethers.parseEther("1");
            const deadline = (await time.latest()) + 7 * 24 * 60 * 60;
            const cid      = "QmTestCID123";

            await expect(crowdFunding.connect(owner).createCampaign(goal, deadline, cid))
                .to.emit(crowdFunding, "CampaignCreated")
                .withArgs(0, owner.address, goal, deadline, cid);
        });

        it("Should fail to create a campaign with zero goal", async function () {
            const { crowdFunding, owner } = await loadFixture(deployCrowdFundingFixture);
            const goal     = ethers.parseEther("0");
            const deadline = (await time.latest()) + 7 * 24 * 60 * 60;
            await expect(
                crowdFunding.connect(owner).createCampaign(goal, deadline, "")
            ).to.be.revertedWith("Funds requested invalid");
        });

        it("Should fail to create a campaign with a past deadline", async function () {
            const { crowdFunding, owner } = await loadFixture(deployCrowdFundingFixture);
            const goal     = ethers.parseEther("1");
            const deadline = (await time.latest()) - 60;
            await expect(
                crowdFunding.connect(owner).createCampaign(goal, deadline, "")
            ).to.be.revertedWith("Deadline invalid");
        });

        // getCampaign no longer returns metadataCID (it was removed from storage).
        it("getCampaign should NOT return metadataCID (removed from storage)", async function () {
            const { crowdFunding, owner } = await loadFixture(deployCrowdFundingFixture);
            const goal     = ethers.parseEther("1");
            const deadline = (await time.latest()) + 7 * 24 * 60 * 60;
            const tx      = await crowdFunding.connect(owner).createCampaign(goal, deadline, "QmABC");
            const receipt = await tx.wait();
            const id      = getCampaignId(crowdFunding, receipt);

            // Returns (goal, raised, deadline, creator, state) – 5 values, no CID
            const result = await crowdFunding.getCampaign(id);
            expect(result).to.have.lengthOf(5);
        });

        // campaignid field removed from struct – verify via getAllCampaignIds instead
        it("getAllCampaignIds should return sequential ids without a storage array", async function () {
            const { crowdFunding, owner } = await loadFixture(deployCrowdFundingFixture);
            const deadline = (await time.latest()) + 7 * 24 * 60 * 60;

            await crowdFunding.connect(owner).createCampaign(ethers.parseEther("1"), deadline, "");
            await crowdFunding.connect(owner).createCampaign(ethers.parseEther("2"), deadline, "");
            await crowdFunding.connect(owner).createCampaign(ethers.parseEther("3"), deadline, "");

            const ids = await crowdFunding.getAllCampaignIds();
            expect(ids.map(Number)).to.deep.equal([0, 1, 2]);
        });
    });

    // ── Contributing to a Campaign ─────────────────────────────────────────
    describe("Contributing to a Campaign", function () {

        it("Should allow contributions to an active campaign", async function () {
            const { crowdFunding, owner, addr1 } = await loadFixture(deployCrowdFundingFixture);
            const goal     = ethers.parseEther("1");
            const deadline = (await time.latest()) + 7 * 24 * 60 * 60;

            const tx      = await crowdFunding.connect(owner).createCampaign(goal, deadline, "");
            const receipt = await tx.wait();
            const id      = getCampaignId(crowdFunding, receipt);

            await expect(
                crowdFunding.connect(addr1).contribute(id, { value: ethers.parseEther("0.1") })
            )
            .to.emit(crowdFunding, "Contributed")
            .withArgs(addr1.address, id, ethers.parseEther("0.1"));
        });

        it("Should fail to contribute after deadline (campaign expired)", async function () {
            const { crowdFunding, owner, addr1 } = await loadFixture(deployCrowdFundingFixture);
            const goal     = ethers.parseEther("1");
            const deadline = (await time.latest()) + 1000;

            const tx      = await crowdFunding.connect(owner).createCampaign(goal, deadline, "");
            const receipt = await tx.wait();
            const id      = getCampaignId(crowdFunding, receipt);

            await time.increase(2000);
            await expect(
                crowdFunding.connect(addr1).contribute(id, { value: ethers.parseEther("0.1") })
            ).to.be.revertedWith("Campaign expired");
        });

        it("Should fail to contribute after the 7-day deadline", async function () {
            const { crowdFunding, owner, addr1 } = await loadFixture(deployCrowdFundingFixture);
            const goal     = ethers.parseEther("1");
            const deadline = (await time.latest()) + 7 * 24 * 60 * 60;

            const tx      = await crowdFunding.connect(owner).createCampaign(goal, deadline, "");
            const receipt = await tx.wait();
            const id      = getCampaignId(crowdFunding, receipt);

            await time.increase(7 * 24 * 60 * 60 + 100);
            await expect(
                crowdFunding.connect(addr1).contribute(id, { value: ethers.parseEther("1") })
            ).to.be.revertedWith("Campaign expired");
        });

        it("Should fail to contribute with zero amount", async function () {
            const { crowdFunding, owner, addr1 } = await loadFixture(deployCrowdFundingFixture);
            const goal     = ethers.parseEther("1");
            const deadline = (await time.latest()) + 7 * 24 * 60 * 60;

            const tx      = await crowdFunding.connect(owner).createCampaign(goal, deadline, "");
            const receipt = await tx.wait();
            const id      = getCampaignId(crowdFunding, receipt);

            await expect(
                crowdFunding.connect(addr1).contribute(id, { value: ethers.parseEther("0") })
            ).to.be.revertedWith("Invalid amount");
        });
    });

    // ── Withdrawing Funds ──────────────────────────────────────────────────
    describe("Withdrawing Funds", function () {

        it("Should allow creator to withdraw when goal met and deadline passed", async function () {
            const { crowdFunding, owner, addr1 } = await loadFixture(deployCrowdFundingFixture);
            const goal     = ethers.parseEther("100");
            const deadline = (await time.latest()) + 7 * 24 * 60 * 60;

            const tx      = await crowdFunding.connect(owner).createCampaign(goal, deadline, "");
            const receipt = await tx.wait();
            const id      = getCampaignId(crowdFunding, receipt);

            await crowdFunding.connect(addr1).contribute(id, { value: ethers.parseEther("100") });
            await time.increase(7 * 24 * 60 * 60 + 100);

            await expect(crowdFunding.connect(owner).withdraw(id))
                .to.emit(crowdFunding, "FundsWithdrawn")
                .withArgs(owner.address, id);
        });

        it("Should fail to withdraw when goal is not met", async function () {
            const { crowdFunding, owner, addr1 } = await loadFixture(deployCrowdFundingFixture);
            const goal     = ethers.parseEther("100");
            const deadline = (await time.latest()) + 7 * 24 * 60 * 60;

            const tx      = await crowdFunding.connect(owner).createCampaign(goal, deadline, "");
            const receipt = await tx.wait();
            const id      = getCampaignId(crowdFunding, receipt);

            await crowdFunding.connect(addr1).contribute(id, { value: ethers.parseEther("1") });
            await time.increase(7 * 24 * 60 * 60 + 100);

            await expect(crowdFunding.connect(owner).withdraw(id))
                .to.be.revertedWith("Campaign not successful");
        });

        it("Should fail to withdraw when deadline has not passed", async function () {
            const { crowdFunding, owner, addr1 } = await loadFixture(deployCrowdFundingFixture);
            const goal     = ethers.parseEther("1");
            const deadline = (await time.latest()) + 7 * 24 * 60 * 60;

            const tx      = await crowdFunding.connect(owner).createCampaign(goal, deadline, "");
            const receipt = await tx.wait();
            const id      = getCampaignId(crowdFunding, receipt);

            await crowdFunding.connect(addr1).contribute(id, { value: ethers.parseEther("1") });
            await time.increase(1000);

            await expect(crowdFunding.connect(owner).withdraw(id))
                .to.be.revertedWith("Campaign ongoing");
        });

        it("Should fail to withdraw when caller is not campaign creator", async function () {
            const { crowdFunding, owner, addr1 } = await loadFixture(deployCrowdFundingFixture);
            const goal     = ethers.parseEther("100");
            const deadline = (await time.latest()) + 7 * 24 * 60 * 60;

            const tx      = await crowdFunding.connect(owner).createCampaign(goal, deadline, "");
            const receipt = await tx.wait();
            const id      = getCampaignId(crowdFunding, receipt);

            await crowdFunding.connect(addr1).contribute(id, { value: ethers.parseEther("100") });
            await time.increase(7 * 24 * 60 * 60 + 1000);

            await expect(crowdFunding.connect(addr1).withdraw(id))
                .to.be.revertedWith("Only owner can withdraw");
        });

        it("Should fail on double withdrawal attempt", async function () {
            const { crowdFunding, owner, addr1 } = await loadFixture(deployCrowdFundingFixture);
            const goal     = ethers.parseEther("1");
            const deadline = (await time.latest()) + 1000;

            const tx      = await crowdFunding.connect(owner).createCampaign(goal, deadline, "");
            const receipt = await tx.wait();
            const id      = getCampaignId(crowdFunding, receipt);

            await crowdFunding.connect(addr1).contribute(id, { value: ethers.parseEther("1") });
            await time.increase(2000);
            await crowdFunding.connect(owner).withdraw(id);

            await expect(crowdFunding.connect(owner).withdraw(id))
                .to.be.revertedWith("Campaign already withdrawn");
        });
    });

    // ── Refunding Contributors ─────────────────────────────────────────────
    describe("Refunding Contributors", function () {

        it("Should refund contributor correctly when campaign fails", async function () {
            const { crowdFunding, owner, addr1 } = await loadFixture(deployCrowdFundingFixture);
            const goal     = ethers.parseEther("1");
            const deadline = (await time.latest()) + 1000;

            const tx      = await crowdFunding.connect(owner).createCampaign(goal, deadline, "");
            const receipt = await tx.wait();
            const id      = getCampaignId(crowdFunding, receipt);

            await crowdFunding.connect(addr1).contribute(id, { value: ethers.parseEther("0.1") });
            expect(await crowdFunding.getContribution(id, addr1.address))
                .to.equal(ethers.parseEther("0.1"));

            await time.increase(2000);

            await expect(crowdFunding.connect(addr1).refund(id))
                .to.emit(crowdFunding, "Refunded");

            expect(await crowdFunding.getContribution(id, addr1.address)).to.equal(0);
        });

        it("Should fail to refund when campaign is successful", async function () {
            const { crowdFunding, owner, addr1 } = await loadFixture(deployCrowdFundingFixture);
            const goal     = ethers.parseEther("1");
            const deadline = (await time.latest()) + 7 * 24 * 60 * 60;

            const tx      = await crowdFunding.connect(owner).createCampaign(goal, deadline, "");
            const receipt = await tx.wait();
            const id      = getCampaignId(crowdFunding, receipt);

            await crowdFunding.connect(addr1).contribute(id, { value: ethers.parseEther("1") });
            await time.increase(7 * 24 * 60 * 60 + 100);

            await expect(crowdFunding.connect(addr1).refund(id))
                .to.be.revertedWith("Campaign was Successful");
        });

        it("Should fail to refund if caller is not a contributor", async function () {
            const { crowdFunding, owner, addr1, addr2 } = await loadFixture(deployCrowdFundingFixture);
            const goal     = ethers.parseEther("100");
            const deadline = (await time.latest()) + 7 * 24 * 60 * 60;

            const tx      = await crowdFunding.connect(owner).createCampaign(goal, deadline, "");
            const receipt = await tx.wait();
            const id      = getCampaignId(crowdFunding, receipt);

            await crowdFunding.connect(addr1).contribute(id, { value: ethers.parseEther("1") });
            await time.increase(7 * 24 * 60 * 60 + 100);

            await expect(crowdFunding.connect(addr2).refund(id))
                .to.be.revertedWith("Only contributors can get a refund");
        });
    });
});
