const {
  loadFixture,
} = require("@nomicfoundation/hardhat-network-helpers");
const { assert, expect } = require("chai");
const { ethers } = require("hardhat");

async function deployFauna() {
  [owner, addr1, addr2] = await ethers.getSigners();
  const contract = await ethers.getContractFactory("Fauna");
  fauna = await contract.deploy();

  return { fauna, owner, addr1, addr2 };
}

describe("Fauna Tests", function () {
  describe("Deployment", function () {
    it("should deploy the smart contract with right owner", async function () {
      let { fauna, owner } = await loadFixture(deployFauna);

      expect(await fauna.owner()).to.equal(owner.address);
    });
  });

  describe("Only Donators", function () {
    it("should prevent a non-donator from interacting", async function () {
      let { fauna, addr1, addr2 } = await loadFixture(deployFauna);
      await fauna.addCuratedProject("name1", "desc1", addr1.address);
      await fauna.connect(addr2).donate({ value: ethers.parseEther("1") });
      await fauna.startVotes();

      await expect(fauna.connect(addr1).submitVote(0)).to.be.revertedWith(
        "Not donator"
      );
    });
  });

  // GETTERS

  describe("getDonator", function () {
    it("should allow anyone to see a donator", async function () {
      let { fauna, addr1, addr2 } = await loadFixture(deployFauna);
      await fauna.connect(addr2).donate({ value: ethers.parseEther("1") });

      await expect(fauna.connect(addr1).getDonator(addr2.address)).to.not.be
        .reverted;
    });
  });

  describe("getProject", function () {
    it("should allow any address to see a project", async function () {
      let { fauna, addr1 } = await loadFixture(deployFauna);
      await fauna.addCuratedProject("name1", "desc1", addr1.address);
      const project = await fauna.getProject(0);

      assert.equal(project.name, "name1");
    });
  });

  describe("getProjects", function () {
    it("should allow any address to see all projects", async function () {
      let { fauna, addr1, addr2 } = await loadFixture(deployFauna);
      await fauna.addCuratedProject("name1", "desc1", addr1.address);
      await fauna.addCuratedProject("name2", "desc2", addr2.address);
      const projects = await fauna.getProjects();

      assert.equal(projects.length, 2);
    });
  });

  describe("getContractBalance", function () {
    it("should allow any address to see balance of the smart contract", async function () {
      let { fauna } = await loadFixture(deployFauna);
      await fauna.donate({ value: ethers.parseEther("1") });

      const balance1 = await fauna.getContractBalance();
      const balance2 = await ethers.provider.getBalance(fauna.target);

      assert.equal(balance1, balance2);
    });
  });

  // FUNDS

  describe("donate", function () {
    it("should revert if no funds deposited", async function () {
      let { fauna, addr1 } = await loadFixture(deployFauna);

      await expect(
        fauna.connect(addr1).donate({ value: ethers.parseEther("0") })
      ).to.be.revertedWith("Not enough funds deposited");
    });

    it("should create donator if new and update totalDonated for donator", async function () {
      let { fauna, addr1 } = await loadFixture(deployFauna);

      await fauna.connect(addr1).donate({ value: ethers.parseEther("1") });
      const donator = await fauna.connect(addr1).getDonator(addr1.address);

      assert.equal(donator.totalDonated, ethers.parseEther("1"));
    });

    it("should emit an event", async function () {
      let { fauna, addr1 } = await loadFixture(deployFauna);

      await expect(
        fauna.connect(addr1).donate({ value: ethers.parseEther("1") })
      )
        .to.emit(fauna, "DonationReceived")
        .withArgs(addr1.address, ethers.parseEther("1"));
    });
  });

  describe("sendFunds", function () {
    it("should revert if sender is not the Owner", async function () {
      let { fauna, addr1 } = await loadFixture(deployFauna);

      await expect(fauna.connect(addr1).sendFunds())
        .to.be.revertedWithCustomError(fauna, "OwnableUnauthorizedAccount")
        .withArgs(addr1.address);
    });

    it("should revert if votes have not ended", async function () {
      let { fauna } = await loadFixture(deployFauna);

      await expect(fauna.sendFunds()).to.be.revertedWith("Votes not ended");
    });

    it("should revert if Fauna's balance is empty", async function () {
      let { fauna, addr1, addr2 } = await loadFixture(deployFauna);
      await fauna.addCuratedProject("name1", "desc1", addr1.address);
      await fauna.connect(addr2).donate({ value: ethers.parseEther("1") });
      await fauna.startVotes();
      await fauna.connect(addr2).submitVote(0);
      await fauna.endVotes();
      await fauna.sendFunds();

      await expect(fauna.sendFunds()).to.be.revertedWith("Empty balance");
    });

    it("should update fundsReceived value", async function () {
      let { fauna, addr1, addr2 } = await loadFixture(deployFauna);
      await fauna.addCuratedProject("name1", "desc1", addr1.address);
      await fauna.connect(addr2).donate({ value: ethers.parseEther("1") });
      await fauna.startVotes();
      await fauna.connect(addr2).submitVote(0);
      await fauna.endVotes();
      await fauna.sendFunds();

      const project = await fauna.getProject(0);

      assert.equal(project.fundsReceived, ethers.parseEther("1"));
    });

    it("should not update fundsReceived value if projects has no votes", async function () {
      let { fauna, addr1, addr2 } = await loadFixture(deployFauna);
      await fauna.addCuratedProject("name1", "desc1", addr1.address);
      await fauna.addCuratedProject("name2", "desc2", addr2.address);
      await fauna.connect(addr2).donate({ value: ethers.parseEther("1") });
      await fauna.startVotes();
      await fauna.connect(addr2).submitVote(0);
      await fauna.endVotes();
      await fauna.sendFunds();

      const project = await fauna.getProject(1);

      assert.equal(project.fundsReceived, 0);
    });

    it("should emit an event for payment", async function () {
      let { fauna, addr1, addr2 } = await loadFixture(deployFauna);
      await fauna.addCuratedProject("name1", "desc1", addr1.address);
      await fauna.connect(addr2).donate({ value: ethers.parseEther("1") });
      await fauna.startVotes();
      await fauna.connect(addr2).submitVote(0);
      await fauna.endVotes();

      await expect(fauna.sendFunds())
        .to.emit(fauna, "FundsGranted")
        .withArgs(ethers.parseEther("1"), 0);
    });

    it("should emit an event for phase change", async function () {
      let { fauna, addr1, addr2 } = await loadFixture(deployFauna);
      await fauna.addCuratedProject("name1", "desc1", addr1.address);
      await fauna.connect(addr2).donate({ value: ethers.parseEther("1") });
      await fauna.startVotes();
      await fauna.connect(addr2).submitVote(0);
      await fauna.endVotes();

      await expect(fauna.sendFunds()).to.emit(fauna, "NewPhase").withArgs(3);
    });
  });

  describe("certifyFundsUsage", function () {
    it("should revert if sender is not the Owner", async function () {
      let { fauna, addr1 } = await loadFixture(deployFauna);

      await expect(fauna.connect(addr1).certifyFundsUsage(1, "comment1"))
        .to.be.revertedWithCustomError(fauna, "OwnableUnauthorizedAccount")
        .withArgs(addr1.address);
    });

    it("should set usageCertified to true", async function () {
      let { fauna, addr1, addr2 } = await loadFixture(deployFauna);
      await fauna.addCuratedProject("name1", "desc1", addr1.address);
      await fauna.connect(addr2).donate({ value: ethers.parseEther("1") });
      await fauna.startVotes();
      await fauna.connect(addr2).submitVote(0);
      await fauna.endVotes();
      await fauna.sendFunds();
      await fauna.certifyFundsUsage(0, "ok");

      const project = await fauna.getProject(0);

      assert.equal(project.usageCertified, true);
    });

    it("should emit an event", async function () {
      let { fauna, addr1, addr2 } = await loadFixture(deployFauna);
      await fauna.addCuratedProject("name1", "desc1", addr1.address);
      await fauna.connect(addr2).donate({ value: ethers.parseEther("1") });
      await fauna.startVotes();
      await fauna.connect(addr2).submitVote(0);
      await fauna.endVotes();
      await fauna.sendFunds();

      await expect(fauna.certifyFundsUsage(0, "ok"))
        .to.emit(fauna, "ProperFundsUsageCertified")
        .withArgs(0, "ok");
    });
  });

  // Projects

  describe("addCuratedProject", function () {
    it("should revert if sender is not the owner", async function () {
      let { fauna, addr1 } = await loadFixture(deployFauna);

      await expect(
        fauna.connect(addr1).addCuratedProject("name1", "desc1", addr1.address)
      )
        .to.be.revertedWithCustomError(fauna, "OwnableUnauthorizedAccount")
        .withArgs(addr1.address);
    });

    it("should revert if not the right time to add a curated project", async function () {
      let { fauna, addr1 } = await loadFixture(deployFauna);
      await fauna.addCuratedProject("name1", "desc1", addr1.address);
      await fauna.startVotes();

      await expect(
        fauna.addCuratedProject("name2", "desc2", addr1.address)
      ).to.be.revertedWith("Project curation is over");
    });

    it("should revert if no project name is given", async function () {
      let { fauna, addr1 } = await loadFixture(deployFauna);

      await expect(
        fauna.addCuratedProject("", "desc1", addr1.address)
      ).to.be.revertedWith("No name");
    });

    it("should revert if no project description is given", async function () {
      let { fauna, addr1 } = await loadFixture(deployFauna);

      await expect(
        fauna.addCuratedProject("name1", "", addr1.address)
      ).to.be.revertedWith("No description");
    });

    it("should revert if no project address is given", async function () {
      let { fauna } = await loadFixture(deployFauna);

      await expect(
        fauna.addCuratedProject(
          "name1",
          "desc1",
          "0x0000000000000000000000000000000000000000"
        )
      ).to.be.revertedWith("No address");
    });

    it("should be able to add a project", async function () {
      let { fauna, addr1 } = await loadFixture(deployFauna);

      await fauna.addCuratedProject("name1", "desc1", addr1.address);
      const project = await fauna.getProject(0);

      assert.equal(project.name, "name1");
    });

    it("should emit an event", async function () {
      let { fauna, addr1 } = await loadFixture(deployFauna);

      await expect(fauna.addCuratedProject("name1", "desc1", addr1.address))
        .to.emit(fauna, "ProjectCurated")
        .withArgs(0);
    });
  });

  // VOTES

  describe("startVotes", function () {
    it("should revert if sender is not the owner", async function () {
      let { fauna, addr1 } = await loadFixture(deployFauna);

      await expect(fauna.connect(addr1).startVotes())
        .to.be.revertedWithCustomError(fauna, "OwnableUnauthorizedAccount")
        .withArgs(addr1.address);
    });

    it("should revert if not the right time to start votes", async function () {
      let { fauna, addr1 } = await loadFixture(deployFauna);
      await fauna.addCuratedProject("name1", "desc1", addr1.address);
      await fauna.startVotes();

      await expect(fauna.startVotes()).to.be.revertedWith(
        "Cannot start votes now"
      );
    });

    it("should revert if no projects have been curated", async function () {
      let { fauna } = await loadFixture(deployFauna);

      await expect(fauna.startVotes()).to.be.revertedWith(
        "No projects to vote for"
      );
    });

    it("should go to phase 1", async function () {
      let { fauna, addr1 } = await loadFixture(deployFauna);
      await fauna.addCuratedProject("name1", "desc1", addr1.address);
      await fauna.startVotes();

      const phase = await fauna.phase();

      assert.equal(phase, 1);
    });

    it("should emit an event", async function () {
      let { fauna, addr1 } = await loadFixture(deployFauna);
      await fauna.addCuratedProject("name1", "desc1", addr1.address);

      await expect(fauna.startVotes()).to.emit(fauna, "NewPhase").withArgs(1);
    });
  });

  describe("submitVote", function () {
    it("should prevent a non-donator from voting", async function () {
      let { fauna, addr1, addr2 } = await loadFixture(deployFauna);
      await fauna.addCuratedProject("name1", "desc1", addr1.address);
      await fauna.startVotes();

      await expect(fauna.connect(addr2).submitVote(0)).to.be.revertedWith(
        "Not donator"
      );
    });

    it("should revert if not the right time to vote", async function () {
      let { fauna, addr1, addr2 } = await loadFixture(deployFauna);
      await fauna.addCuratedProject("name1", "desc1", addr1.address);
      await fauna.connect(addr2).donate({ value: ethers.parseEther("1") });

      await expect(fauna.connect(addr2).submitVote(0)).to.be.revertedWith(
        "Cannot vote now"
      );
    });

    it("should revert if voter has already voted", async function () {
      let { fauna, addr1, addr2 } = await loadFixture(deployFauna);
      await fauna.addCuratedProject("name1", "desc1", addr1.address);
      await fauna.connect(addr2).donate({ value: ethers.parseEther("1") });
      await fauna.startVotes();
      await fauna.connect(addr2).submitVote(0);

      await expect(fauna.connect(addr2).submitVote(0)).to.be.revertedWith(
        "You already voted"
      );
    });

    it("should revert if project doesn't exist", async function () {
      let { fauna, addr1, addr2 } = await loadFixture(deployFauna);
      await fauna.addCuratedProject("name1", "desc1", addr1.address);
      await fauna.connect(addr2).donate({ value: ethers.parseEther("1") });
      await fauna.startVotes();

      await expect(fauna.connect(addr2).submitVote(1)).to.be.revertedWith(
        "Unknown project"
      );
    });

    it("should take into account the vote on the voter's side", async function () {
      let { fauna, addr1, addr2 } = await loadFixture(deployFauna);
      await fauna.addCuratedProject("name1", "desc1", addr1.address);
      await fauna.addCuratedProject("name2", "desc2", addr1.address);
      await fauna.connect(addr2).donate({ value: ethers.parseEther("1") });
      await fauna.startVotes();
      await fauna.connect(addr2).submitVote(1);

      const donator = await fauna.connect(addr2).getDonator(addr2.address);

      assert.equal(donator.votedProjectId, 1);
      assert.equal(donator.hasVoted, true);
    });

    it("should take into account the vote on the project's side", async function () {
      let { fauna, addr1, addr2 } = await loadFixture(deployFauna);
      await fauna.addCuratedProject("name1", "desc1", addr1.address);
      const project = await fauna.getProject(0);
      const initialVoteCount = project.voteCount;

      await fauna.connect(addr2).donate({ value: ethers.parseEther("1") });
      await fauna.startVotes();
      await fauna.connect(addr2).submitVote(0);

      const proj = await fauna.getProject(0);
      const newVoteCount = proj.voteCount;

      assert.equal(newVoteCount, initialVoteCount + BigInt(1));
    });

    it("should increment totalVotes", async function () {
      let { fauna, addr1, addr2 } = await loadFixture(deployFauna);
      await fauna.addCuratedProject("name1", "desc1", addr1.address);
      await fauna.connect(addr2).donate({ value: ethers.parseEther("1") });
      await fauna.startVotes();
      await fauna.connect(addr2).submitVote(0);

      const totalVotes = await fauna.totalVotes();

      assert.equal(totalVotes, 1);
    });

    it("should emit an event", async function () {
      let { fauna, addr1, addr2 } = await loadFixture(deployFauna);
      await fauna.addCuratedProject("name1", "desc1", addr1.address);
      await fauna.connect(addr2).donate({ value: ethers.parseEther("1") });
      await fauna.startVotes();

      await expect(fauna.connect(addr2).submitVote(0))
        .to.emit(fauna, "Voted")
        .withArgs(addr2.address, 0);
    });
  });

  describe("endVotes", function () {
    it("should revert if sender is not the owner", async function () {
      let { fauna, addr1 } = await loadFixture(deployFauna);

      await expect(fauna.connect(addr1).endVotes())
        .to.be.revertedWithCustomError(fauna, "OwnableUnauthorizedAccount")
        .withArgs(addr1.address);
    });

    it("should revert if not the right time to end votes", async function () {
      let { fauna } = await loadFixture(deployFauna);

      await expect(fauna.endVotes()).to.be.revertedWith("Cannot end votes now");
    });

    it("should revert if no votes have been submitted", async function () {
      let { fauna, addr1 } = await loadFixture(deployFauna);
      await fauna.addCuratedProject("name1", "desc1", addr1.address);
      await fauna.startVotes();

      await expect(fauna.endVotes()).to.be.revertedWith(
        "No votes submitted yet"
      );
    });

    it("should go to phase 2", async function () {
      let { fauna, addr1, addr2 } = await loadFixture(deployFauna);
      await fauna.addCuratedProject("name1", "desc1", addr1.address);
      await fauna.connect(addr2).donate({ value: ethers.parseEther("1") });
      await fauna.startVotes();
      await fauna.connect(addr2).submitVote(0);
      await fauna.endVotes();

      const phase = await fauna.phase();

      assert.equal(phase, 2);
    });

    it("should emit an event", async function () {
      let { fauna, addr1 } = await loadFixture(deployFauna);
      await fauna.addCuratedProject("name1", "desc1", addr1.address);
      await fauna.connect(addr2).donate({ value: ethers.parseEther("1") });
      await fauna.startVotes();
      await fauna.connect(addr2).submitVote(0);

      await expect(fauna.endVotes()).to.emit(fauna, "NewPhase").withArgs(2);
    });
  });
});
