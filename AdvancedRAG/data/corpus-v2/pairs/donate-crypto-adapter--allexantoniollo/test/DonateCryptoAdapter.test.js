const { loadFixture } = require("@nomicfoundation/hardhat-network-helpers");
const { expect } = require("chai");
const { ethers } = require("hardhat");

  describe("DonateCryptoAdapter", function () {

      async function deployAdapterFixture(){
        const [owner, otherAccount] = await ethers.getSigners();

        const DonateCryptoAdapter = await ethers.getContractFactory("DonateCryptoAdapter");

        const adapter = await DonateCryptoAdapter.deploy();

        return { adapter, owner, otherAccount };
      }

      async function deployImplementationFixture(){

        const DonateCrypto = await ethers.getContractFactory("DonateCrypto");

        const contract = await DonateCrypto.deploy();

        return { contract };
      }

      const campaign = {
        title: "Meal of Love",
        description: "This campaign have an objective to feed more people in the Africa.",
        videosUrl: ["1","2"],
        imagesUrl: ["1","2"],
        goal: "10000"
      }

      it("Should upgrade", async function () {
        const { adapter} = await loadFixture(deployAdapterFixture);
        const { contract } = await loadFixture(deployImplementationFixture);

        await adapter.upgrade(await contract.getAddress());

        const address2 = await adapter.getImplAddress();

        expect(await contract.getAddress()).to.equal(address2);
      });

      it("Should not upgrade (permission)", async function () {
        const { adapter, otherAccount } = await loadFixture(deployAdapterFixture);
        const { contract } = await loadFixture(deployImplementationFixture);

        const instance = adapter.connect(otherAccount)

        await expect(instance.upgrade(contract.getAddress())).to.be.revertedWith("You do not have permission");
      });

      it("Should add campaign", async function () {
        const { adapter } = await loadFixture(deployAdapterFixture);
        const { contract } = await loadFixture(deployImplementationFixture);

        await adapter.upgrade(await contract.getAddress());

        await adapter.addCampaign(campaign.title,campaign.description,campaign.videosUrl,campaign.imagesUrl,campaign.goal);

        expect(await contract.nextId()).to.equal(1);
      });

      it("Should get campaign", async function () {
        const { adapter } = await loadFixture(deployAdapterFixture);
        const { contract } = await loadFixture(deployImplementationFixture);

        await adapter.upgrade(await contract.getAddress());

        await adapter.addCampaign(campaign.title,campaign.description,campaign.videosUrl,campaign.imagesUrl,campaign.goal);
        const result = adapter.getCampaign(0)

        expect((await result).title).to.equal("Meal of Love");
      });

      it("Should get last id", async function () {
        const { adapter } = await loadFixture(deployAdapterFixture);
        const { contract } = await loadFixture(deployImplementationFixture);

        await adapter.upgrade(await contract.getAddress());

        await adapter.addCampaign(campaign.title,campaign.description,campaign.videosUrl,campaign.imagesUrl,campaign.goal);

        expect(await adapter.getLastId()).to.equal(1);
      });

      it("Should make a donation", async function () {
        const { adapter, otherAccount } = await loadFixture(deployAdapterFixture);
        const { contract } = await loadFixture(deployImplementationFixture);

        await adapter.upgrade(await contract.getAddress());

        await adapter.addCampaign(campaign.title,campaign.description,campaign.videosUrl,campaign.imagesUrl,campaign.goal);

        const instance = await adapter.connect(otherAccount)
        await instance.donate("0",{value: 1000})

        expect((await contract.campaigns(0)).balance).to.equal(1000);
      });

      it("Should get donor", async function () {
        const { adapter,owner,otherAccount } = await loadFixture(deployAdapterFixture);
        const { contract } = await loadFixture(deployImplementationFixture);

        await adapter.upgrade(await contract.getAddress());

        await adapter.addCampaign(campaign.title,campaign.description,campaign.videosUrl,campaign.imagesUrl,campaign.goal);

        const instance = await adapter.connect(otherAccount)
        await instance.donate("0",{value: 1000})

        const donor = await instance.getDonors(0)

        expect(donor[0]).to.equal(await otherAccount.getAddress());
      });

      it("Should change fee", async function () {
        const { adapter } = await loadFixture(deployAdapterFixture);
        const { contract } = await loadFixture(deployImplementationFixture);

        await adapter.upgrade(await contract.getAddress());

        await adapter.changeFee(200)

        expect(await contract.fee()).to.equal(200)
      });

      it("Should not change fee", async function () {
        const { adapter,otherAccount } = await loadFixture(deployAdapterFixture);
        const { contract } = await loadFixture(deployImplementationFixture);

        await adapter.upgrade(await contract.getAddress());

        const instance = await adapter.connect(otherAccount)

        await expect(instance.changeFee(200)).to.be.revertedWith("You do not have permission")
      });

      it("Should owner withdraw", async function () {
        const { adapter, otherAccount } = await loadFixture(deployAdapterFixture);
        const { contract } = await loadFixture(deployImplementationFixture);

        await adapter.upgrade(await contract.getAddress());

        await adapter.addCampaign(campaign.title, campaign.description, campaign.videosUrl, campaign.imagesUrl, campaign.goal);

        const instance = await adapter.connect(otherAccount)
        await instance.donate("0", { value: 11000 })

        const contractAddress = await contract.getAddress();

        const contractBalanceBefore = await ethers.provider.getBalance(contractAddress);

        await adapter.withdrawOwner()

        const contractBalanceAfter = await ethers.provider.getBalance(contractAddress);

        expect(contractBalanceAfter).to.equal(Number(contractBalanceBefore) - 100);
    });

    });
