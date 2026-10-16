const { loadFixture } = require("@nomicfoundation/hardhat-network-helpers");
const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("DonateCrypto", function () {

    async function deployFixture(){
      const [owner, otherAccount] = await ethers.getSigners();

      const DonateCrypto = await ethers.getContractFactory("DonateCrypto");

      const contract = await DonateCrypto.deploy();

      return { contract, owner, otherAccount };
    }

    const campaign = {
      title: "Meal of Love",
      description: "This campaign have an objective to feed more people in the Africa.",
      videosUrl: ["1","2"],
      imagesUrl: ["1","2"],
      goal: "10000"
    }

    it("Should add campaign", async function () {
      const { contract} = await loadFixture(deployFixture);

      await contract.addCampaign(campaign.title,campaign.description,campaign.videosUrl,campaign.imagesUrl,campaign.goal)

      expect(await contract.nextId()).to.equal(1);
    });

    it("Should get campaign", async function () {
      const { contract} = await loadFixture(deployFixture);

      await contract.addCampaign(campaign.title,campaign.description,campaign.videosUrl,campaign.imagesUrl,campaign.goal)
      const result = await contract.getCampaign(0)

      expect(await result.title).to.equal("Meal of Love");
    });

    it("Should get last id", async function () {
      const { contract} = await loadFixture(deployFixture);

      await contract.addCampaign(campaign.title,campaign.description,campaign.videosUrl,campaign.imagesUrl,campaign.goal)
      const lastId = await contract.getLastId()
      expect(await lastId).to.equal(1);
    });

    it("Should make a donation", async function () {
      const { contract,otherAccount} = await loadFixture(deployFixture);

      await contract.addCampaign(campaign.title,campaign.description,campaign.videosUrl,campaign.imagesUrl,campaign.goal)

      const instance = contract.connect(otherAccount)

      await instance.donate("0",{value: 1000})

      expect((await contract.campaigns(0)).balance).to.equal(1000);
    });

    it("Should not donation (Inactive)", async function () {
      const { contract,otherAccount} = await loadFixture(deployFixture);

      await contract.addCampaign(campaign.title,campaign.description,campaign.videosUrl,campaign.imagesUrl,campaign.goal)

      const instance = contract.connect(otherAccount)

      await instance.donate("0",{value: 20000})

      await expect((contract.donate("0",{value:100}))).to.be.revertedWith("Cannot donate to this campaign");
    });

    it("Should not donation (smaller or equal than zero)", async function () {
      const { contract,otherAccount} = await loadFixture(deployFixture);

      await contract.addCampaign(campaign.title,campaign.description,campaign.videosUrl,campaign.imagesUrl,campaign.goal)

      const instance = contract.connect(otherAccount)

      await expect(instance.donate("0",{value: 0})).to.be.revertedWith("You must send a donation value > 0");
    });

    it("Should get donor", async function () {
      const { contract,otherAccount} = await loadFixture(deployFixture);

      await contract.addCampaign(campaign.title,campaign.description,campaign.videosUrl,campaign.imagesUrl,campaign.goal)

      const instance = contract.connect(otherAccount)

      await instance.donate("0",{value: 1000})

      const donors = await contract.getDonors(0);

      expect(donors[0]).to.equal(otherAccount.address)
    });

    it("Should withdraw", async function () {
      const { contract,otherAccount} = await loadFixture(deployFixture);

      const instance = contract.connect(otherAccount)

      await instance.addCampaign(campaign.title,campaign.description,campaign.videosUrl,campaign.imagesUrl,campaign.goal)

      await contract.donate("0",{value: 1000})

      await instance.withdraw(0)

      const balance = await ethers.provider.getBalance(contract.getAddress());

      expect(balance).to.equal(100);
    });

    it("Should not withdraw (balance < fee)", async function () {
      const { contract,otherAccount} = await loadFixture(deployFixture);

      const instance = contract.connect(otherAccount)

      await instance.addCampaign(campaign.title,campaign.description,campaign.videosUrl,campaign.imagesUrl,campaign.goal)

      await contract.donate("0",{value: 50})

      await expect(instance.withdraw(0)).to.be.revertedWith("This campaign does not have enough balance")
    });

    it("Should not withdraw (campaign is closed)", async function () {
      const { contract,otherAccount} = await loadFixture(deployFixture);

      const instance = contract.connect(otherAccount)

      await instance.addCampaign(campaign.title,campaign.description,campaign.videosUrl,campaign.imagesUrl,campaign.goal)

      await contract.donate("0",{value: 1000})

      await instance.withdraw(0)

      await expect(instance.withdraw(0)).to.be.revertedWith("This campaign is closed")
    });

    it("Should withdraw fees by owner", async function () {
      const { contract,owner,otherAccount} = await loadFixture(deployFixture);

      const instance = contract.connect(otherAccount)

      await instance.addCampaign(campaign.title,campaign.description,campaign.videosUrl,campaign.imagesUrl,campaign.goal)

      await contract.donate("0",{value: 1000})

      await instance.withdraw(0)

      await contract.withdrawOwner()
      const balance = await ethers.provider.getBalance(contract.getAddress());

      expect(balance).to.equal(0);
    });

    it("Should not fees to withdraw", async function () {
      const { contract,owner,otherAccount} = await loadFixture(deployFixture);

      const instance = contract.connect(otherAccount)

      await instance.addCampaign(campaign.title,campaign.description,campaign.videosUrl,campaign.imagesUrl,campaign.goal)

      await contract.donate("0",{value: 1000})

      await expect(contract.withdrawOwner()).to.be.revertedWith("No fees to withdraw");
    });

    it("Should change fees", async function () {
      const { contract } = await loadFixture(deployFixture);

      await contract.changeFee(200)

      expect(await contract.fee()).to.equal(200);
    });

    it("Should not owner permission (fees)", async function () {
      const { contract, otherAccount } = await loadFixture(deployFixture);

      const instance = contract.connect(otherAccount)

      await expect(instance.changeFee(200)).to.be.revertedWith("You do not have permission");
    });

    it("Should not owner permission (withdraw)", async function () {
      const { contract, otherAccount } = await loadFixture(deployFixture);

      const instance = contract.connect(otherAccount)

      await expect(instance.withdrawOwner()).to.be.revertedWith("You do not have permission");
    });

    });
