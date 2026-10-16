const { loadFixture } = require("@nomicfoundation/hardhat-network-helpers");
const { expect } = require("chai");

describe("Reputation", function () {
  async function deployReputationFixture() {
    const [client, freelancer, otherClient] = await ethers.getSigners();
    const Reputation = await ethers.getContractFactory("Reputation");
    const reputation = await Reputation.deploy();
    return { reputation, client, freelancer, otherClient };
  }

  describe("rateFreelancer", function () {
    it("reverts for a rating of 0", async function () {
      const { reputation, client, freelancer } = await loadFixture(
        deployReputationFixture
      );

      await expect(
        reputation.connect(client).rateFreelancer(freelancer.address, 0)
      ).to.be.revertedWith("Invalid rating (1-5)");
    });

    it("reverts for a rating above 5", async function () {
      const { reputation, client, freelancer } = await loadFixture(
        deployReputationFixture
      );

      await expect(
        reputation.connect(client).rateFreelancer(freelancer.address, 6)
      ).to.be.revertedWith("Invalid rating (1-5)");
    });

    it("accepts ratings from 1 to 5 and updates counters", async function () {
      const { reputation, client, freelancer } = await loadFixture(
        deployReputationFixture
      );

      await reputation.connect(client).rateFreelancer(freelancer.address, 4);

      const [avg, completed] = await reputation.getReputation(freelancer.address);
      expect(avg).to.equal(4n);
      expect(completed).to.equal(1n);
    });

    it("averages multiple ratings (integer division) and accumulates completedJobs", async function () {
      const { reputation, client, otherClient, freelancer } = await loadFixture(
        deployReputationFixture
      );

      await reputation.connect(client).rateFreelancer(freelancer.address, 5);
      await reputation.connect(otherClient).rateFreelancer(freelancer.address, 2);

      const [avg, completed] = await reputation.getReputation(freelancer.address);
      expect(avg).to.equal(3n); // (5 + 2) / 2 == 3 (integer division)
      expect(completed).to.equal(2n);
    });
  });

  describe("getReputation", function () {
    it("returns zero average and zero completed jobs before any rating", async function () {
      const { reputation, freelancer } = await loadFixture(deployReputationFixture);

      const [avg, completed] = await reputation.getReputation(freelancer.address);
      expect(avg).to.equal(0n);
      expect(completed).to.equal(0n);
    });
  });

  describe("project links", function () {
    it("stores and retrieves a project link for the caller", async function () {
      const { reputation, freelancer } = await loadFixture(deployReputationFixture);

      await reputation.connect(freelancer).addProjectLink("https://example.com/portfolio");

      expect(await reputation.getProjectLink(freelancer.address)).to.equal(
        "https://example.com/portfolio"
      );
    });

    it("returns an empty string for an address that never set a link", async function () {
      const { reputation, client } = await loadFixture(deployReputationFixture);

      expect(await reputation.getProjectLink(client.address)).to.equal("");
    });
  });
});
